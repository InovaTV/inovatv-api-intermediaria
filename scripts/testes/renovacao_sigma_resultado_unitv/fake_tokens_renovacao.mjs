let token = null;
let marcado = null;
export function configurarToken(t) { token = t; }
export function configurarMarcado(m) { marcado = m; }
export function resetar() { token = null; marcado = null; }
export async function buscarTokenPorOperacaoId() { return token; }
export async function marcarResultadoRenovacao() { return marcado ?? token; }
