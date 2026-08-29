let chamadas = [];
export function notificacoes() { return chamadas; }
export function resetar() { chamadas = []; }
export async function notificarTransferenciaHumana(telefone, motivo, acionada, conversationId, opcoes) {
  chamadas.push({ telefone, motivo, acionada, conversationId, opcoes });
}
