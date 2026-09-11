// Suite dedicada a cobrir a CORRECAO do gap de duracao Sigma/Rocket
// (2026-09-11, AUDITORIA GERAL DE ENCERRAMENTO): a duracao da renovacao
// Sigma deve vir do PLANO CONTRATADO (plano_nome), nunca do pacote
// tecnico atual do Sigma. scripts/renovacao-sigma-workflow.mjs continua
// REAL, sem alteracao -- so' fakeia "playwright" (nao instalado fora do
// job do GitHub Actions).
const BASE = new URL("./", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "playwright") {
    return nextResolve(new URL("fake_playwright.mjs", BASE).href, context);
  }
  return nextResolve(specifier, context);
}
