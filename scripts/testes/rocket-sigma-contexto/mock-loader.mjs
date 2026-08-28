// Redireciona so a dependencia externa _shared/supabase_client.ts
// (importa npm:@supabase/supabase-js, nao resolvivel neste ambiente)
// para o fake deste diretorio. Tudo mais e' real:
//   - supabase/functions/renovacao-sigma-contexto/index.ts   (alvo)
//   - supabase/functions/_shared/rocket_sigma_contexto.ts     (real)
//   - supabase/functions/_shared/rocket_session_check.ts      (real)
//   - supabase/functions/_shared/http.ts                       (real)
// O fetch global e' interceptado pelo proprio teste.mjs.
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
