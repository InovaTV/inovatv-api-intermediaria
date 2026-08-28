// Redireciona _shared/supabase_client.ts -> fake deste diretorio.
// _shared/tokens_renovacao.ts fica REAL (renovacoes_lote.ts importa
// hashToken de la' -- funcao pura de crypto, sem I/O).
const BASE = new URL("./", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith("_shared/supabase_client.ts") || specifier.endsWith("/supabase_client.ts")) {
    return nextResolve(new URL("fake_supabase_client.mjs", BASE).href, context);
  }
  return nextResolve(specifier, context);
}
