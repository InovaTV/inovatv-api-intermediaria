// Cliente de envio WhatsApp Cloud API -- Etapa 6, quarta fatia
// (inovatv_central CLAUDE.md, Componente 1 §16/§16-A). So a
// capacidade tecnica de enviar uma mensagem de texto livre -- NAO
// decide quando/pra quem enviar (isso e' do Orquestrador, fatia
// futura), NAO usa Message Template (fora de escopo desta fatia), NAO
// esta integrado a orchestrator/index.ts ainda (nem pro cliente, nem
// pro aviso ao Jose).
//
// WHATSAPP_ACCESS_TOKEN e WHATSAPP_PHONE_NUMBER_ID vem exclusivamente
// de secrets da Edge Function, configurados manualmente no painel do
// Supabase -- nunca hardcoded aqui, nunca aparecem em commit/log
// (mesmo padrao de gemini_client.ts).

const TIMEOUT_MS = 10000;
const GRAPH_API_VERSION = "v21.0";

export type EnvioWhatsAppResultado =
  | { outcome: "success"; messageId: string }
  | { outcome: "unavailable" };

async function enviarPayloadWhatsApp(
  payload: Record<string, unknown>,
): Promise<EnvioWhatsAppResultado> {
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!accessToken || !phoneNumberId) return { outcome: "unavailable" };

  try {
    const resp = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );

    const data = await resp.json().catch(() => null);

    if (!resp.ok) {
      console.log(
        "[whatsapp_client] envio falhou",
        JSON.stringify({ status: resp.status, statusText: resp.statusText, body: data }),
      );
      return { outcome: "unavailable" };
    }

    const messageId = data?.messages?.[0]?.id;
    if (typeof messageId !== "string") {
      console.log(
        "[whatsapp_client] resposta 200 sem messageId",
        JSON.stringify({ body: data }),
      );
      return { outcome: "unavailable" };
    }

    return { outcome: "success", messageId };
  } catch (erro) {
    console.log("[whatsapp_client] excecao ao enviar", String(erro));
    return { outcome: "unavailable" };
  }
}

export async function enviarMensagemWhatsApp(
  paraNumero: string,
  texto: string,
): Promise<EnvioWhatsAppResultado> {
  return enviarPayloadWhatsApp({
    messaging_product: "whatsapp",
    to: paraNumero,
    type: "text",
    text: { body: texto },
  });
}

// Botoes interativos nativos da Cloud API. A decisao de negocio (quando
// enviar e quais IDs usar) pertence ao Orquestrador; aqui so existe o
// transporte autenticado e o mesmo contrato de falha dos demais envios.
export async function enviarMensagemInterativaWhatsApp(
  paraNumero: string,
  texto: string,
  botoes: Array<{ id: string; titulo: string }>,
): Promise<EnvioWhatsAppResultado> {
  return enviarPayloadWhatsApp({
    messaging_product: "whatsapp",
    to: paraNumero,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: texto },
      action: {
        buttons: botoes.map((botao) => ({
          type: "reply",
          reply: { id: botao.id, title: botao.titulo },
        })),
      },
    },
  });
}

// Envio via Message Template -- unico formato aceito pela Cloud API
// pra mensagem iniciada pela empresa fora de uma janela de atendimento
// ativa (Componente 1 §16-A). O template precisa estar aprovado pela
// Meta antes de funcionar de verdade -- ate la, retorna "unavailable"
// como qualquer outra falha da Graph API (mesmo contrato, nunca lanca
// excecao).
export async function enviarTemplateWhatsApp(
  paraNumero: string,
  nomeTemplate: string,
  codigoIdioma: string,
  parametrosCorpo: string[],
): Promise<EnvioWhatsAppResultado> {
  return enviarPayloadWhatsApp({
    messaging_product: "whatsapp",
    to: paraNumero,
    type: "template",
    template: {
      name: nomeTemplate,
      language: { code: codigoIdioma },
      components:
        parametrosCorpo.length > 0
          ? [
              {
                type: "body",
                parameters: parametrosCorpo.map((texto) => ({ type: "text", text: texto })),
              },
            ]
          : [],
    },
  });
}
