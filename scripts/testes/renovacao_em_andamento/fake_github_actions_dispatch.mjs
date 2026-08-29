import { registrar } from "./_seq.mjs";

let proximo = { outcome: "disparado" };
let chamadas = [];

export function configurar(v) { proximo = v; }
export function chamadasFeitas() { return chamadas; }
export function resetar() {
  proximo = { outcome: "disparado" };
  chamadas = [];
}

export async function dispararWorkflowRenovacaoSigma(operacaoId) {
  chamadas.push(operacaoId);
  registrar("dispararWorkflowRenovacaoSigma");
  return proximo;
}
