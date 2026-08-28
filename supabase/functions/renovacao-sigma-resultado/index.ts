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
} from "../_shared/tokens_renovacao.ts";
import { acionarTransferenciaHumana } from "../_shared/conversas_estado.ts";
import { notificarTransferenciaHumana } from "../_shared/notificacao_transferencia.ts";
import { inserirMensagem } from "../_shared/mensagens_atendimento.ts";
import { enviarTemplateWhatsApp } from "../_shared/whatsapp_client.ts";
import {
  NOME_TEMPLATE_PAGAMENTO_CONFIRMADO,
  IDIOMA_TEMPLATE_PAGAMENTO_CONFIRMADO,
  montarTextoConfirmacaoPagamentoRenovacao,
} from "../_shared/mensagens_fixas.ts";

const RESULTADOS_VALIDOS: ResultadoRenovacaoSigma[] = [
  "sucesso",
  "falha",
  "sessao_expirada",
  "resultado_ambiguo",
];

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
    resultado?: string;
    vencimentoConfirmado?: string;
    detalhe?: string;
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Corpo da requisicao precisa ser JSON valido");
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
