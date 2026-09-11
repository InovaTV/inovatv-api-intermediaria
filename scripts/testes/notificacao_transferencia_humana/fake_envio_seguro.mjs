// Fake de _shared/envio_seguro.ts -- resolve na hora, sem esperar de
// verdade os 7s reais (produzidos por aguardarIntervaloSeguroEntreEnvios).
// So existe pra manter a suite rapida; nao verifica timing.
export const INTERVALO_SEGURO_ENTRE_ENVIOS_MS = 0;

export async function aguardarIntervaloSeguroEntreEnvios() {
  // no-op
}
