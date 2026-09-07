// Suite: renovacao_wasender_confirmacao (2026-09-07).
// Roda o modulo REAL _shared/renovacao_wasender_resolver.ts. So' as
// dependencias de I/O sao fakes:
//   - supabase_client.ts  -> "banco" em memoria (renovacoes_lote / tokens_renovacao)
//   - renovacoes_lote.ts  -> buscarFilhosDoLote no-op (import so' carrega; nao exercitado)
// telefone.ts e mensagens_fixas.ts sao puros -> carregados REAIS.
//
// Match por BASENAME (o resolver importa os vizinhos como "./x.ts").
const BASE = new URL("./", import.meta.url);

const MAPA = {
  "supabase_client.ts": "fake_supabase_client.mjs",
  "renovacoes_lote.ts": "fake_renovacoes_lote.mjs",
};

export async function resolve(specifier, context, nextResolve) {
  for (const [basename, arquivoFake] of Object.entries(MAPA)) {
    if (specifier.endsWith("/" + basename) || specifier === basename) {
      return nextResolve(new URL(arquivoFake, BASE).href, context);
    }
  }
  return nextResolve(specifier, context);
}
