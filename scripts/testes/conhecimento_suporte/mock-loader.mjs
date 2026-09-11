// Hook de resolucao de modulos (Node --experimental-loader /
// module.register) que redireciona _shared/supabase_client.ts para o
// fake deste diretorio -- o arquivo REAL sob teste
// (_shared/conhecimento_suporte.ts) nunca e' modificado; so' a
// dependencia externa (Supabase) e' substituida.
const BASE = new URL("./", import.meta.url);

const MAPA = {
  "_shared/supabase_client.ts": "fake_supabase_client.mjs",
};

export async function resolve(specifier, context, nextResolve) {
  for (const [sufixo, arquivoFake] of Object.entries(MAPA)) {
    if (specifier.endsWith(sufixo)) {
      return nextResolve(new URL(arquivoFake, BASE).href, context);
    }
  }
  return nextResolve(specifier, context);
}
