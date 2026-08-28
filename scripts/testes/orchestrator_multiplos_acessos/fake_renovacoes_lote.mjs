// Fake de _shared/renovacoes_lote.ts para a suite orchestrator_multiplos_acessos
// (Etapa 1, 2026-08-29). O orchestrator so' importa criarRenovacaoLote --
// registra a chamada e devolve um lote sintetico com token_hash fixo, sem
// tocar banco. `resolverPrecoLote` continua REAL (funcao pura, sem deps).

let chamadas = [];
let forcarFalha = false;
// Etapa 1 (ponto do buscarTokenAtivoPorPublicId): por padrao NENHUM
// acesso tem lote ativo. Um teste pode marcar publicIds especificos.
let publicIdsComLoteAtivo = new Set();

export function resetarRenovacoesLote() {
  chamadas = [];
  forcarFalha = false;
  publicIdsComLoteAtivo = new Set();
}

export function definirLoteAtivoParaPublicId(publicId) {
  publicIdsComLoteAtivo.add(publicId);
}

export async function existeLoteAtivoParaPublicId(publicId) {
  return publicIdsComLoteAtivo.has(publicId);
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
