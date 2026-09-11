// Redireciona as dependencias EXTERNAS de webhook-wasender/index.ts para
// os fakes deste diretorio.
//
// - webhook_dedup.ts: UNICA dependencia que toca banco de forma
//   incondicional (roda pra TODA mensagem, midia ou texto, antes do
//   200) -- fake com comportamento controlavel pelos testes.
// - supabase_client.ts: nao e' o alvo de nenhum teste, mas
//   comando_atendimento.ts (-> conversas_estado.ts) e
//   renovacao_wasender_resolver.ts (-> tokens_renovacao.ts/
//   renovacoes_lote.ts) importam ele de forma EAGER so' por
//   webhook-wasender/index.ts importar esses modulos no topo do
//   arquivo -- mesmo sem os testes chegarem a chamar as funcoes de
//   banco. Sem este fake, "npm:@supabase/supabase-js@2" quebra a
//   suite inteira no Node antes mesmo do primeiro teste rodar.
//
// - wasender_media.ts (Fase 4, Checkpoint C): fake com comportamento
//   controlavel -- exercita a integracao shadow (chamada com os
//   campos certos, log so' com outcome, erro isolado) SEM depender do
//   Wasender real nem repetir a suite ja dedicada
//   (scripts/testes/wasender_media_decrypt/), que testa o modulo em si.
// - gemini_client.ts (Fase 4, Checkpoint D1): fake com comportamento
//   controlavel -- exercita a integracao do Gemini multimodal em modo
//   sombra (chamado direto do webhook, nunca via Orchestrator).
//
// telefone.ts e wasender_client.ts ficam REAIS: sao puros/degradam sem
// rede (wasender_client sem WASENDER_API_TOKEN no ambiente de teste).
const BASE = new URL("./", import.meta.url);

const MAPA = {
  "_shared/webhook_dedup.ts": "fake_webhook_dedup.mjs",
  "_shared/supabase_client.ts": "fake_supabase_client.mjs",
  "_shared/wasender_media.ts": "fake_wasender_media.mjs",
  "_shared/gemini_client.ts": "fake_gemini_client.mjs",
};

export async function resolve(specifier, context, nextResolve) {
  for (const [sufixo, arquivoFake] of Object.entries(MAPA)) {
    if (specifier.endsWith(sufixo)) {
      return nextResolve(new URL(arquivoFake, BASE).href, context);
    }
  }
  return nextResolve(specifier, context);
}
