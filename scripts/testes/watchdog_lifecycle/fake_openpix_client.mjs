let porOpId = {};
export function _definir(opId, resposta) { porOpId[opId] = resposta; }
export function resetar() { porOpId = {}; }
export async function consultarCobrancaOpenPix(opId) {
  return porOpId[opId] ?? { outcome: "not_found" };
}
