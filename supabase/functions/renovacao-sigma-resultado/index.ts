// Callback do workflow renovacao-sigma.yml (GitHub Actions) -- Bloco 2,
// 2026-08-24 (inovatv_central/CLAUDE.md, desenho aprovado). Recebe o
// RESULTADO JA' DECIDIDO pelo job (que ja fez a reconsulta real de
// Rocket+Sigma antes de chamar aqui) -- este endpoint nunca reconsulta
// nada de novo, so' efetiva a transicao de estado e age sobre o
// resultado.
//
// "A confirmacao continua sendo a reconsulta real do Rocket/Sigma"
// (regra explicita do usuario): essa reconsulta acontece DENTRO do
// job, antes dele chamar este endpoint -- nunca aqui. Este endpoint
// confia no campo "resultado" exatamente porque ele so' existe depois
// que o job ja verificou de verdade.
//
// Autenticacao: X-Internal-Token dedicado
// (RENOVACAO_SIGMA_CALLBACK_TOKEN) -- guardado nos dois lados (secret
// do Supabase aqui, GitHub Actions Secret no workflow). NUNCA a
// SUPABASE_SERVICE_ROLE_KEY para esta chamada -- o job usa a
// service_role so' pra leitura (dados/sessao), a escrita fica atras
// deste endpoint com logica propria.
//
// Idempotencia: marcarResultadoRenovacao so' atualiza uma linha ainda
// 'renovacao_em_andamento' -- reenvio/retry do callback (ou uma
// corrida improvavel com o watchdog) nunca reprocessa, nunca reenvia
// mensagem, nunca aciona transferencia humana duas vezes.

import { errorResponse, jsonResponse } from "../_shared/http.ts";
import {
  marcarResultadoRenovacao,
  buscarTokenPorOperacaoId,
  type ResultadoRenovacaoSigma,
  type EstadoTokenRenovacao,
} from "../_shared/tokens_renovacao.ts";
import {
  buscarLotePorOperacaoId,
  buscarFilhosDoLote,
  marcarResultadoFilhoLote,
  marcarEstadoFinalLote,
} from "../_shared/renovacoes_lote.ts";
import { acionarTransferenciaHumana } from "../_shared/conversas_estado.ts";
import { notificarTransferenciaHumana } from "../_shared/notificacao_transferencia.ts";
import { inserirMensagem } from "../_shared/mensagens_atendimento.ts";
import { enviarTemplateWhatsApp, enviarMensagemWhatsApp } from "../_shared/whatsapp_client.ts";
import {
  NOME_TEMPLATE_PAGAMENTO_CONFIRMADO,
  IDIOMA_TEMPLATE_PAGAMENTO_CONFIRMADO,
  NOME_TEMPLATE_NOVA_TRANSFERENCIA,
  IDIOMA_TEMPLATE_NOVA_TRANSFERENCIA,
  montarTextoConfirmacaoPagamentoRenovacao,
  montarMensagemResultadoLote,
} from "../_shared/mensagens_fixas.ts";

// Etapa 2 (Renovacao UniTV, Bloco 4). Dessincronia: a renovacao UniTV
// deu certo no painel de revenda mas o vencimento NAO sincronizou no
// Rocket. A renovacao continua sendo SUCESSO (o cliente recebe a data
// confirmada pelo painel). Isto e' so' um heads-up interno para o Jose
// ajustar o vencimento no Rocket -- NUNCA aguardando_humano, NUNCA 2a
// mensagem ao cliente.
const MOTIVO_ROCKET_DESYNC = "renovacao_unitv:rocket_desync";

async function avisarRocketDesync(conversationId: string, textoSistema: string): Promise<void> {
  await inserirMensagem(conversationId, "sistema", textoSistema, null).catch(() => {});
  const numeroJose = Deno.env.get("WHATSAPP_JOSE_NUMERO");
  if (numeroJose) {
    await enviarTemplateWhatsApp(
      numeroJose,
      NOME_TEMPLATE_NOVA_TRANSFERENCIA,
      IDIOMA_TEMPLATE_NOVA_TRANSFERENCIA,
      [MOTIVO_ROCKET_DESYNC],
    ).catch(() => {});
  }
}

const RESULTADOS_VALIDOS: ResultadoRenovacaoSigma[] = [
  "sucesso",
  "falha",
  "sessao_expirada",
  "resultado_ambiguo",
];

