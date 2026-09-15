// Fake minimo de _shared/cobrancas_pix.ts para esta suite (Etapa 4,
// 2026-09-15) -- necessario so' porque o modulo REAL importa
// supabase_client.ts (npm:@supabase/supabase-js, nao resolvivel neste
// ambiente de teste Node/tsx). Nenhum teste desta suite hoje seta um
// token/lote com expira_em no passado (ver comentario em
// fake_tokens_renovacao.mjs/fake_renovacoes_lote.mjs) -- o guard de
// expiracao nunca chega a chamar buscarCobrancaPorOperacaoId aqui;
// este stub existe so' para o import nao quebrar.
export async function buscarCobrancaPorOperacaoId() {
  return null;
}

// Correcao de cobranca pendente bloqueando nova tentativa (2026-09-15):
// reconciliarCobrancaPendenteAntesDeNovaCobranca (_shared/renovacao_guard_expiracao.ts)
// tambem importa estas 2 -- nenhum teste desta suite exercita o fluxo
// de ACEITO/cobranca (isso e' testado a fundo em
// scripts/testes/vinculo_operacao_renovacao/), so' precisam existir
// para o import nao quebrar.
export async function buscarCobrancaPendente() {
  return null;
}
export async function buscarCobrancaPendentePorGrupo() {
  return null;
}
export async function expirarCobrancaPendente() {
  return null;
}
