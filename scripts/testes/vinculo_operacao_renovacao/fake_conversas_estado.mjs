// Fake de _shared/conversas_estado.ts -- so a parte usada por
// renovacao_confirmacao.ts (acionarTransferenciaHumana).
export const transferencias = [];

export async function acionarTransferenciaHumana(conversationId, motivo, textoCliente, textoIa) {
  transferencias.push({ conversationId, motivo, textoCliente, textoIa });
  return { outcome: "acionada" };
}
