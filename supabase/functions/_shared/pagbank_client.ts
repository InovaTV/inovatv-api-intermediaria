// Cliente PagBank/PagSeguro -- Sandbox nesta etapa (Bloco 1, 2026-08-23,
// fluxo de renovacao automatica). PAGBANK_SANDBOX_TOKEN vem
// exclusivamente de secret -- nunca hardcoded, nunca logado (mesmo
// padrao de GEMINI_API_KEY/WHATSAPP_ACCESS_TOKEN).
//
// consultarCobrancaPagBank() reaproveita EXATAMENTE o mecanismo ja
// comprovado com chamada real em
// docs/renovacao_automatica/levantamentos/2026-08-22_poc_consulta_pagbank_charge_id.md
// (GET /orders?charge_id=..., resultado em orders[0].charges[0]) --
// nao reinventado.
//
// criarCobrancaPagBank() e' NOVA -- nenhuma POC anterior deste projeto
// testou POST /orders (criacao). Payload montado com base na
// documentacao publica da API de Pedidos do PagBank (Pix via
// qr_codes), mas NUNCA verificado contra a API real ainda -- marcado
// explicitamente como o ponto novo/nao comprovado desta implementacao.

const SANDBOX_BASE_URL = "https://sandbox.api.pagseguro.com";
const TIMEOUT_MS = 15000;

function authHeader(): Record<string, string> | null {
  const token = Deno.env.get("PAGBANK_SANDBOX_TOKEN");
  if (!token) return null;
  return { Authorization: `Bearer ${token}` };
}

export interface CobrancaPagBankCriada {
  outcome: "success";
  orderId: string;
  chargeId: string | null; // normalmente ainda nulo -- so existe apos o pagamento
  qrCodeTexto: string; // "copia e cola"
  qrCodeId: string | null;
}

export type CriarCobrancaResultado = CobrancaPagBankCriada | { outcome: "unavailable" };

export async function criarCobrancaPagBank(
  operacaoId: string,
  valorCentavos: number,
  descricaoItem: string,
): Promise<CriarCobrancaResultado> {
  const headers = authHeader();
  if (!headers) return { outcome: "unavailable" };

  try {
    const resp = await fetch(`${SANDBOX_BASE_URL}/orders`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        reference_id: operacaoId,
        items: [
          {
            reference_id: `${operacaoId}-item`,
            name: descricaoItem,
            quantity: 1,
            unit_amount: valorCentavos,
          },
        ],
        qr_codes: [{ amount: { value: valorCentavos } }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const data = await resp.json().catch(() => null);

    if (!resp.ok) {
      console.log(
        "[pagbank_client] criar cobranca falhou",
        JSON.stringify({ status: resp.status, body: data }),
      );
      return { outcome: "unavailable" };
    }

    const orderId = data?.id;
    const qrCode = data?.qr_codes?.[0];
    const qrCodeTexto = qrCode?.text;

    if (typeof orderId !== "string" || typeof qrCodeTexto !== "string") {
      console.log(
        "[pagbank_client] resposta sem order id/qr code texto",
        JSON.stringify({ body: data }),
      );
      return { outcome: "unavailable" };
    }

    return {
      outcome: "success",
      orderId,
      chargeId: typeof data?.charges?.[0]?.id === "string" ? data.charges[0].id : null,
      qrCodeTexto,
      qrCodeId: typeof qrCode?.id === "string" ? qrCode.id : null,
    };
  } catch (erro) {
    console.log("[pagbank_client] excecao ao criar cobranca", String(erro));
    return { outcome: "unavailable" };
  }
}

export interface ConsultaCobrancaPagBank {
  outcome: "success";
  status: string | null;
  amountCentavos: number | null;
  referenceId: string | null;
  chargeId: string | null;
  endToEndId: string | null;
}

export type ConsultarCobrancaResultado =
  | ConsultaCobrancaPagBank
  | { outcome: "not_found" }
  | { outcome: "unavailable" };

export async function consultarCobrancaPagBank(
  chargeId: string,
): Promise<ConsultarCobrancaResultado> {
  const headers = authHeader();
  if (!headers) return { outcome: "unavailable" };

  try {
    const resp = await fetch(
      `${SANDBOX_BASE_URL}/orders?charge_id=${encodeURIComponent(chargeId)}`,
      { headers, signal: AbortSignal.timeout(TIMEOUT_MS) },
    );

    if (resp.status === 404) return { outcome: "not_found" };

    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      console.log(
        "[pagbank_client] consulta falhou",
        JSON.stringify({ status: resp.status, body: data }),
      );
      return { outcome: "unavailable" };
    }

    const order = data?.orders?.[0];
    const charge = order?.charges?.[0];
    if (!order || !charge) return { outcome: "not_found" };

    return {
      outcome: "success",
      status: charge?.status ?? null,
      amountCentavos: charge?.amount?.value ?? null,
      referenceId: order?.reference_id ?? null,
      chargeId: charge?.id ?? null,
      endToEndId: charge?.payment_method?.pix?.end_to_end_id ?? null,
    };
  } catch (erro) {
    console.log("[pagbank_client] excecao ao consultar", String(erro));
    return { outcome: "unavailable" };
  }
}
