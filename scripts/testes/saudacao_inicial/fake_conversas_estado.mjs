// Fake de _shared/conversas_estado.ts para a suite da saudacao inicial.
// buscarOuCriarConversa devolve sempre o mesmo objeto controlavel
// (resetarConversa aceita overrides -- estado / sessao_atividade_em).

let conversaAtual;
let acionamentos = [];

export function resetarConversa(overrides = {}) {
  conversaAtual = {
    conversation_id: "conv-teste-1",
    episodio_atual_id: null,
    estado: "normal",
    acesso_selecionado: null,
    intencao_atual: null,
    sessao_atividade_em: null,
    ...overrides,
  };
  acionamentos = [];
}
resetarConversa();

export function getConversaAtual() {
  return conversaAtual;
}
export function acionamentosRegistrados() {
  return acionamentos;
}

export async function buscarOuCriarConversa() {
  return conversaAtual;
}

export async function acionarTransferenciaHumana(conversationId, motivo, mensagemCliente, textoIa) {
  acionamentos.push({ conversationId, motivo, mensagemCliente, textoIa });
  return { outcome: "acionada" };
}

export async function atualizarNomeSnapshot() {}

export async function atualizarSessao() {}

export async function expirarSessaoAtomicamente() {
  return { outcome: "expirou_agora" };
}
