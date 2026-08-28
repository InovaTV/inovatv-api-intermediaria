// Fase 4 -- primeira integracao real com o Rocket Gestor (Cenario C,
// ver ARQUITETURA_IDENTIDADE_SINCRONIZACAO.md, secao 2, inovatv_central).
// GET /gerenciador/api/v1/cliente/{public_id} no Rocket -- consulta
// direta por um public_id ja conhecido/vinculado. Nunca escreve nada
// no Rocket (sem POST/PATCH/DELETE, em nenhuma hipotese).
//
// Nunca repassa `senha` nem `device_key_or_OTP_code` (campos reais do
// Rocket) -- so o subconjunto normalizado abaixo. Nunca repassa o
// `detail` cru de erro do Rocket para quem chamou.
//
// `ROCKET_BASE_URL` e `ROCKET_API_KEY` vem exclusivamente de secrets
// desta funcao -- nunca aparecem em codigo, nunca sao devolvidos em
// nenhuma resposta.
//
// Invocada como .../functions/v1/status/{public_id} -- o public_id e'
// lido do ultimo segmento do path, nao de query string.

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeCliente(cliente: Record<string, unknown>) {
  const plano = cliente.plano as Record<string, unknown> | null;
  const servidor = cliente.servidor as Record<string, unknown> | null;

  return {
    nome: cliente.nome ?? null,
    vencimento: cliente.vencimento ?? null,
    planoNome: plano?.nome ?? null,
    servidorNome: servidor?.nome ?? null,
    telas: cliente.telas ?? null,
    // `valor` exposto (2026-08-28) so' pra apresentacao na lista de
    // multiplos acessos da renovacao -- campo JA existente no cadastro
    // do Rocket, repassado sem transformacao (mesmo estilo dos demais).
    // Continua NUNCA repassando senha/device_key_or_OTP_code.
    valor: cliente.valor ?? null,
  };
}

Deno.serve(async (req: Request) => {
  const now = new Date().toISOString();
  const rocketBaseUrl = Deno.env.get("ROCKET_BASE_URL");
  const rocketApiKey = Deno.env.get("ROCKET_API_KEY");

  if (!rocketBaseUrl || !rocketApiKey) {
    return new Response(
      JSON.stringify({
        outcome: "unavailable",
        linkState: "unlinked",
        publicId: null,
        syncedAt: now,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const publicId = segments[segments.length - 1] ?? "";

  if (!UUID_PATTERN.test(publicId)) {
    return new Response(
      JSON.stringify({
        outcome: "invalid_request",
        linkState: "unlinked",
        publicId: null,
        syncedAt: now,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  let rocketResponse: Response;
  try {
    rocketResponse = await fetch(
      `${rocketBaseUrl}/gerenciador/api/v1/cliente/${publicId}`,
      { headers: { "X-API-Key": rocketApiKey } },
    );
  } catch {
    return new Response(
      JSON.stringify({
        outcome: "unavailable",
        linkState: "unlinked",
        publicId: null,
        syncedAt: now,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  if (rocketResponse.status === 404) {
    return new Response(
      JSON.stringify({
        outcome: "success",
        linkState: "unlinked",
        publicId: null,
        syncedAt: now,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  if (!rocketResponse.ok) {
    return new Response(
      JSON.stringify({
        outcome: "unavailable",
        linkState: "unlinked",
        publicId: null,
        syncedAt: now,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  const data = await rocketResponse.json();
  const cliente = (data?.cliente ?? {}) as Record<string, unknown>;

  return new Response(
    JSON.stringify({
      outcome: "success",
      linkState: "linked",
      publicId,
      syncedAt: now,
      cliente: normalizeCliente(cliente),
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
