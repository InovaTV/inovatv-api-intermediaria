// painel-atendimento-marcar-visto (Componente 5, Painel de
// Atendimento -- Aviso de Novas Mensagens, Fatia 2, inovatv_central,
// "Planejamento -- Aviso de Novas Mensagens", decisao 3). Marca
// conversas_estado.visto_em = now() para a conversa informada.
// Endpoint dedicado, deliberadamente separado de
// painel-atendimento-abrir -- decisao aprovada explicitamente pelo
// usuario: abrir permanece estritamente leitura, nunca dispara esta
// mutacao sozinha, mesmo custando uma chamada HTTP extra ao frontend.

import { verificarOperador, respostaNaoAutorizado } from "../_shared/auth_painel.ts";
import { marcarVisto } from "../_shared/conversas_estado.ts";
import { jsonResponse, errorResponse, corsResponse } from "../_shared/http.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return corsResponse();
  }
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
    const resultado = await marcarVisto(body.conversation_id);
    if (resultado.outcome === "nao_encontrada") {
      return jsonResponse({ outcome: "nao_encontrada" }, 404);
    }
    return jsonResponse({ outcome: "marcada", conversa: resultado.conversa });
  } catch {
    return jsonResponse({ outcome: "unavailable" }, 503);
  }
});
