let proximo = { outcome: "valida" };
export function configurar(v) { proximo = v; }
export function resetar() { proximo = { outcome: "valida" }; }
export async function validarAssinaturaWebhookOpenPix(_corpo, _assinatura) {
  return proximo;
}
