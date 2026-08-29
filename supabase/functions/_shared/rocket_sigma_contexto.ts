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

// Iteracao 1 (2026-08-29) -- reclassificacao da instabilidade de auth do
// painel Sigma. O painel (`channeltvbr.store` etc., stack Laravel/Sanctum)
// devolve, de forma NAO-deterministica POR REQUISICAO, HTTP 200 com corpo
//   { "error": true, "msg": "{\"message\":\"Unauthenticated.\"}" }
// -- caracterizado ao vivo (3 requisicoes byte a byte identicas no mesmo
// milissegundo -> ERR, ERR, OK). Isso NUNCA e' "cliente sem plano": e'
// transitorio (`unavailable`, motivo `auth_painel`), retryavel pela Camada A
// (renovacao-sigma-contexto). `pacote_vazio` passa a exigir uma resposta
// VALIDA do painel (`error` != true, com bloco `data`) e realmente sem
// pacote.
export type SigmaInfoResultado =
  | { outcome: "success"; package: string; expiresAt: string | null }
  | { outcome: "pacote_vazio" }
  | { outcome: "unavailable"; motivo?: "auth_painel" | "http" | "resposta_invalida" | "excecao" };

// Erro reportado pelo painel que tem cara de rejeicao de autenticacao
// (Laravel: "Unauthenticated." / "Unauthorized" / token / sessao). Nao
// e' "cliente sem plano" -- e' transitorio.
function pareceErroAutenticacao(texto: string): boolean {
  return /unauthenticated|unauthoriz|forbidden|\btoken\b|n[aã]o autenticad|sess[aã]o (inv[aá]lid|expirad)|401|403/i.test(texto);
}

// GET /gerenciador/cliente/sigma/info/?cliente_id={id} -- so' extrai
// data.package (trim) e data.expires_at. O corpo bruto nunca sai daqui.
// Distingue:
//   - HTTP 401/403                                    -> "unavailable" (auth_painel)
//   - outro !ok / resposta nao-JSON                    -> "unavailable" (http / resposta_invalida)
//   - JSON com error:true + mensagem de auth           -> "unavailable" (auth_painel)
//   - JSON com error:true sem cara de auth              -> "unavailable" (http)
//   - resposta valida (error != true) SEM bloco data    -> "unavailable" (resposta_invalida)
//   - resposta valida com data e package vazio          -> "pacote_vazio" (cliente sem plano)
//   - resposta valida com data e package preenchido     -> "success"
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

    // Rejeicao de autenticacao no nivel HTTP -> transitorio, nunca pacote_vazio.
    if (res.status === 401 || res.status === 403) {
      return { outcome: "unavailable", motivo: "auth_painel" };
    }
    if (!res.ok) return { outcome: "unavailable", motivo: "http" };

    const body = await res.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return { outcome: "unavailable", motivo: "resposta_invalida" };
    }

    const b = body as {
      error?: unknown;
      msg?: unknown;
      message?: unknown;
      data?: { package?: unknown; expires_at?: unknown };
    };

    // Erro sinalizado DENTRO do JSON (HTTP 200 do Rocket, mas o painel
    // recusou). error:true NUNCA e' "cliente sem plano".
    if (b.error === true) {
      const texto = [
        typeof b.msg === "string" ? b.msg : "",
        typeof b.message === "string" ? b.message : "",
      ].join(" ");
      return { outcome: "unavailable", motivo: pareceErroAutenticacao(texto) ? "auth_painel" : "http" };
    }

    // A partir daqui: resposta valida do painel (error != true).
    const data = b.data;
    if (!data || typeof data !== "object") {
      // Sem bloco data -> nao da' pra afirmar "cliente sem plano". Trata
      // como indisponibilidade (retryavel), nao como pacote_vazio.
      return { outcome: "unavailable", motivo: "resposta_invalida" };
    }

    const pacote = String(data.package ?? "").trim();
    if (!pacote) return { outcome: "pacote_vazio" };

    const expiresAtBruto = data.expires_at;
    const expiresAt =
      expiresAtBruto === null || expiresAtBruto === undefined ? null : String(expiresAtBruto);

    return { outcome: "success", package: pacote, expiresAt };
  } catch {
    return { outcome: "unavailable", motivo: "excecao" };
  }
}
