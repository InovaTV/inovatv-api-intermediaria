// "Banco" em memoria de tokens_renovacao com semantica CAS -- mesmo
// padrao ja usado em scripts/testes/watchdog_lifecycle/fake_tokens_renovacao.mjs,
// com buscarTokenAtivoPorPublicId adicionado (necessario para a
// reavaliacao apos um CAS perdido em _shared/renovacao_guard_expiracao.ts).
let tokens = [];

export function _seed(lista) {
  tokens = lista.map((t) => ({
    id: t.id,
    estado: t.estado,
    operacao_id: t.operacao_id ?? null,
    grupo_id: t.grupo_id ?? null,
    public_id: t.public_id ?? null,
    conversation_id: t.conversation_id ?? "conv-1",
    telefone: t.telefone ?? "5511999999999",
    criado_em: t.criado_em ?? new Date().toISOString(),
    expira_em: t.expira_em,
    motivo_falha: t.motivo_falha ?? null,
  }));
}
export function _all() {
  return tokens;
}
export function resetar() {
  tokens = [];
}

const ATIVOS = ["aguardando_confirmacao", "autorizada", "renovacao_em_andamento"];

// Mesma query de _shared/tokens_renovacao.ts: public_id + grupo_id IS
// NULL + estado ativo, mais recente primeiro.
export async function buscarTokenAtivoPorPublicId(publicId) {
  const candidatos = tokens
    .filter((t) => t.public_id === publicId && t.grupo_id == null && ATIVOS.includes(t.estado))
    .sort((a, b) => new Date(b.criado_em).getTime() - new Date(a.criado_em).getTime());
  return candidatos[0] ? { ...candidatos[0] } : null;
}

export async function expirarSeVencido(reg) {
  const t = tokens.find((x) => x.id === reg.id);
  if (!t) return { ...reg, estado: "expirada" };
  if (t.estado !== "aguardando_confirmacao") return { ...t }; // CAS
  if (new Date(t.expira_em).getTime() > Date.now()) return { ...t };
  t.estado = "expirada";
  return { ...t };
}

export async function expirarAutorizacaoVinculada(id, motivo) {
  const t = tokens.find((x) => x.id === id);
  if (!t || t.estado !== "autorizada") return null; // CAS
  t.estado = "expirada";
  t.motivo_falha = motivo;
  return { ...t };
}
