let mensagens = [];
let templates = [];
export function mensagensEnviadas() { return mensagens; }
export function templatesEnviados() { return templates; }
export function resetar() { mensagens = []; templates = []; }
export async function enviarMensagemWhatsApp(telefone, texto) {
  mensagens.push({ telefone, texto });
  return { outcome: "success" };
}
export async function enviarTemplateWhatsApp(telefone, nome, idioma, parametros) {
  templates.push({ telefone, nome, idioma, parametros });
  return { outcome: "success" };
}
