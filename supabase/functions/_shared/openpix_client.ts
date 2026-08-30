// Cliente OpenPix/Woovi -- Sandbox nesta etapa (Bloco 1, 2026-08-24,
// substitui pagbank_client.ts). OPENPIX_APPID vem exclusivamente de
// secret -- nunca hardcoded, nunca logado (mesmo padrao de
// GEMINI_API_KEY/WHATSAPP_ACCESS_TOKEN/PAGBANK_SANDBOX_TOKEN).
//
// Troca de provedor decidida em 2026-08-24 depois de investigacao real
// (inovatv_central/CLAUDE.md): o PagBank exige customer.tax_id (CPF/CNPJ
// do cliente pagador) em toda modalidade de Pix avulso -- incompativel
// com o requisito de nao coletar nenhum dado do cliente. A OpenPix
// confirmou, em teste real de Sandbox, criar cobranca Pix sem nenhum
// dado de customer.
//
// correlationID = operacaoId (nosso identificador interno, gerado em
// crypto.randomUUID() pelo Orquestrador) -- e' o mesmo padrao ja usado
// como reference_id no PagBank, so que agora a propria OpenPix reforca
// a unicidade (reenviar o mesmo correlationID retorna HTTP 400
// explicito, "Já existe uma cobrança com este Correlação ID" --
// confirmado em teste real, nunca reaproveita nem duplica
// silenciosamente). Consulta tambem e' sempre por correlationID
// (GET /charge/{correlationID}), nunca por transactionID -- mais
// simples que o modelo de duas camadas (order/charge) do PagBank.
//
// Base URL: so' Sandbox foi validada em POC real (2026-08-24).
// Producao (api.woovi.com) exige conta/credencial separada. A URL vem
// de OPENPIX_BASE_URL (secret); sem o secret, mantem o Sandbox como
// default -- zero mudanca de comportamento ate o secret de producao
// ser configurado.

const OPENPIX_BASE_URL = Deno.env.get("OPENPIX_BASE_URL") ?? "https://api.woovi-sandbox.com";
const TIMEOUT_MS = 15000;

function authHeader(): Record<string, string> | null {
  const appId = Deno.env.get("OPENPIX_APPID");
  if (!appId) return null;
  return { Authorization: appId };
}

export interface CobrancaOpenPixCriada {
  outcome: "success";
  transactionId: string;
  qrCodeTexto: string; // brCode -- "copia e cola" (guardado em cobrancas_pix; NAO vai mais ao WhatsApp)
  // paymentLinkUrl: pagina de pagamento hospedada pela Woovi, uma por
  // cobranca (UX de renovacao 2026-08-28). A resposta do POST /charge
  // ja traz este campo -- antes era descartado. E' o que o cliente
  // recebe no WhatsApp agora, no lugar do BR Code no corpo da mensagem.
  paymentLinkUrl: string;
}

export type CriarCobrancaResultado = CobrancaOpenPixCriada | { outcome: "unavailable" };

export async function criarCobrancaOpenPix(
  operacaoId: string,
  valorCentavos: number,
  comentario: string,
): Promise<CriarCobrancaResultado> {
  const headers = authHeader();
  if (!headers) return { outcome: "unavailable" };

  try {
    const resp = await fetch(`${OPENPIX_BASE_URL}/api/v1/charge`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        correlationID: operacaoId,
        value: valorCentavos,
        comment: comentario,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const data = await resp.json().catch(() => null);

    if (!resp.ok) {
      console.log(
        "[openpix_client] criar cobranca falhou",
        JSON.stringify({ status: resp.status, body: data }),
      );
      return { outcome: "unavailable" };
    }

    const transactionId = data?.charge?.transactionID;
    const qrCodeTexto = data?.charge?.brCode ?? data?.brCode;
    const paymentLinkUrl = data?.charge?.paymentLinkUrl ?? data?.paymentLinkUrl;

    if (
      typeof transactionId !== "string" ||
      typeof qrCodeTexto !== "string" ||
      typeof paymentLinkUrl !== "string"
    ) {
      console.log(
        "[openpix_client] resposta sem transactionID/brCode/paymentLinkUrl",
        JSON.stringify({
          temTransactionId: typeof transactionId === "string",
          temBrCode: typeof qrCodeTexto === "string",
          temPaymentLinkUrl: typeof paymentLinkUrl === "string",
        }),
      );
      return { outcome: "unavailable" };
    }

    return { outcome: "success", transactionId, qrCodeTexto, paymentLinkUrl };
  } catch (erro) {
    console.log("[openpix_client] excecao ao criar cobranca", String(erro));
    return { outcome: "unavailable" };
  }
}

export interface ConsultaCobrancaOpenPix {
  outcome: "success";
  status: string | null; // "ACTIVE" | "COMPLETED" | ... (valores reais da OpenPix)
  amountCentavos: number | null;
  correlationId: string | null;
  transactionId: string | null;
  endToEndId: string | null;
  paidAt: string | null;
}

export type ConsultarCobrancaResultado =
  | ConsultaCobrancaOpenPix
  | { outcome: "not_found" }
  | { outcome: "unavailable" };

// Consulta sempre por correlationID (= operacaoId), nunca por
// transactionID -- e' o identificador que nos controlamos e enviamos
// na criacao, mesmo em caso de falha de persistencia local.
export async function consultarCobrancaOpenPix(
  operacaoId: string,
): Promise<ConsultarCobrancaResultado> {
  const headers = authHeader();
  if (!headers) return { outcome: "unavailable" };

  try {
    const resp = await fetch(
      `${OPENPIX_BASE_URL}/api/v1/charge/${encodeURIComponent(operacaoId)}`,
      { headers, signal: AbortSignal.timeout(TIMEOUT_MS) },
    );

    if (resp.status === 404) return { outcome: "not_found" };

    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      console.log(
        "[openpix_client] consulta falhou",
        JSON.stringify({ status: resp.status, body: data }),
      );
      return { outcome: "unavailable" };
    }

    const charge = data?.charge;
    if (!charge) return { outcome: "not_found" };

    return {
      outcome: "success",
      status: charge?.status ?? null,
      amountCentavos: typeof charge?.value === "number" ? charge.value : null,
      correlationId: charge?.correlationID ?? null,
      transactionId: charge?.transactionID ?? null,
      // endToEndId NAO foi confirmado presente no GET /charge/{id} real
      // (so' apareceu no payload do webhook, em pix.endToEndId, nivel
      // raiz -- nao dentro de charge). Mantido best-effort/opcional --
      // nada no fluxo depende deste campo, so' status/amount.
      endToEndId: charge?.pix?.endToEndId ?? charge?.paymentMethods?.pix?.endToEndId ?? null,
      paidAt: charge?.paidAt ?? null,
    };
  } catch (erro) {
    console.log("[openpix_client] excecao ao consultar", String(erro));
    return { outcome: "unavailable" };
  }
}
