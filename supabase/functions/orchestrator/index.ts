// Orquestrador da IA -- nucleo minimo (Componente 1, inovatv_central
// CLAUDE.md, frente "IA propria"). Etapa 4 da sequencia de
// implementacao (docs/IMPLEMENTATION.md).
//
// Prova SO o passo 0 do fluxo (Componente 1 §6, revisado 2026-08-15):
// identificar a conversa pelo telefone, consultar conversas_estado, e
// decidir entre registrar mensagem (aguardando_humano, para ali) ou
// seguir fluxo normal. NAO chama /match, /status nem Gemini ainda --
// isso e' a etapa 5, deliberadamente fora de escopo aqui.
//
// Entrada temporaria para teste direto -- o Webhook real (Componente
// 3) ainda nao existe nesta etapa, chega depois. Formato provisorio,
// so para validar o nucleo:
//   POST { telefone: string, conteudo: string }

import { jsonResponse, errorResponse } from "../_shared/http.ts";
import { buscarOuCriarConversa } from "../_shared/conversas_estado.ts";
import { inserirMensagem } from "../_shared/mensagens_atendimento.ts";

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

  // estado === 'normal': o nucleo minimo prova so ate aqui. /match,
  // /status e Gemini entram na etapa 5, nunca nesta.
  return jsonResponse({
    outcome: "normal",
    conversation_id: conversa.conversation_id,
    proximo_passo:
      "integracao com /match, /status e Gemini (etapa 5, ainda nao implementada)",
  });
});
