// Fake de _shared/rocket_valor_cliente.ts, so para a suite da nova
// funcao renovacao-sigma-cliente. consultarClienteCompletoRocket e' a
// UNICA exportacao usada pela funcao real -- nada mais deste modulo
// precisa ser fakeado.

let proximoResultado = { outcome: "success", nome: "Teste", servidorNome: "BLAZE", planoNome: "Mensal", valor: "35.0", vencimento: "2026-12-08T20:59:59-03:00" };
let chamadas = [];

export function definirProximoResultado(resultado) {
  proximoResultado = resultado;
}

export function chamadasRegistradas() {
  return chamadas;
}

export function resetarFake() {
  chamadas = [];
  proximoResultado = { outcome: "success", nome: "Teste", servidorNome: "BLAZE", planoNome: "Mensal", valor: "35.0", vencimento: "2026-12-08T20:59:59-03:00" };
}

export async function consultarClienteCompletoRocket(publicId) {
  chamadas.push(publicId);
  return proximoResultado;
}
