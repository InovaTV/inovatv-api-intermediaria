// So' redireciona _shared/supabase_client.ts (que importa
// npm:@supabase/supabase-js@2, nao resolvivel sob tsx/Node) para um
// stub. Todo o resto e' REAL:
//   * _shared/unitv_token_diag.ts   -- o alvo do teste
//   * _shared/unitv_conta.ts        -- resolverContaUnitv + cripto reais
//   * _shared/mensagens_fixas.ts    -- constantes reais do template
//   * _shared/whatsapp_client.ts    -- real, mas nunca chamado (o teste
//                                      injeta opts.enviarTemplate)
const BASE = new URL("./", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith("_shared/supabase_client.ts") || specifier.endsWith("/supabase_client.ts")) {
    return nextResolve(new URL("fake_supabase_client.mjs", BASE).href, context);
  }
  return nextResolve(specifier, context);
}
