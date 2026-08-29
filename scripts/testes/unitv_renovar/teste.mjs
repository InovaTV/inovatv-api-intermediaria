// Teste local de scripts/lib/unitv-renovar.mjs (Etapa 2 -- Renovacao
// Automatica UniTV, 2026-08-28). Funcoes puras + executor com `fetch`
// injetado (fake) -- ZERO rede real, nenhuma chamada ao painel de
// revenda, nenhum credito consumido.
//
// Ancoras empiricas (do trafego real capturado / da POC):
//   - sign MD5 de (id=3433363, points_type=1, points=1)
//     == "85c37de7e1e653df55e12330aebb1be4"  (byte a byte com o real)
//   - AES-CBC key/IV fixos do painel -> o fake fetch monta os envelopes
//     com o MESMO unitvEncrypt, entao o round-trip cifra/decifra tambem
//     e' exercitado de ponta a ponta aqui.
//
// Como rodar: npx tsx scripts/testes/unitv_renovar/teste.mjs

import crypto from "node:crypto";
import {
  unitvSign,
  unitvEncrypt,
  unitvDecrypt,
  spDateToIso,
  resolverContaUnitv,
  renovarUmAcessoUniTV,
  UNITV_PRE_AUTH_ID,
} from "../../lib/unitv-renovar.mjs";

let falhas = 0;
function ok(cond, msg) {
  if (!cond) {
    falhas++;
    console.error(`FALHA: ${msg}`);
  } else {
    console.log(`ok: ${msg}`);
  }
}

const CREDS = { dealerToken: "fake-dealer-token", dealerName: "inovatvstream2" };
const noSleep = async () => {};

// Monta uma resposta no formato do painel: envelope texto puro, `data`
// cifrado com a MESMA AES do modulo.
function envelope(payloadObj, { returnCode = 0, errorMessage = "", jumpCode = 0 } = {}) {
  const body = { returnCode, errorMessage, jumpCode };
  if (payloadObj !== undefined) body.data = unitvEncrypt(JSON.stringify(payloadObj));
  return { status: 200, async text() { return JSON.stringify(body); } };
}

// fake fetch: roteia por pathname, decifra o body enviado e passa o
// objeto ja' decifrado + o contador de chamadas por rota ao handler.
function makeFakeFetch(handlers) {
  const contadores = {};
  const calls = [];
  const fn = async (url, init) => {
    const path = new URL(url).pathname;
    contadores[path] = (contadores[path] || 0) + 1;
    let reqObj = null;
    try { reqObj = JSON.parse(unitvDecrypt(init.body)); } catch { /* deixa null */ }
    calls.push({ path, reqObj, n: contadores[path] });
    const h = handlers[path];
    if (!h) throw new Error(`fake fetch: rota nao mapeada ${path}`);
    return h(reqObj, contadores[path]);
  };
  fn.calls = calls;
  fn.contadores = contadores;
  return fn;
}

const contaGcnv6v = (expireTime) => ({
  id: 3433363, sn: "gcnv6v", customer: "UniTV", package_name: "Plano Basico",
  expireTime, activeTime: "2025-05-23 22:48:27", days: 67, status: 1, jhStatus: 2,
});

// =====================================================================
// 1. unitvSign -- vetor real + consistencia MD5
// =====================================================================
ok(
  unitvSign(3433363, 1, 1) === "85c37de7e1e653df55e12330aebb1be4",
  "sign MD5 do payload real (id=3433363,pt=1,p=1) bate byte a byte com o capturado",
);
ok(
  unitvSign(999, 1, 1) === crypto.createHash("md5").update("dealer99911").digest("hex"),
  "sign == MD5('dealer'+id+points_type+points) para outra entrada",
);
ok(unitvSign(1, 1, 1).length === 32 && /^[0-9a-f]+$/.test(unitvSign(1, 1, 1)), "sign e' hex minusculo de 32 chars (MD5, nunca SHA1)");

