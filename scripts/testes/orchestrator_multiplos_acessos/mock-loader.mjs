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
  // Fase 3, Checkpoint 2 (shadow mode): sem esta entrada, o orchestrator
  // carregaria o arquivo REAL, que chama _shared/supabase_client.ts
  // real -- consulta de rede contra a URL fake deste ambiente de teste.
  "_shared/conhecimento_suporte.ts": "fake_conhecimento_suporte.mjs",
  "_shared/gemini_client.ts": "fake_gemini_client.mjs",
  // Achado real (2026-09-05, investigacao do "achado D"): o orchestrator
  // ja importa de wasender_client.ts, nao mais whatsapp_client.ts -- sem
  // esta entrada, o cliente REAL do Wasender carregava sem mock (sem
  // WASENDER_API_TOKEN no ambiente de teste -> "unavailable" silencioso,
  // nenhuma mensagem capturada pelo fake).
  "_shared/wasender_client.ts": "fake_whatsapp_client.mjs",
  "_shared/rocket_valor_cliente.ts": "fake_rocket_valor_cliente.mjs",
  "_shared/tokens_renovacao.ts": "fake_tokens_renovacao.mjs",
  // Etapa 1 (renovacao em lote): renovacoes_lote.ts toca banco
  // (supabase_client). precos_renovacao.ts NAO e' fakeado -- e' funcao
  // pura, sem deps, e a regra comercial real e' o que a suite prova.
  "_shared/renovacoes_lote.ts": "fake_renovacoes_lote.mjs",
  // Etapa 2 (Bloco 4): resolucao da conta UniTV (sn -> id do painel).
  "_shared/unitv_conta_client.ts": "fake_unitv_conta_client.mjs",
  // Novo (folga anti-bloqueio entre 2 envios rapidos, ver
  // _shared/envio_seguro.ts) -- fakeado so pra suite nao esperar os 7s
  // reais; nao e' o alvo desta suite.
  "_shared/envio_seguro.ts": "fake_envio_seguro.mjs",
  // Etapa 4 (2026-09-15, guard de expiracao) -- _shared/renovacao_guard_expiracao.ts
  // (importado por orchestrator/index.ts) importa seus vizinhos como
  // "./cobrancas_pix.ts" (relativo, sem prefixo "_shared/") -- so'
  // cobrancas_pix.ts precisa de fake aqui: importa supabase_client.ts
  // real (npm:@supabase/supabase-js, nao resolvivel neste ambiente de
  // teste). openpix_client.ts nao importa nada (so' Deno.env/fetch,
  // ja shimados nesta suite) -- roda real, sem fake. tokens_renovacao.ts
  // e renovacoes_lote.ts ja tem fake mapeado acima (match por sufixo
  // "_shared/x.ts", que TAMBEM cobre o import relativo do proprio
  // guard gracas ao fallback por basename abaixo).
  "cobrancas_pix.ts": "fake_cobrancas_pix.mjs",
};

export async function resolve(specifier, context, nextResolve) {
  for (const [sufixo, arquivoFake] of Object.entries(MAPA)) {
    // Match por sufixo completo (import "../_shared/x.ts" do orchestrator)
    // OU por basename isolado (import "./x.ts" de dentro de _shared/,
    // como renovacao_guard_expiracao.ts) -- mesmo padrao ja usado em
    // scripts/testes/watchdog_lifecycle/mock-loader.mjs.
    if (specifier.endsWith(sufixo) || specifier.endsWith("/" + sufixo.split("/").pop()) || specifier === sufixo.split("/").pop()) {
      return nextResolve(new URL(arquivoFake, BASE).href, context);
    }
  }
  return nextResolve(specifier, context);
}
