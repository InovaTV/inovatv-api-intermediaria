// Testes locais de supabase/functions/_shared/unitv_token_diag.ts (REAL)
// -- Fase 1 da autocura do UNITV_DEALER_TOKEN (2026-08-29).
//
// _shared/unitv_conta.ts (resolverContaUnitv + cripto) e
// _shared/mensagens_fixas.ts sao REAIS. supabase_client.ts e' stub
// (mock-loader). fetch / supa / enviarTemplate / relogio / sleep sao
// injetados via opts.
//
// Regras que estes testes travam:
//   1. Agregacao dos probes -> veredito (token_vivo / token_morto /
//      indeterminado_outage / indeterminado), incluindo a regra
//      ">=2 auth_reject com o MESMO returnCode".
//   2. Aviso ao Jose SO' em token_morto, com dedupe de 6h.
//   3. NENHUM vazamento: token, dealer_name, numero do Jose e SN ancora
//      nunca aparecem no log estruturado nem na linha gravada.
//   4. painel_msg higienizada (SN ancora / e-mail / telefone redigidos)
//      e <= 120 chars.
//   5. Teto de 90s: um relogio que "salta" corta os probes.
//   6. diagnosticarTokenUnitv NUNCA rejeita (mesmo com insert/template
//      lancando excecao).
//   7. Linha gravada tem EXATAMENTE o contrato de colunas.
//
// Como rodar: npx tsx scripts/testes/unitv_token_diag/teste.mjs

import { register } from "node:module";
register("./mock-loader.mjs", import.meta.url);

// Shim de Deno: os testes injetam tudo via opts, entao qualquer
// `?? Deno.env.get(...)` cai em undefined -> "".
globalThis.Deno = { env: { get: () => undefined } };

const diag = await import("../../../supabase/functions/_shared/unitv_token_diag.ts");
const conta = await import("../../../supabase/functions/_shared/unitv_conta.ts");
const fixas = await import("../../../supabase/functions/_shared/mensagens_fixas.ts");

let falhas = 0;
function ok(cond, msg) {
  if (!cond) { falhas++; console.error(`FALHA: ${msg}`); }
  else console.log(`ok: ${msg}`);
}

// ---------------------------------------------------------------------
// Infra de teste
// ---------------------------------------------------------------------
const ANCORA = "anc0r4x";
const DEALER_TOKEN = "tkn-super-secreto-xyz-123";
const DEALER_NAME = "inovatvstream2";
const NUM_JOSE = "5517900000000";

const CONTA_ANCORA = (expireTime = "2026-12-01 02:31:01") => ({
  id: 999001, sn: ANCORA, customer: "UniTV", package_name: "Plano Basico", expireTime,
});

// Respostas do painel para o fake fetch (formato que callUnitvApi le).
async function respOk(listArr) {
  const body = {
    returnCode: 0, errorMessage: "", jumpCode: 0,
    data: await conta.unitvEncrypt(JSON.stringify({ total: listArr.length, list: listArr })),
  };
  return { status: 200, async text() { return JSON.stringify(body); } };
}
function respAuthReject(returnCode, msg) {
  return { status: 200, async text() { return JSON.stringify({ returnCode, errorMessage: msg ?? "", jumpCode: 0 }); } };
}
function respHttp500() {
  return { status: 500, async text() { return "<html>500</html>"; } }; // JSON.parse falha -> transport_fail (httpStatus 500)
}
function fetchThrow() { throw new Error("ECONNRESET"); }

// fetch que serve uma sequencia (ultimo responder repete).
function fetchSeq(responders) {
  let i = 0;
  const fn = async () => {
    const r = responders[Math.min(i, responders.length - 1)];
    i++;
    return typeof r === "function" ? r() : r;
  };
  Object.defineProperty(fn, "chamadas", { get: () => i });
  return fn;
}

// relogio + sleep controlados. dormir avanca o relogio em `passoMs`.
function relogioFake(passoMs = 20_000) {
  let t = 0;
  let sleeps = 0;
  return {
    agora: () => t,
    dormir: async (ms) => { sleeps++; t += (passoMs ?? ms); },
    get sleeps() { return sleeps; },
    salto: (ms) => { t += ms; },
  };
}

