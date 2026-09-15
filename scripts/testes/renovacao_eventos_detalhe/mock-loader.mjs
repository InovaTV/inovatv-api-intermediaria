// Redireciona _shared/supabase_client.ts -> fake deste diretorio.
// auth_painel.ts, http.ts, tokens_renovacao.ts, renovacoes_lote.ts e
// renovacao_eventos.ts ficam REAIS (so' o cliente de banco e' fake) --
// mesmo padrao de scripts/testes/renovacao_status/mock-loader.mjs.
const BASE = new URL("./", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith("_shared/supabase_client.ts") || specifier.endsWith("/supabase_client.ts")) {
    return nextResolve(new URL("fake_supabase_client.mjs", BASE).href, context);
  }
  return nextResolve(specifier, context);
}
