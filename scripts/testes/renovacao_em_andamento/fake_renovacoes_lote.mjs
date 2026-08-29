import { registrar } from "./_seq.mjs";

let proximo = { telefone: "5517000000000", conversation_id: "conv-lote" };
let chamadas = [];

export function configurar(v) { proximo = v; }
export function chamadasFeitas() { return chamadas; }
export function resetar() {
  proximo = { telefone: "5517000000000", conversation_id: "conv-lote" };
  chamadas = [];
}

export async function reivindicarInicioRenovacaoLote(operacaoId) {
  chamadas.push(operacaoId);
  registrar("reivindicarInicioRenovacaoLote");
  return proximo;
}
