// Redireciona as dependencias de leaf de openpix-webhook para fakes.
// _shared/mensagens_fixas.ts fica REAL (o texto da mensagem
// intermediaria e' exatamente o que a producao usa).
const BASE = new URL("./", import.meta.url);
const MAPA = {
  "_shared/openpix_webhook_signature.ts": "fake_openpix_webhook_signature.mjs",
  "_shared/openpix_client.ts": "fake_openpix_client.mjs",
  "_shared/cobrancas_pix.ts": "fake_cobrancas_pix.mjs",
  "_shared/tokens_renovacao.ts": "fake_tokens_renovacao.mjs",
  "_shared/renovacoes_lote.ts": "fake_renovacoes_lote.mjs",
  "_shared/github_actions_dispatch.ts": "fake_github_actions_dispatch.mjs",
  "_shared/whatsapp_client.ts": "fake_whatsapp_client.mjs",
  "_shared/mensagens_atendimento.ts": "fake_mensagens_atendimento.mjs",
};
export async function resolve(specifier, context, nextResolve) {
  for (const [sufixo, fake] of Object.entries(MAPA)) {
    if (specifier.endsWith(sufixo)) return nextResolve(new URL(fake, BASE).href, context);
  }
  return nextResolve(specifier, context);
}
