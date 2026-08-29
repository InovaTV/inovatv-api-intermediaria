// Suite do workflow para o LOTE MISTO (1 Sigma + 1 UniTV na MESMA
// execucao de processarLote). Fakea duas dependencias:
//   - "playwright" -> fake seletor-ciente (identico ao da suite
//     renovacao-sigma-workflow-leitura) -- o filho Sigma exercita o
//     fluxo Playwright de verdade (goto/$$eval/click/select/close).
//   - ./lib/unitv-renovar.mjs -> executor congelado fakado -- o filho
//     UniTV registra os args e devolve o resultado configurado.
// scripts/renovacao-sigma-workflow.mjs continua REAL, sem alteracao.
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
