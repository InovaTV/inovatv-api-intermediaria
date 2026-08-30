// F4 da autocura do UNITV_DEALER_TOKEN (2026-08-30) -- resolvedor
// READ-ONLY de /api/account, EXCLUSIVO da autocura.
//
// POR QUE NAO REUSA scripts/lib/unitv-renovar.mjs:
//   Invariante I3 / doc secao C.9 -- nenhuma peca da autocura importa o
//   executor de renovacao. As varreduras estaticas (autocura_*_nao_age)
//   quebram o CI se "unitv-renovar" aparecer em qualquer arquivo da
//   autocura. Este modulo e' uma copia MINIMA e SO'-LEITURA do
//   protocolo do painel: resolve o `id` interno a partir do `sn` para
//   comprovar que um dealer_token AUTENTICA. Nunca /api/account/renew,
//   nunca `sign`/payload de renovacao, nunca /pagamento/add/.
//
// A chave/IV do AES sao CONSTANTES DO PROTOCOLO DO PAINEL (publicas no
// bundle deles), nao segredo nosso -- mesmo texto que _shared/unitv_conta.ts.

import crypto from "node:crypto";

const AES_KEY = Buffer.from("93403d3aa2ec48b4", "utf8"); // 16 bytes -> AES-128
const AES_IV = Buffer.from("7cf0127d190cb909", "utf8"); // 16 bytes
export const PAINEL_API_BASE = "https://panel-web.revenda.site";
const PACKAGE_ID = 1;
const HTTP_TIMEOUT_MS = 15000;

function encrypt(plaintext) {
  const c = crypto.createCipheriv("aes-128-cbc", AES_KEY, AES_IV);
  return Buffer.concat([c.update(plaintext, "utf8"), c.final()]).toString("hex").toUpperCase();
}
function decrypt(hex) {
  const d = crypto.createDecipheriv("aes-128-cbc", AES_KEY, AES_IV);
  return Buffer.concat([d.update(Buffer.from(hex, "hex")), d.final()]).toString("utf8");
}

// Retorno normalizado:
//   { ok: true, id, sn }
//   { ok: false, reason, returnCode? }   reason in:
//     sn_invalido | credenciais_ausentes | nao_encontrado | ambiguo |
//     return_code | transporte | corpo_ilegivel
// `returnCode` so' vem quando reason === 'return_code' (util para
// classificar token_novo_invalido e para observar o codigo de um token
// morto).
export async function resolverContaReadonly(sn, { fetchImpl = fetch, dealerToken, dealerName } = {}) {
  if (typeof sn !== "string" || sn.trim() === "") return { ok: false, reason: "sn_invalido" };
  if (!dealerToken || !dealerName) return { ok: false, reason: "credenciais_ausentes" };

  let resp;
  try {
    resp = await fetchImpl(`${PAINEL_API_BASE}/api/account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: encrypt(JSON.stringify({
        package_id: PACKAGE_ID,
        dealer_token: dealerToken,
        dealer_name: dealerName,
        time_zone: "America/Sao_Paulo",
        page: 1,
        pageSize: 10,
        keyword: sn,
      })),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "transporte" };
  }

  let text;
  try { text = await resp.text(); } catch { return { ok: false, reason: "corpo_ilegivel" }; }

  let env;
  try { env = JSON.parse(text); } catch { return { ok: false, reason: "corpo_ilegivel" }; }

  if (env.returnCode !== 0) {
    return {
      ok: false,
      reason: "return_code",
      returnCode: typeof env.returnCode === "number" ? env.returnCode : null,
    };
  }

  let data = null;
  if (env.data) {
    try { data = JSON.parse(decrypt(env.data)); } catch { return { ok: false, reason: "corpo_ilegivel" }; }
  }
  const lista = Array.isArray(data?.list) ? data.list : [];
  const exatos = lista.filter((a) => a && a.sn === sn);
  if (exatos.length === 0) return { ok: false, reason: "nao_encontrado" };
  if (exatos.length > 1) return { ok: false, reason: "ambiguo" };
  return { ok: true, id: Number(exatos[0].id), sn: String(exatos[0].sn) };
}
