// Testes locais de supabase/functions/_shared/unitv_conta.ts (REAL) --
// Etapa 2 (Renovacao UniTV, Bloco 3). Gemeo Deno do resolvedor de
// conta; NUNCA chama /renew.
//
// CROSS-CHECK obrigatorio: `unitvSign` / `unitvEncrypt` / `unitvDecrypt`
// deste modulo produzem output IDENTICO ao de scripts/lib/unitv-renovar.mjs
// (impl de referencia congelada, Node/runner) -- provando que a impl
// WebCrypto (Deno) e a impl node:crypto (Node) concordam byte a byte no
// mesmo protocolo do painel.
//
// Como rodar: npx tsx scripts/testes/unitv_conta/teste.mjs

globalThis.Deno = { env: { get: (k) => (k === "UNITV_DEALER_TOKEN" ? "fake-token" : k === "UNITV_DEALER_NAME" ? "inovatvstream2" : undefined) } };

const conta = await import("../../../supabase/functions/_shared/unitv_conta.ts");
const lib = await import("../../lib/unitv-renovar.mjs");

let falhas = 0;
function ok(cond, msg) {
  if (!cond) { falhas++; console.error(`FALHA: ${msg}`); }
  else console.log(`ok: ${msg}`);
}

const CREDS = { dealerToken: "fake-token", dealerName: "inovatvstream2" };

// =====================================================================
// 1. CROSS-CHECK: conta.ts (WebCrypto/Deno) == unitv-renovar.mjs (node:crypto)
// =====================================================================
ok(
  conta.unitvSign(3433363, 1, 1) === "85c37de7e1e653df55e12330aebb1be4",
  "unitvSign: vetor real (id=3433363) bate byte a byte",
);
for (const [id, pt, p] of [[3433363, 1, 1], [1, 1, 1], [9999999, 2, 3], [42, 1, 5]]) {
  ok(conta.unitvSign(id, pt, p) === lib.unitvSign(id, pt, p), `unitvSign(${id},${pt},${p}): conta.ts == unitv-renovar.mjs`);
}

const KAT = "CA79846683DC81CD2229B88734CEC434C9FFB265C94A2E8173432035059FCA0F";
for (const s of ['{"test":"inovatv-etapa2"}', '{"a":1}', '{"acao":"renovação","srv":"América/São_Paulo"}', "y".repeat(300)]) {
  const encConta = await conta.unitvEncrypt(s);
  ok(encConta === lib.unitvEncrypt(s), `unitvEncrypt("${s.slice(0, 24)}${s.length > 24 ? "…" : ""}"): conta.ts == unitv-renovar.mjs`);
  ok(await conta.unitvDecrypt(encConta) === s, "unitvDecrypt(round-trip) preserva o plaintext");
}
ok(await conta.unitvEncrypt('{"test":"inovatv-etapa2"}') === KAT, "unitvEncrypt bate com o KAT congelado");
ok(await conta.unitvDecrypt(KAT) === '{"test":"inovatv-etapa2"}', "unitvDecrypt(KAT congelado) == plaintext");
{
  const e = await conta.unitvEncrypt('{"k":"v"}');
  ok(/^[0-9A-F]+$/.test(e) && e.length % 32 === 0, "saida do unitvEncrypt e' HEX MAIUSCULO, multiplo de bloco");
}

// =====================================================================
// 2. resolverContaUnitv -- fake fetch monta envelopes com o proprio
//    unitvEncrypt (exercita cifra/decifra ponta a ponta)
// =====================================================================
async function envelope(payloadObj, { returnCode = 0 } = {}) {
  const body = { returnCode, errorMessage: "", jumpCode: 0 };
  if (payloadObj !== undefined) body.data = await conta.unitvEncrypt(JSON.stringify(payloadObj));
  return { status: 200, async text() { return JSON.stringify(body); } };
}
function fakeFetch(responder) {
  const calls = [];
  const fn = async (url, init) => {
    let reqObj = null;
    try { reqObj = JSON.parse(await conta.unitvDecrypt(init.body)); } catch { /* ok */ }
    calls.push({ url: String(url), reqObj });
    return responder(reqObj);
  };
  fn.calls = calls;
  return fn;
}
const contaGcnv6v = (expireTime) => ({ id: 3433363, sn: "gcnv6v", customer: "UniTV", package_name: "Plano Basico", expireTime });

{
  const f = fakeFetch(() => envelope({ total: 1, list: [contaGcnv6v("2026-11-03 02:31:01")] }));
  const r = await conta.resolverContaUnitv("gcnv6v", { fetchImpl: f, ...CREDS });
  ok(r.ok === true && r.id === 3433363 && r.sn === "gcnv6v", "match exato -> {ok, id, sn}");
  ok(r.expireTimeRaw === "2026-11-03 02:31:01" && r.customer === "UniTV", "resolve devolve expireTimeRaw + customer");
  ok(f.calls[0].reqObj.keyword === "gcnv6v" && f.calls[0].reqObj.dealer_token === "fake-token", "envia keyword=sn + dealer_token no corpo");
}
{
  const f = fakeFetch(() => envelope({ total: 1, list: [{ ...contaGcnv6v("x"), sn: "outro9" }] }));
  const r = await conta.resolverContaUnitv("gcnv6v", { fetchImpl: f, ...CREDS });
  ok(r.ok === false && r.reason === "nao_encontrado", "sem sn exato na lista -> nao_encontrado");
}
{
  const f = fakeFetch(() => envelope({ total: 0, list: [] }));
  ok((await conta.resolverContaUnitv("gcnv6v", { fetchImpl: f, ...CREDS })).reason === "nao_encontrado", "lista vazia -> nao_encontrado");
}
{
  const f = fakeFetch(() => envelope({ total: 2, list: [contaGcnv6v("a"), contaGcnv6v("b")] }));
  ok((await conta.resolverContaUnitv("gcnv6v", { fetchImpl: f, ...CREDS })).reason === "ambiguo", "2 sn exatos -> ambiguo");
}
{
  const f = fakeFetch(() => envelope({ total: 1, list: [{ ...contaGcnv6v("x"), customer: "OutroProduto" }] }));
  ok((await conta.resolverContaUnitv("gcnv6v", { fetchImpl: f, ...CREDS })).reason === "customer_inesperado", "customer != 'UniTV' -> customer_inesperado");
}
{
  const f = fakeFetch(() => envelope(undefined, { returnCode: -1 }));
  ok((await conta.resolverContaUnitv("gcnv6v", { fetchImpl: f, ...CREDS })).reason === "unavailable", "returnCode != 0 -> unavailable");
}
{
  const f = fakeFetch(() => { throw new Error("ECONNRESET"); });
  ok((await conta.resolverContaUnitv("gcnv6v", { fetchImpl: f, ...CREDS })).reason === "unavailable", "excecao de rede -> unavailable");
}
{
  ok((await conta.resolverContaUnitv("", { fetchImpl: fakeFetch(() => {}), ...CREDS })).reason === "sn_invalido", "sn vazio -> sn_invalido");
  ok((await conta.resolverContaUnitv("gcnv6v", { fetchImpl: fakeFetch(() => {}), dealerToken: "", dealerName: "x" })).reason === "credenciais_ausentes", "sem dealerToken -> credenciais_ausentes");
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
