// Roda o modulo REAL _shared/renovacao_guard_expiracao.ts. So' as
// dependencias de I/O (banco via tokens_renovacao/renovacoes_lote,
// Woovi via cobrancas_pix/openpix_client) sao fakes. Match por
// BASENAME (nao por sufixo "_shared/x.ts") porque
// renovacao_guard_expiracao.ts importa seus vizinhos como "./x.ts" --
// mesmo padrao ja usado em scripts/testes/watchdog_lifecycle/mock-loader.mjs.
const BASE = new URL("./", import.meta.url);

const MAPA = {
  "tokens_renovacao.ts": "fake_tokens_renovacao.mjs",
  "renovacoes_lote.ts": "fake_renovacoes_lote.mjs",
  "cobrancas_pix.ts": "fake_cobrancas_pix.mjs",
  "openpix_client.ts": "fake_openpix_client.mjs",
};

export async function resolve(specifier, context, nextResolve) {
  for (const [basename, arquivoFake] of Object.entries(MAPA)) {
    if (specifier.endsWith("/" + basename) || specifier === basename) {
      return nextResolve(new URL(arquivoFake, BASE).href, context);
    }
  }
  return nextResolve(specifier, context);
}
