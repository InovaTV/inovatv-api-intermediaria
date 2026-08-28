// Fake de _shared/supabase_client.ts -- so' getServiceClient().rpc()
// e' usado por renovacao-sigma-contexto (para rocket_sessao_ler).
// Nenhum acesso real a banco.

let proximaSessao = { sessionid: "SESSIONID_FAKE", csrftoken: "CSRF_FAKE" };
let rpcLanca = false;

export function definirSessaoVault(s) {
  proximaSessao = s;
}

export function definirRpcLanca(v) {
  rpcLanca = v;
}

export function resetarFakeSupabase() {
  proximaSessao = { sessionid: "SESSIONID_FAKE", csrftoken: "CSRF_FAKE" };
  rpcLanca = false;
}

export function getServiceClient() {
  return {
    async rpc(nome) {
      if (rpcLanca) throw new Error("rpc rocket_sessao_ler falhou (fake)");
      if (nome === "rocket_sessao_ler") {
        return { data: proximaSessao === null ? null : [proximaSessao] };
      }
      return { data: null };
    },
  };
}
