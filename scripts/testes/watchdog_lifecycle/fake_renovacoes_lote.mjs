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
    criado_em: l.criado_em ?? null,
    expira_em: l.expira_em,
    renovacao_concluida_em: l.renovacao_concluida_em ?? null,
    cobranca_ausente_em: l.cobranca_ausente_em ?? null,
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
// CAMADA 3 -- espelho lote de buscarAutorizacoesVinculadasAindaNaJanela.
export async function buscarLotesAutorizadosVinculadosAindaNaJanela(minutosMinimos) {
  const teto = Date.now() - minutosMinimos * 60 * 1000;
  return lotes
    .filter(
      (l) =>
        l.estado === "autorizada" &&
        l.operacao_id &&
        !venceu(l) &&
        l.criado_em &&
        new Date(l.criado_em).getTime() < teto,
    )
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

// Janela de 5min ponta a ponta (2026-09-07) -- espelho lote.
export async function marcarLoteCobrancaAusenteDetectada(grupoId) {
  const l = lotes.find((x) => x.grupo_id === grupoId);
  if (!l || l.estado !== "autorizada" || l.cobranca_ausente_em) return null; // CAS duplo
  l.cobranca_ausente_em = new Date().toISOString();
  return { ...l };
}
export async function limparLoteCobrancaAusente(grupoId) {
  const l = lotes.find((x) => x.grupo_id === grupoId);
  if (!l || l.estado !== "autorizada") return null; // CAS
  l.cobranca_ausente_em = null;
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
// Backstop de 24h do lote (2026-09-07) -- CAS: 'autorizada' | 'renovacao_em_andamento' -> 'falhou'.
export async function marcarLoteComoFalha(grupoId, motivo) {
  const l = lotes.find(
    (x) => x.grupo_id === grupoId && (x.estado === "autorizada" || x.estado === "renovacao_em_andamento"),
  );
  if (!l) return null;
  l.estado = "falhou";
  l.motivo_falha = motivo;
  return { ...l };
}