// =====================================================================
// 2. unitvEncrypt / unitvDecrypt -- KAT + round-trip + formato
// =====================================================================
const KAT = "CA79846683DC81CD2229B88734CEC434C9FFB265C94A2E8173432035059FCA0F";
ok(unitvEncrypt('{"test":"inovatv-etapa2"}') === KAT, "unitvEncrypt e' deterministico e bate com o vetor congelado (KAT)");
ok(unitvDecrypt(KAT) === '{"test":"inovatv-etapa2"}', "unitvDecrypt(KAT) devolve o plaintext original");
for (const s of ['{"a":1}', '{"acao":"renovação","srv":"América/São_Paulo"}', "x".repeat(400)]) {
  ok(unitvDecrypt(unitvEncrypt(s)) === s, `round-trip preserva "${s.slice(0, 30)}${s.length > 30 ? "…" : ""}"`);
}
const enc = unitvEncrypt('{"k":"v"}');
ok(/^[0-9A-F]+$/.test(enc), "saida do unitvEncrypt e' HEX MAIUSCULO");
ok(enc.length % 32 === 0, "saida do unitvEncrypt tem tamanho multiplo de 16 bytes (bloco AES)");
ok(unitvDecrypt(KAT.toLowerCase()) === '{"test":"inovatv-etapa2"}', "unitvDecrypt aceita hex minusculo tambem");

// =====================================================================
// 3. spDateToIso -- horario de Sao Paulo -> ISO -03:00, null-safe
// =====================================================================
ok(spDateToIso("2026-11-03 02:31:01") === "2026-11-03T02:31:01-03:00", "converte 'YYYY-MM-DD HH:MM:SS' para ISO -03:00");
ok(spDateToIso("2026-11-03T02:31:01") === "2026-11-03T02:31:01-03:00", "aceita separador 'T' tambem");
for (const bad of [null, undefined, "", "   ", "03/11/2026", "2026-11-03", "2026-13-40 99:99:99x", 12345]) {
  ok(spDateToIso(bad) === null, `spDateToIso(${JSON.stringify(bad)}) -> null (nunca inventa data)`);
}

// =====================================================================
// 4. resolverContaUnitv
// =====================================================================
{
  const f = makeFakeFetch({
    "/api/account": (req) => {
      ok(req.keyword === "gcnv6v", "resolverContaUnitv envia keyword = sn");
      ok(req.dealer_token === CREDS.dealerToken && req.dealer_name === CREDS.dealerName, "resolverContaUnitv envia dealer_token/name no corpo");
      ok(req.time_zone === "America/Sao_Paulo", "resolverContaUnitv envia time_zone America/Sao_Paulo");
      return envelope({ total: 1, total_page: 1, list: [contaGcnv6v("2026-11-03 02:31:01")] });
    },
  });
  const r = await resolverContaUnitv("gcnv6v", { fetchImpl: f, ...CREDS });
  ok(r.ok === true && r.id === 3433363 && r.sn === "gcnv6v", "match exato -> {ok, id, sn}");
  ok(r.expireTimeRaw === "2026-11-03 02:31:01" && r.expireTimeIso === "2026-11-03T02:31:01-03:00", "resolverContaUnitv devolve expireTime cru e ISO");
}
{
  // lista tem outra conta, nenhum sn exato -> nao_encontrado
  const f = makeFakeFetch({ "/api/account": () => envelope({ total: 1, list: [contaGcnv6v("2026-11-03 02:31:01")].map((c) => ({ ...c, sn: "outro9" })) }) });
  const r = await resolverContaUnitv("gcnv6v", { fetchImpl: f, ...CREDS });
  ok(r.ok === false && r.reason === "nao_encontrado", "sem sn exato na lista -> {ok:false, nao_encontrado}");
}
{
  const f = makeFakeFetch({ "/api/account": () => envelope({ total: 0, list: [] }) });
  const r = await resolverContaUnitv("gcnv6v", { fetchImpl: f, ...CREDS });
  ok(r.ok === false && r.reason === "nao_encontrado", "lista vazia -> nao_encontrado");
}
{
  const f = makeFakeFetch({ "/api/account": () => envelope(undefined, { returnCode: -1, errorMessage: "sessao invalida" }) });
  const r = await resolverContaUnitv("gcnv6v", { fetchImpl: f, ...CREDS });
  ok(r.ok === false && r.reason === "erro_api" && r.returnCode === -1, "returnCode != 0 -> {ok:false, erro_api}");
}
{
  const f = makeFakeFetch({ "/api/account": () => envelope({ total: 1, list: [{ ...contaGcnv6v("2026-11-03 02:31:01"), customer: "OutroProduto" }] }) });
  const r = await resolverContaUnitv("gcnv6v", { fetchImpl: f, ...CREDS });
  ok(r.ok === false && r.reason === "customer_inesperado", "customer != 'UniTV' -> customer_inesperado");
}
{
  const r1 = await resolverContaUnitv("gcnv6v", { fetchImpl: makeFakeFetch({}), dealerName: "x" });
  ok(r1.ok === false && r1.reason === "credenciais_ausentes", "sem dealerToken -> credenciais_ausentes");
  const r2 = await resolverContaUnitv("", { fetchImpl: makeFakeFetch({}), ...CREDS });
  ok(r2.ok === false && r2.reason === "sn_invalido", "sn vazio -> sn_invalido");
}

