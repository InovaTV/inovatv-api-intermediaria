let templates = [], mensagens = [];
export function templatesEnviados() { return templates; }
export function mensagensEnviadas() { return mensagens; }
export function resetar() { templates = []; mensagens = []; }
export async function enviarTemplateWhatsApp(telefone, nome, idioma, parametros) {
  templates.push({ telefone, nome, idioma, parametros });
  return { outcome: "success" };
}
export async function enviarMensagemWhatsApp(telefone, texto) {
  mensagens.push({ telefone, texto });
  return { outcome: "success" };
}
