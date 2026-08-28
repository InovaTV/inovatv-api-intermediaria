let tokenExistenteConfigurado = null;
let registroCriado = {
  id: "token-teste-1",
  cliente_nome: "Meu Uso Testes",
  servidor_nome: "BLAZE",
  plano_nome: "Mensal",
  vencimento_atual: "2026-09-13T23:59:00-03:00",
  token_hash: "hash-teste-123",
};

let contadorCriarToken = 0;

export function chamadasCriarToken() {
  return contadorCriarToken;
}
export function configurarTokenExistente(token) {
  tokenExistenteConfigurado = token;
}
export function configurarRegistroCriado(registro) {
  registroCriado = registro;
}
export function resetarTokensRenovacao() {
  tokenExistenteConfigurado = null;
  contadorCriarToken = 0;
  registroCriado = {
    id: "token-teste-1",
    cliente_nome: "Meu Uso Testes",
    servidor_nome: "BLAZE",
    plano_nome: "Mensal",
    vencimento_atual: "2026-09-13T23:59:00-03:00",
    token_hash: "hash-teste-123",
  };
}

export async function buscarTokenAtivoPorPublicId() {
  return tokenExistenteConfigurado;
}

export async function criarTokenRenovacao() {
  contadorCriarToken += 1;
  return { registro: registroCriado };
}
