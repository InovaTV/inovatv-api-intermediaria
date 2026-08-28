let proximoResultado = {
  outcome: "success",
  nome: "Meu Uso Testes",
  servidorNome: "BLAZE",
  planoNome: "Mensal",
  valor: "35.0",
  vencimento: "2026-09-13T23:59:00-03:00",
};

export function definirProximoResultadoValorCliente(resultado) {
  proximoResultado = resultado;
}
export function resetarValorCliente() {
  proximoResultado = {
    outcome: "success",
    nome: "Meu Uso Testes",
    servidorNome: "BLAZE",
    planoNome: "Mensal",
    valor: "35.0",
    vencimento: "2026-09-13T23:59:00-03:00",
  };
}

export async function consultarClienteCompletoRocket() {
  return proximoResultado;
}
