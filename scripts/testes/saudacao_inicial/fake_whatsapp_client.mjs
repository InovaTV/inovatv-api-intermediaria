// Fake de _shared/whatsapp_client.ts para a suite da saudacao inicial.
// Igual ao fake herdado de orchestrator_multiplos_acessos, mais um
// toggle de FALHA -- a suite precisa provar que, quando o envio da
// saudacao falha, a mensagem do cliente e' gravada mas a saudacao NAO,
// e a execucao ainda assim encerra (nao chama Gemini).

let mensagensEnviadas = [];
let mensagensInterativasEnviadas = [];
let templatesEnviados = [];
let forcarFalhaTexto = false;

export function resetarWhatsapp() {
  mensagensEnviadas = [];
  mensagensInterativasEnviadas = [];
  templatesEnviados = [];
  forcarFalhaTexto = false;
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
export function forcarFalhaEnvioTexto() {
  forcarFalhaTexto = true;
}

export async function enviarMensagemWhatsApp(telefone, texto) {
  mensagensEnviadas.push({ telefone, texto });
  if (forcarFalhaTexto) return { outcome: "unavailable" };
  return { outcome: "success", messageId: `wamid-fake-${mensagensEnviadas.length}` };
}

export async function enviarMensagemInterativaWhatsApp(telefone, texto, botoes) {
  mensagensInterativasEnviadas.push({ telefone, texto, botoes });
  return { outcome: "success", messageId: `wamid-fake-int-${mensagensInterativasEnviadas.length}` };
}

export async function enviarTemplateWhatsApp(telefone, nomeTemplate, idioma, parametros) {
  templatesEnviados.push({ telefone, nomeTemplate, idioma, parametros });
  return { outcome: "success", messageId: `wamid-fake-tpl-${templatesEnviados.length}` };
}
