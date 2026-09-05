// Peca 3 (2026-08-29) -- ciclo de vida garantido dos estados presos.
// Roda o handler REAL de supabase/functions/renovacao-sigma-watchdog/
// index.ts E o modulo REAL _shared/reconciliacao_renovacao.ts (onde
// vivem as garantias CAS de "nunca perder um pagamento"). So' as
// dependencias de I/O (banco, Woovi, GitHub, WhatsApp) sao fakes.
//
// Match por BASENAME (nao por sufixo "_shared/x.ts") porque
// reconciliacao_renovacao.ts importa seus vizinhos como "./x.ts".
const BASE = new URL("./", import.meta.url);

const MAPA = {
  "tokens_renovacao.ts": "fake_tokens_renovacao.mjs",
  "renovacoes_lote.ts": "fake_renovacoes_lote.mjs",
  "cobrancas_pix.ts": "fake_cobrancas_pix.mjs",
  "openpix_client.ts": "fake_openpix_client.mjs",
  "github_actions_dispatch.ts": "fake_github_actions_dispatch.mjs",
  "conversas_estado.ts": "fake_conversas_estado.mjs",
  "notificacao_transferencia.ts": "fake_notificacao_transferencia.mjs",
  "mensagens_atendimento.ts": "fake_mensagens_atendimento.mjs",
  "whatsapp_client.ts": "fake_whatsapp_client.mjs",
  "wasender_client.ts": "fake_whatsapp_client.mjs",
};

export async function resolve(specifier, context, nextResolve) {
  for (const [basename, arquivoFake] of Object.entries(MAPA)) {
    if (specifier.endsWith("/" + basename) || specifier === basename) {
      return nextResolve(new URL(arquivoFake, BASE).href, context);
    }
  }
  return nextResolve(specifier, context);
}
