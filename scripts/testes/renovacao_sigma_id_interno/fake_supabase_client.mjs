let sessao = [{ sessionid: "SID", csrftoken: "CSRF" }];
let erro = null;
export function setSessao(s, e) { sessao = s; erro = e ?? null; }
export function getServiceClient() {
  return { async rpc(nome) {
    if (nome === "rocket_sessao_ler") return { data: sessao, error: erro };
    return { data: null, error: { message: "rpc?" } };
  } };
}
