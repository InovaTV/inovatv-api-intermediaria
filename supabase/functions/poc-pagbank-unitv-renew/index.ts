// PoC ISOLADA E TEMPORARIA -- fluxo PagBank (webhook real) -> renovacao
// real do UniTV (gcnv6v). NAO e a arquitetura definitiva da integracao
// de pagamentos nem de identidade/sincronizacao -- ver
// docs/pagamentos/PAGBANK_IDEMPOTENCIA_E_RETRY.md e
// docs/unitv/UNITV_RENOVACAO_TESTE_REAL.md (inovatv-api-intermediaria)
// para o que ja foi comprovado e para o que fica para uma fase futura
// de verdade (confirmacao server-to-server com o PagBank, idempotencia
// na criacao da cobranca, etc -- nada disso esta aqui de proposito).
//
// Decisao explicita do usuario para esta PoC (nao vale para o futuro):
// - confia no `status` do corpo do webhook recebido, sem reconsultar o
//   PagBank (aceitavel so por ser Sandbox e um teste unico e vigiado);
// - guarda minima de idempotencia via tabela `poc_processed_charges`
//   (SQL para criar essa tabela: ver README desta pasta), para que uma
//   reentrega do mesmo webhook (comportamento real e esperado do
//   PagBank, ja comprovado) nunca renove a conta mais de uma vez;
// - so reage a exatamente UMA cobranca (reference_id fixo abaixo) --
//   qualquer outra requisicao que chegue nesse endpoint e ignorada,
//   sem tocar em nenhuma outra conta.
//
// Depois do teste: esta function deve ser REMOVIDA (mesmo padrao ja
// usado neste repositorio para a function temporaria `debug-fields`),
// nao e para ficar deployada permanentemente.

import { createHash } from "node:crypto";

// --- Escopo travado desta PoC (aceita qualquer reference_id que comece com este prefixo) ---
const POC_REFERENCE_ID_PREFIX = "TESTE-INOVATV-POC-PAGBANK-";

const UNITV_SN = "gcnv6v";
const UNITV_ID = 3433363;
const UNITV_PACKAGE_ID = 1;
const UNITV_POINTS_TYPE = 1; // Creditos Mensal
const UNITV_AUTH_CYCLE = 1; // 1 mes
const UNITV_POINTS = 1;
const UNITV_PRE_AUTH_ID = 123; // confirmado no teste real anterior, para esta combinacao exata

// --- Criptografia do painel UniTV (ResellerSystem) -- confirmada empiricamente ---
// Ver UNITV_RENOVACAO_INVESTIGACAO.md, secao 2. Chave/IV fixos no
// bundle do painel -- nao sao segredo nosso, sao do protocolo deles.
const UNITV_AES_KEY = "93403d3aa2ec48b4";
const UNITV_AES_IV = "7cf0127d190cb909";

// Trocado de node:crypto (createCipheriv) para Web Crypto (SubtleCrypto)
// -- ver investigacao da causa do 500 anterior no README desta pasta.
// SubtleCrypto e API padrao do runtime (globalThis.crypto), sem
// depender de Buffer nem de nenhum modulo Node importado. AES-CBC do
// WebCrypto ja aplica PKCS7 por padrao -- mesmo padding do CryptoJS
// usado pelo painel UniTV, nada mudou no resultado esperado.
async function unitvEncrypt(plaintextJson: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(UNITV_AES_KEY),
    { name: "AES-CBC" },
    false,
    ["encrypt"],
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv: enc.encode(UNITV_AES_IV) },
    cryptoKey,
    enc.encode(plaintextJson),
  );
  let hex = "";
  for (const b of new Uint8Array(ciphertext)) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex.toUpperCase();
}

function unitvSign(id: number, pointsType: number, points: number): string {
  return createHash("md5")
    .update(`dealer${id}${pointsType}${points}`)
    .digest("hex");
}

