// Utilitarios de resposta HTTP -- evita repetir o boilerplate de
// Response/JSON.stringify em cada function nova.

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ outcome: "error", message }, status);
}
