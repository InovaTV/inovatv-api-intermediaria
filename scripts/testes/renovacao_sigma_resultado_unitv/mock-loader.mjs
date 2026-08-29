// Redireciona as dependencias de leaf de renovacao-sigma-resultado
// para fakes. _shared/http.ts e _shared/mensagens_fixas.ts ficam REAIS.
const BASE = new URL("./", import.meta.url);
const MAPA = {
  "_shared/tokens_renovacao.ts": "fake_tokens_renovacao.mjs",
  "_shared/renovacoes_lote.ts": "fake_renovacoes_lote.mjs",
  "_shared/conversas_estado.ts": "fake_conversas_estado.mjs",
  "_shared/notificacao_transferencia.ts": "fake_notificacao_transferencia.mjs",
  "_shared/mensagens_atendimento.ts": "fake_mensagens_atendimento.mjs",
  "_shared/whatsapp_client.ts": "fake_whatsapp_client.mjs",
};
export async function resolve(specifier, context, nextResolve) {
  for (const [sufixo, fake] of Object.entries(MAPA)) {
    if (specifier.endsWith(sufixo)) return nextResolve(new URL(fake, BASE).href, context);
  }
  return nextResolve(specifier, context);
}
