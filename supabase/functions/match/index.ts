// Fase 4 -- primeira integracao real com o Rocket Gestor (Cenario B,
// ver ARQUITETURA_IDENTIDADE_SINCRONIZACAO.md, secao 2, inovatv_central).
// GET /gerenciador/api/v1/clientes/ no Rocket -- busca multi-campo.
// Nunca escreve nada no Rocket (sem POST/PATCH/DELETE, em nenhuma
// hipotese).
//
// 0/1/N candidatos decididos exclusivamente por paginacao.total da
// resposta do Rocket -- nunca por itens.length isolado.
//
// Nunca repassa `senha` nem `device_key_or_OTP_code`. Cada candidato
// devolve so publicId/nome/usuario -- nunca telefone/mac/pix/email
// completos de um candidato ainda nao confirmado. Nunca repassa o
// `detail` cru de erro do Rocket para quem chamou.
//
// `ROCKET_BASE_URL` e `ROCKET_API_KEY` vem exclusivamente de secrets
// desta funcao -- nunca aparecem em codigo, nunca sao devolvidos em
// nenhuma resposta.
//
// Sem cache, sem coalescencia de requisicoes concorrentes nesta fase
// -- deliberadamente fora de escopo (fica para fase propria de cache).

const ALLOWED_PARAMS = [
  "nome",
  "usuario",
  "telefone",
  "email",
  "mac",
  "pix",
  "link_m3u",
  "painel_id",
  "busca",
];

function normalizeCandidate(cliente: Record<string, unknown>) {
  return {
    publicId: cliente.id ?? null,
    nome: cliente.nome ?? null,
    usuario: cliente.usuario ?? null,
  };
}

Deno.serve(async (req: Request) => {
  const rocketBaseUrl = Deno.env.get("ROCKET_BASE_URL");
  const rocketApiKey = Deno.env.get("ROCKET_API_KEY");

  if (!rocketBaseUrl || !rocketApiKey) {
    return new Response(
      JSON.stringify({ outcome: "unavailable", candidates: [] }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  const url = new URL(req.url);
  const forwarded = new URLSearchParams();

  for (const key of ALLOWED_PARAMS) {
    const value = url.searchParams.get(key);
    if (value) forwarded.set(key, value);
  }

  if ([...forwarded.keys()].length === 0) {
    return new Response(
      JSON.stringify({ outcome: "invalid_request", candidates: [] }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  forwarded.set("page", "1");
  forwarded.set("page_size", "10");

  let rocketResponse: Response;
  try {
    rocketResponse = await fetch(
      `${rocketBaseUrl}/gerenciador/api/v1/clientes/?${forwarded.toString()}`,
      { headers: { "X-API-Key": rocketApiKey } },
    );
  } catch {
    return new Response(
      JSON.stringify({ outcome: "unavailable", candidates: [] }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  if (!rocketResponse.ok) {
    return new Response(
      JSON.stringify({ outcome: "unavailable", candidates: [] }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  const data = await rocketResponse.json();
  const total = data?.paginacao?.total ?? 0;
  const itens = Array.isArray(data?.itens) ? data.itens : [];

  const outcome =
    total === 0 ? "no_match" : total === 1 ? "single_match" : "multiple_matches";

  return new Response(
    JSON.stringify({
      outcome,
      candidates: itens.map(normalizeCandidate),
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
