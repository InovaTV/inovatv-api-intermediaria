import { registrar } from "./_seq.mjs";

// modo: "success" | "unavailable" | "throw"
let modo = "success";
let enviadas = [];

export function configurarModo(m) { modo = m; }
export function enviadasFeitas() { return enviadas; }
export function resetar() { modo = "success"; enviadas = []; }

export async function enviarMensagemWhatsApp(telefone, texto) {
  registrar("enviarMensagemWhatsApp");
  enviadas.push({ telefone, texto });
  if (modo === "throw") throw new Error("falha simulada de rede WhatsApp");
  if (modo === "unavailable") return { outcome: "unavailable" };
  return { outcome: "success", messageId: "wamid.fake" };
}
