// Testes locais de supabase/functions/renovacao-sigma-contexto/index.ts
// (real, importada sem alteracao). So' _shared/supabase_client.ts e'
// fakeado (mock-loader.mjs). _shared/rocket_sigma_contexto.ts,
// _shared/rocket_session_check.ts e _shared/http.ts sao os arquivos
// REAIS. O fetch global e' interceptado aqui.
//
// Contrato NOVO (2026-08-28): a function recebe SO' { idClienteInterno }
// (ja resolvido pelo DOM do Playwright, dentro do workflow) e devolve
// { outcome, sessaoValida, pacoteAtual, expiresAt }. Nao ha mais
// scrape de pagina, nao ha mais resolucao de id, nao ha mais
// diagnostico estrutural -- tudo isso saiu com a nova arquitetura.
//
// Como rodar: npx tsx scripts/testes/rocket-sigma-contexto/teste.mjs

import { register } from "node:module";

register("./mock-loader.mjs", import.meta.url);

const { definirSessaoVault, definirRpcLanca, resetarFakeSupabase } = await import(
  "./fake_supabase_client.mjs"
);

const TOKEN_VALIDO = "token-interno-de-teste-valor-longo";
const ID_INTERNO = "1569178";

// ---------------------------------------------------------------------
// Interceptacao de fetch global. Config por cenario via `cfg`.
// ---------------------------------------------------------------------
let cfg;
let chamadas;
let sigmaInfoChamadas; // Iteracao 1: quantas vezes GET .../sigma/info/ foi batido (p/ testar a Camada A)

function resetCfg() {
  cfg = {
    // "valida" | "login" | "erroRede"
    sessaoCheck: "valida",
    // Response | "throw" | array de (Response | "throw") consumida 1 por
    // chamada (o ultimo item repete). Iteracao 1: permite testar o retry
    // da Camada A com respostas diferentes por tentativa.
    sigma: null,
  };
  chamadas = [];
  sigmaInfoChamadas = 0;
}

function proximaRespostaSigma() {
  const s = cfg.sigma;
  // Um Response so' pode ter o corpo lido 1x -- quando o cenario dispara
  // retry (outcome "unavailable"), cada tentativa precisa de um Response
  // NOVO. Por isso: funcao = factory (chamada a cada tentativa); array =
  // 1 por tentativa (ultimo repete); Response/"throw" = 1 uso so'.
  if (typeof s === "function") return s(sigmaInfoChamadas);
  if (Array.isArray(s)) {
    const i = Math.min(sigmaInfoChamadas, s.length - 1);
    return s[i];
  }
  return s;
}

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  chamadas.push({ url: u, method: opts.method ?? "GET" });

  if (u === "https://app.rocketgestor.com/gerenciador/") {
    if (cfg.sessaoCheck === "erroRede") throw new Error("net down");
    if (cfg.sessaoCheck === "login") {
      return new Response('<form id="login-form"><input name="username"></form>', { status: 200 });
    }
    return new Response("<html><body>dashboard ok</body></html>", { status: 200 });
  }

  if (u.startsWith("https://app.rocketgestor.com/gerenciador/cliente/sigma/info/")) {
    const resp = proximaRespostaSigma();
    sigmaInfoChamadas++;
    if (resp === "throw") throw new Error("sigma down");
    return resp;
  }

  throw new Error(`fetch inesperado no teste: ${opts.method ?? "GET"} ${u}`);
};

// ---------------------------------------------------------------------
// Deno shim + import do handler real
// ---------------------------------------------------------------------
let handler;
globalThis.Deno = {
  serve: (fn) => {
    handler = fn;
  },
  env: {
    get: (nome) => (nome === "RENOVACAO_SIGMA_CALLBACK_TOKEN" ? TOKEN_VALIDO : undefined),
  },
};

const { SIGMA_CTX_RETRY } = await import("../../../supabase/functions/renovacao-sigma-contexto/index.ts");

