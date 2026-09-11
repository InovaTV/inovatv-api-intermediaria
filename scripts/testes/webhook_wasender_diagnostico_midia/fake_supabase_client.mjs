// Fake de _shared/supabase_client.ts -- NAO e' o alvo de nenhum teste
// desta suite. Existe so' para quebrar a cadeia de import EAGER de
// modulos que webhook-wasender/index.ts carrega no topo do arquivo mas
// cujas funcoes de banco nunca chegam a ser chamadas nestes testes
// (comando_atendimento.ts -> conversas_estado.ts, e
// renovacao_wasender_resolver.ts -> tokens_renovacao.ts/
// renovacoes_lote.ts) -- sem isto, o import de "npm:@supabase/
// supabase-js@2" (especificador estilo Deno) quebra a suite inteira no
// Node, mesmo sem nenhum destes caminhos ser exercitado.
export function getServiceClient() {
  throw new Error(
    "fake_supabase_client: getServiceClient() nao deveria ser chamado nesta suite " +
      "(webhook_wasender_diagnostico_midia) -- os testes escolhem deliberadamente " +
      "mensagens que nunca chegam a tocar banco nesses modulos.",
  );
}
