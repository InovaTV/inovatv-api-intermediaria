// Redireciona _shared/unitv_conta.ts, _shared/unitv_token_diag.ts e
// _shared/unitv_dealer_token.ts -> fakes deste diretorio. _shared/http.ts
// fica REAL. O index.ts alvo e' importado real.
const BASE = new URL("./", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith("_shared/unitv_dealer_token.ts") || specifier.endsWith("/unitv_dealer_token.ts")) {
    return nextResolve(new URL("fake_unitv_dealer_token.mjs", BASE).href, context);
  }
  if (specifier.endsWith("_shared/unitv_token_diag.ts") || specifier.endsWith("/unitv_token_diag.ts")) {
    return nextResolve(new URL("fake_unitv_token_diag.mjs", BASE).href, context);
  }
  if (specifier.endsWith("_shared/unitv_conta.ts") || specifier.endsWith("/unitv_conta.ts")) {
    return nextResolve(new URL("fake_unitv_conta.mjs", BASE).href, context);
  }
  return nextResolve(specifier, context);
}
