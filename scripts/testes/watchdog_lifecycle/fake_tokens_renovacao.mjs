// "Banco" em memoria de tokens_renovacao com semantica CAS -- para
// provar idempotencia e seguranca sob concorrencia (Peca 3).
let tokens = [];

export const ESTADOS_TOKEN_NAO_TERMINAIS = [
  "aguardando_confirmacao",
  "autorizada",
  "renovacao_em_andamento",
];

export function _seed(lista) {
  tokens = lista.map((t) => ({
    id: t.id,
    estado: t.estado,
    operacao_id: t.operacao_id ?? null,
    grupo_id: t.grupo_id ?? null,
    conversation_id: t.conversation_id ?? "conv-1",
    telefone: t.telefone ?? "5511999999999",
    expira_em: t.expira_em,
    renovacao_iniciada_em: t.renovacao_iniciada_em ?? null,
    renovacao_concluida_em: t.renovacao_concluida_em ?? null,
    motivo_falha: t.motivo_falha ?? null,
  }));
}
export function _all() {
  return tokens;
}
export function resetar() {
  tokens = [];
}

const venceu = (t) => new Date(t.expira_em).getTime() < Date.now();

export async function buscarSolicitacoesAguardandoExpiradas() {
  return tokens
    .filter((t) => t.estado === "aguardando_confirmacao" && !t.grupo_id && venceu(t))
    .map((t) => ({ ...t }));
}
export async function buscarAutorizacoesVinculadasExpiradas() {
  return tokens
    .filter((t) => t.estado === "autorizada" && t.operacao_id && !t.grupo_id && venceu(t))
    .map((t) => ({ ...t }));
}
export async function buscarTokensTerminaisComCobrancaSemRenovacao() {
  const TERM = ["expirada", "renovacao_falhou", "renovacao_indeterminada", "cancelada"];
  return tokens
    .filter((t) => TERM.includes(t.estado) && t.operacao_id && !t.grupo_id && !t.renovacao_concluida_em)
    .map((t) => ({ ...t }));
}

export async function expirarSeVencido(reg) {
  const t = tokens.find((x) => x.id === reg.id);
  if (!t) return { ...reg, estado: "expirada" };
  if (t.estado !== "aguardando_confirmacao") return { ...t };
  if (!venceu(t)) return { ...t };
  t.estado = "expirada"; // CAS: so' a partir de 'aguardando_confirmacao'
  return { ...t };
}
export async function expirarAutorizacaoVinculada(id, motivo) {
  const t = tokens.find((x) => x.id === id);
  if (!t || t.estado !== "autorizada") return null; // CAS
  t.estado = "expirada";
  t.motivo_falha = motivo;
  return { ...t };
}
export async function marcarCicloRenovacaoEncerrado(id, motivo) {
  const t = tokens.find((x) => x.id === id);
  if (!t || t.renovacao_concluida_em) return null; // CAS renovacao_concluida_em IS NULL
  t.renovacao_concluida_em = new Date().toISOString();
  t.motivo_falha = motivo;
  return { ...t };
}
export async function reivindicarInicioRenovacao(operacaoId) {
  const t = tokens.find((x) => x.operacao_id === operacaoId && x.estado === "autorizada" && !x.grupo_id);
  if (!t) return null; // CAS estado='autorizada'
  t.estado = "renovacao_em_andamento";
  t.renovacao_iniciada_em = new Date().toISOString();
  return { ...t };
}

// Imports do watchdog fora do escopo dos testes da Peca 3 (mantidos
// no-op para o import nao quebrar).
export async function buscarRenovacoesEmAndamentoAntigas() {
  return [];
}
export async function marcarResultadoRenovacao() {
  return null;
}
export async function buscarAutorizacoesOrfasAntigas() {
  return [];
}
export async function marcarAutorizacaoComoFalha() {
  return null;
}
