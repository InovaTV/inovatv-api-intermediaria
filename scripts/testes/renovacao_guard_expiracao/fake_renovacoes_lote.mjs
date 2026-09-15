// Espelho lote de fake_tokens_renovacao.mjs desta mesma suite --
// mesmo padrao de scripts/testes/watchdog_lifecycle/fake_renovacoes_lote.mjs,
// com buscarLoteAtivoParaPublicId adicionado. A busca real (Etapa 3,
// _shared/renovacoes_lote.ts) resolve por um filho em tokens_renovacao
// (public_id -> grupo_id) e so' depois busca a "capa" do lote -- aqui
// simplificado: cada linha do fake ja carrega o publicId do filho que
// a acionou, suficiente para os testes desta suite (nunca mais de 1
// lote ativo por publicId, mesma garantia do indice unico real).
let lotes = [];

export function _seed(lista) {
  lotes = lista.map((l) => ({
    grupo_id: l.grupo_id,
    publicId: l.publicId, // publicId do filho usado para encontrar este lote
    estado: l.estado,
    operacao_id: l.operacao_id ?? null,
    conversation_id: l.conversation_id ?? "conv-1",
    telefone: l.telefone ?? "5511999999999",
    criado_em: l.criado_em ?? new Date().toISOString(),
    expira_em: l.expira_em,
  }));
}
export function _all() {
  return lotes;
}
export function resetar() {
  lotes = [];
}

const ATIVOS = ["aguardando_confirmacao", "autorizada", "renovacao_em_andamento"];

export async function buscarLoteAtivoParaPublicId(publicId) {
  const l = lotes.find((x) => x.publicId === publicId && ATIVOS.includes(x.estado));
  return l ? { ...l } : null;
}

export async function expirarLoteSeVencido(lote) {
  const l = lotes.find((x) => x.grupo_id === lote.grupo_id);
  if (!l) return { ...lote, estado: "expirada" };
  if (l.estado !== "aguardando_confirmacao") return { ...l };
  if (new Date(l.expira_em).getTime() > Date.now()) return { ...l };
  l.estado = "expirada";
  return { ...l };
}

export async function expirarLoteAutorizado(operacaoId) {
  const l = lotes.find((x) => x.operacao_id === operacaoId && x.estado === "autorizada");
  if (!l) return null; // CAS
  l.estado = "expirada";
  return { ...l };
}
