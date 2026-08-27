// Fake de _shared/whatsapp_client.ts -- so registra o que foi enviado,
// sempre "sucesso" (o objetivo destes testes e' a logica de vinculo/
// persistencia, nao o transporte real do WhatsApp).
export const mensagensEnviadas = [];

export async function enviarMensagemWhatsApp(paraNumero, texto) {
  mensagensEnviadas.push({ tipo: "texto", paraNumero, texto });
  return { outcome: "success", messageId: "fake-msg-" + mensagensEnviadas.length };
}

export async function enviarMensagemInterativaWhatsApp(paraNumero, texto, botoes) {
  mensagensEnviadas.push({ tipo: "interativa", paraNumero, texto, botoes });
  return { outcome: "success", messageId: "fake-msg-" + mensagensEnviadas.length };
}

export async function enviarTemplateWhatsApp(paraNumero, nomeTemplate, idioma, parametros) {
  mensagensEnviadas.push({ tipo: "template", paraNumero, nomeTemplate, idioma, parametros });
  return { outcome: "success", messageId: "fake-msg-" + mensagensEnviadas.length };
}
