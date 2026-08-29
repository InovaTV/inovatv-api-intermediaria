// Redireciona as duas dependencias EXTERNAS de
// supabase/functions/renovacao-rocket-vencimento/index.ts para os fakes
// deste diretorio. _shared/http.ts continua o arquivo REAL (sem
// dependencia de Deno alem do que o proprio teste shima). O index.ts
// alvo e' sempre importado real, nunca fakeado.
const BASE = new URL("./", import.meta.url);

const MAPA = {
  "_shared/rocket_valor_cliente.ts": "fake_rocket_valor_cliente.mjs",
  "_shared/rocket_vencimento.ts": "fake_rocket_vencimento.mjs",
};

export async function resolve(specifier, context, nextResolve) {
  for (const [sufixo, arquivoFake] of Object.entries(MAPA)) {
    if (specifier.endsWith(sufixo)) {
      return nextResolve(new URL(arquivoFake, BASE).href, context);
    }
  }
  return nextResolve(specifier, context);
}
