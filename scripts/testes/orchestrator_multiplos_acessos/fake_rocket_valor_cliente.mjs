let proximoResultado = {
  outcome: "success",
  nome: "Meu Uso Testes",
  servidorNome: "BLAZE",
  planoNome: "Mensal",
  valor: "35.0",
  vencimento: "2026-09-13T23:59:00-03:00",
};

let contadorConsultarValor = 0;

export function chamadasConsultarValor() {
  return contadorConsultarValor;
}
export function definirProximoResultadoValorCliente(resultado) {
  proximoResultado = resultado;
}
export function resetarValorCliente() {
  contadorConsultarValor = 0;
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
  contadorConsultarValor += 1;
  return proximoResultado;
}
