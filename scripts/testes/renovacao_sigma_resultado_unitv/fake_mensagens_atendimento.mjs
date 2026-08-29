let msgs = [];
export function mensagens() { return msgs; }
export function resetar() { msgs = []; }
export async function inserirMensagem(conversationId, origem, texto, episodioId) {
  msgs.push({ conversationId, origem, texto, episodioId });
}
