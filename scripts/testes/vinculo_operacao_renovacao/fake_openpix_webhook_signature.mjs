// Fake de _shared/openpix_webhook_signature.ts -- sempre valida (o
// objetivo destes testes e' a logica de vinculo apos pagamento
// confirmado, nao a criptografia da assinatura, ja validada em outro
// lugar).
export async function validarAssinaturaWebhookOpenPix() {
  return { outcome: "valida" };
}
