// painel-atendimento-listar (Componente 5 §8, inovatv_central, Plano
// de Execucao, Bloco 2). Lista TODAS as conversas, qualquer estado,
// paginada, mais recente primeiro -- nao filtra so aguardando_humano
// (isso mudou na revisao de escopo pra "Painel de Atendimento").
// Dado do cliente (nome/plano/vencimento) NAO vem aqui -- so no
// painel-atendimento-abrir, quando o operador abre uma conversa
// especifica (Componente 5 §8, minimizacao).

import { verificarOperador, respostaNaoAutorizado } from "../_shared/auth_painel.ts";
import { listarConversas } from "../_shared/conversas_estado.ts";
import { jsonResponse, errorResponse, corsResponse } from "../_shared/http.ts";

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
  const paginaParam = url.searchParams.get("pagina") ?? "1";
  const pagina = Number(paginaParam);

  if (!Number.isInteger(pagina) || pagina < 1) {
    return errorResponse("Parametro 'pagina' invalido", 400);
  }

  try {
    const { conversas, total } = await listarConversas(pagina);
    return jsonResponse({ outcome: "success", pagina, total, conversas });
  } catch {
    return jsonResponse(
      { outcome: "unavailable", pagina, total: 0, conversas: [] },
      503,
    );
  }
});