// Iteracao 1: por padrao, backoff ZERO nos testes (rapidez). O unico
// teste que valida o TEMPO real do backoff restaura os valores de
// producao localmente.
const SIGMA_CTX_BACKOFF_PROD = [...SIGMA_CTX_RETRY.backoffMs];
SIGMA_CTX_RETRY.backoffMs = [0, 0, 0, 0];

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------
let falhas = 0;
function ok(cond, msg) {
  if (!cond) {
    falhas++;
    console.error(`FALHA: ${msg}`);
  } else {
    console.log(`ok: ${msg}`);
  }
}

function req({ method = "POST", token = TOKEN_VALIDO, corpo, corpoBruto } = {}) {
  const headers = {};
  if (token !== null) headers["X-Internal-Token"] = token;
  const semCorpo = method === "GET" || method === "HEAD";
  if (!semCorpo) headers["Content-Type"] = "application/json";
  return new Request("https://example.test/renovacao-sigma-contexto", {
    method,
    headers,
    body: semCorpo
      ? undefined
      : corpoBruto !== undefined
        ? corpoBruto
        : corpo !== undefined
          ? JSON.stringify(corpo)
          : undefined,
  });
}

const PROIBIDO = [
  "SESSIONID_FAKE",
  "CSRF_FAKE",
  "sessionid=",
  "csrftoken=",
  "<html",
  "<button",
  "btn_add_pagamento_",
  "senha",
  "device_key",
];
function semVazamento(bodyStr, rotulo) {
  const achou = PROIBIDO.filter((p) => bodyStr.includes(p));
  ok(achou.length === 0, `${rotulo}: resposta sem cookie/sessao/senha/HTML bruto (nao contem: ${achou.join(", ") || "nada"})`);
}

function resp200Json(obj) {
  return new Response(JSON.stringify(obj), { status: 200, headers: { "content-type": "application/json" } });
}
function respStatus(status, texto = "") {
  return new Response(texto, { status });
}

async function chamar(reqObj) {
  const r = await handler(reqObj);
  const txt = await r.text();
  let json = null;
  try {
    json = JSON.parse(txt);
  } catch {
    /* deixa null */
  }
  return { status: r.status, txt, json };
}

// ---------------------------------------------------------------------
// 1-6: contrato de protocolo
// ---------------------------------------------------------------------
{
  resetCfg();
  resetarFakeSupabase();
  const r = await chamar(req({ token: null }));
  ok(r.status === 401 && r.json?.outcome === "error", "1: sem X-Internal-Token -> 401 error");
  ok(chamadas.length === 0, "1: nenhum fetch externo sem token");
}
{
  resetCfg();
  const r = await chamar(req({ token: "errado" }));
  ok(r.status === 401, "2: token errado -> 401");
  ok(chamadas.length === 0, "2: nenhum fetch externo com token errado");
}
{
  resetCfg();
  const r = await chamar(req({ method: "GET" }));
  ok(r.status === 405, "3: GET -> 405");
}
{
  resetCfg();
  const r = await chamar(req({ corpoBruto: "{ nao e json" }));
  ok(r.status === 400, "4: corpo nao-JSON -> 400");
}
{
  resetCfg();
  const r = await chamar(req({ corpo: {} }));
  ok(r.status === 400, "5: idClienteInterno ausente -> 400");
  ok(chamadas.length === 0, "5: nenhum fetch externo sem idClienteInterno");
}
{
  resetCfg();
  const r = await chamar(req({ corpo: { idClienteInterno: "12ab" } }));
  ok(r.status === 400, "6: idClienteInterno nao-digitos -> 400");
  ok(chamadas.length === 0, "6: nenhum fetch externo com idClienteInterno invalido");
}
{
  // idClienteInterno com espacos em volta -> trim -> aceito
  resetCfg();
  resetarFakeSupabase();
  cfg.sigma = resp200Json({ data: { package: "1 MES - X", expires_at: "2026-09-13T20:59:59-03:00" } });
  const r = await chamar(req({ corpo: { idClienteInterno: "  1569178  " } }));
  ok(r.status === 200 && r.json?.outcome === "success", "6b: idClienteInterno com espacos -> trim -> success");
  ok(chamadas.some((c) => c.url.includes("sigma/info/?cliente_id=1569178")), "6b: sigma/info chamado com o id trimado");
}
{
  // campos obsoletos (publicId/clienteNome/telefone) sao ignorados
  resetCfg();
  resetarFakeSupabase();
  cfg.sigma = resp200Json({ data: { package: "1 MES - X", expires_at: "2026-10-01T00:00:00-03:00" } });
  const r = await chamar(
    req({ corpo: { idClienteInterno: ID_INTERNO, publicId: "qualquer", clienteNome: "Fulano", telefone: "5511999999999" } }),
  );
  ok(r.status === 200 && r.json?.outcome === "success", "7: campos obsoletos no corpo sao ignorados, nao quebram");
  ok(!r.txt.includes("Fulano") && !r.txt.includes("qualquer"), "7: campos obsoletos nao aparecem na resposta");
}

