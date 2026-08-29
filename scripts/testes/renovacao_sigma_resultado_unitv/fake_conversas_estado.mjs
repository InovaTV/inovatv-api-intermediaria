let chamadas = [];
export function acionamentos() { return chamadas; }
export function resetar() { chamadas = []; }
export async function acionarTransferenciaHumana(conversationId, motivo) {
  chamadas.push({ conversationId, motivo });
  return { outcome: "acionada" };
}
