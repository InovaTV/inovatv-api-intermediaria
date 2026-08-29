// Fake de _shared/rocket_valor_cliente.ts para a suite de
// renovacao-rocket-vencimento. So' consultarClienteCompletoRocket e'
// usada pela funcao real. Devolve resultados de uma FILA (cada chamada
// consome o proximo) -- permite roteirizar a sequencia GET-antes /
// GET-depois / retries. Se a fila esvazia, repete o ultimo item.
//
// Os resultados de "success" incluem de proposito campos sensiveis
// (nome, valor) e um `senha` -- o teste verifica que NADA disso vaza
// na resposta da Edge Function (que so' consome `vencimento`).

let fila = [];
let ultimo = { outcome: "unavailable" };
let chamadas = [];

export function definirSequencia(resultados) {
  fila = [...resultados];
  if (fila.length > 0) ultimo = fila[fila.length - 1];
}

export function chamadasRegistradas() {
  return chamadas;
}

export function resetarFake() {
  fila = [];
  ultimo = { outcome: "unavailable" };
  chamadas = [];
}

export async function consultarClienteCompletoRocket(publicId) {
  chamadas.push(publicId);
  const r = fila.length > 0 ? fila.shift() : ultimo;
  return r;
}

// Helper para o teste montar um "success" realista com campos sensiveis.
export function clienteSucesso(vencimento) {
  return {
    outcome: "success",
    nome: "Cliente Sensivel Fake",
    servidorNome: "UNITV",
    planoNome: "Mensal",
    valor: "35.00",
    senha: "SENHA-SECRETA-NAO-DEVE-VAZAR",
    device_key_or_OTP_code: "DEVICEKEY-NAO-DEVE-VAZAR",
    vencimento,
  };
}
