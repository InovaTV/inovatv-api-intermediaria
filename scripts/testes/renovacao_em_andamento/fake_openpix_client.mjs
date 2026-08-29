let proximo = {
  outcome: "success",
  status: "COMPLETED",
  amountCentavos: 7000,
  correlationId: null,
  transactionId: null,
  endToEndId: null,
  paidAt: null,
};
export function configurar(v) { proximo = v; }
export function resetar() {
  proximo = {
    outcome: "success",
    status: "COMPLETED",
    amountCentavos: 7000,
    correlationId: null,
    transactionId: null,
    endToEndId: null,
    paidAt: null,
  };
}
export async function consultarCobrancaOpenPix(_correlationId) {
  return proximo;
}
