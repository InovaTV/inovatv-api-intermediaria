// wasender_client.ts
// Cliente de ENVIO via WasenderAPI -- LABORATORIO (repositorio
// inovatv-wasender-lab, Supabase uleklqdlwyofnkcsdigz). NAO e producao.
//
// Substitui _shared/whatsapp_client.ts (Meta Cloud API) SO no
// Orquestrador do laboratorio -- o whatsapp_client.ts (Meta) permanece
// INTOCADO como referencia e continua sendo o cliente das demais
// funcoes herdadas (painel-atendimento-responder, renovacao-*,
// openpix-webhook), que estao fora do escopo do lab.
//
// Contrato PRESERVADO -- mesmas 3 funcoes exportadas, mesmas
// assinaturas, mesmo tipo de retorno EnvioWhatsAppResultado. Assim os
// ~18 call sites do orchestrator/index.ts NAO mudam; so a linha de
// import (L156) aponta para este arquivo.
//
// WasenderAPI = metodo NAO-OFICIAL (sessao QR/multi-device). Diferencas
// em relacao a Cloud API (ver "AUDITORIA DOCUMENTAL DO WASENDERAPI --
// 2026-09-04" no NEXT_SESSION.md):
//   - envio de texto: POST /api/send-message { to, text }, Bearer token,
//     id retornado = data.msgId (NUMERICO, != wamid).
//   - SEM botoes interativos nativos -> enviarMensagemInterativaWhatsApp
//     degrada para texto + lista numerada (o roteamento de resposta de
//     botao NAO e implementado -- fluxo de renovacao fora do escopo do lab).
//   - SEM Message Templates e SEM janela de 24h -> enviarTemplateWhatsApp
//     renderiza os parametros do corpo como mensagem de texto simples.
//
// SECRETS (Edge Function do LAB uleklqdlwyofnkcsdigz -- NUNCA em codigo
// ou arquivo versionado; NENHUM criado nesta etapa):
//   - WASENDER_API_TOKEN  -> Authorization: Bearer <token> em /api/send-message.
//   - WASENDER_BASE_URL   -> opcional; default https://wasenderapi.com.
// Sem WASENDER_API_TOKEN, todo envio retorna { outcome: "unavailable" }
// (mesmo contrato de falha do whatsapp_client.ts Meta -- nunca lanca).

const TIMEOUT_MS = 10000;
const WASENDER_BASE_URL_PADRAO = "https://wasenderapi.com";

export type EnvioWhatsAppResultado =
  | { outcome: "success"; messageId: string }
  | { outcome: "unavailable" };

// ----------------------------------------------------------------------------
// Transporte unico: POST {base}/api/send-message. Recebe ja o objeto de
// corpo (so { to, text } nesta etapa). Nunca loga token nem corpo da
// mensagem.
// ----------------------------------------------------------------------------
async function enviarTextoWasender(
  paraNumero: string,
  texto: string,
): Promise<EnvioWhatsAppResultado> {
  const apiToken = Deno.env.get("WASENDER_API_TOKEN");
  if (!apiToken) return { outcome: "unavailable" };

  const baseUrl = Deno.env.get("WASENDER_BASE_URL") ?? WASENDER_BASE_URL_PADRAO;

  try {
    const resp = await fetch(`${baseUrl}/api/send-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ to: paraNumero, text: texto }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const data = await resp.json().catch(() => null);

    if (!resp.ok) {
      console.log(
        "[wasender_client] envio falhou",
        JSON.stringify({ status: resp.status, statusText: resp.statusText, body: data }),
      );
      return { outcome: "unavailable" };
    }

    // Sucesso documentado: { success: true, data: { msgId, jid, status } }.
    const msgId = data?.data?.msgId;
    const ok = data?.success === true && (typeof msgId === "number" || typeof msgId === "string");
    if (!ok) {
      console.log(
        "[wasender_client] resposta 2xx sem msgId util",
        JSON.stringify({ body: data }),
      );
      return { outcome: "unavailable" };
    }

    const messageId = String(msgId);

    // Observabilidade minima -- so a ACEITACAO (HTTP 2xx + msgId).
    // Nunca loga corpo da mensagem, token ou secret.
    console.log(
      "[wasender_client] wasender_send_accepted",
      JSON.stringify({
        evento: "wasender_send_accepted",
        msgId: messageId,
        destinatario: paraNumero,
        timestamp: new Date().toISOString(),
        outcome: "success",
      }),
    );

    return { outcome: "success", messageId };
  } catch (erro) {
    console.log("[wasender_client] excecao ao enviar", String(erro));
    return { outcome: "unavailable" };
  }
}

// ----------------------------------------------------------------------------
// API PUBLICA -- espelha _shared/whatsapp_client.ts byte a byte nas
// assinaturas. O Orquestrador nao percebe a troca.
// ----------------------------------------------------------------------------

export async function enviarMensagemWhatsApp(
  paraNumero: string,
  texto: string,
): Promise<EnvioWhatsAppResultado> {
  return enviarTextoWasender(paraNumero, texto);
}

// SEM botao nativo no WasenderAPI. Degrada para o corpo + as opcoes como
// lista numerada de texto. Os botoes[].id sao DELIBERADAMENTE descartados
// -- o roteamento da resposta de botao pertence ao fluxo de renovacao,
// que esta fora do escopo do laboratorio.
export async function enviarMensagemInterativaWhatsApp(
  paraNumero: string,
  texto: string,
  botoes: Array<{ id: string; titulo: string }>,
): Promise<EnvioWhatsAppResultado> {
  const linhas = botoes.map((b, i) => `${i + 1} - ${b.titulo}`).join("\n");
  const corpo = linhas.length > 0 ? `${texto}\n\n${linhas}` : texto;
  return enviarTextoWasender(paraNumero, corpo);
}

// SEM Message Template e SEM janela de 24h no WasenderAPI. Renderiza os
// parametros do corpo (ja e' o texto pronto, um por linha) como mensagem
// de texto simples. nomeTemplate / codigoIdioma nao sao usados.
export async function enviarTemplateWhatsApp(
  paraNumero: string,
  nomeTemplate: string,
  _codigoIdioma: string,
  parametrosCorpo: string[],
): Promise<EnvioWhatsAppResultado> {
  const corpo = parametrosCorpo.length > 0
    ? parametrosCorpo.join("\n")
    : `(${nomeTemplate})`;
  return enviarTextoWasender(paraNumero, corpo);
}
