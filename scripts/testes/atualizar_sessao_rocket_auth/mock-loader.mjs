// Redireciona SO' as dependencias que puxam npm:@supabase/supabase-js
// ou fariam rede real:
//   _shared/supabase_client.ts     -> fake (usado pelo handler REAL E
//                                     pelo verificarOperador() REAL)
//   _shared/rocket_session_check.ts -> fake (nao bate em app.rocketgestor.com)
//
// REAIS, sem nenhuma alteracao (o objetivo do teste e' justamente
// exercitar a integracao com eles):
//   _shared/auth_painel.ts
//   _shared/http.ts
//   supabase/functions/atualizar-sessao-rocket/index.ts   (o alvo)
const BASE = new URL("./", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (
    specifier.endsWith("_shared/supabase_client.ts") ||
    specifier.endsWith("/supabase_client.ts")
  ) {
    return nextResolve(new URL("fake_supabase_client.mjs", BASE).href, context);
  }
  if (
    specifier.endsWith("_shared/rocket_session_check.ts") ||
    specifier.endsWith("/rocket_session_check.ts")
  ) {
    return nextResolve(new URL("fake_rocket_session_check.mjs", BASE).href, context);
  }
  return nextResolve(specifier, context);
}
