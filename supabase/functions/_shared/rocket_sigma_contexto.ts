// Leitura do "contexto Sigma" de um cliente a partir da sessao
// autenticada do Rocket (cookie do Vault) -- pacote atual e
// expires_at. Usado exclusivamente pela Edge Function
// renovacao-sigma-contexto.
//
// Somente leitura. Nunca escreve no Rocket, nunca toca /pagamento/add/.
// Nada de cookie, sessao, senha, device_key/OTP ou HTML bruto sai
// daqui -- so' os dois campos ja extraidos.
//
// NOTA (investigacao 2026-08-28): a resolucao do id_cliente interno
// NAO acontece mais aqui. A lista de clientes do Rocket passou a ser
// materializada por JavaScript (runtime Vue) -- o
// #btn_add_pagamento_{id} nao existe no HTML que um fetch cru recebe,
// so' no DOM renderizado. Por isso a resolucao do idClienteInterno
// migrou para o Playwright, dentro de scripts/renovacao-sigma-workflow.mjs
// (+ scripts/lib/resolver-id-interno-dom.mjs). Esta funcao recebe o
// idClienteInterno ja resolvido e so' consulta o Sigma por ele.

export const ROCKET_BASE_URL = "https://app.rocketgestor.com";
export const ROCKET_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export function montarCookieHeader(sessionid: string, csrftoken: string): string {
  return `sessionid=${sessionid}; csrftoken=${csrftoken}`;
}

export type SigmaInfoResultado =
  | { outcome: "success"; package: string; expiresAt: string | null }
  | { outcome: "pacote_vazio" }
  | { outcome: "unavailable" };

// GET /gerenciador/cliente/sigma/info/?cliente_id={id} -- so' extrai
// data.package (trim) e data.expires_at. O corpo bruto nunca sai
// daqui. Distingue:
//   - resposta nao-JSON / !ok            -> "unavailable"
//   - JSON valido mas package vazio       -> "pacote_vazio"
export async function lerSigmaInfo(
  cookieHeader: string,
  idClienteInterno: string,
): Promise<SigmaInfoResultado> {
  try {
    const res = await fetch(
      `${ROCKET_BASE_URL}/gerenciador/cliente/sigma/info/?cliente_id=${encodeURIComponent(idClienteInterno)}`,
      {
        headers: {
          Cookie: cookieHeader,
          "User-Agent": ROCKET_USER_AGENT,
          Referer: `${ROCKET_BASE_URL}/gerenciador/`,
          "X-Requested-With": "XMLHttpRequest",
        },
      },
    );
    if (!res.ok) return { outcome: "unavailable" };

    const body = await res.json().catch(() => null);
    if (!body || typeof body !== "object") return { outcome: "unavailable" };

    const data = (body as { data?: { package?: unknown; expires_at?: unknown } }).data;
    const pacote = String(data?.package ?? "").trim();
    if (!pacote) return { outcome: "pacote_vazio" };

    const expiresAtBruto = data?.expires_at;
    const expiresAt =
      expiresAtBruto === null || expiresAtBruto === undefined ? null : String(expiresAtBruto);

    return { outcome: "success", package: pacote, expiresAt };
  } catch {
    return { outcome: "unavailable" };
  }
}
