// diagnosticarTokenUnitv SEMPRE recebe `supa` via opts nos testes --
// este stub existe so' pra o import de _shared/supabase_client.ts (que
// puxa npm:@supabase/supabase-js@2) nao quebrar sob tsx/Node. Se for
// chamado de verdade, e' bug do teste (esqueceu de injetar opts.supa).
export function getServiceClient() {
  throw new Error("getServiceClient() nao deveria ser chamado -- injete opts.supa no teste");
}
