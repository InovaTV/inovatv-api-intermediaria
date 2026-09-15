// Mesmo padrao de scripts/testes/watchdog_lifecycle/fake_openpix_client.mjs,
// incluindo o gancho de concorrencia (_aoConsultar) usado no teste de
// 2 requisicoes simultaneas.
let porOpId = {};
let consultas = [];
let ganchoAoConsultar = null;

export function _definir(opId, resposta) {
  porOpId[opId] = resposta;
}
export function consultasRegistradas() {
  return consultas;
}
export function _aoConsultar(fn) {
  ganchoAoConsultar = fn;
}
export function resetar() {
  porOpId = {};
  consultas = [];
  ganchoAoConsultar = null;
}

export async function consultarCobrancaOpenPix(opId) {
  consultas.push(opId);
  if (ganchoAoConsultar) await ganchoAoConsultar(opId);
  return porOpId[opId] ?? { outcome: "not_found" };
}
