const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://inovatv-api-intermediaria.vercel.app",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ outcome: "error", message }, status);
}

export function corsResponse(): Response {
  return new Response("ok", {
    status: 200,
    headers: CORS_HEADERS,
  });
}

// Achado da bateria de testes negativos do Painel de Atendimento
// (2026-08-17): um conversation_id malformado (nao-UUID) chegava sem
// checagem propria ate o Postgres, que rejeita a string antes de
// qualquer RPC customizada -- cai no catch generico de cada function
// e vira 503 "unavailable" em vez de um 400 de validacao. Corrigido
// checando o formato ANTES de qualquer chamada ao banco.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function conversationIdValido(id: string): boolean {
  return UUID_REGEX.test(id);
}