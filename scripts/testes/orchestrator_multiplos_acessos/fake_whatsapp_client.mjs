let mensagensEnviadas = [];
let mensagensInterativasEnviadas = [];
let templatesEnviados = [];

export function resetarWhatsapp() {
  mensagensEnviadas = [];
  mensagensInterativasEnviadas = [];
  templatesEnviados = [];
}
export function getMensagensEnviadas() {
  return mensagensEnviadas;
}
export function getMensagensInterativasEnviadas() {
  return mensagensInterativasEnviadas;
}
export function getTemplatesEnviados() {
  return templatesEnviados;
}

export async function enviarMensagemWhatsApp(telefone, texto) {
  mensagensEnviadas.push({ telefone, texto });
  return { outcome: "success" };
}

export async function enviarMensagemInterativaWhatsApp(telefone, texto, botoes) {
  mensagensInterativasEnviadas.push({ telefone, texto, botoes });
  return { outcome: "success" };
}

export async function enviarTemplateWhatsApp(telefone, nomeTemplate, idioma, parametros) {
  templatesEnviados.push({ telefone, nomeTemplate, idioma, parametros });
  return { outcome: "success" };
}