// ---------------------------------------------------------------------
// 8-11: sessao do Vault / checagem de sessao
// ---------------------------------------------------------------------
{
  resetCfg();
  resetarFakeSupabase();
  definirSessaoVault({ sessionid: null, csrftoken: null });
  const r = await chamar(req({ corpo: { idClienteInterno: ID_INTERNO } }));
  ok(r.status === 200 && r.json?.outcome === "sessao_expirada", "8: sessao do Vault ausente -> 200 sessao_expirada");
  ok(r.json?.detalhe === "sessao do Vault ausente", "8: detalhe = 'sessao do Vault ausente'");
  ok(chamadas.length === 0, "8: nao chega a bater no Rocket sem sessao");
}
{
  resetCfg();
  resetarFakeSupabase();
  definirRpcLanca(true);
  const r = await chamar(req({ corpo: { idClienteInterno: ID_INTERNO } }));
  ok(r.status === 200 && r.json?.outcome === "unavailable" && r.json?.etapa === "sessao_vault", "9: rpc rocket_sessao_ler lanca -> unavailable etapa sessao_vault");
}
{
  resetCfg();
  resetarFakeSupabase();
  cfg.sessaoCheck = "login";
  const r = await chamar(req({ corpo: { idClienteInterno: ID_INTERNO } }));
  ok(r.status === 200 && r.json?.outcome === "sessao_expirada" && r.json?.detalhe === "sessao invalida (login)", "10: GET /gerenciador/ = tela de login -> sessao_expirada (login)");
}
{
  // erro de rede na checagem NAO aborta -- segue e resolve normalmente
  resetCfg();
  resetarFakeSupabase();
  cfg.sessaoCheck = "erroRede";
  cfg.sigma = resp200Json({ data: { package: "1 MES - X", expires_at: "2026-09-13T20:59:59-03:00" } });
  const r = await chamar(req({ corpo: { idClienteInterno: ID_INTERNO } }));
  ok(r.status === 200 && r.json?.outcome === "success", "11: erro de rede na checagem de sessao NAO aborta (resolve normalmente)");
}

