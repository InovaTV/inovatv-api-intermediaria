// Fake de _shared/mensagens_atendimento.ts -- so registra, nunca falha.
export const mensagens = [];

export function resetarMensagensFake() {
  mensagens.length = 0;
}

export async function inserirMensagem(conversationId, origem, texto, episodioId) {
  mensagens.push({ conversationId, origem, texto, episodioId });
}
