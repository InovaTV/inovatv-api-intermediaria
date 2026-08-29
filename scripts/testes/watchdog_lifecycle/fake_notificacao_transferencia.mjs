let chamadas = [];
export function notificacoes() { return chamadas; }
export function resetar() { chamadas = []; }
export async function notificarTransferenciaHumana(telefone, motivo, acionada, conversationId, opcoes) {
  // Espelha o modulo real: no-op quando acionada=false.
  if (!acionada) return { clienteAvisado: false, joseAvisado: false };
  chamadas.push({ telefone, motivo, acionada, conversationId, opcoes });
  return { clienteAvisado: true, joseAvisado: true };
}
