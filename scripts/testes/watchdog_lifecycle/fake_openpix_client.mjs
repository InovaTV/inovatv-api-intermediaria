let porOpId = {};
let consultas = [];
let ganchoAoConsultar = null;

export function _definir(opId, resposta) { porOpId[opId] = resposta; }
export function consultasRegistradas() { return consultas; }
// Gancho pra simular uma CORRIDA: roda mid-flight, enquanto reconciliarSePago /
// reconciliarPagamentoRenovacao esta' "esperando" a Woovi -- ex.: o webhook real
// avancando o token nesse instante.
export function _aoConsultar(fn) { ganchoAoConsultar = fn; }
export function resetar() { porOpId = {}; consultas = []; ganchoAoConsultar = null; }

export async function consultarCobrancaOpenPix(opId) {
  consultas.push(opId);
  if (ganchoAoConsultar) await ganchoAoConsultar(opId);
  return porOpId[opId] ?? { outcome: "not_found" };
}
