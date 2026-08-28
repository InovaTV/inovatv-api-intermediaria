// Testes locais de _shared/openpix_client.ts -> criarCobrancaOpenPix
// (arquivo REAL, importado sem alteracao). So' Deno.env e o fetch
// global sao interceptados aqui -- nenhuma chamada de rede real,
// nenhuma cobranca criada.
//
// Alvo: UX de renovacao 2026-08-28 -- a funcao passa a capturar
// `paymentLinkUrl` (pagina hospedada da Woovi) da resposta do
// POST /charge, alem de `transactionID` e `brCode`. Sem paymentLinkUrl
// -> outcome "unavailable" (nunca fallback pro BR Code). O brCode
// continua sendo capturado (guardado em cobrancas_pix, so' nao vai
// mais ao WhatsApp).
//
// Como rodar: npx tsx scripts/testes/openpix_paymentlink/teste.mjs

process.env.OPENPIX_APPID = "appid-de-teste-nao-real";

globalThis.Deno = { env: { get: (k) => process.env[k] } };

let falhas = 0;
let total = 0;
function ok(cond, msg) {
  total++;
  if (cond) console.log("ok:", msg);
  else {
    falhas++;
    console.error("FALHA:", msg);
  }
}

// fetch mock configuravel por cenario
let respostaFetch;
let chamadasFetch = [];
globalThis.fetch = async (url, init) => {
  chamadasFetch.push({ url: String(url), method: init?.method ?? "GET" });
  return respostaFetch();
};
function jsonResp(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const { criarCobrancaOpenPix } = await import(
  "../../../supabase/functions/_shared/openpix_client.ts"
);

const OP_ID = "op-teste-1";
const BRCODE = "00020101021226980014br.gov.bcb.pix2576api.woovi-sandbox.com/api/testaccount/qr/v1/aaa520400005303986540535.005802BR5917JS INFORMATICA RP6009Sao Paulo62290525aaa6304ABCD";
const LINK = "https://woovi-sandbox.com/pay/op-teste-1";

// --- Cenario 1: paymentLinkUrl dentro de charge -> capturado ---
{
  chamadasFetch = [];
  respostaFetch = () =>
    jsonResp({ charge: { transactionID: "tx1", brCode: BRCODE, paymentLinkUrl: LINK } });
  const r = await criarCobrancaOpenPix(OP_ID, 3500, "Renovacao InovaTV - Plano Mensal");
  ok(r.outcome === "success", "C1: outcome success quando charge.paymentLinkUrl presente");
  ok(r.paymentLinkUrl === LINK, "C1: paymentLinkUrl capturado de charge.paymentLinkUrl");
  ok(r.qrCodeTexto === BRCODE, "C1: brCode continua sendo capturado (guardado em cobrancas_pix)");
  ok(r.transactionId === "tx1", "C1: transactionID capturado");
  ok(
    chamadasFetch.length === 1 &&
      chamadasFetch[0].method === "POST" &&
      chamadasFetch[0].url.endsWith("/api/v1/charge"),
    "C1: um unico POST /api/v1/charge",
  );
}

// --- Cenario 2: paymentLinkUrl so' na raiz (data.paymentLinkUrl) -> fallback ---
{
  respostaFetch = () =>
    jsonResp({ charge: { transactionID: "tx2", brCode: BRCODE }, paymentLinkUrl: LINK });
  const r = await criarCobrancaOpenPix(OP_ID, 3500, "x");
  ok(r.outcome === "success", "C2: outcome success com paymentLinkUrl so' na raiz");
  ok(r.paymentLinkUrl === LINK, "C2: paymentLinkUrl capturado do fallback data.paymentLinkUrl");
}

// --- Cenario 3: SEM paymentLinkUrl -> unavailable (nunca fallback pro BR Code) ---
{
  respostaFetch = () => jsonResp({ charge: { transactionID: "tx3", brCode: BRCODE } });
  const r = await criarCobrancaOpenPix(OP_ID, 3500, "x");
  ok(r.outcome === "unavailable", "C3: sem paymentLinkUrl -> unavailable");
  ok(!("paymentLinkUrl" in r), "C3: unavailable nao carrega paymentLinkUrl");
  ok(!("qrCodeTexto" in r), "C3: unavailable nao carrega BR Code (nunca cai de volta pro codigo)");
}

// --- Cenario 4: SEM brCode -> unavailable (guard existente preservado) ---
{
  respostaFetch = () => jsonResp({ charge: { transactionID: "tx4", paymentLinkUrl: LINK } });
  const r = await criarCobrancaOpenPix(OP_ID, 3500, "x");
  ok(r.outcome === "unavailable", "C4: sem brCode -> unavailable (guard antigo intacto)");
}

// --- Cenario 5: HTTP != 2xx -> unavailable ---
{
  respostaFetch = () => jsonResp({ error: "boom" }, 400);
  const r = await criarCobrancaOpenPix(OP_ID, 3500, "x");
  ok(r.outcome === "unavailable", "C5: HTTP 400 -> unavailable");
}

// --- Cenario 6: OPENPIX_APPID ausente -> unavailable ANTES do fetch ---
{
  const salvo = process.env.OPENPIX_APPID;
  delete process.env.OPENPIX_APPID;
  chamadasFetch = [];
  respostaFetch = () => jsonResp({ charge: { transactionID: "tx", brCode: BRCODE, paymentLinkUrl: LINK } });
  const r = await criarCobrancaOpenPix(OP_ID, 3500, "x");
  ok(r.outcome === "unavailable" && chamadasFetch.length === 0, "C6: sem OPENPIX_APPID -> unavailable, sem tocar a rede");
  process.env.OPENPIX_APPID = salvo;
}

// --- Cenario 7: correlationID enviado no corpo continua sendo o operacaoId ---
{
  chamadasFetch = [];
  let corpoEnviado = null;
  globalThis.fetch = async (url, init) => {
    corpoEnviado = JSON.parse(init.body);
    return jsonResp({ charge: { transactionID: "tx7", brCode: BRCODE, paymentLinkUrl: LINK } });
  };
  await criarCobrancaOpenPix("op-especifico-7", 3500, "desc");
  ok(corpoEnviado?.correlationID === "op-especifico-7", "C7: correlationID no corpo = operacaoId (inalterado)");
  ok(corpoEnviado?.value === 3500, "C7: value em centavos inalterado");
}

console.log(`\nResultado: ${total - falhas}/${total} passando`);
process.exit(falhas === 0 ? 0 : 1);
