// Orquestrador da IA (Componente 1, inovatv_central CLAUDE.md, frente
// "IA propria"). Etapas 4+5 da sequencia de implementacao
// (docs/IMPLEMENTATION.md).
//
// Passo 0 (Componente 1 §6, revisado 2026-08-15, Etapa 4): identifica
// a conversa pelo telefone, consulta conversas_estado, decide entre
// registrar mensagem (aguardando_humano, para ali) ou seguir fluxo
// normal.
//
// Fluxo normal (Etapa 5, escopo aprovado 2026-08-16): encadeia
// /match -> /status -> contexto minimo -> Gemini, devolvendo so a
// decisao estruturada {tipo, texto}. Deliberadamente NAO grava
// aguardando_humano quando tipo === "transferir", NAO roda validador,
// NAO envia WhatsApp -- proxima etapa, sem excecao.
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

  // estado === 'normal' (Etapa 5): encadeia /match, /status, contexto
  // minimo e Gemini, devolvendo so a decisao estruturada. NAO grava
  // aguardando_humano, NAO roda validador, NAO envia WhatsApp -- isso
  // fica deliberadamente para a proxima etapa (escopo aprovado
  // 2026-08-16).
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
    gemini:
      geminiResult.outcome === "success"
        ? geminiResult.data
        : { outcome: "unavailable" },
  });
});
