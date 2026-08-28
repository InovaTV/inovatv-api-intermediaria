// Redireciona so a dependencia EXTERNA (_shared/rocket_valor_cliente.ts)
// para o fake deste diretorio. _shared/http.ts continua o arquivo REAL
// (nao tem nenhuma dependencia de Deno alem do que o proprio index.ts
// ja shima), e supabase/functions/renovacao-sigma-cliente/index.ts
// (o alvo do teste) e' sempre importado real, nunca fakeado.
const BASE = new URL("./", import.meta.url);

const MAPA = {
  "_shared/rocket_valor_cliente.ts": "fake_rocket_valor_cliente.mjs",
};

export async function resolve(specifier, context, nextResolve) {
  for (const [sufixo, arquivoFake] of Object.entries(MAPA)) {
    if (specifier.endsWith(sufixo)) {
      return nextResolve(new URL(arquivoFake, BASE).href, context);
    }
  }
  return nextResolve(specifier, context);
}
