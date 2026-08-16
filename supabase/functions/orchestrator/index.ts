// Orquestrador da IA (Componente 1, inovatv_central CLAUDE.md, frente
// "IA propria"). Etapas 4+5 da sequencia de implementacao
// (docs/IMPLEMENTATION.md).
//
// Passo 0 (Componente 1 §6, revisado 2026-08-15, Etapa 4): identifica
// a conversa pelo telefone, consulta conversas_estado, decide entre
// registrar mensagem (aguardando_humano, para ali) ou seguir fluxo
// normal.
//
// Fluxo normal: encadeia /match -> /status -> contexto minimo ->
// Gemini (Etapa 5, 2026-08-16) -> Validador Deterministico (Etapa 6,
// segunda fatia, 2026-08-16) antes de liberar a resposta. Reprovado
// => resposta original nunca sai, so o motivo (gemini vira
// {outcome:"bloqueado"}). Deliberadamente NAO grava aguardando_humano
// (nem em reprovacao, nem quando tipo === "transferir"), NAO envia
// WhatsApp -- proxima fatia, sem excecao.
//
// Entrada temporaria para teste direto -- o Webhook real (Componente
// 3) ainda nao existe nesta etapa, chega depois. Formato provisorio,
// so para validar o nucleo:
//   POST { telefone: string, conteudo: string }

import { jsonResponse, errorResponse } from "../_shared/http.ts";
import { buscarOuCriarConversa } from "../_shared/conversas_estado.ts";
import { inserirMensagem } from "../_shared/mensagens_atendimento.ts";
import {
  chamarMatch,
  chamarStatus,
  type StatusResult,
} from "../_shared/rocket_intermediaria.ts";
import { montarContextoCliente } from "../_shared/contexto.ts";
import { chamarGemini } from "../_shared/gemini_client.ts";
import { validarResposta } from "../_shared/validador.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return errorResponse("Metodo nao suportado, use POST", 405);
  }

  let body: { telefone?: string; conteudo?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Corpo da requisicao precisa ser JSON valido");
  }

  const { telefone, conteudo } = body;
  if (!telefone || !conteudo) {
    return errorResponse("Campos obrigatorios: telefone, conteudo");
  }

  let conversa;
  try {
    conversa = await buscarOuCriarConversa(telefone);
  } catch {
    return jsonResponse(
      { outcome: "unavailable", message: "Falha ao consultar conversas_estado" },
      503,
    );
  }

  // Passo 0 (Componente 1 §6): aguardando_humano -- so registra e para,
  // nunca chama Gemini enquanto um humano estiver cuidando da conversa
  // (Arquitetura Formal §11).
  if (conversa.estado === "aguardando_humano") {
    try {
      const mensagem = await inserirMensagem(
        conversa.conversation_id,
        "cliente",
        conteudo,
      );
      return jsonResponse({
        outcome: "aguardando_humano",
        conversation_id: conversa.conversation_id,
        mensagem_registrada: mensagem.id,
      });
    } catch {
      return jsonResponse(
        { outcome: "unavailable", message: "Falha ao registrar mensagem" },
        503,
      );
    }
  }

  // estado === 'normal': encadeia /match, /status, contexto minimo,
  // Gemini (Etapa 5) e validador (Etapa 6, segunda fatia). NAO grava
  // aguardando_humano em nenhum caso, NAO envia WhatsApp -- proxima
  // fatia, deliberadamente fora de escopo aqui.
  const matchResult = await chamarMatch(telefone);

  let statusResults: StatusResult[] = [];
  if (matchResult.outcome === "single_match") {
    const candidato = matchResult.candidates[0];
    if (candidato?.publicId) {
      statusResults = [await chamarStatus(candidato.publicId)];
    }
  } else if (matchResult.outcome === "multiple_matches") {
    statusResults = await Promise.all(
      matchResult.candidates
        .filter((c) => !!c.publicId)
        .map((c) => chamarStatus(c.publicId as string)),
    );
  }

  const matchIndisponivel =
    matchResult.outcome === "unavailable" || matchResult.outcome === "invalid_request";

  const contextoCliente = montarContextoCliente(telefone, statusResults, {
    matchIndisponivel,
  });

  const geminiResult = await chamarGemini(conteudo, contextoCliente);

  // Etapa 6, segunda fatia (escopo aprovado): valida a saida do Gemini
  // antes de liberar. Reprovado => resposta original NUNCA sai, so o
  // motivo. Ainda NAO grava aguardando_humano, NAO envia WhatsApp --
  // proxima fatia.
  let geminiSaida: unknown = { outcome: "unavailable" };
  let validacaoResultado: { aprovado: boolean; motivo?: string } | undefined;

  if (geminiResult.outcome === "success") {
    const validacao = validarResposta(geminiResult.data, contextoCliente);
    validacaoResultado = validacao.aprovado
      ? { aprovado: true }
      : { aprovado: false, motivo: validacao.motivo };
    geminiSaida = validacao.aprovado
      ? geminiResult.data
      : { outcome: "bloqueado" };
  }

  return jsonResponse({
    outcome: "normal",
    conversation_id: conversa.conversation_id,
    match: {
      outcome: matchResult.outcome,
      candidatos_consultados: statusResults.length,
    },
    status: statusResults.map((s) => ({
      publicId: s.publicId,
      outcome: s.outcome,
      linkState: s.linkState,
    })),
    gemini: geminiSaida,
    ...(validacaoResultado ? { validacao: validacaoResultado } : {}),
  });
});
