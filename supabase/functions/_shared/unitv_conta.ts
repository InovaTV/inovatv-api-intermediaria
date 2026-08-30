// Resolucao da conta UniTV a partir do `sn` (== `usuario` do cadastro
// Rocket) -- Etapa 2 (Renovacao UniTV, Bloco 3). SO' resolucao:
// `POST /api/account` no painel de revenda, para descobrir o `id`
// numerico interno da conta (exigido pelo /renew) e o `expireTime`.
//
// NUNCA chama /api/account/renew. A renovacao em si continua exclusiva
// do runner do GitHub Actions (scripts/lib/unitv-renovar.mjs, congelado).
// Este modulo existe para o Orquestrador resolver a conta ANTES de
// criar token/cobranca (Opcao A) -- sem token/cobranca quando a conta
// nao resolve para exatamente 1.
//
// TRANSPORTE, nao investigacao: mecanica ja comprovada ponta a ponta
// (docs/unitv/*, POC 013). Este e' o gemeo Deno do resolvedor que ja
// existe em scripts/lib/unitv-renovar.mjs (Node/runner) -- os dois
// implementam o MESMO protocolo do painel:
//   sign  = MD5("dealer" + id + points_type + points)
//   corpo = AES-128-CBC(PKCS7, key/IV fixos do bundle deles) -> HEX MAIUSCULO
//   resposta = envelope texto puro { returnCode, errorMessage, jumpCode, data }
//              (returnCode 0 = ok; `data`, quando presente, = HEX AES)
// chave/IV/algoritmo do `sign` sao CONSTANTES DO PROTOCOLO DELES, nao
// segredo nosso. A suite unitv_conta faz cross-check: `sign`/`encrypt`
// deste modulo produzem EXATAMENTE o mesmo output de unitv-renovar.mjs.
//
// dealer_token / dealer_name vem so' de env (UNITV_DEALER_TOKEN /
// UNITV_DEALER_NAME) -- nunca hardcoded, nunca logado, nunca devolvido.

import { createHash } from "node:crypto";

// --- Constantes do protocolo do painel (fixas, nao sao segredo nosso) ---
const UNITV_AES_KEY = "93403d3aa2ec48b4"; // 16 bytes -> AES-128
const UNITV_AES_IV = "7cf0127d190cb909"; // 16 bytes
export const UNITV_API_BASE = "https://panel-web.revenda.site";
export const UNITV_PACKAGE_ID = 1;
export const UNITV_POINTS_TYPE = 1;
export const UNITV_POINTS = 1;

const HTTP_TIMEOUT_MS = 15000;

// sign = MD5("dealer" + id + points_type + points).
export function unitvSign(id: number, pointsType: number, points: number): string {
  return createHash("md5").update(`dealer${id}${pointsType}${points}`).digest("hex");
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.trim();
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
function bytesToHexUpper(buf: ArrayBuffer): string {
  let hex = "";
  for (const b of new Uint8Array(buf)) hex += b.toString(16).padStart(2, "0");
  return hex.toUpperCase();
}

// JSON string -> AES-128-CBC(PKCS7) -> HEX MAIUSCULO (WebCrypto -- mesmo
// resultado que o createCipheriv de unitv-renovar.mjs).
export async function unitvEncrypt(plaintext: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(UNITV_AES_KEY), { name: "AES-CBC" }, false, ["encrypt"]);
  const ct = await crypto.subtle.encrypt({ name: "AES-CBC", iv: enc.encode(UNITV_AES_IV) }, key, enc.encode(plaintext));
  return bytesToHexUpper(ct);
}

// HEX -> AES-128-CBC decrypt -> UTF-8. Aplicado ao campo `data` do
// envelope da resposta.
export async function unitvDecrypt(hex: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(UNITV_AES_KEY), { name: "AES-CBC" }, false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-CBC", iv: enc.encode(UNITV_AES_IV) }, key, hexToBytes(hex));
  return new TextDecoder().decode(pt);
}

type CallOk = { ok: true; data: unknown };
// Enriquecido (Fase 1 autocura UNITV_DEALER_TOKEN, 2026-08-29): `reason`
// continua sendo o unico campo que o restante do codigo usa pra decidir
// -- `renovacao-unitv-conta` so' distingue nao_encontrado/ambiguo/
// indisponivel, e `resolverContaUnitv` so' propaga "unavailable". Os
// campos extras (`detalhe`/`returnCode`/`httpStatus`/`painelMsg`) sao
// SO' pra observabilidade do diagnostico -- antes, o returnCode/HTTP da
// chamada que falhava era lido 1x e descartado. Nao alteram nenhum
// caminho de decisao.
type CallErr = {
  ok: false;
  reason: "unavailable";
  detalhe: "excecao" | "corpo_ilegivel" | "corpo_nao_json" | "return_code" | "data_indecifravel";
  returnCode?: number;
  httpStatus?: number;
  painelMsg?: string;
};

