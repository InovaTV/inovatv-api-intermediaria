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
let argsCriarTokenRegistrados = [];

export function chamadasCriarToken() {
  return contadorCriarToken;
}
// Etapa 2 (Bloco 4): payload EXATO de cada criarTokenRenovacao -- pra
// asserir tipo/unitvSn/unitvId no fluxo UniTV.
export function argsCriarToken() {
  return argsCriarTokenRegistrados;
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
  argsCriarTokenRegistrados = [];
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

export async function criarTokenRenovacao(params) {
  contadorCriarToken += 1;
  argsCriarTokenRegistrados.push(params);
  return { registro: registroCriado };
}