// ---------------------------------------------------------------------
// 12-16: consulta ao Sigma
// ---------------------------------------------------------------------
{
  // happy
  resetCfg();
  resetarFakeSupabase();
  cfg.sigma = resp200Json({ data: { package: "1 MES - P2P & IPTV COM ADULTOS", expires_at: "2026-09-13T20:59:59-03:00", status: "ACTIVE" } });
  const r = await chamar(req({ corpo: { idClienteInterno: ID_INTERNO } }));
  ok(r.status === 200 && r.json?.outcome === "success", "12: happy -> success");
  ok(r.json?.sessaoValida === true, "12: sessaoValida = true");
  ok(r.json?.pacoteAtual === "1 MES - P2P & IPTV COM ADULTOS", "12: pacoteAtual = data.package");
  ok(r.json?.expiresAt === "2026-09-13T20:59:59-03:00", "12: expiresAt = data.expires_at");
  ok(r.json?.status === undefined && r.json?.idClienteInterno === undefined, "12: data.status / idClienteInterno NAO aparecem (fora do contrato)");
  ok(!chamadas.some((c) => c.url.includes("/cliente/info/")), "12: NUNCA busca a pagina do cliente (/cliente/info/)");
  ok(chamadas.some((c) => c.url.includes(`sigma/info/?cliente_id=${ID_INTERNO}`)), "12: sigma/info chamado com o id recebido");
  semVazamento(r.txt, "12");
}
{
  // expires_at null -> success com expiresAt null
  resetCfg();
  resetarFakeSupabase();
  cfg.sigma = resp200Json({ data: { package: "1 MES - X", expires_at: null } });
  const r = await chamar(req({ corpo: { idClienteInterno: ID_INTERNO } }));
  ok(r.json?.outcome === "success" && r.json?.expiresAt === null, "13: sigma/info sem expires_at -> success com expiresAt null");
}
{
  resetCfg();
  resetarFakeSupabase();
  cfg.sigma = respStatus(500, "erro interno");
  const r = await chamar(req({ corpo: { idClienteInterno: ID_INTERNO } }));
  ok(r.json?.outcome === "unavailable" && r.json?.etapa === "sigma_info", "14: sigma/info HTTP 500 -> unavailable etapa sigma_info");
}
{
  resetCfg();
  resetarFakeSupabase();
  cfg.sigma = new Response("<html>bloqueio da borda</html>", { status: 200 });
  const r = await chamar(req({ corpo: { idClienteInterno: ID_INTERNO } }));
  ok(r.json?.outcome === "unavailable" && r.json?.etapa === "sigma_info", "15: sigma/info 200 nao-JSON -> unavailable etapa sigma_info");
}
{
  resetCfg();
  resetarFakeSupabase();
  cfg.sigma = resp200Json({ data: { package: "   ", expires_at: "2026-10-01T00:00:00-03:00" } });
  const r = await chamar(req({ corpo: { idClienteInterno: ID_INTERNO } }));
  ok(r.json?.outcome === "pacote_vazio", "16: sigma/info package vazio -> pacote_vazio");
}
{
  resetCfg();
  resetarFakeSupabase();
  cfg.sigma = "throw";
  const r = await chamar(req({ corpo: { idClienteInterno: ID_INTERNO } }));
  ok(r.json?.outcome === "unavailable" && r.json?.etapa === "sigma_info", "17: fetch do sigma/info lanca -> unavailable etapa sigma_info");
}

// =====================================================================
// ITERACAO 1 (2026-08-29) -- reclassificacao de auth Sigma + retry Camada A.
// Numeracao dos testes = spec da Iteracao 1 (1..10).
// =====================================================================

// spec 1: {"error":true,"msg":"...Unauthenticated..."} -> unavailable
//         (etapa sigma_info_auth), NUNCA pacote_vazio.
{
  resetCfg();
  resetarFakeSupabase();
  // factory: cada uma das 4 tentativas do retro recebe um Response NOVO
  cfg.sigma = () => resp200Json({ error: true, msg: '{"message":"Unauthenticated."}' });
  const r = await chamar(req({ corpo: { idClienteInterno: ID_INTERNO } }));
  ok(r.json?.outcome === "unavailable", "spec1: Unauthenticated no corpo -> unavailable (NUNCA pacote_vazio)");
  ok(r.json?.etapa === "sigma_info_auth", "spec1: etapa = 'sigma_info_auth' (distinta de sigma_info generico)");
  ok(sigmaInfoChamadas === 4, "spec1: unavailable -> Camada A re-tentou (4 chamadas a sigma/info)");
}

// spec 2: {"error":false,"data":{"package":"", ...}} -> pacote_vazio
//         (resposta VALIDA do painel + realmente sem pacote).
{
  resetCfg();
  resetarFakeSupabase();
  cfg.sigma = resp200Json({ error: false, data: { package: "", status: "ACTIVE" } });
  const r = await chamar(req({ corpo: { idClienteInterno: ID_INTERNO } }));
  ok(r.json?.outcome === "pacote_vazio", "spec2: error:false + data.package vazio -> pacote_vazio (cliente sem plano)");
}

