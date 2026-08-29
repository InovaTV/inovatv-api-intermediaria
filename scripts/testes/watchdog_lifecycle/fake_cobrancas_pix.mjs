let cobrancas = [];
export function _seed(lista) { cobrancas = lista.map((c) => ({ ...c })); }
export function _all() { return cobrancas; }
export function resetar() { cobrancas = []; }

export async function buscarCobrancaPorOperacaoId(opId) {
  const c = cobrancas.find((x) => x.operacao_id === opId);
  return c ? { ...c } : null;
}
export async function marcarCobrancaComoPaga(opId) {
  const c = cobrancas.find((x) => x.operacao_id === opId && x.status === "pendente"); // CAS
  if (!c) return null;
  c.status = "pago";
  return { ...c };
}
export async function marcarCobrancaComoDivergente(opId) {
  const c = cobrancas.find((x) => x.operacao_id === opId && x.status === "pendente"); // CAS
  if (!c) return null;
  c.status = "valor_divergente";
  return { ...c };
}
export async function expirarCobrancaPendente(opId) {
  const c = cobrancas.find((x) => x.operacao_id === opId && x.status === "pendente"); // CAS
  if (!c) return null;
  c.status = "expirada";
  return { ...c };
}
