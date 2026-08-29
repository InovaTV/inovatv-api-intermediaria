let chamadas = [];
let proximoOutcome = "acionada";
export function acionamentos() { return chamadas; }
export function _definirOutcome(o) { proximoOutcome = o; }
export function resetar() { chamadas = []; proximoOutcome = "acionada"; }
export async function acionarTransferenciaHumana(conversationId, motivo) {
  chamadas.push({ conversationId, motivo });
  return { outcome: proximoOutcome };
}
