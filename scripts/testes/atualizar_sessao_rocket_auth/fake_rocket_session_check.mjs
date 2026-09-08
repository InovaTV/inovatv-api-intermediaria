// Fake de _shared/rocket_session_check.ts -- NUNCA faz rede.
//
// O handler chama verificarSessaoRocket(sessionid, csrftoken) logo
// depois de gravar no Vault, so' pra dar uma confirmacao imediata.
// Este fake devolve um resultado configuravel e registra que foi
// chamado (e com quais argumentos), sem tocar em app.rocketgestor.com.
// A logica REAL de validacao da sessao Rocket nao foi alterada nesta
// mudanca e nao e' o objeto deste teste.

let proximoResultado = { valida: true };
let chamadas = [];

export function definirResultado(r) {
  proximoResultado = r;
}
export function chamadasRegistradas() {
  return chamadas;
}
export function resetar() {
  proximoResultado = { valida: true };
  chamadas = [];
}

export async function verificarSessaoRocket(sessionid, csrftoken) {
  chamadas.push({ sessionid, csrftoken });
  return proximoResultado;
}