async function alreadyProcessed(chargeId: string): Promise<boolean> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    // DIAGNOSTICO TEMPORARIO -- remover depois de achar a causa raiz do
    // INSERT falhando. Nunca loga a service key, so se ela existe.
    console.log("[diag-insert]", JSON.stringify({
      skipped: true,
      reason: "missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      hasUrl: !!supabaseUrl,
      hasKey: !!serviceKey,
    }));
    // Sem guarda disponivel -- por seguranca, trata como "ja processado"
    // para NUNCA renovar sem a garantia de idempotencia.
    return true;
  }

  const insertResp = await fetch(`${supabaseUrl}/rest/v1/poc_processed_charges`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceKey}`,
      "apikey": serviceKey,
      "Prefer": "return=minimal",
    },
    body: JSON.stringify({ charge_id: chargeId }),
  });

  // DIAGNOSTICO TEMPORARIO -- so status e corpo de erro do INSERT, nunca
  // a service key ou qualquer secret. Remover depois de achar a causa.
  let insertBody = "";
  try {
    insertBody = await insertResp.text();
  } catch {
    insertBody = "<failed to read response body>";
  }
  console.log("[diag-insert]", JSON.stringify({
    status: insertResp.status,
    statusText: insertResp.statusText,
    body: insertBody.slice(0, 500),
  }));

  // Insert bem-sucedido (201) = primeira vez vendo esse charge_id.
  // Conflito de chave unica (409) = ja processado antes -> duplicata.
  if (insertResp.status === 201) return false;
  return true;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ignored: true, reason: "method" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ignored: true, reason: "invalid json" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // DIAGNOSTICO TEMPORARIO -- remover depois de investigar a causa do
  // "not paid yet" inesperado. So campos nao sensiveis (nunca customer,
  // telefone, cpf, email, dealer_token ou o payload completo). Nao muda
  // nenhuma condicao/logica abaixo.
  {
    const diagCharges = Array.isArray(body.charges)
      ? (body.charges as Array<Record<string, unknown>>)
      : [];
    console.log("[diag-webhook]", JSON.stringify({
      id: body.id,
      reference_id: body.reference_id,
      charges_length: diagCharges.length,
      charge_ids: diagCharges.map((c) => c?.id),
      charge_statuses: diagCharges.map((c) => c?.status),
      charge_paid_ats: diagCharges.map((c) => c?.paid_at),
    }));
  }

  if (typeof body.reference_id !== "string" || !body.reference_id.startsWith(POC_REFERENCE_ID_PREFIX)) {
    return new Response(JSON.stringify({ ignored: true, reason: "reference_id mismatch" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const charges = body.charges as Array<Record<string, unknown>> | undefined;
  const charge = charges?.[0];
  const chargeId = charge?.id as string | undefined;
  const chargeStatus = charge?.status as string | undefined;

  if (!chargeId || chargeStatus !== "PAID") {
    return new Response(JSON.stringify({ ignored: true, reason: "not paid yet" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const duplicate = await alreadyProcessed(chargeId);
  console.log("[diag-step] after-alreadyProcessed");
  if (duplicate) {
    return new Response(JSON.stringify({ duplicate: true, chargeId }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  console.log("[diag-step] before-token");
  const dealerToken = Deno.env.get("UNITV_DEALER_TOKEN");
  console.log("[diag-step] after-token", JSON.stringify({ exists: !!dealerToken }));
  console.log("[diag-step] before-name");
  const dealerName = Deno.env.get("UNITV_DEALER_NAME");
  console.log("[diag-step] after-name", JSON.stringify({ exists: !!dealerName }));
  if (!dealerToken || !dealerName) {
    return new Response(JSON.stringify({ error: "missing UniTV secrets" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  console.log("[diag-step] after-secrets-check");

  // DIAGNOSTICO TEMPORARIO -- localizar o ponto exato do crash (EDGE_FUNCTION_ERROR)
  // apos o INSERT ter tido sucesso. Nunca loga token, payload ou qualquer segredo.
  console.log("[diag-step] before-sign");
  console.log("[diag-unitv] antes-sign");
  let signValue: string;
  try {
    signValue = unitvSign(UNITV_ID, UNITV_POINTS_TYPE, UNITV_POINTS);
  } catch (err) {
    const e = err as { name?: string; message?: string };
    console.log("[diag-unitv-error] sign", JSON.stringify({ name: e?.name, message: e?.message }));
    throw err;
  }
  console.log("[diag-unitv] depois-sign");

  const payload = {
    package_id: UNITV_PACKAGE_ID,
    points_type: UNITV_POINTS_TYPE,
    auth_cycle: UNITV_AUTH_CYCLE,
    points: UNITV_POINTS,
    pre_auth_id: UNITV_PRE_AUTH_ID,
    sn: UNITV_SN,
    id: UNITV_ID,
    sign: signValue,
    dealer_token: dealerToken,
    dealer_name: dealerName,
  };

  console.log("[diag-unitv] antes-encrypt");
  let encryptedBody: string;
  try {
    encryptedBody = await unitvEncrypt(JSON.stringify(payload));
  } catch (err) {
    const e = err as { name?: string; message?: string };
    console.log("[diag-unitv-error] encrypt", JSON.stringify({ name: e?.name, message: e?.message }));
    throw err;
  }
  console.log("[diag-unitv] depois-encrypt");

  let unitvRawResponse: string;
  try {
    console.log("[diag-unitv] antes-fetch");
    const unitvResp = await fetch("https://panel-web.revenda.site/api/account/renew", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: encryptedBody,
    });
    console.log("[diag-unitv] depois-fetch");
    unitvRawResponse = await unitvResp.text();
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "unitv call failed", detail: String(err) }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ forwarded: true, chargeId, unitvRawResponse }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
