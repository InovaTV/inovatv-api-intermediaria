// Fase 3 (esqueleto minimo) -- prova unicamente que o caminho
// Central -> HTTPS -> Edge Function -> JSON mock funciona de ponta a
// ponta. Nome e formato desta funcao sao temporarios e descartaveis --
// NAO correspondem a /match, /link ou /status definitivos, que serao
// desenhados quando a integracao real com o Rocket Gestor existir
// (ver inovatv_central/docs/identidade_sincronizacao/).
//
// Escopo desta fase, deliberadamente: sem banco, sem vinculo, sem
// cache, sem Rocket, sem X-API-Key, sem autenticacao definitiva.
// Protecao de acesso: so a verificacao nativa de JWT/anon key do
// proprio Supabase (nenhum codigo de autenticacao aqui) -- isso NAO e
// identidade do dispositivo nem autenticacao definitiva da Central,
// so uma barreira basica contra chamada anonima aleatoria.

Deno.serve(async (_req: Request) => {
  const body = {
    outcome: "success",
    linkState: "unlinked",
    publicId: null,
    syncedAt: "2026-08-11T00:00:00Z",
  };

  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
});
