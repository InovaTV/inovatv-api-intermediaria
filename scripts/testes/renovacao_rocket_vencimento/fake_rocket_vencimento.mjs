// Fake de _shared/rocket_vencimento.ts para a suite de
// renovacao-rocket-vencimento. So' atualizarVencimentoRocket e' usada
// pela funcao real. Devolve resultados de uma FILA (cada chamada
// consome o proximo; fila vazia -> repete o ultimo) e registra os
// argumentos de cada PATCH -- o teste verifica que o `vencimento`
// enviado ao Rocket e' EXATAMENTE o vencimentoAlvo (nunca recalculado)
// e quantas vezes o PATCH foi chamado.

let fila = [];
let ultimo = { outcome: "success", httpStatus: 200 };
let chamadas = [];

export function definirSequenciaPatch(resultados) {
  fila = [...resultados];
  if (fila.length > 0) ultimo = fila[fila.length - 1];
}

export function definirResultadoPatch(resultado) {
  fila = [];
  ultimo = resultado;
}

export function patchChamadas() {
  return chamadas;
}

export function resetarFake() {
  fila = [];
  ultimo = { outcome: "success", httpStatus: 200 };
  chamadas = [];
}

export async function atualizarVencimentoRocket(publicId, vencimento) {
  chamadas.push({ publicId, vencimento });
  return fila.length > 0 ? fila.shift() : ultimo;
}