function supaFake() {
  const rows = [];
  let dedupe = [];
  let insertThrows = false;
  let insertError = null;
  let selectThrows = false;
  const api = {
    from(tabela) {
      if (tabela !== "unitv_token_diagnostico") throw new Error("tabela inesperada: " + tabela);
      const q = {
        insert(row) {
          if (insertThrows) throw new Error("insert lancou (fake)");
          rows.push(row);
          return Promise.resolve({ error: insertError });
        },
        select() { return q; },
        eq() { return q; },
        gte() { return q; },
        limit() {
          if (selectThrows) throw new Error("select lancou (fake)");
          return Promise.resolve({ data: dedupe });
        },
      };
      return q;
    },
  };
  return {
    api, rows,
    setDedupe: (d) => { dedupe = d; },
    setInsertThrows: (v) => { insertThrows = v; },
    setInsertError: (e) => { insertError = e; },
    setSelectThrows: (v) => { selectThrows = v; },
  };
}

function templateFake() {
  const calls = [];
  let modo = "success"; // success | unavailable | throw
  const fn = async (numero, nome, idioma, params) => {
    calls.push({ numero, nome, idioma, params });
    if (modo === "throw") throw new Error("template lancou (fake)");
    if (modo === "unavailable") return { outcome: "unavailable" };
    return { outcome: "success", messageId: "wamid.fake" };
  };
  fn.calls = calls;
  fn.setModo = (m) => { modo = m; };
  return fn;
}

