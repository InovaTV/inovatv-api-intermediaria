// Fake de _shared/mensagens_atendimento.ts para a suite da saudacao
// inicial. inserirMensagem e contarMensagensDaConversa compartilham o
// MESMO array -- gravar a saudacao faz a contagem subir (idempotencia
// real do criterio "primeiro contato").

let mensagens = [];

export function resetarMensagens() {
  mensagens = [];
}
export function mensagensRegistradas() {
  return mensagens;
}

// Semeia historico previo sem passar pela logica de envio -- simula
// uma conversa que ja teve trocas (cliente conhecido / 2a mensagem).
export function semearMensagensPrevias(conversationId, quantidade) {
  for (let i = 0; i < quantidade; i++) {
    mensagens.push({
      conversationId,
      origem: i % 2 === 0 ? "cliente" : "ia",
      texto: `previa-${i}`,
      episodioId: null,
    });
  }
}

export async function inserirMensagem(conversationId, origem, texto, episodioId) {
  mensagens.push({ conversationId, origem, texto, episodioId });
  return { id: `msg-${mensagens.length}` };
}

export async function contarMensagensDaConversa(conversationId) {
  return mensagens.filter((m) => m.conversationId === conversationId).length;
}
