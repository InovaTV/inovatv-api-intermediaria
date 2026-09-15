// Mesmo padrao de scripts/testes/watchdog_lifecycle/fake_cobrancas_pix.mjs.
let cobrancas = [];
export function _seed(lista) {
  cobrancas = lista.map((c) => ({ ...c }));
}
export function _all() {
  return cobrancas;
}
export function resetar() {
  cobrancas = [];
}

export async function buscarCobrancaPorOperacaoId(opId) {
  const c = cobrancas.find((x) => x.operacao_id === opId);
  return c ? { ...c } : null;
}

// Correcao de cobranca pendente bloqueando nova tentativa (2026-09-15).
export async function buscarCobrancaPendente(publicId) {
  const candidatos = cobrancas
    .filter((c) => c.public_id === publicId && c.status === "pendente")
    .sort((a, b) => new Date(b.criado_em ?? 0).getTime() - new Date(a.criado_em ?? 0).getTime());
  return candidatos[0] ? { ...candidatos[0] } : null;
}
export async function buscarCobrancaPendentePorGrupo(grupoId) {
  const candidatos = cobrancas
    .filter((c) => c.grupo_id === grupoId && c.status === "pendente")
    .sort((a, b) => new Date(b.criado_em ?? 0).getTime() - new Date(a.criado_em ?? 0).getTime());
  return candidatos[0] ? { ...candidatos[0] } : null;
}
export async function expirarCobrancaPendente(opId) {
  const c = cobrancas.find((x) => x.operacao_id === opId && x.status === "pendente"); // CAS
  if (!c) return null;
  c.status = "expirada";
  return { ...c };
}
