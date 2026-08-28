// Fake de _shared/conversas_estado.ts para a suite de multiplos
// acessos no fluxo de renovacao. buscarOuCriarConversa devolve sempre
// o mesmo objeto controlavel (resetarConversa), atualizarSessao
// reflete acesso_selecionado de volta nele (mesmo efeito real, sem
// banco) -- permite testar o "fluxo existente continua normalmente"
// (Teste B) entre duas chamadas sucessivas ao handler real.

let conversaAtual;
let acionamentos = [];
let atualizacoesSessao = [];

export function resetarConversa() {
  conversaAtual = {
    conversation_id: "conv-teste-1",
    episodio_atual_id: null,
    estado: "normal",
    acesso_selecionado: null,
    intencao_atual: null,
    sessao_atividade_em: new Date().toISOString(),
  };
  acionamentos = [];
  atualizacoesSessao = [];
}
resetarConversa();

export function getConversaAtual() {
  return conversaAtual;
}
export function acionamentosRegistrados() {
  return acionamentos;
}
export function atualizacoesSessaoRegistradas() {
  return atualizacoesSessao;
}

export async function buscarOuCriarConversa() {
  return conversaAtual;
}

export async function acionarTransferenciaHumana(conversationId, motivo, mensagemCliente, textoIa) {
  acionamentos.push({ conversationId, motivo, mensagemCliente, textoIa });
  return { outcome: "acionada" };
}

export async function atualizarNomeSnapshot() {}

export async function atualizarSessao(conversationId, dados) {
  atualizacoesSessao.push({ conversationId, dados });
  if (Object.prototype.hasOwnProperty.call(dados, "acessoSelecionado")) {
    conversaAtual.acesso_selecionado = dados.acessoSelecionado;
  }
  if (Object.prototype.hasOwnProperty.call(dados, "intencaoAtual")) {
    conversaAtual.intencao_atual = dados.intencaoAtual;
  }
}

export async function expirarSessaoAtomicamente() {
  return { outcome: "expirada" };
}
