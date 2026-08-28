// Fake de _shared/whatsapp_client.ts -- registra envios, com falha
// configuravel (uma unica vez) pra testar isolamento de falha.
export const mensagensEnviadas = [];
export const templatesEnviados = [];

let falharProximoTexto = false;
let falharProximoTemplate = false;

export function forcarFalhaProximoTexto() {
  falharProximoTexto = true;
}
export function forcarFalhaProximoTemplate() {
  falharProximoTemplate = true;
}
export function resetar() {
  mensagensEnviadas.length = 0;
  templatesEnviados.length = 0;
  falharProximoTexto = false;
  falharProximoTemplate = false;
}

export async function enviarMensagemWhatsApp(paraNumero, texto) {
  mensagensEnviadas.push({ paraNumero, texto });
  if (falharProximoTexto) {
    falharProximoTexto = false;
    return { outcome: "unavailable" };
  }
  return { outcome: "success", messageId: "fake-msg-" + mensagensEnviadas.length };
}

export async function enviarMensagemInterativaWhatsApp(paraNumero, texto, botoes) {
  mensagensEnviadas.push({ paraNumero, texto, botoes });
  return { outcome: "success", messageId: "fake-msg-" + mensagensEnviadas.length };
}

export async function enviarTemplateWhatsApp(paraNumero, nomeTemplate, idioma, parametros) {
  templatesEnviados.push({ paraNumero, nomeTemplate, idioma, parametros });
  if (falharProximoTemplate) {
    falharProximoTemplate = false;
    return { outcome: "unavailable" };
  }
  return { outcome: "success", messageId: "fake-tpl-" + templatesEnviados.length };
}
