// Mesmo padrao de scripts/testes/watchdog_lifecycle/fake_cobrancas_pix.mjs.
let cobrancas = [];
export function _seed(lista) {
  cobrancas = lista.map((c) => ({ ...c }));
}
export function _all() {
  return cobrancas;
}
export function resetar() {
  cobrancas = [];
}

export async function buscarCobrancaPorOperacaoId(opId) {
  const c = cobrancas.find((x) => x.operacao_id === opId);
  return c ? { ...c } : null;
}
