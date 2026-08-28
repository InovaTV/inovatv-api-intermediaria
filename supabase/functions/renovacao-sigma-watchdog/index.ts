// Watchdog do Bloco 2 (2026-08-24) -- ultima camada de seguranca do
// timeout/falha (desenho aprovado, inovatv_central/CLAUDE.md).
// Acionado pelo cron job "renovacao-sigma-watchdog" (pg_net, a cada
// 5min) -- ver migration 20260824130000_tokens_renovacao.sql.
//
// Garante que nenhuma solicitacao fica presa em
// 'renovacao_em_andamento' pra sempre, mesmo se o callback do job do
// GitHub Actions nunca chegar (job morto, GitHub fora do ar, excecao
// nao tratada que escapou do try/catch do proprio job). Janela: 15
// minutos (decisao aprovada) -- bem mais que o timeout do proprio job
// (5 minutos), entao so' pega casos genuinamente presos, nunca um job
// ainda rodando normalmente.
//
// Reaproveita EXATAMENTE o mesmo caminho de
// marcarResultadoRenovacao("resultado_ambiguo", ...) que o callback
// real usaria -- nao e' um mecanismo novo, so' um chamador diferente
// (tempo, nao HTTP) do mesmo codigo.

import { errorResponse, jsonResponse } from "../_shared/http.ts";
import {
  buscarRenovacoesEmAndamentoAntigas,
  marcarResultadoRenovacao,
  buscarAutorizacoesOrfasAntigas,
  marcarAutorizacaoComoFalha,
} from "../_shared/tokens_renovacao.ts";
import {
  buscarLotesEmAndamentoAntigos,
  buscarLotesAutorizadosOrfaosAntigos,
  buscarFilhosDoLote,
  marcarResultadoFilhoLote,
  marcarEstadoFinalLote,
  marcarLoteComoFalha,
} from "../_shared/renovacoes_lote.ts";
import { acionarTransferenciaHumana } from "../_shared/conversas_estado.ts";
import { notificarTransferenciaHumana } from "../_shared/notificacao_transferencia.ts";
import { inserirMensagem } from "../_shared/mensagens_atendimento.ts";
import { montarMensagemResultadoLote } from "../_shared/mensagens_fixas.ts";
import { enviarMensagemWhatsApp } from "../_shared/whatsapp_client.ts";

const JANELA_MINUTOS = 15;

