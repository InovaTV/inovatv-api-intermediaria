let disparos = [];
let resultado = { outcome: "disparado" };
export function disparosRegistrados() { return disparos; }
export function _definirResultado(r) { resultado = r; }
export function resetar() { disparos = []; resultado = { outcome: "disparado" }; }
export async function dispararWorkflowRenovacaoSigma(opId) {
  disparos.push(opId);
  return resultado;
}
