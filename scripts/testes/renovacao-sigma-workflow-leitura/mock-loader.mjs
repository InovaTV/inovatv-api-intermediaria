// Redireciona so a dependencia externa "playwright" (nao instalada
// neste ambiente local -- so' dentro do job do GitHub Actions) para o
// fake deste diretorio. scripts/renovacao-sigma-workflow.mjs continua
// sendo importado real, sem alteracao nenhuma.
const BASE = new URL("./", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "playwright") {
    return nextResolve(new URL("fake_playwright.mjs", BASE).href, context);
  }
  return nextResolve(specifier, context);
}
