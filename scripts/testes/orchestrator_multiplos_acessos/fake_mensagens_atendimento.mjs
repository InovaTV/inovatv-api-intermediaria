let mensagens = [];

export function resetarMensagens() {
  mensagens = [];
}
export function mensagensRegistradas() {
  return mensagens;
}

export async function inserirMensagem(conversationId, origem, texto, episodioId) {
  mensagens.push({ conversationId, origem, texto, episodioId });
  return { id: `msg-${mensagens.length}` };
}