// Captura de console.log durante uma execucao.
let logsCap = [];
const logOriginal = console.log;
function capturarLogs() {
  logsCap = [];
  console.log = (...args) => {
    logsCap.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
}
function pararCaptura() { console.log = logOriginal; }

// Executa 1 cenario com defaults sensatos; retorna { rows, template, logs, relogio, fetch }.
async function rodar(over = {}) {
  const supa = over.supa ?? supaFake();
  const tmpl = over.tmpl ?? templateFake();
  const rel = over.rel ?? relogioFake();
  const fetchImpl = over.fetchImpl ?? fetchSeq([() => respOk([CONTA_ANCORA()])]);
  capturarLogs();
  try {
    await diag.diagnosticarTokenUnitv({
      motivoOrigem: over.motivoOrigem ?? "renovacao-unitv-conta:indisponivel",
      origemErro: over.origemErro,
      fetchImpl,
      agora: rel.agora,
      dormir: rel.dormir,
      supa: supa.api,
      enviarTemplate: tmpl,
      numeroJose: "numeroJose" in over ? over.numeroJose : NUM_JOSE,
      ancoraSn: "ancoraSn" in over ? over.ancoraSn : ANCORA,
      dealerToken: "dealerToken" in over ? over.dealerToken : DEALER_TOKEN,
      dealerName: DEALER_NAME,
    });
  } finally {
    pararCaptura();
  }
  return { supa, rows: supa.rows, tmpl, logs: logsCap.slice(), rel, fetchImpl };
}

const COLUNAS = [
  "veredito", "motivo_origem", "origem_return_code", "origem_http_status",
  "probe_total", "probe_ok", "probe_auth_reject", "probe_transport_fail",
  "probe_return_code", "ancora_status", "painel_msg", "alertado_jose",
].sort().join(",");

// =====================================================================
// 1. token_vivo -- 3 probes returnCode 0, ancora resolve
// =====================================================================
{
  const { rows, tmpl } = await rodar({ fetchImpl: fetchSeq([() => respOk([CONTA_ANCORA()])]) });
  ok(rows.length === 1, "1: grava exatamente 1 linha");
  const l = rows[0];
  ok(l.veredito === "token_vivo", "1: veredito token_vivo");
  ok(l.probe_total === 3 && l.probe_ok === 3, "1: 3 probes, todos ok");
  ok(l.ancora_status === "ok", "1: ancora_status ok");
  ok(l.alertado_jose === false, "1: nao alerta");
  ok(tmpl.calls.length === 0, "1: template nunca chamado");
  ok(Object.keys(l).sort().join(",") === COLUNAS, "1: linha tem EXATAMENTE as colunas do contrato");
}

// =====================================================================
// 2. token_morto -- 3 probes returnCode != 0, MESMO codigo
// =====================================================================
{
  const { rows, tmpl } = await rodar({
    fetchImpl: fetchSeq([() => respAuthReject(-1, "Unauthenticated.")]),
  });
  const l = rows[0];
  ok(l.veredito === "token_morto", "2: veredito token_morto");
  ok(l.probe_auth_reject === 3, "2: 3 probes auth_reject");
  ok(l.probe_return_code === -1, "2: probe_return_code = -1 (codigo comum)");
  ok(l.ancora_status === "nao_resolveu", "2: ancora nunca resolveu");
  ok(l.alertado_jose === true, "2: alertado_jose true");
  ok(tmpl.calls.length === 1, "2: template chamado 1x");
  ok(tmpl.calls[0].numero === NUM_JOSE, "2: template enviado ao numero do Jose");
  ok(tmpl.calls[0].nome === fixas.NOME_TEMPLATE_NOVA_TRANSFERENCIA, "2: usa template nova_transferencia_humana");
  ok(tmpl.calls[0].idioma === fixas.IDIOMA_TEMPLATE_NOVA_TRANSFERENCIA, "2: idioma pt_BR");
  ok(tmpl.calls[0].params.length === 1 && tmpl.calls[0].params[0] === diag.MOTIVO_ALERTA_JOSE, "2: corpo = MOTIVO_ALERTA_JOSE");
}

// =====================================================================
// 3. indeterminado_outage -- 3 probes falha de transporte
// =====================================================================
{
  const { rows, tmpl } = await rodar({
    fetchImpl: fetchSeq([fetchThrow]),
    origemErro: { returnCode: 42, httpStatus: 503, painelMsg: "boom" },
  });
  const l = rows[0];
  ok(l.veredito === "indeterminado_outage", "3: veredito indeterminado_outage");
  ok(l.probe_transport_fail === 3, "3: 3 probes transport_fail");
  ok(l.probe_return_code === null, "3: sem probe_return_code");
  ok(l.alertado_jose === false && tmpl.calls.length === 0, "3: nao alerta");
  ok(l.origem_return_code === 42 && l.origem_http_status === 503, "3: origem_return_code/http_status vem do origemErro");
}

// =====================================================================
// 4. misto 1 ok + 1 auth_reject + 1 transport_fail -> indeterminado
// =====================================================================
{
  const { rows, tmpl } = await rodar({
    fetchImpl: fetchSeq([() => respOk([CONTA_ANCORA()]), () => respAuthReject(-1, "x"), fetchThrow]),
  });
  const l = rows[0];
  ok(l.veredito === "indeterminado", "4: misto -> indeterminado");
  ok(l.probe_ok === 1 && l.probe_auth_reject === 1 && l.probe_transport_fail === 1, "4: contagem 1/1/1");
  ok(l.probe_total === 3 && (l.probe_ok + l.probe_auth_reject + l.probe_transport_fail) === l.probe_total, "4: probe_total = soma");
  ok(tmpl.calls.length === 0, "4: nao alerta");
}

// =====================================================================
// 5. token_morto -- 2 auth_reject (mesmo codigo) + 1 ok
// =====================================================================
{
  const { rows, tmpl } = await rodar({
    fetchImpl: fetchSeq([() => respAuthReject(-1, "no"), () => respAuthReject(-1, "no"), () => respOk([CONTA_ANCORA()])]),
  });
  const l = rows[0];
  ok(l.veredito === "token_morto", "5: 2 auth_reject iguais + 1 ok -> token_morto");
  ok(l.probe_return_code === -1, "5: probe_return_code = -1");
  ok(tmpl.calls.length === 1, "5: alerta enviado");
}

// =====================================================================
// 6. 2 auth_reject com codigos DIFERENTES -> indeterminado, sem alerta
// =====================================================================
{
  const { rows, tmpl } = await rodar({
    fetchImpl: fetchSeq([() => respAuthReject(-1, "a"), () => respAuthReject(-2, "b"), () => respOk([CONTA_ANCORA()])]),
  });
  const l = rows[0];
  ok(l.veredito === "indeterminado", "6: auth_reject com codigos divergentes -> indeterminado");
  ok(l.probe_return_code === null, "6: sem probe_return_code (sem codigo comum)");
  ok(l.alertado_jose === false && tmpl.calls.length === 0, "6: NAO alerta com codigos divergentes");
}

// =====================================================================
// 7. returnCode 0 mas SN ancora nao bate (drift) -> token_vivo
// =====================================================================
{
  const rowOutroSn = { ...CONTA_ANCORA(), sn: "outra-conta" };
  const { rows, tmpl } = await rodar({ fetchImpl: fetchSeq([() => respOk([rowOutroSn])]) });
  const l = rows[0];
  ok(l.veredito === "token_vivo", "7: returnCode 0 => token autenticou => token_vivo mesmo sem resolver a ancora");
  ok(l.probe_ok === 3, "7: 3 probes ok (autenticaram)");
  ok(l.ancora_status === "nao_resolveu", "7: ancora_status nao_resolveu (drift de dado)");
  ok(tmpl.calls.length === 0, "7: nao alerta");
}

// =====================================================================
// 8. SN ancora ausente -> probes pulados
// =====================================================================
{
  const fetchImpl = fetchSeq([() => respOk([CONTA_ANCORA()])]);
  const { rows, tmpl } = await rodar({ ancoraSn: "", fetchImpl });
  const l = rows[0];
  ok(l.veredito === "indeterminado", "8: ancora ausente -> veredito indeterminado");
  ok(l.ancora_status === "ausente", "8: ancora_status ausente");
  ok(l.probe_total === 0, "8: 0 probes");
  ok(fetchImpl.chamadas === 0, "8: nenhum fetch disparado");
  ok(rows.length === 1, "8: mesmo sem probes, grava a linha");
  ok(tmpl.calls.length === 0, "8: nao alerta");
}
// 8b. dealerToken ausente tambem cai em 'ausente'
{
  const { rows } = await rodar({ dealerToken: "" });
  ok(rows[0].ancora_status === "ausente" && rows[0].probe_total === 0, "8b: dealerToken vazio -> ausente, 0 probes");
}

// =====================================================================
// 9. dedupe -- token_morto mas ja houve alerta nas ultimas 6h
// =====================================================================
{
  const supa = supaFake();
  supa.setDedupe([{ id: "ja-alertado" }]);
  const { rows, tmpl } = await rodar({ supa, fetchImpl: fetchSeq([() => respAuthReject(-1, "Unauthenticated.")]) });
  const l = rows[0];
  ok(l.veredito === "token_morto", "9: veredito token_morto");
  ok(tmpl.calls.length === 0, "9: dedupe suprime o envio do alerta");
  ok(l.alertado_jose === false, "9: alertado_jose false (dedupe)");
}
// 9b. sem numero do Jose configurado -> nao alerta, nao quebra
{
  const { rows, tmpl } = await rodar({
    numeroJose: "",
    fetchImpl: fetchSeq([() => respAuthReject(-1, "Unauthenticated.")]),
  });
  ok(rows[0].veredito === "token_morto" && rows[0].alertado_jose === false && tmpl.calls.length === 0, "9b: sem numero do Jose -> token_morto sem alerta");
}
// 9c. envio do template retorna unavailable -> alertado_jose false, linha gravada
{
  const tmpl = templateFake(); tmpl.setModo("unavailable");
  const { rows } = await rodar({ tmpl, fetchImpl: fetchSeq([() => respAuthReject(-1, "x")]) });
  ok(rows[0].alertado_jose === false, "9c: template unavailable -> alertado_jose false");
}

// =====================================================================
// 10. NENHUM VAZAMENTO -- mensagem do painel com SN + telefone + e-mail
//     + nome + ID numerico; nem o banco nem os logs contem os originais.
// =====================================================================
{
  const SN_MIN = "anc0r4x";               // = ANCORA (com maiuscula tb: ANC0R4X)
  const EMAIL = "joao.suporte+dev@revenda.site";
  const TEL_1 = "+55 17 98111-2222";
  const TEL_2 = "(017) 3229-1113";
  const ID_NUM = "828667229";
  const NOME = "Joao Alberto Da Silva";
  const msgMaliciosa =
    `Titular ${NOME} (conta ${SN_MIN} / ANC0R4X id ${ID_NUM}) sem autorizacao. ` +
    `Contato ${EMAIL} ou tel ${TEL_1} / ${TEL_2}. ${"z".repeat(300)}`;

  const { rows, logs } = await rodar({
    ancoraSn: ANCORA,
    fetchImpl: fetchSeq([() => respAuthReject(-1, msgMaliciosa)]),
  });
  const l = rows[0];
  const blob = JSON.stringify(rows) + "\n" + logs.join("\n");

  // valores originais NUNCA aparecem (nem no banco/linha, nem nos logs)
  for (const [rotulo, valor] of [
    ["SN ancora (minusculo)", SN_MIN], ["SN ancora (maiusculo)", "ANC0R4X"],
    ["e-mail", EMAIL], ["telefone 1", TEL_1], ["telefone 1 sem espacos", "98111-2222"],
    ["telefone 2", TEL_2], ["ID numerico", ID_NUM], ["nome completo", NOME],
    ["sobrenome", "Da Silva"], ["dealer_token", DEALER_TOKEN],
    ["dealer_name", DEALER_NAME], ["numero do Jose", NUM_JOSE],
  ]) {
    ok(!blob.includes(valor), `10: "${rotulo}" NUNCA aparece em banco/log`);
  }

  // painel_msg gravada = marcador fixo (a msg tinha @, digitos e nome)
  ok(l.painel_msg === diag.MSG_PAINEL_OMITIDA, "10: painel_msg gravada = MSG_PAINEL_OMITIDA");
  ok(l.painel_msg.length <= 120, "10: painel_msg <= 120 (CHECK do banco)");

  // log estruturado: SEM texto de painel_msg, so' status
  const logDiag = logs.find((x) => x.includes("diagnostico concluido"));
  ok(!!logDiag, "10: log estruturado presente");
  ok(logDiag.includes('"painel_msg_status":"omitida"'), "10: log traz painel_msg_status, nao o texto");
  ok(!logDiag.includes('"painel_msg":'), "10: log NUNCA tem a chave painel_msg com texto");
  ok(logDiag.includes('"evento":"diagnostico_token"') && logDiag.includes('"veredito":"token_morto"'), "10: log tem evento + veredito");
}

// =====================================================================
// 10b. higienizarMsgPainel -- vetores unitarios
// =====================================================================
{
  const h = diag.higienizarMsgPainel;
  const M = diag.MSG_PAINEL_OMITIDA;

  ok(h(null) === null, "10b: null -> null");
  ok(h("   ") === null, "10b: em branco -> null");
  ok(h(123) === null, "10b: nao-string -> null");

  // frases de auth genericas: PRESERVADAS
  ok(h("Unauthenticated.") === "Unauthenticated.", "10b: 'Unauthenticated.' preservada");
  ok(h("Token invalid") === "Token invalid", "10b: 'Token invalid' preservada (1 palavra capitalizada)");
  ok(h("access denied") === "access denied", "10b: 'access denied' preservada");

  // SN redigido -- minusculo e MAIUSCULO, todas as ocorrencias
  ok(h("conta anc0r4x expirada", "anc0r4x") === "conta [sn] expirada", "10b: SN minusculo -> [sn]");
  ok(h("conta ANC0R4X expirada", "anc0r4x") === "conta [sn] expirada", "10b: SN MAIUSCULO -> [sn] (case-insensitive)");
  ok(h("x anc0r4x y anc0r4x z", "anc0r4x") === "x [sn] y [sn] z", "10b: todas as ocorrencias do SN");

  // e-mail / telefone / ID numerico: MASCARADOS e mantidos -- o texto
  // pos-higienizacao (sem o valor original) e' o que fica gravado.
  ok(h("erro joao.dev@revenda.site aqui") === "erro [email] aqui", "10b: e-mail -> [email]");
  ok(!h("erro joao.dev@revenda.site aqui").includes("joao") && !h("erro joao.dev@revenda.site aqui").includes("@"), "10b: e-mail sem residuo");
  ok(h("tel +55 17 98111-2222") === "tel [num]", "10b: telefone -> [num]");
  ok(!h("tel +55 17 98111-2222").includes("8111") && !h("tel +55 17 98111-2222").includes("2222"), "10b: telefone sem residuo");
  ok(h("conta 828667229 x") === "conta [num] x", "10b: ID de 9 digitos -> [num]");
  ok(h("error code 5012") === M, "10b: 4+ digitos seguidos (nao-telefone) -> OMITIDA");
  ok(h("user @ dominio.invalido") === M, "10b: '@' solto (e-mail malformado) -> OMITIDA");
  ok(h("Titular Joao Silva bloqueado") === M, "10b: 2+ palavras capitalizadas (nome) -> OMITIDA");
  ok(h("a".repeat(80)) === M, "10b: > 60 chars -> OMITIDA");
  ok(h("erro" + String.fromCharCode(7) + "controle") === M, "10b: char de controle -> OMITIDA");

  // SN numerico nunca aparece em claro (redacao direta OU mascara)
  const rSnNum = h("conta 828667229", "828667229");
  ok(!String(rSnNum).includes("828667229"), "10b: SN numerico nunca em claro");
  ok(rSnNum === M || rSnNum === "conta [sn]" || rSnNum === "conta [num]", "10b: SN numerico -> [sn]/[num]/OMITIDA");
}

// =====================================================================
// 11. NUNCA rejeita -- insert e template lancando excecao
// =====================================================================
{
  const supa = supaFake(); supa.setInsertThrows(true);
  const tmpl = templateFake(); tmpl.setModo("throw");
  let rejeitou = false;
  try {
    await diag.diagnosticarTokenUnitv({
      motivoOrigem: "renovacao-unitv-conta:indisponivel",
      fetchImpl: fetchSeq([() => respAuthReject(-1, "x")]),
      agora: relogioFake().agora,
      dormir: relogioFake().dormir,
      supa: supa.api,
      enviarTemplate: tmpl,
      numeroJose: NUM_JOSE,
      ancoraSn: ANCORA,
      dealerToken: DEALER_TOKEN,
      dealerName: DEALER_NAME,
    });
  } catch {
    rejeitou = true;
  }
  ok(rejeitou === false, "11: diagnosticarTokenUnitv NUNCA rejeita, mesmo com insert+template lancando");
}
// 11b. select de dedupe lancando -> nao suprime alerta, nao quebra
{
  const supa = supaFake(); supa.setSelectThrows(true);
  const { rows, tmpl } = await rodar({ supa, fetchImpl: fetchSeq([() => respAuthReject(-1, "x")]) });
  ok(tmpl.calls.length === 1 && rows[0].alertado_jose === true, "11b: falha no dedupe -> envia o alerta (nao perde aviso de token morto)");
}
// 11c. insert retorna { error } (nao lanca) -> nao quebra, linha registrada localmente
{
  const supa = supaFake(); supa.setInsertError({ message: "rls" });
  const { logs } = await rodar({ supa, fetchImpl: fetchSeq([() => respOk([CONTA_ANCORA()])]) });
  ok(logs.some((x) => x.includes("erro ao gravar diagnostico")), "11c: erro de insert e' logado, sem excecao");
}

// =====================================================================
// 12. teto de 90s -- relogio que salta corta os probes
// =====================================================================
{
  const rel = relogioFake(0);
  // dormir salta 100s -> depois do 1o probe, o gate pos-sleep corta.
  const relComSalto = { agora: rel.agora, dormir: async () => { rel.salto(100_000); }, get sleeps() { return 0; } };
  const fetchImpl = fetchSeq([() => respOk([CONTA_ANCORA()])]);
  const { rows } = await rodar({ rel: relComSalto, fetchImpl });
  const l = rows[0];
  ok(fetchImpl.chamadas === 1, "12: apos o salto de relogio, so' 1 probe roda");
  ok(l.probe_total === 1, "12: probe_total = 1");
  ok(l.veredito === "indeterminado", "12: 1 probe so' -> veredito indeterminado (nunca token_morto/vivo)");
}
// 12b. timing normal -- 3 probes, 2 sleeps de 20s (total 40s < 90s)
{
  const rel = relogioFake(20_000);
  const fetchImpl = fetchSeq([() => respOk([CONTA_ANCORA()])]);
  await rodar({ rel, fetchImpl });
  ok(fetchImpl.chamadas === 3, "12b: 3 probes no timing normal");
  ok(rel.sleeps === 2, "12b: exatamente 2 sleeps entre 3 probes");
}

// =====================================================================
// 13. motivo_origem repassado para a linha
// =====================================================================
{
  const { rows } = await rodar({ motivoOrigem: "renovacao-unitv-conta:indisponivel" });
  ok(rows[0].motivo_origem === "renovacao-unitv-conta:indisponivel", "13: motivo_origem gravado");
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