// =====================================================================
// 5. renovarUmAcessoUniTV
// =====================================================================

// 5a. Caminho feliz: baseline -> renew rc0 -> reconsulta com expireTime avancado
{
  let etapa = 0;
  const f = makeFakeFetch({
    "/api/account": () => {
      etapa++;
      return envelope({ total: 1, list: [contaGcnv6v(etapa === 1 ? "2026-11-03 02:31:01" : "2026-12-03 02:31:01")] });
    },
    "/api/account/renew": (req) => {
      ok(req.pre_auth_id === UNITV_PRE_AUTH_ID && req.package_id === 1 && req.points_type === 1 && req.points === 1 && req.auth_cycle === 1, "renew envia os parametros mensais fixos (pre_auth_id=123, etc.)");
      ok(req.sn === "gcnv6v" && req.id === 3433363, "renew envia sn+id resolvidos");
      ok(req.sign === unitvSign(3433363, 1, 1), "renew envia o sign MD5 correto para o id");
      return envelope({ uuid: "abcd-1234" }, { jumpCode: 1, errorMessage: "entrara em vigor em 5 minutos" });
    },
  });
  const r = await renovarUmAcessoUniTV({ sn: "gcnv6v", id: 3433363, fetchImpl: f, ...CREDS, sleep: noSleep });
  ok(r.resultado === "sucesso", "caminho feliz -> resultado 'sucesso'");
  ok(r.vencimentoConfirmado === "2026-12-03T02:31:01-03:00", "sucesso devolve vencimentoConfirmado ISO da reconsulta");
  ok(f.contadores["/api/account/renew"] === 1, "o /renew e' chamado exatamente 1 vez (nunca retry)");
}

// 5b. Painel recusa o renew (rc != 0, ex.: sem credito) -> falha determinada
{
  const f = makeFakeFetch({
    "/api/account": () => envelope({ total: 1, list: [contaGcnv6v("2026-11-03 02:31:01")] }),
    "/api/account/renew": () => envelope(undefined, { returnCode: 1001, errorMessage: "creditos insuficientes" }),
  });
  const r = await renovarUmAcessoUniTV({ sn: "gcnv6v", id: 3433363, fetchImpl: f, ...CREDS, sleep: noSleep });
  ok(r.resultado === "falha" && /rc=1001/.test(r.detalhe) && /creditos insuficientes/.test(r.detalhe), "renew rc!=0 -> falha com rc e errorMessage no detalhe");
}

// 5c. renew rc0 mas expireTime NAO avanca em nenhuma reconsulta -> falha
{
  const f = makeFakeFetch({
    "/api/account": () => envelope({ total: 1, list: [contaGcnv6v("2026-11-03 02:31:01")] }),
    "/api/account/renew": () => envelope({ uuid: "x" }, { jumpCode: 1 }),
  });
  const r = await renovarUmAcessoUniTV({ sn: "gcnv6v", id: 3433363, fetchImpl: f, ...CREDS, sleep: noSleep });
  ok(r.resultado === "falha" && /nao avancou/.test(r.detalhe), "expireTime igual antes/depois -> falha 'nao avancou'");
  ok(f.contadores["/api/account"] === 1 + 3, "reconsulta tenta 3x antes de desistir");
}

