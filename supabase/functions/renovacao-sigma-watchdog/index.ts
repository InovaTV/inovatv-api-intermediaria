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
import { acionarTransferenciaHumana } from "../_shared/conversas_estado.ts";
import { inserirMensagem } from "../_shared/mensagens_atendimento.ts";

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

  if (presos.length === 0 && autorizacoesOrfas.length === 0) {
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

    try {
      await acionarTransferenciaHumana(
        atualizado.conversation_id,
        "renovacao_sigma:watchdog_timeout",
        "(renovacao Sigma pos-pagamento)",
        "",
      );
    } catch (erro) {
      console.log("[renovacao-sigma-watchdog] falha ao acionar transferencia humana", String(erro));
    }

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

    try {
      await acionarTransferenciaHumana(
        atualizado.conversation_id,
        "renovacao:watchdog_autorizacao_orfa",
        "(renovacao Sigma -- ACEITO sem cobranca vinculada)",
        "",
      );
    } catch (erro) {
      console.log("[renovacao-sigma-watchdog] falha ao acionar transferencia humana (autorizacao orfa)", String(erro));
    }

    autorizacoesProcessadas.push(token.id);
  }

  return jsonResponse({
    outcome: "processado",
    quantidade: processados.length + autorizacoesProcessadas.length,
    operacoes: processados,
    autorizacoesOrfas: autorizacoesProcessadas,
  });
});
