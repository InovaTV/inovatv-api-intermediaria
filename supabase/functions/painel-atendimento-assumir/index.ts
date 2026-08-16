// painel-atendimento-assumir (Componente 5 §9, inovatv_central, Plano
// de Execucao, Bloco 2 + 3). Chama a RPC unificada assumir_atendimento
// -- cobre os 2 casos (a partir de 'normal', ou de 'aguardando_humano'
// ja aberto pela IA). O operador vem do proprio token autenticado
// (auth.email), nunca de um campo livre do corpo da requisicao.

import { verificarOperador, respostaNaoAutorizado } from "../_shared/auth_painel.ts";
import { assumirAtendimento } from "../_shared/conversas_estado.ts";
import { jsonResponse, errorResponse } from "../_shared/http.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return errorResponse("Metodo nao suportado, use POST", 405);
  }

  const auth = await verificarOperador(req);
  if (!auth.autorizado) return respostaNaoAutorizado(auth.motivo);

  let body: { conversation_id?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Corpo da requisicao precisa ser JSON valido");
  }

  if (!body.conversation_id) {
    return errorResponse("Campo obrigatorio: conversation_id");
  }

  try {
    const resultado = await assumirAtendimento(body.conversation_id, auth.email);
    if (resultado.outcome === "ja_assumida") {
      return jsonResponse({ outcome: "ja_assumida" }, 409);
    }
    return jsonResponse({ outcome: "assumida", conversa: resultado.conversa });
  } catch {
    return jsonResponse({ outcome: "unavailable" }, 503);
  }
});
