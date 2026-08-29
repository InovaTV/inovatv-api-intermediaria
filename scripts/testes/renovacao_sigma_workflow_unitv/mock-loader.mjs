// Redireciona "playwright" (nao instalado localmente) e o executor
// congelado ./lib/unitv-renovar.mjs para fakes deste diretorio.
// scripts/renovacao-sigma-workflow.mjs continua importado REAL.
const BASE = new URL("./", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "playwright") {
    return nextResolve(new URL("fake_playwright.mjs", BASE).href, context);
  }
  if (specifier.endsWith("/lib/unitv-renovar.mjs")) {
    return nextResolve(new URL("fake_unitv_renovar.mjs", BASE).href, context);
  }
  return nextResolve(specifier, context);
}
