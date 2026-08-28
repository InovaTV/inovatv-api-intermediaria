// Fake do pacote npm "playwright", so' pra permitir importar o
// arquivo REAL scripts/renovacao-sigma-workflow.mjs neste ambiente de
// teste (playwright so' e' instalado dentro do job do GitHub Actions,
// via `npm install playwright@1.47.0`, nao faz parte de node_modules
// deste repositorio localmente).
//
// launch() lanca erro de proposito -- os cenarios deste teste nunca
// devem alcancar o Playwright de verdade (o bail-out acontece sempre
// antes, por desenho). Se launch() for chamado, e' sinal de que o
// teste avancou mais do que deveria -- falha alta e visivel, nunca um
// browser real tentando abrir.

export const chromium = {
  async launch() {
    throw new Error("chromium.launch() nao deveria ser chamado neste teste -- cenario avancou alem do esperado");
  },
};
