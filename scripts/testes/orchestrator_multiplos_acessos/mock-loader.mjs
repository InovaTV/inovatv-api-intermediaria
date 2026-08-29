// Redireciona as dependencias EXTERNAS de orchestrator/index.ts para
// os fakes deste diretorio. Deliberadamente mantidos REAIS (nao
// fakeados): _shared/http.ts, _shared/contexto.ts, _shared/validador.ts,
// _shared/mensagens_fixas.ts, _shared/telefone.ts, _shared/rotulo_acesso.ts
// -- e' exatamente a interacao real entre eles (Validador rejeitando
// por "renovacao:acesso_nao_determinado", mensagens_fixas montando o
// texto certo) que esta suite existe para provar, nao uma simulacao.
const BASE = new URL("./", import.meta.url);

const MAPA = {
  "_shared/conversas_estado.ts": "fake_conversas_estado.mjs",
  "_shared/mensagens_atendimento.ts": "fake_mensagens_atendimento.mjs",
  "_shared/rocket_intermediaria.ts": "fake_rocket_intermediaria.mjs",
  "_shared/conhecimento.ts": "fake_conhecimento.mjs",
  "_shared/gemini_client.ts": "fake_gemini_client.mjs",
  "_shared/whatsapp_client.ts": "fake_whatsapp_client.mjs",
  "_shared/rocket_valor_cliente.ts": "fake_rocket_valor_cliente.mjs",
  "_shared/tokens_renovacao.ts": "fake_tokens_renovacao.mjs",
  // Etapa 1 (renovacao em lote): renovacoes_lote.ts toca banco
  // (supabase_client). precos_renovacao.ts NAO e' fakeado -- e' funcao
  // pura, sem deps, e a regra comercial real e' o que a suite prova.
  "_shared/renovacoes_lote.ts": "fake_renovacoes_lote.mjs",
  // Etapa 2 (Bloco 4): resolucao da conta UniTV (sn -> id do painel).
  "_shared/unitv_conta_client.ts": "fake_unitv_conta_client.mjs",
};

export async function resolve(specifier, context, nextResolve) {
  for (const [sufixo, arquivoFake] of Object.entries(MAPA)) {
    if (specifier.endsWith(sufixo)) {
      return nextResolve(new URL(arquivoFake, BASE).href, context);
    }
  }
  return nextResolve(specifier, context);
}