// 5d. Baseline nao resolve -> ambiguo, renew NUNCA e' chamado
{
  const f = makeFakeFetch({
    "/api/account": () => envelope({ total: 0, list: [] }),
    "/api/account/renew": () => { throw new Error("renew nao deveria ser chamado"); },
  });
  const r = await renovarUmAcessoUniTV({ sn: "gcnv6v", id: 3433363, fetchImpl: f, ...CREDS, sleep: noSleep });
  ok(r.resultado === "resultado_ambiguo" && /antes da renovacao/.test(r.detalhe), "baseline falha -> resultado_ambiguo (renew nao chamado)");
  ok(!f.contadores["/api/account/renew"], "renew realmente nao foi chamado quando o baseline falha");
}

// 5e. id do token diverge do id que o painel devolve pelo sn -> ambiguo, sem renew
{
  const f = makeFakeFetch({
    "/api/account": () => envelope({ total: 1, list: [contaGcnv6v("2026-11-03 02:31:01")] }), // painel diz id 3433363
    "/api/account/renew": () => { throw new Error("renew nao deveria ser chamado"); },
  });
  const r = await renovarUmAcessoUniTV({ sn: "gcnv6v", id: 9999999, fetchImpl: f, ...CREDS, sleep: noSleep });
  ok(r.resultado === "resultado_ambiguo" && /divergente/.test(r.detalhe), "id token != id painel -> resultado_ambiguo");
  ok(!f.contadores["/api/account/renew"], "renew nao chamado quando o id diverge");
}

// 5f. renew rc0 mas a reconsulta sempre falha -> ambiguo (nao afirma nada)
{
  let etapa = 0;
  const f = makeFakeFetch({
    "/api/account": () => {
      etapa++;
      if (etapa === 1) return envelope({ total: 1, list: [contaGcnv6v("2026-11-03 02:31:01")] });
      return envelope(undefined, { returnCode: -1, errorMessage: "sessao caiu" });
    },
    "/api/account/renew": () => envelope({ uuid: "x" }, { jumpCode: 1 }),
  });
  const r = await renovarUmAcessoUniTV({ sn: "gcnv6v", id: 3433363, fetchImpl: f, ...CREDS, sleep: noSleep });
  ok(r.resultado === "resultado_ambiguo" && /reconsultar a conta depois/.test(r.detalhe), "reconsulta sempre falha apos renew -> resultado_ambiguo");
}

// 5h. /renew cai no transporte (nao rc!=0) MAS o expireTime avancou na
//     reconsulta -> a renovacao landou -> sucesso
{
  let etapa = 0;
  const f = makeFakeFetch({
    "/api/account": () => {
      etapa++;
      return envelope({ total: 1, list: [contaGcnv6v(etapa === 1 ? "2026-11-03 02:31:01" : "2026-12-03 02:31:01")] });
    },
    "/api/account/renew": () => { throw new Error("ECONNRESET"); },
  });
  const r = await renovarUmAcessoUniTV({ sn: "gcnv6v", id: 3433363, fetchImpl: f, ...CREDS, sleep: noSleep });
  ok(r.resultado === "sucesso" && r.vencimentoConfirmado === "2026-12-03T02:31:01-03:00", "/renew cai no transporte mas expireTime avancou -> sucesso (a reconsulta manda)");
}

// 5i. /renew cai no transporte E o expireTime NAO mudou -> ambiguo
//     (nunca 'falha' -- nao da' pra afirmar que foi recusado)
{
  const f = makeFakeFetch({
    "/api/account": () => envelope({ total: 1, list: [contaGcnv6v("2026-11-03 02:31:01")] }),
    "/api/account/renew": () => { throw new Error("ECONNRESET"); },
  });
  const r = await renovarUmAcessoUniTV({ sn: "gcnv6v", id: 3433363, fetchImpl: f, ...CREDS, sleep: noSleep });
  ok(r.resultado === "resultado_ambiguo" && /transporte/.test(r.detalhe), "/renew cai no transporte + expireTime igual -> resultado_ambiguo (nao 'falha')");
}

// 5g. credenciais ausentes -> ambiguo antes de qualquer chamada
{
  const r = await renovarUmAcessoUniTV({ sn: "gcnv6v", id: 3433363, fetchImpl: makeFakeFetch({}), dealerName: "x", sleep: noSleep });
  ok(r.resultado === "resultado_ambiguo" && /credenciais UniTV ausentes/.test(r.detalhe), "sem UNITV_DEALER_TOKEN -> resultado_ambiguo");
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
