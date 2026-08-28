// Redireciona so as dependencias EXTERNAS (Supabase, WhatsApp,
// OpenPix, log de mensagens) para os fakes deste diretorio.
// _shared/conversas_estado.ts (acionarTransferenciaHumana real, so'
// a camada de banco por baixo dele e' fake via .rpc()),
// _shared/tokens_renovacao.ts, _shared/cobrancas_pix.ts,
// _shared/notificacao_transferencia.ts (o proprio alvo do teste) e
// _shared/mensagens_fixas.ts continuam os arquivos REAIS de producao.
const BASE = new URL("./", import.meta.url);

const MAPA = {
  "_shared/supabase_client.ts": "fake_supabase_client.mjs",
  "_shared/whatsapp_client.ts": "fake_whatsapp_client.mjs",
  "_shared/openpix_client.ts": "fake_openpix_client.mjs",
  "_shared/mensagens_atendimento.ts": "fake_mensagens_atendimento.mjs",
};

export async function resolve(specifier, context, nextResolve) {
  for (const [sufixo, arquivoFake] of Object.entries(MAPA)) {
    if (specifier.endsWith(sufixo)) {
      return nextResolve(new URL(arquivoFake, BASE).href, context);
    }
  }
  return nextResolve(specifier, context);
}
