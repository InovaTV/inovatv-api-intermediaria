// painel-atendimento-abrir (Componente 5 §8, inovatv_central, Plano de
// Execucao, Bloco 2). Historico completo de uma conversa (episodios +
// mensagens, sem limite de janela de tempo) -- abrir nunca assume o
// atendimento, e' so leitura (assumir e' o painel-atendimento-assumir,
// acao separada). Dado operacional do cliente (plano/vencimento)
// reconsultado AO VIVO via /match+/status nesta chamada -- nunca salvo
// em tabela nova (Componente 5 §8, mesmo principio ja usado no
// Orquestrador).

import { verificarOperador, respostaNaoAutorizado } from "../_shared/auth_painel.ts";
import { buscarConversaPorId, atualizarNomeSnapshot } from "../_shared/conversas_estado.ts";
import { listarEpisodios, listarMensagens } from "../_shared/mensagens_atendimento.ts";
import { chamarMatch, chamarStatus, type StatusResult } from "../_shared/rocket_intermediaria.ts";
import { jsonResponse, errorResponse, corsResponse, conversationIdValido } from "../_shared/http.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return corsResponse();
  }
  if (req.method !== "GET") {
    return errorResponse("Metodo nao suportado, use GET", 405);
  }

  const auth = await verificarOperador(req);
  if (!auth.autorizado) return respostaNaoAutorizado(auth.motivo);

  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversation_id");
  if (!conversationId) {
    return errorResponse("Parametro 'conversation_id' obrigatorio", 400);
  }
  if (!conversationIdValido(conversationId)) {
    return errorResponse("conversation_id precisa ser um UUID valido", 400);
  }

  let conversa;
  try {
    conversa = await buscarConversaPorId(conversationId);
  } catch {
    return jsonResponse({ outcome: "unavailable" }, 503);
  }

  if (!conversa) {
    return jsonResponse({ outcome: "nao_encontrada" }, 404);
  }

  let episodios, mensagens;
  try {
    [episodios, mensagens] = await Promise.all([
      listarEpisodios(conversationId),
      listarMensagens(conversationId),
    ]);
  } catch {
    return jsonResponse({ outcome: "unavailable" }, 503);
  }

  // Dado ao vivo do cliente -- best-effort, nunca derruba a abertura
  // da conversa se o Rocket estiver indisponivel (mesma disciplina do
  // Orquestrador: unavailable != no_match).
  let statusResults: StatusResult[] = [];
  try {
    const matchResult = await chamarMatch(conversa.telefone);
    if (matchResult.outcome === "single_match") {
      const candidato = matchResult.candidates[0];
      if (candidato?.publicId) statusResults = [await chamarStatus(candidato.publicId)];
    } else if (matchResult.outcome === "multiple_matches") {
      statusResults = await Promise.all(
        matchResult.candidates
          .filter((c) => !!c.publicId)
          .map((c) => chamarStatus(c.publicId as string)),
      );
    }
  } catch {
    statusResults = [];
  }

  // Painel de Atendimento -- previa da lista, Fatia 1 (2026-08-18).
  // Reforco secundario ao Orquestrador (cobre o caso raro de /match
  // ter falhado na primeira mensagem, mas funcionar quando o
  // operador abre depois). Best-effort: nunca atrasa/falha a
  // resposta que ja vai pro operador.
  const nomeReal = statusResults.find((s) => s.cliente?.nome)?.cliente?.nome;
  if (nomeReal) {
    await atualizarNomeSnapshot(conversationId, nomeReal).catch(() => {});
  }

  return jsonResponse({
    outcome: "success",
    conversa,
    episodios,
    mensagens,
    clienteAoVivo: statusResults.map((s) => ({
      outcome: s.outcome,
      linkState: s.linkState,
      cliente: s.cliente ?? null,
    })),
  });
});
