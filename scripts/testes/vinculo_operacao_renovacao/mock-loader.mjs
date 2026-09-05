// Hook de resolucao de modulos (Node --experimental-loader / module.register)
// que redireciona especificadores de import terminados nos caminhos abaixo
// para os fakes deste diretorio -- os arquivos REAIS sob teste
// (_shared/renovacao_confirmacao.ts, _shared/tokens_renovacao.ts,
// _shared/cobrancas_pix.ts, openpix-webhook/index.ts) nunca sao
// modificados; so as dependencias externas deles sao substituidas.
const BASE = new URL("./", import.meta.url);

const MAPA = {
  "_shared/supabase_client.ts": "fake_supabase_client.mjs",
  "_shared/openpix_client.ts": "fake_openpix_client.mjs",
  "_shared/whatsapp_client.ts": "fake_whatsapp_client.mjs",
  "_shared/wasender_client.ts": "fake_whatsapp_client.mjs",
  "_shared/conversas_estado.ts": "fake_conversas_estado.mjs",
  "_shared/mensagens_atendimento.ts": "fake_mensagens_atendimento.mjs",
  "_shared/openpix_webhook_signature.ts": "fake_openpix_webhook_signature.mjs",
  "_shared/github_actions_dispatch.ts": "fake_github_actions_dispatch.mjs",
};

export async function resolve(specifier, context, nextResolve) {
  for (const [sufixo, arquivoFake] of Object.entries(MAPA)) {
    if (specifier.endsWith(sufixo)) {
      return nextResolve(new URL(arquivoFake, BASE).href, context);
    }
  }
  return nextResolve(specifier, context);
}
