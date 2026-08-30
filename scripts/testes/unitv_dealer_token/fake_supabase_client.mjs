// obterDealerToken SEMPRE recebe `supa` via opts nos testes -- este
// stub existe so' pra o import de _shared/supabase_client.ts nao
// quebrar sob tsx/Node. Chamada real = bug do teste.
export function getServiceClient() {
  throw new Error("getServiceClient() nao deveria ser chamado -- injete opts.supa no teste");
}
