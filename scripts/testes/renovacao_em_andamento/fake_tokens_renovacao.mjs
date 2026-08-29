import { registrar } from "./_seq.mjs";

let proximo = { telefone: "5517981625486", conversation_id: "conv-1" };
let chamadas = [];

export function configurar(v) { proximo = v; }
export function chamadasFeitas() { return chamadas; }
export function resetar() {
  proximo = { telefone: "5517981625486", conversation_id: "conv-1" };
  chamadas = [];
}

export async function reivindicarInicioRenovacao(operacaoId) {
  chamadas.push(operacaoId);
  registrar("reivindicarInicioRenovacao");
  return proximo;
}
