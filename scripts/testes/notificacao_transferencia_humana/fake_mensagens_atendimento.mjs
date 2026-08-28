// Fake de _shared/mensagens_atendimento.ts -- so registra, nunca falha.
export const mensagens = [];

export async function inserirMensagem(conversationId, origem, texto, episodioId) {
  mensagens.push({ conversationId, origem, texto, episodioId });
}
