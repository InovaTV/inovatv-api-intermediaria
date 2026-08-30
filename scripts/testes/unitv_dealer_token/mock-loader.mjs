// So' redireciona _shared/supabase_client.ts (importa
// npm:@supabase/supabase-js@2, nao resolvivel sob tsx/Node) para um
// stub. O modulo alvo (_shared/unitv_dealer_token.ts) e' REAL; os
// testes injetam `supa`/`env`/`agora`, entao getServiceClient() nunca
// e' chamado de verdade.
const BASE = new URL("./", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith("_shared/supabase_client.ts") || specifier.endsWith("/supabase_client.ts")) {
    return nextResolve(new URL("fake_supabase_client.mjs", BASE).href, context);
  }
  return nextResolve(specifier, context);
}
