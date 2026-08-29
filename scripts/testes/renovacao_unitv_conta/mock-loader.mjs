// Redireciona _shared/unitv_conta.ts -> fake deste diretorio.
// _shared/http.ts fica REAL. O index.ts alvo e' importado real.
const BASE = new URL("./", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith("_shared/unitv_conta.ts") || specifier.endsWith("/unitv_conta.ts")) {
    return nextResolve(new URL("fake_unitv_conta.mjs", BASE).href, context);
  }
  return nextResolve(specifier, context);
}