// spec 3: {"error":false,"data":{package, expires_at, status:ACTIVE}} -> success
{
  resetCfg();
  resetarFakeSupabase();
  cfg.sigma = resp200Json({
    error: false,
    data: { id: "loL7ZaZ1XM", package: "⭐1 MÊS C/ADULTOS⭐ 🔞", expires_at: "2026-09-01T02:59:59.000000Z", status: "ACTIVE" },
  });
  const r = await chamar(req({ corpo: { idClienteInterno: ID_INTERNO } }));
  ok(r.json?.outcome === "success", "spec3: resposta valida com pacote -> success");
  ok(r.json?.pacoteAtual === "⭐1 MÊS C/ADULTOS⭐ 🔞", "spec3: pacoteAtual = data.package");
  ok(r.json?.expiresAt === "2026-09-01T02:59:59.000000Z", "spec3: expiresAt = data.expires_at");
  ok(r.json?.status === undefined && r.json?.id === undefined, "spec3: data.status / data.id NAO vazam (fora do contrato)");
  semVazamento(r.txt, "spec3");
}

// spec 4: HTTP 401 / 403 -> unavailable (etapa sigma_info_auth).
{
  resetCfg();
  resetarFakeSupabase();
  cfg.sigma = respStatus(401, "Unauthorized");
  const r = await chamar(req({ corpo: { idClienteInterno: ID_INTERNO } }));
  ok(r.json?.outcome === "unavailable" && r.json?.etapa === "sigma_info_auth", "spec4: HTTP 401 -> unavailable etapa sigma_info_auth");
}
{
  resetCfg();
  resetarFakeSupabase();
  cfg.sigma = respStatus(403, "Forbidden");
  const r = await chamar(req({ corpo: { idClienteInterno: ID_INTERNO } }));
  ok(r.json?.outcome === "unavailable" && r.json?.etapa === "sigma_info_auth", "spec4: HTTP 403 -> unavailable etapa sigma_info_auth");
}

// spec 5: sessao_expirada do Vault segue categoria DISTINTA de unavailable
//         (e nem entra no retry da Camada A -- sigma/info nunca e' batido).
{
  resetCfg();
  resetarFakeSupabase();
  definirSessaoVault({ sessionid: null, csrftoken: null });
  cfg.sigma = resp200Json({ error: true, msg: '{"message":"Unauthenticated."}' }); // nao deveria nem ser lido
  const r = await chamar(req({ corpo: { idClienteInterno: ID_INTERNO } }));
  ok(r.json?.outcome === "sessao_expirada", "spec5: sessao do Vault ausente -> sessao_expirada (nunca 'unavailable')");
  ok(sigmaInfoChamadas === 0, "spec5: sessao_expirada NAO entra no retry da Camada A (0 chamadas a sigma/info)");
}

// spec 6: 1a e 2a unavailable, 3a success -> EF success, EXATAMENTE 3
//         chamadas a sigma/info, tentativas=3.
{
  resetCfg();
  resetarFakeSupabase();
  cfg.sigma = [
    resp200Json({ error: true, msg: '{"message":"Unauthenticated."}' }),
    respStatus(401, "Unauthorized"),
    resp200Json({ error: false, data: { package: "1 MES - X", expires_at: "2026-10-01T00:00:00-03:00" } }),
  ];
  const r = await chamar(req({ corpo: { idClienteInterno: ID_INTERNO } }));
  ok(r.json?.outcome === "success" && r.json?.pacoteAtual === "1 MES - X", "spec6: unavailable x2 depois success -> EF success");
  ok(sigmaInfoChamadas === 3, "spec6: sigma/info batido EXATAMENTE 3x (parou na 1a que nao foi unavailable)");
  ok(r.json?.tentativas === 3, "spec6: campo tentativas = 3");
}

