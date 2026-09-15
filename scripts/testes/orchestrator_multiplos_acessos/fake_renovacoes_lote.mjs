// Fake de _shared/renovacoes_lote.ts para a suite orchestrator_multiplos_acessos
// (Etapa 1, 2026-08-29). O orchestrator so' importa criarRenovacaoLote --
// registra a chamada e devolve um lote sintetico com token_hash fixo, sem
// tocar banco. `resolverPrecoLote` continua REAL (funcao pura, sem deps).

let chamadas = [];
let forcarFalha = false;
// Etapa 1 (ponto do buscarTokenAtivoPorPublicId): por padrao NENHUM
// acesso tem lote ativo. Um teste pode marcar publicIds especificos.
let publicIdsComLoteAtivo = new Set();
// Peca 2 (2026-08-29): validade read-side. Por padrao NENHUM
// acesso tem uma operacao de renovacao TERMINAL -- ausencia de
// operacao (anafora) -> acesso_selecionado e' honrado. Um teste
// marca publicIds cuja ultima operacao ja e' terminal.
let publicIdsUltimaOperacaoTerminal = new Set();

export function resetarRenovacoesLote() {
  chamadas = [];
  forcarFalha = false;
  publicIdsComLoteAtivo = new Set();
  publicIdsUltimaOperacaoTerminal = new Set();
}

export function definirLoteAtivoParaPublicId(publicId) {
  publicIdsComLoteAtivo.add(publicId);
}

export function definirUltimaOperacaoTerminalParaPublicId(publicId) {
  publicIdsUltimaOperacaoTerminal.add(publicId);
}

export async function ultimaOperacaoRenovacaoEhTerminal(_conversationId, publicId) {
  return publicIdsUltimaOperacaoTerminal.has(publicId);
}

export async function existeLoteAtivoParaPublicId(publicId) {
  return publicIdsComLoteAtivo.has(publicId);
}

// Etapa 4 (2026-09-15, guard de expiracao) -- orchestrator/index.ts
// passou a usar esta versao (registro completo) no lugar de
// existeLoteAtivoParaPublicId no passo 0, para poder avaliar/fechar um
// lote vencido. Sem `expira_em` no fake (nenhum teste desta suite
// exercita a janela de expiracao) -- o guard trata isso como "ainda
// dentro da janela" (fail-safe) e devolve o lote inalterado, mesmo
// comportamento de bloqueio que existeLoteAtivoParaPublicId(true) ja
// dava antes desta etapa.
export async function buscarLoteAtivoParaPublicId(publicId) {
  if (!publicIdsComLoteAtivo.has(publicId)) return null;
  return {
    grupo_id: "grupo-fake-ativo-" + publicId,
    estado: "aguardando_confirmacao",
    operacao_id: null,
    // Deliberadamente SEM expira_em (nunca `null` -- `new Date(null)`
    // e' epoch, um valor VALIDO que o guard trataria como vencido; a
    // ausencia do campo vira `NaN`, que o guard trata como "ainda na
    // janela", fail-safe -- mesmo raciocinio do fail-safe real:
    // expira_em e' NOT NULL no banco, nunca deveria faltar de verdade).
  };
}

export function chamadasCriarLote() {
  return chamadas;
}

export function forcarFalhaCriarLote() {
  forcarFalha = true;
}

export async function criarRenovacaoLote(params) {
  chamadas.push(params);
  if (forcarFalha) {
    throw new Error("fake: falha simulada ao criar renovacoes_lote");
  }
  return {
    tokenBruto: "token-bruto-lote-fake",
    lote: {
      grupo_id: "grupo-fake-1234",
      conversation_id: params.conversationId,
      telefone: params.telefone,
      token_hash: "a".repeat(64),
      estado: "aguardando_confirmacao",
      valor_total_centavos: params.valorTotalCentavos,
      regra_aplicada: params.regraAplicada,
      operacao_id: null,
    },
  };
}
