// painel-atendimento-responder (Componente 5 §10/§12, inovatv_central,
// Plano de Execucao, Bloco 3). Reaproveita enviarMensagemWhatsApp() de
// _shared/whatsapp_client.ts, ja existente e testado -- ZERO codigo
// novo de envio (mesmo caminho de saida do Orquestrador, Componente 1
// §15). So funciona se a conversa estiver realmente aguardando_humano
// -- nao deixa o operador responder por cima do fluxo normal so-IA.

import { verificarOperador, respostaNaoAutorizado } from "../_shared/auth_painel.ts";
import { buscarConversaPorId } from "../_shared/conversas_estado.ts";
import { inserirMensagem } from "../_shared/mensagens_atendimento.ts";
import { enviarMensagemWhatsApp } from "../_shared/whatsapp_client.ts";
import { jsonResponse, errorResponse, corsResponse, conversationIdValido } from "../_shared/http.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return corsResponse();
  }
  if (req.method !== "POST") {
    return errorResponse("Metodo nao suportado, use POST", 405);
  }

  const auth = await verificarOperador(req);
  if (!auth.autorizado) return respostaNaoAutorizado(auth.motivo);

  let body: { conversation_id?: string; texto?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Corpo da requisicao precisa ser JSON valido");
  }

  if (!body.conversation_id || !body.texto?.trim()) {
    return errorResponse("Campos obrigatorios: conversation_id, texto");
  }
  if (!conversationIdValido(body.conversation_id)) {
    return errorResponse("conversation_id precisa ser um UUID valido", 400);
  }

  let conversa;
  try {
    conversa = await buscarConversaPorId(body.conversation_id);
  } catch {
    return jsonResponse({ outcome: "unavailable" }, 503);
  }

  if (!conversa) {
    return jsonResponse({ outcome: "nao_encontrada" }, 404);
  }

  if (conversa.estado !== "aguardando_humano") {
    return jsonResponse({ outcome: "conversa_nao_esta_aguardando_humano" }, 409);
  }

  const envio = await enviarMensagemWhatsApp(conversa.telefone, body.texto);
  if (envio.outcome !== "success") {
    return jsonResponse({ outcome: "falha_envio" }, 502);
  }

  try {
    await inserirMensagem(
      conversa.conversation_id,
      "humano",
      body.texto,
      conversa.episodio_atual_id,
    );
  } catch {
    // Best-effort de log -- a mensagem ja foi enviada de verdade ao
    // cliente (confirmado acima), uma falha so' no registro nunca pode
    // ser reportada ao operador como falha de envio.
  }

  return jsonResponse({ outcome: "enviada" });
});
