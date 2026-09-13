// Redireciona _shared/supabase_client.ts -> fake deste diretorio.
// _shared/tokens_renovacao.ts e _shared/renovacoes_lote.ts ficam REAIS
// (so' o cliente de banco e' fake) -- mesmo padrao de
// scripts/testes/renovacoes_lote/mock-loader.mjs.
const BASE = new URL("./", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith("_shared/supabase_client.ts") || specifier.endsWith("/supabase_client.ts")) {
    return nextResolve(new URL("fake_supabase_client.mjs", BASE).href, context);
  }
  return nextResolve(specifier, context);
}