Deno.serve(async (req: Request) => {
  const tokenInterno = Deno.env.get("RENOVACAO_SIGMA_WATCHDOG_TOKEN");
  const tokenRecebido = req.headers.get("X-Internal-Token");
  if (!tokenInterno || !tokenRecebido || tokenRecebido !== tokenInterno) {
    return errorResponse("Nao autorizado", 401);
  }

  const presos = await buscarRenovacoesEmAndamentoAntigas(JANELA_MINUTOS);
  // Correcao de risco (2026-08-24, revisao do Bloco 2): backstop pro
  // caso raro (queda de processo/plataforma) em que um token fica
  // preso em 'autorizada' sem nunca ter chegado a ter uma cobranca
  // vinculada -- o caminho normal (falha ao criar cobranca na OpenPix)
  // ja se auto-recupera na hora, direto em confirmacao-renovacao/
  // index.ts; isto aqui so' cobre o que escapar daquele caminho.
  // NUNCA inclui tokens com operacao_id ja vinculado (aguardando
  // pagamento legitimamente, ver buscarAutorizacoesOrfasAntigas).
  const autorizacoesOrfas = await buscarAutorizacoesOrfasAntigas(JANELA_MINUTOS);

  // Renovacao em lote (Etapa 1, 2026-08-29): mesma janela, mesmo
  // principio -- um lote preso em 'renovacao_em_andamento' sem callback
  // vira 'falhou', filhos ainda em andamento viram
  // 'renovacao_indeterminada', e uma transferencia humana e' acionada
  // no nivel da conversa.
  const lotesPresos = await buscarLotesEmAndamentoAntigos(JANELA_MINUTOS);

  // Backstop lote (Etapa 1, 2026-08-29) -- equivalente de
  // autorizacoesOrfas: lote preso em 'autorizada' sem cobranca
  // vinculada apos a janela (queda entre criarCobrancaOpenPix e
  // vincularOperacaoAoLote). Sem pagamento -> NUNCA envia a mensagem
  // consolidada ("Pagamento confirmado" seria falso); usa o mesmo
  // caminho da autorizacao orfa individual (aviso de transferencia +
  // acesso liberado).
  const lotesOrfaos = await buscarLotesAutorizadosOrfaosAntigos(JANELA_MINUTOS);

  if (
    presos.length === 0 &&
    autorizacoesOrfas.length === 0 &&
    lotesPresos.length === 0 &&
    lotesOrfaos.length === 0
  ) {
    return jsonResponse({ outcome: "nenhuma_presa" });
  }

  const processados: string[] = [];
  for (const token of presos) {
    if (!token.operacao_id) continue; // nunca deveria acontecer (renovacao_em_andamento sempre tem operacao_id), defensivo

    const atualizado = await marcarResultadoRenovacao(token.operacao_id, "resultado_ambiguo", {
      motivo: `watchdog: sem callback apos ${JANELA_MINUTOS} minutos`,
    });
    if (!atualizado) continue; // ja processado por outro caminho enquanto o watchdog rodava -- idempotencia

    try {
      await inserirMensagem(
        atualizado.conversation_id,
        "sistema",
        `Watchdog: renovação Sigma sem resposta após ${JANELA_MINUTOS} minutos -- marcada como resultado_ambiguo.`,
        null,
      );
    } catch {
      // best-effort
    }

    const motivoTimeout = "renovacao_sigma:watchdog_timeout";
    let transferenciaAcionada = false;
    try {
      const transferencia = await acionarTransferenciaHumana(
        atualizado.conversation_id,
        motivoTimeout,
        "(renovacao Sigma pos-pagamento)",
        "",
      );
      transferenciaAcionada = transferencia.outcome === "acionada";
    } catch (erro) {
      console.log("[renovacao-sigma-watchdog] falha ao acionar transferencia humana", String(erro));
    }
    await notificarTransferenciaHumana(atualizado.telefone, motivoTimeout, transferenciaAcionada, atualizado.conversation_id);

    processados.push(token.operacao_id);
  }

  const autorizacoesProcessadas: string[] = [];
  for (const token of autorizacoesOrfas) {
    const atualizado = await marcarAutorizacaoComoFalha(
      token.id,
      `watchdog: autorizado sem cobranca vinculada apos ${JANELA_MINUTOS} minutos`,
    );
    if (!atualizado) continue; // ja resolvido por outro caminho enquanto o watchdog rodava -- idempotencia

    try {
      await inserirMensagem(
        atualizado.conversation_id,
        "sistema",
        `Watchdog: renovação autorizada sem cobrança criada após ${JANELA_MINUTOS} minutos -- marcada como falha, acesso liberado para nova solicitação.`,
        null,
      );
    } catch {
      // best-effort
    }

    const motivoOrfa = "renovacao:watchdog_autorizacao_orfa";
    let transferenciaAcionada = false;
    try {
      const transferencia = await acionarTransferenciaHumana(
        atualizado.conversation_id,
        motivoOrfa,
        "(renovacao Sigma -- ACEITO sem cobranca vinculada)",
        "",
      );
      transferenciaAcionada = transferencia.outcome === "acionada";
    } catch (erro) {
      console.log("[renovacao-sigma-watchdog] falha ao acionar transferencia humana (autorizacao orfa)", String(erro));
    }
    await notificarTransferenciaHumana(atualizado.telefone, motivoOrfa, transferenciaAcionada, atualizado.conversation_id);

    autorizacoesProcessadas.push(token.id);
  }

  const lotesProcessados: string[] = [];
  for (const lote of lotesPresos) {
    const loteFinalizado = await marcarEstadoFinalLote(lote.grupo_id, "falhou");
    if (!loteFinalizado) continue; // ja finalizado por outro caminho -- idempotencia

    const filhos = await buscarFilhosDoLote(lote.grupo_id);
    for (const filho of filhos) {
      if (filho.estado === "renovacao_em_andamento") {
        await marcarResultadoFilhoLote(filho.id, "renovacao_indeterminada", {
          motivo: `watchdog: sem callback apos ${JANELA_MINUTOS} minutos`,
        }).catch(() => {});
      }
    }

    try {
      await inserirMensagem(
        lote.conversation_id,
        "sistema",
        `Watchdog: renovação em lote sem resposta após ${JANELA_MINUTOS} minutos -- marcada como falha.`,
        null,
      );
    } catch {
      // best-effort
    }

    const textoCliente = montarMensagemResultadoLote(
      filhos.map((f) => ({
        nome: f.cliente_nome,
        servidorNome: f.servidor_nome,
        sucesso: f.estado === "renovacao_concluida",
        vencimentoFormatado: f.vencimento_confirmado
          ? new Date(f.vencimento_confirmado).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
          : null,
      })),
    );
    const envio = await enviarMensagemWhatsApp(lote.telefone, textoCliente);
    if (envio.outcome === "success") {
      await inserirMensagem(lote.conversation_id, "ia", textoCliente, null).catch(() => {});
    }

    const motivoLote = "renovacao_lote:watchdog_timeout";
    let transferenciaAcionada = false;
    try {
      const transferencia = await acionarTransferenciaHumana(
        lote.conversation_id,
        motivoLote,
        "(renovacao em lote pos-pagamento)",
        "",
      );
      transferenciaAcionada = transferencia.outcome === "acionada";
    } catch (erro) {
      console.log("[renovacao-sigma-watchdog] falha ao acionar transferencia humana (lote)", String(erro));
    }
    // avisarCliente: false -- a mensagem consolidada acima ja e' a
    // unica mensagem ao cliente (ela ja diz "um atendente vai
    // concluir"). Estado + aviso ao Jose continuam.
    await notificarTransferenciaHumana(lote.telefone, motivoLote, transferenciaAcionada, lote.conversation_id, {
      avisarCliente: false,
    });

    lotesProcessados.push(lote.grupo_id);
  }

  // Backstop lote orfao: lote preso em 'autorizada' sem cobranca
  // vinculada. Sem pagamento -> mesma disciplina da autorizacao orfa
  // individual (aviso de transferencia ao cliente + acesso liberado),
  // NUNCA a mensagem consolidada de "pagamento confirmado".
  const lotesOrfaosProcessados: string[] = [];
  for (const lote of lotesOrfaos) {
    const loteFinalizado = await marcarLoteComoFalha(
      lote.grupo_id,
      `watchdog: lote autorizado sem cobranca vinculada apos ${JANELA_MINUTOS} minutos`,
    );
    if (!loteFinalizado) continue; // ja resolvido por outro caminho -- idempotencia

    try {
      await inserirMensagem(
        lote.conversation_id,
        "sistema",
        `Watchdog: renovação em lote autorizada sem cobrança criada após ${JANELA_MINUTOS} minutos -- marcada como falha, acessos liberados para nova solicitação.`,
        null,
      );
    } catch {
      // best-effort
    }

    const motivoOrfaLote = "renovacao_lote:watchdog_autorizacao_orfa";
    let transferenciaAcionada = false;
    try {
      const transferencia = await acionarTransferenciaHumana(
        lote.conversation_id,
        motivoOrfaLote,
        "(renovacao em lote -- ACEITO sem cobranca vinculada)",
        "",
      );
      transferenciaAcionada = transferencia.outcome === "acionada";
    } catch (erro) {
      console.log("[renovacao-sigma-watchdog] falha ao acionar transferencia humana (lote orfao)", String(erro));
    }
    await notificarTransferenciaHumana(lote.telefone, motivoOrfaLote, transferenciaAcionada, lote.conversation_id);

    lotesOrfaosProcessados.push(lote.grupo_id);
  }

  return jsonResponse({
    outcome: "processado",
    quantidade:
      processados.length +
      autorizacoesProcessadas.length +
      lotesProcessados.length +
      lotesOrfaosProcessados.length,
    operacoes: processados,
    autorizacoesOrfas: autorizacoesProcessadas,
    lotes: lotesProcessados,
    lotesOrfaos: lotesOrfaosProcessados,
  });
});
