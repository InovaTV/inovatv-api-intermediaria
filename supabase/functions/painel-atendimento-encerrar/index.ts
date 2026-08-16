// painel-atendimento-encerrar (Componente 5 §11, inovatv_central,
// Plano de Execucao, Bloco 3). Chama encerrar_atendimento_humano --
// fecha o episodio (nunca apaga), devolve a conversa a 'normal'. O
// operador vem do token autenticado, nao de campo livre do corpo.

import { verificarOperador, respostaNaoAutorizado } from "../_shared/auth_painel.ts";
import { encerrarAtendimento } from "../_shared/conversas_estado.ts";
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
    const resultado = await encerrarAtendimento(body.conversation_id, auth.email);
    if (resultado.outcome === "nao_estava_aguardando_humano") {
      return jsonResponse({ outcome: "nao_estava_aguardando_humano" }, 409);
    }
    return jsonResponse({ outcome: "encerrada", conversa: resultado.conversa });
  } catch {
    return jsonResponse({ outcome: "unavailable" }, 503);
  }
});
