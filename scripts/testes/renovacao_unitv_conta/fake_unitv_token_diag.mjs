// Fake de _shared/unitv_token_diag.ts para a suite da EF
// renovacao-unitv-conta. So' registra que diagnosticarTokenUnitv foi
// agendada e com quais args -- prova o gatilho (SO' em "unavailable")
// sem puxar supabase-js/whatsapp reais. Nunca lanca.

let chamadas = [];

export function chamadasDiag() { return chamadas; }
export function resetarDiag() { chamadas = []; }

export const MOTIVO_ALERTA_JOSE = "UNITV_DEALER_TOKEN invalido - recapturar (autocura fase 1)";

export async function diagnosticarTokenUnitv(opts) {
  chamadas.push(opts);
}

export function higienizarMsgPainel(msg) {
  return typeof msg === "string" && msg.trim() !== "" ? msg.slice(0, 120) : null;
}