// Renovacao em lote (Etapa 1, 2026-08-29): resultados possiveis de um
// FILHO do lote. "unitv_pendente" e' o stub da Etapa 2 -- o workflow
// nunca executa UniTV de verdade ainda, sempre reporta isso, e o filho
// vira renovacao_indeterminada + transferencia humana.
const RESULTADOS_FILHO_LOTE = ["sucesso", "falha", "sessao_expirada", "resultado_ambiguo", "unitv_pendente"] as const;
type ResultadoFilhoLote = (typeof RESULTADOS_FILHO_LOTE)[number];

interface ItemResultadoLote {
  token_id?: string;
  tipo?: string;
  servidor_nome?: string;
  cliente_nome?: string;
  resultado?: string;
  vencimentoConfirmado?: string;
  detalhe?: string;
  // Etapa 2 (Bloco 4): filho UniTV renovou no painel mas o Rocket nao
  // sincronizou -- o resultado continua "sucesso".
  rocketDesync?: boolean;
}

function formatarDataBr(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

Deno.serve(async (req: Request) => {
  const tokenInterno = Deno.env.get("RENOVACAO_SIGMA_CALLBACK_TOKEN");
  const tokenRecebido = req.headers.get("X-Internal-Token");
  if (!tokenInterno || !tokenRecebido || tokenRecebido !== tokenInterno) {
    return errorResponse("Nao autorizado", 401);
  }

  if (req.method !== "POST") {
    return errorResponse("Metodo nao suportado, use POST", 405);
  }

  let body: {
    operacao_id?: string;
    grupo_id?: string;
    resultado?: string;
    resultados?: ItemResultadoLote[];
    vencimentoConfirmado?: string;
    detalhe?: string;
    // Etapa 2 (Bloco 4): individual UniTV -- renovou no painel mas o
    // Rocket nao sincronizou. resultado continua "sucesso".
    rocketDesync?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Corpo da requisicao precisa ser JSON valido");
  }

  // Renovacao em lote (Etapa 1, 2026-08-29): callback com grupo_id +
  // resultados[] -- um resultado por acesso do lote. Formato individual
  // (operacao_id + resultado) segue byte a byte abaixo.
  if (body.grupo_id) {
    return await processarResultadoLote(body);
  }

  const { operacao_id: operacaoId, resultado, vencimentoConfirmado, detalhe } = body;
  if (!operacaoId || !resultado || !RESULTADOS_VALIDOS.includes(resultado as ResultadoRenovacaoSigma)) {
    return errorResponse(
      `Campos obrigatorios: operacao_id, resultado (um de: ${RESULTADOS_VALIDOS.join(", ")})`,
    );
  }

  const registroAntes = await buscarTokenPorOperacaoId(operacaoId);
  if (!registroAntes) {
    console.log("[renovacao-sigma-resultado] operacao_id sem token correspondente", JSON.stringify({ operacaoId }));
    return jsonResponse({ outcome: "sem_token_correspondente" });
  }

  const atualizado = await marcarResultadoRenovacao(
    operacaoId,
    resultado as ResultadoRenovacaoSigma,
    { vencimentoConfirmado, motivo: detalhe },
  );

  if (!atualizado) {
    // Ja processado antes (idempotencia) -- nao reenvia mensagem, nao
    // transfere de novo.
    console.log("[renovacao-sigma-resultado] callback duplicado ou fora de estado -- ignorado", JSON.stringify({ operacaoId, resultado }));
    return jsonResponse({ outcome: "ja_processado" });
  }

  try {
    await inserirMensagem(
      atualizado.conversation_id,
      "sistema",
      `Resultado da renovação Sigma: ${resultado}${detalhe ? " -- " + detalhe : ""}`,
      null,
    );
  } catch {
    // best-effort
  }

  if (resultado === "sucesso") {
    const vencimentoFormatado = vencimentoConfirmado ? formatarDataBr(vencimentoConfirmado) : "";
    const parametrosTemplate = [
      atualizado.cliente_nome,
      atualizado.plano_nome,
      atualizado.servidor_nome,
      vencimentoFormatado,
    ];
    const envio = await enviarTemplateWhatsApp(
      atualizado.telefone,
      NOME_TEMPLATE_PAGAMENTO_CONFIRMADO,
      IDIOMA_TEMPLATE_PAGAMENTO_CONFIRMADO,
      parametrosTemplate,
    );
    if (envio.outcome === "success") {
      // Bloco de renovacao 2026-08-28 (C4): grava no historico do
      // Painel exatamente o texto que o cliente recebeu. O envio real
      // e' o template acima; isto e' so' registro. Best-effort, nunca
      // desfaz nem bloqueia o resultado ja processado.
      await inserirMensagem(
        atualizado.conversation_id,
        "ia",
        montarTextoConfirmacaoPagamentoRenovacao({
          clienteNome: atualizado.cliente_nome,
          planoNome: atualizado.plano_nome,
          servidorNome: atualizado.servidor_nome,
          vencimentoFormatado,
        }),
        null,
      ).catch(() => {});
    }

    // Etapa 2 (Bloco 4): renovacao UniTV concluida no painel, Rocket
    // NAO sincronizado. A mensagem de sucesso ao cliente (template
    // acima) ja saiu com a data confirmada pelo painel; aqui so' o
    // heads-up interno. Nunca aguardando_humano, nunca 2a mensagem ao
    // cliente.
    if (body.rocketDesync === true) {
      await avisarRocketDesync(
        atualizado.conversation_id,
        "Renovação UniTV concluída no painel; vencimento NÃO sincronizado no Rocket -- requer ajuste manual do vencimento.",
      );
    }

    return jsonResponse({ outcome: "sucesso_processado", mensagemEnviada: envio.outcome === "success" });
  }

  // falha / sessao_expirada / resultado_ambiguo -- todas caem no mesmo
  // mecanismo generico ja existente de transferencia humana, nunca um
  // mecanismo novo.
  const motivoTransferencia = `renovacao_sigma:${resultado}`;
  let transferenciaAcionada = false;
  try {
    const transferencia = await acionarTransferenciaHumana(
      atualizado.conversation_id,
      motivoTransferencia,
      "(renovacao Sigma pos-pagamento)",
      detalhe ?? "",
    );
    transferenciaAcionada = transferencia.outcome === "acionada";
  } catch (erro) {
    console.log("[renovacao-sigma-resultado] falha ao acionar transferencia humana", String(erro));
  }
  await notificarTransferenciaHumana(atualizado.telefone, motivoTransferencia, transferenciaAcionada, atualizado.conversation_id);

  return jsonResponse({ outcome: `${resultado}_processado` });
});

// ---------------------------------------------------------------------
// Renovacao em lote (Etapa 1, 2026-08-29). Um callback por LOTE, com um
// resultado por acesso. Cada filho tem sua propria linha em
// tokens_renovacao e seu proprio estado terminal; o lote deriva
// concluida | parcial | falhou. Idempotencia: marcarResultadoFilhoLote
// e marcarEstadoFinalLote so' agem sobre linhas ainda
// 'renovacao_em_andamento' -- reenvio do callback vira no-op.
// ---------------------------------------------------------------------
function mapearEstadoFilho(resultado: ResultadoFilhoLote): EstadoTokenRenovacao {
  if (resultado === "sucesso") return "renovacao_concluida";
  if (resultado === "unitv_pendente") return "renovacao_indeterminada";
  return "renovacao_falhou";
}

async function processarResultadoLote(body: {
  operacao_id?: string;
  grupo_id?: string;
  resultados?: ItemResultadoLote[];
}): Promise<Response> {
  const operacaoId = body.operacao_id;
  const grupoId = body.grupo_id;
  const itens = body.resultados;
  if (!operacaoId || !grupoId || !Array.isArray(itens) || itens.length === 0) {
    return errorResponse("Campos obrigatorios (lote): operacao_id, grupo_id, resultados[]");
  }
  for (const it of itens) {
    if (!it.token_id || !it.resultado || !RESULTADOS_FILHO_LOTE.includes(it.resultado as ResultadoFilhoLote)) {
      return errorResponse(
        `Cada item de resultados[] precisa de token_id e resultado (um de: ${RESULTADOS_FILHO_LOTE.join(", ")})`,
      );
    }
  }

  const lote = await buscarLotePorOperacaoId(operacaoId);
  if (!lote) {
    console.log("[renovacao-sigma-resultado] lote sem correspondencia", JSON.stringify({ operacaoId, grupoId }));
    return jsonResponse({ outcome: "sem_lote_correspondente" });
  }

  const filhosAntes = await buscarFilhosDoLote(grupoId);
  const porId = new Map(filhosAntes.map((f) => [f.id, f]));

  let algumAtualizado = false;
  for (const it of itens) {
    const resultado = it.resultado as ResultadoFilhoLote;
    const atualizado = await marcarResultadoFilhoLote(it.token_id!, mapearEstadoFilho(resultado), {
      vencimentoConfirmado: it.vencimentoConfirmado ?? null,
      motivo: resultado === "sucesso" ? null : (it.detalhe ?? `renovacao_lote:${resultado}`),
    });
    if (atualizado) algumAtualizado = true;
  }

  if (!algumAtualizado) {
    console.log("[renovacao-sigma-resultado] callback de lote duplicado/fora de estado -- ignorado", JSON.stringify({ grupoId }));
    return jsonResponse({ outcome: "ja_processado" });
  }

  const totalOk = itens.filter((it) => it.resultado === "sucesso").length;
  const estadoFinal: "concluida" | "parcial" | "falhou" =
    totalOk === itens.length ? "concluida" : totalOk === 0 ? "falhou" : "parcial";

  const loteFinalizado = await marcarEstadoFinalLote(grupoId, estadoFinal);
  if (!loteFinalizado) {
    // Outra chamada (ou o watchdog) ja finalizou o lote -- nao reenvia
    // mensagem nem transfere de novo.
    return jsonResponse({ outcome: "ja_processado" });
  }

  // Log tecnico no historico do Painel.
  const resumo = itens
    .map((it, i) => `${i + 1}. ${it.servidor_nome ?? it.tipo ?? "acesso"}: ${it.resultado}${it.detalhe ? " -- " + it.detalhe : ""}`)
    .join(" | ");
  await inserirMensagem(lote.conversation_id, "sistema", `Resultado da renovação em lote (${estadoFinal}): ${resumo}`, null).catch(() => {});

  // Mensagem consolidada ao cliente -- texto livre (o template
  // renovacao_lote_resultado ainda nao foi submetido a Meta; fora da
  // janela de 24h o envio falha e cai no gap ja conhecido, so' logado).
  const textoCliente = montarMensagemResultadoLote(
    itens.map((it) => {
      const filho = it.token_id ? porId.get(it.token_id) : undefined;
      return {
        nome: it.cliente_nome ?? filho?.cliente_nome ?? "não informado",
        servidorNome: it.servidor_nome ?? filho?.servidor_nome ?? "não informado",
        sucesso: it.resultado === "sucesso",
        vencimentoFormatado: it.vencimentoConfirmado ? formatarDataBr(it.vencimentoConfirmado) : null,
      };
    }),
  );
  const envio = await enviarMensagemWhatsApp(lote.telefone, textoCliente);
  if (envio.outcome === "success") {
    await inserirMensagem(lote.conversation_id, "ia", textoCliente, null).catch(() => {});
  } else {
    console.log(
      "[renovacao-sigma-resultado] falha ao enviar resultado do lote ao cliente (possivel janela 24h) -- so' logado",
      JSON.stringify({ grupoId, outcome: envio.outcome }),
    );
  }

  // Etapa 2 (Bloco 4): algum filho UniTV renovou no painel mas o Rocket
  // nao sincronizou -> heads-up interno UMA vez, independente de
  // estadoFinal (um lote 100% sucesso com 1 filho dessincronizado e'
  // 'concluida' e nao transfere, mas ainda precisa do aviso). Nunca
  // aguardando_humano so' por dessincronia, nunca 2a mensagem ao cliente.
  if (itens.some((it) => it.rocketDesync === true)) {
    await avisarRocketDesync(
      lote.conversation_id,
      "Renovação em lote: um ou mais acessos UniTV renovaram no painel mas o vencimento NÃO sincronizou no Rocket -- requer ajuste manual.",
    );
  }

  // Qualquer acesso que nao concluiu -> transferencia humana no nivel
  // da conversa (uma so', nao por acesso). unitv_pendente tem motivo
  // proprio (Etapa 2 ainda nao integrada). avisarCliente: false -- a
  // mensagem consolidada acima ja e' a UNICA mensagem ao cliente e ja
  // diz "um atendente vai concluir esta renovacao"; nao repetir com a
  // frase generica de transferencia. O estado + o aviso ao Jose
  // continuam normais.
  if (estadoFinal !== "concluida") {
    const temUnitvPendente = itens.some((it) => it.resultado === "unitv_pendente");
    const motivo = temUnitvPendente
      ? "renovacao:unitv_pendente_integracao"
      : `renovacao_lote:${estadoFinal}`;
    let transferenciaAcionada = false;
    try {
      const t = await acionarTransferenciaHumana(lote.conversation_id, motivo, "(renovacao em lote pos-pagamento)", resumo);
      transferenciaAcionada = t.outcome === "acionada";
    } catch (erro) {
      console.log("[renovacao-sigma-resultado] falha ao acionar transferencia (lote)", String(erro));
    }
    await notificarTransferenciaHumana(lote.telefone, motivo, transferenciaAcionada, lote.conversation_id, {
      avisarCliente: false,
    });
  }

  return jsonResponse({ outcome: `lote_${estadoFinal}` });
}
