// Redireciona as dependencias EXTERNAS de orchestrator/index.ts para
// fakes. conversas_estado e mensagens_atendimento sao fakes LOCAIS
// deste diretorio (a suite precisa controlar o estado da conversa e a
// contagem de mensagens -- criterio "primeiro contato"). O restante
// reaproveita, sem copiar, os fakes ja existentes da suite
// orchestrator_multiplos_acessos. _shared/mensagens_fixas.ts,
// _shared/contexto.ts, _shared/validador.ts, _shared/telefone.ts,
// _shared/http.ts e _shared/rotulo_acesso.ts continuam REAIS.
const BASE = new URL("./", import.meta.url);
const OUTRO = new URL("../orchestrator_multiplos_acessos/", import.meta.url);

const LOCAIS = {
  "_shared/conversas_estado.ts": "fake_conversas_estado.mjs",
  "_shared/mensagens_atendimento.ts": "fake_mensagens_atendimento.mjs",
};

const HERDADOS = {
  "_shared/rocket_intermediaria.ts": "fake_rocket_intermediaria.mjs",
  "_shared/conhecimento.ts": "fake_conhecimento.mjs",
  "_shared/gemini_client.ts": "fake_gemini_client.mjs",
  "_shared/whatsapp_client.ts": "fake_whatsapp_client.mjs",
  "_shared/rocket_valor_cliente.ts": "fake_rocket_valor_cliente.mjs",
  "_shared/tokens_renovacao.ts": "fake_tokens_renovacao.mjs",
  "_shared/renovacoes_lote.ts": "fake_renovacoes_lote.mjs",
  "_shared/unitv_conta_client.ts": "fake_unitv_conta_client.mjs",
};

export async function resolve(specifier, context, nextResolve) {
  for (const [sufixo, arq] of Object.entries(LOCAIS)) {
    if (specifier.endsWith(sufixo)) {
      return nextResolve(new URL(arq, BASE).href, context);
    }
  }
  for (const [sufixo, arq] of Object.entries(HERDADOS)) {
    if (specifier.endsWith(sufixo)) {
      return nextResolve(new URL(arq, OUTRO).href, context);
    }
  }
  return nextResolve(specifier, context);
}
