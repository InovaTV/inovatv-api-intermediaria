let lotes = [];

export const ESTADOS_LOTE_NAO_TERMINAIS = [
  "aguardando_confirmacao",
  "autorizada",
  "renovacao_em_andamento",
];

export function _seed(lista) {
  lotes = lista.map((l) => ({
    grupo_id: l.grupo_id,
    estado: l.estado,
    operacao_id: l.operacao_id ?? null,
    conversation_id: l.conversation_id ?? "conv-1",
    telefone: l.telefone ?? "5511999999999",
    expira_em: l.expira_em,
    renovacao_concluida_em: l.renovacao_concluida_em ?? null,
  }));
}
export function _all() {
  return lotes;
}
export function resetar() {
  lotes = [];
}

const venceu = (l) => new Date(l.expira_em).getTime() < Date.now();

export async function buscarLotesAguardandoExpirados() {
  return lotes.filter((l) => l.estado === "aguardando_confirmacao" && venceu(l)).map((l) => ({ ...l }));
}
export async function buscarLotesAutorizadosVinculadosExpirados() {
  return lotes
    .filter((l) => l.estado === "autorizada" && l.operacao_id && venceu(l))
    .map((l) => ({ ...l }));
}
export async function buscarLotesTerminaisComCobrancaSemRenovacao() {
  const TERM = ["expirada", "falhou", "cancelada"];
  return lotes
    .filter((l) => TERM.includes(l.estado) && l.operacao_id && !l.renovacao_concluida_em)
    .map((l) => ({ ...l }));
}

export async function expirarLoteSeVencido(lote) {
  const l = lotes.find((x) => x.grupo_id === lote.grupo_id);
  if (!l) return { ...lote, estado: "expirada" };
  if (l.estado !== "aguardando_confirmacao") return { ...l };
  if (!venceu(l)) return { ...l };
  l.estado = "expirada";
  return { ...l };
}
export async function expirarLoteAutorizado(operacaoId) {
  const l = lotes.find((x) => x.operacao_id === operacaoId && x.estado === "autorizada");
  if (!l) return null; // CAS estado='autorizada'
  l.estado = "expirada";
  return { ...l };
}
export async function marcarLoteCicloRenovacaoEncerrado(grupoId) {
  const l = lotes.find((x) => x.grupo_id === grupoId);
  if (!l || l.renovacao_concluida_em) return null; // CAS
  l.renovacao_concluida_em = new Date().toISOString();
  return { ...l };
}
export async function reivindicarInicioRenovacaoLote(operacaoId) {
  const l = lotes.find((x) => x.operacao_id === operacaoId && x.estado === "autorizada");
  if (!l) return null; // CAS
  l.estado = "renovacao_em_andamento";
  return { ...l };
}

export async function buscarFilhosDoLote() {
  return [];
}

// Imports do watchdog fora do escopo dos testes da Peca 3.
export async function buscarLotesEmAndamentoAntigos() {
  return [];
}
export async function buscarLotesAutorizadosOrfaosAntigos() {
  return [];
}
export async function marcarResultadoFilhoLote() {
  return null;
}
export async function marcarEstadoFinalLote() {
  return null;
}
export async function marcarLoteComoFalha() {
  return null;
}