// spec 7: todas as N (4) unavailable -> unavailable apos N (nunca N+1).
{
  resetCfg();
  resetarFakeSupabase();
  cfg.sigma = [
    respStatus(401),
    resp200Json({ error: true, msg: '{"message":"Unauthenticated."}' }),
    respStatus(403),
    respStatus(401),
  ];
  const r = await chamar(req({ corpo: { idClienteInterno: ID_INTERNO } }));
  ok(r.json?.outcome === "unavailable" && r.json?.etapa === "sigma_info_auth", "spec7: 4x unavailable -> unavailable (auth)");
  ok(sigmaInfoChamadas === 4, "spec7: EXATAMENTE 4 chamadas a sigma/info (nao 5)");
  ok(r.json?.tentativas === 4, "spec7: campo tentativas = 4");
}

// spec 8: 1a success -> 1 chamada, zero retry.
{
  resetCfg();
  resetarFakeSupabase();
  cfg.sigma = resp200Json({ error: false, data: { package: "1 MES - X", expires_at: "2026-10-01T00:00:00-03:00" } });
  const r = await chamar(req({ corpo: { idClienteInterno: ID_INTERNO } }));
  ok(r.json?.outcome === "success" && sigmaInfoChamadas === 1 && r.json?.tentativas === 1, "spec8: 1a success -> 1 chamada, tentativas=1 (zero retry)");
}

// spec 9: 1a pacote_vazio -> 1 chamada, zero retry (nao e' transitorio).
{
  resetCfg();
  resetarFakeSupabase();
  cfg.sigma = resp200Json({ error: false, data: { package: "   " } });
  const r = await chamar(req({ corpo: { idClienteInterno: ID_INTERNO } }));
  ok(r.json?.outcome === "pacote_vazio" && sigmaInfoChamadas === 1 && r.json?.tentativas === 1, "spec9: 1a pacote_vazio -> 1 chamada, tentativas=1 (zero retry)");
}

// spec 10: 1a sessao_expirada (checagem de sessao = login) -> zero retry
//          da Camada A (sigma/info nunca batido).
{
  resetCfg();
  resetarFakeSupabase();
  cfg.sessaoCheck = "login";
  cfg.sigma = resp200Json({ error: true, msg: '{"message":"Unauthenticated."}' });
  const r = await chamar(req({ corpo: { idClienteInterno: ID_INTERNO } }));
  ok(r.json?.outcome === "sessao_expirada" && sigmaInfoChamadas === 0, "spec10: sessao invalida (login) -> sessao_expirada, 0 chamadas a sigma/info (zero retry)");
}

// spec 6 (parte de tempo): com o backoff REAL de producao, uma sequencia
// [unavailable x3, success] tem que ESPERAR pelo menos ~ (400+900)*0.8 ms.
{
  resetCfg();
  resetarFakeSupabase();
  SIGMA_CTX_RETRY.backoffMs = [...SIGMA_CTX_BACKOFF_PROD]; // [0, 400, 900, 1600]
  cfg.sigma = [
    respStatus(401),
    respStatus(401),
    respStatus(401),
    resp200Json({ error: false, data: { package: "1 MES - X", expires_at: "2026-10-01T00:00:00-03:00" } }),
  ];
  const t0 = Date.now();
  const r = await chamar(req({ corpo: { idClienteInterno: ID_INTERNO } }));
  const decorrido = Date.now() - t0;
  SIGMA_CTX_RETRY.backoffMs = [0, 0, 0, 0]; // restaura rapidez pros proximos
  ok(r.json?.outcome === "success" && r.json?.tentativas === 4, "spec6-tempo: 3x unavailable + success -> success na 4a");
  // esperas antes das tentativas 2,3,4 = 400,900,1600; a 4a e' success ->
  // esperou 400+900+1600 = 2900ms de base, com jitter -20% = >= 2320ms.
  ok(decorrido >= 2000, `spec6-tempo: respeitou o backoff acumulado (decorrido=${decorrido}ms >= 2000)`);
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
