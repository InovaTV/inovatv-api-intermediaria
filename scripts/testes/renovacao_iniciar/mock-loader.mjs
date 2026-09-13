// Redireciona _shared/supabase_client.ts -> fake deste diretorio (usado
// pelas etapas telefone/carrinho). tokens_renovacao.ts, renovacoes_lote.ts
// e conversas_estado.ts ficam REAIS -- so' o cliente de banco e' fake.
// Mesmo padrao de scripts/testes/renovacoes_lote/mock-loader.mjs.
//
// Redireciona tambem _shared/renovacao_confirmacao.ts -> fake (usado so'
// pela etapa=confirmar, Checkpoint 4C) -- confirmarRenovacao() ja e'
// testada a fundo em scripts/testes/vinculo_operacao_renovacao/ e
// scripts/testes/notificacao_transferencia_humana/; aqui testamos so' a
// fronteira (renovacao-iniciar chama com os parametros certos e traduz
// o outcome pro HTML certo), ver fake_renovacao_confirmacao.mjs.
const BASE = new URL("./", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith("_shared/supabase_client.ts") || specifier.endsWith("/supabase_client.ts")) {
    return nextResolve(new URL("fake_supabase_client.mjs", BASE).href, context);
  }
  if (specifier.endsWith("_shared/renovacao_confirmacao.ts") || specifier.endsWith("/renovacao_confirmacao.ts")) {
    return nextResolve(new URL("fake_renovacao_confirmacao.mjs", BASE).href, context);
  }
  return nextResolve(specifier, context);
}
