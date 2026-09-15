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

// Etapa 4 (2026-09-15, guard de expiracao) -- usadas por
// _shared/renovacao_guard_expiracao.ts (importado por orchestrator/
// index.ts) para fechar um token vencido antes de decidir bloquear.
// Nenhum teste pre-existente desta suite seta expira_em no passado
// (configurarTokenExistente nunca inclui esse campo) -- o guard trata
// isso como "ainda dentro da janela" (fail-safe) e nunca chama estas
// funcoes; ficam aqui so' para os novos testes de wiring da Etapa 4.
export async function expirarSeVencido(reg) {
  if (reg?.estado !== "aguardando_confirmacao") return reg;
  tokenExistenteConfigurado = null; // "fechado" -- proxima leitura nao encontra mais nada ativo
  return { ...reg, estado: "expirada" };
}
export async function expirarAutorizacaoVinculada(_id, _motivo) {
  const fechado = tokenExistenteConfigurado ? { ...tokenExistenteConfigurado, estado: "expirada" } : null;
  tokenExistenteConfigurado = null;
  return fechado;
}

export async function criarTokenRenovacao(params) {
  contadorCriarToken += 1;
  argsCriarTokenRegistrados.push(params);
  return { registro: registroCriado };
}
