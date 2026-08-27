// Fake de _shared/mensagens_atendimento.ts -- so registra, nunca falha.
export const mensagensConversa = [];

export async function inserirMensagem(conversationId, origem, texto, episodioId) {
  mensagensConversa.push({ conversationId, origem, texto, episodioId });
}