async function callUnitvApi(path: string, payloadObj: unknown, fetchImpl: typeof fetch): Promise<CallOk | CallErr> {
  let resp: Response;
  try {
    resp = await fetchImpl(`${UNITV_API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await unitvEncrypt(JSON.stringify(payloadObj)),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "unavailable", detalhe: "excecao" };
  }

  let text: string;
  try {
    text = await resp.text();
  } catch {
    return { ok: false, reason: "unavailable", detalhe: "corpo_ilegivel", httpStatus: resp.status };
  }

  let env: { returnCode?: number; errorMessage?: string; data?: string };
  try {
    env = JSON.parse(text);
  } catch {
    return { ok: false, reason: "unavailable", detalhe: "corpo_nao_json", httpStatus: resp.status };
  }
  if (env.returnCode !== 0) {
    return {
      ok: false,
      reason: "unavailable",
      detalhe: "return_code",
      returnCode: typeof env.returnCode === "number" ? env.returnCode : undefined,
      httpStatus: resp.status,
      painelMsg: typeof env.errorMessage === "string" ? env.errorMessage : undefined,
    };
  }

  let data: unknown = null;
  if (env.data) {
    try {
      data = JSON.parse(await unitvDecrypt(env.data));
    } catch {
      return { ok: false, reason: "unavailable", detalhe: "data_indecifravel", httpStatus: resp.status };
    }
  }
  return { ok: true, data };
}

export type ResolucaoContaUnitv =
  | { ok: true; id: number; sn: string; expireTimeRaw: string | null; customer: string | null; packageName: string | null }
  | { ok: false; reason: "sn_invalido" | "credenciais_ausentes" | "nao_encontrado" | "ambiguo" | "customer_inesperado" }
  // "unavailable" carrega detalhe opcional SO' pra observabilidade
  // (Fase 1 autocura). Nenhum consumidor ramifica por esses campos.
  | {
    ok: false;
    reason: "unavailable";
    detalhe?: "excecao" | "corpo_ilegivel" | "corpo_nao_json" | "return_code" | "data_indecifravel";
    returnCode?: number;
    httpStatus?: number;
    painelMsg?: string;
  };

// Resolve a conta UniTV pelo `sn`. NUNCA escolhe por posicao: exige
// exatamente 1 correspondencia EXATA de `sn` na lista.
export async function resolverContaUnitv(
  sn: string,
  opts: { fetchImpl?: typeof fetch; dealerToken?: string; dealerName?: string } = {},
): Promise<ResolucaoContaUnitv> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const dealerToken = opts.dealerToken ?? Deno.env.get("UNITV_DEALER_TOKEN");
  const dealerName = opts.dealerName ?? Deno.env.get("UNITV_DEALER_NAME");

  if (typeof sn !== "string" || sn.trim() === "") return { ok: false, reason: "sn_invalido" };
  if (!dealerToken || !dealerName) return { ok: false, reason: "credenciais_ausentes" };

  const r = await callUnitvApi("/api/account", {
    package_id: UNITV_PACKAGE_ID,
    dealer_token: dealerToken,
    dealer_name: dealerName,
    time_zone: "America/Sao_Paulo",
    page: 1,
    pageSize: 10,
    keyword: sn,
  }, fetchImpl);
  if (!r.ok) {
    return {
      ok: false,
      reason: "unavailable",
      detalhe: r.detalhe,
      returnCode: r.returnCode,
      httpStatus: r.httpStatus,
      painelMsg: r.painelMsg,
    };
  }

  const lista = Array.isArray((r.data as { list?: unknown[] })?.list) ? (r.data as { list: Record<string, unknown>[] }).list : [];
  const exatos = lista.filter((a) => a && a.sn === sn);
  if (exatos.length === 0) return { ok: false, reason: "nao_encontrado" };
  if (exatos.length > 1) return { ok: false, reason: "ambiguo" };

  const conta = exatos[0];
  if (conta.customer != null && conta.customer !== "UniTV") {
    return { ok: false, reason: "customer_inesperado" };
  }
  return {
    ok: true,
    id: Number(conta.id),
    sn: String(conta.sn),
    expireTimeRaw: typeof conta.expireTime === "string" ? conta.expireTime : null,
    customer: typeof conta.customer === "string" ? conta.customer : null,
    packageName: typeof conta.package_name === "string" ? conta.package_name : null,
  };
}
