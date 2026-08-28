// Testes locais de supabase/functions/renovacao-sigma-contexto/index.ts
// (real, importada sem alteracao). So' _shared/supabase_client.ts e'
// fakeado (mock-loader.mjs). _shared/rocket_sigma_contexto.ts,
// _shared/rocket_session_check.ts e _shared/http.ts sao os arquivos
// REAIS. O fetch global e' interceptado aqui.
//
// Cobre: contrato de protocolo (401/405/400), sessao do Vault
// ausente / rpc lancando / sessao invalida (login) / erro de rede na
// checagem (nao aborta), fase "antes" (happy, id_nao_encontrado com
// diagnostico so-inteiros, id_ambiguo, ordem id/nome trocada,
// sigma/info invalido, pacote_vazio, pagina !ok / pagina lanca) e
// fase "depois". Garante que nenhuma resposta contem cookie/sessao/
// senha/device_key/HTML bruto.
//
// Como rodar: npx tsx scripts/testes/rocket-sigma-contexto/teste.mjs

import { register } from "node:module";

register("./mock-loader.mjs", import.meta.url);

const { definirSessaoVault, definirRpcLanca, resetarFakeSupabase } = await import(
  "./fake_supabase_client.mjs"
);

const TOKEN_VALIDO = "token-interno-de-teste-valor-longo";
const PUBLIC_ID = "01a0271b-5a54-7d7e-8e4a-ef4c39730e0b";
const NOME_ALVO = "Meu Uso Testes";
const TEL_ALVO = "5517981625486";
const ID_INTERNO = "1569178";

// ---------------------------------------------------------------------
// Interceptacao de fetch global. Config por cenario via `cfg`.
// ---------------------------------------------------------------------
let cfg;
let chamadas;

function resetCfg() {
  cfg = {
    // "valida" | "login" | "erroRede"
    sessaoCheck: "valida",
    // Response | "throw" para GET /gerenciador/cliente/info/{id}/
    pagina: null,
    // Response | "throw" para GET .../sigma/info/?cliente_id=...
    sigma: null,
  };
  chamadas = [];
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

  if (u.startsWith("https://app.rocketgestor.com/gerenciador/cliente/info/")) {
    if (cfg.pagina === "throw") throw new Error("pagina down");
    return cfg.pagina;
  }

  if (u.startsWith("https://app.rocketgestor.com/gerenciador/cliente/sigma/info/")) {
    if (cfg.sigma === "throw") throw new Error("sigma down");
    return cfg.sigma;
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

await import("../../../supabase/functions/renovacao-sigma-contexto/index.ts");

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

function botao(id, nome, { ordemTrocada = false } = {}) {
  return ordemTrocada
    ? `<button type="button" nome="${nome}" id="btn_add_pagamento_${id}" class="b">Adicionar pagamento</button>`
    : `<button type="button" id="btn_add_pagamento_${id}" nome="${nome}" class="b">Adicionar pagamento</button>`;
}
function linha(id, nome, telefone, opts) {
  // telefone aparece ANTES do botao, dentro da janela de 3000 chars
  return `<tr><td>${nome}</td><td telefone="${telefone}">tel</td><td>${botao(id, nome, opts)}</td></tr>`;
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
// 1-8: contrato de protocolo
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
  const r = await chamar(req({ corpo: { publicId: "nao-uuid", clienteNome: NOME_ALVO, telefone: TEL_ALVO } }));
  ok(r.status === 400, "5: publicId invalido -> 400");
  ok(chamadas.length === 0, "5: nenhum fetch externo com publicId invalido");
}
{
  resetCfg();
  const r = await chamar(req({ corpo: { publicId: PUBLIC_ID, telefone: TEL_ALVO } }));
  ok(r.status === 400, "6: fase antes sem clienteNome -> 400");
}
{
  resetCfg();
  const r = await chamar(req({ corpo: { publicId: PUBLIC_ID, clienteNome: NOME_ALVO } }));
  ok(r.status === 400, "7: fase antes sem telefone -> 400");
}
{
  resetCfg();
  const r = await chamar(req({ corpo: { publicId: PUBLIC_ID, idClienteInterno: "12ab" } }));
  ok(r.status === 400, "8: idClienteInterno nao-digitos -> 400");
  ok(chamadas.length === 0, "8: nenhum fetch externo com idClienteInterno invalido");
}

// ---------------------------------------------------------------------
// 9-12: sessao do Vault / checagem de sessao
// ---------------------------------------------------------------------
{
  resetCfg();
  resetarFakeSupabase();
  definirSessaoVault({ sessionid: null, csrftoken: null });
  const r = await chamar(req({ corpo: { publicId: PUBLIC_ID, clienteNome: NOME_ALVO, telefone: TEL_ALVO } }));
  ok(r.status === 200 && r.json?.outcome === "sessao_expirada", "9: sessao do Vault ausente -> 200 sessao_expirada");
  ok(r.json?.detalhe === "sessao do Vault ausente", "9: detalhe = 'sessao do Vault ausente'");
  ok(chamadas.length === 0, "9: nao chega a bater no Rocket sem sessao");
}
{
  resetCfg();
  resetarFakeSupabase();
  definirRpcLanca(true);
  const r = await chamar(req({ corpo: { publicId: PUBLIC_ID, clienteNome: NOME_ALVO, telefone: TEL_ALVO } }));
  ok(r.status === 200 && r.json?.outcome === "unavailable" && r.json?.etapa === "sessao_vault", "10: rpc rocket_sessao_ler lanca -> unavailable etapa sessao_vault");
}
{
  resetCfg();
  resetarFakeSupabase();
  cfg.sessaoCheck = "login";
  const r = await chamar(req({ corpo: { publicId: PUBLIC_ID, clienteNome: NOME_ALVO, telefone: TEL_ALVO } }));
  ok(r.status === 200 && r.json?.outcome === "sessao_expirada" && r.json?.detalhe === "sessao invalida (login)", "11: GET /gerenciador/ = tela de login -> sessao_expirada (login)");
}
{
  // erro de rede na checagem NAO aborta -- segue e resolve normalmente
  resetCfg();
  resetarFakeSupabase();
  cfg.sessaoCheck = "erroRede";
  cfg.pagina = respStatus(200, `<table>${linha(ID_INTERNO, NOME_ALVO, TEL_ALVO)}</table>`);
  cfg.sigma = resp200Json({ data: { package: "1 MES - X", expires_at: "2026-09-13T20:59:59-03:00" } });
  const r = await chamar(req({ corpo: { publicId: PUBLIC_ID, clienteNome: NOME_ALVO, telefone: TEL_ALVO } }));
  ok(r.status === 200 && r.json?.outcome === "success", "12: erro de rede na checagem de sessao NAO aborta (resolve normalmente)");
}

// ---------------------------------------------------------------------
// 13-22: fase "antes"
// ---------------------------------------------------------------------
{
  // happy
  resetCfg();
  resetarFakeSupabase();
  cfg.pagina = respStatus(200, `<table>${linha("999999", "Outro Cliente", "551199990000")}${linha(ID_INTERNO, NOME_ALVO, TEL_ALVO)}</table>`);
  cfg.sigma = resp200Json({ data: { package: "1 MES - P2P & IPTV COM ADULTOS", expires_at: "2026-09-13T20:59:59-03:00", status: "ACTIVE" } });
  const r = await chamar(req({ corpo: { publicId: PUBLIC_ID, clienteNome: NOME_ALVO, telefone: TEL_ALVO } }));
  ok(r.status === 200 && r.json?.outcome === "success", "13: antes happy -> success");
  ok(r.json?.sessaoValida === true, "13: sessaoValida = true");
  ok(r.json?.idClienteInterno === ID_INTERNO, "13: idClienteInterno correto");
  ok(r.json?.pacoteAtual === "1 MES - P2P & IPTV COM ADULTOS", "13: pacoteAtual = data.package");
  ok(r.json?.expiresAt === "2026-09-13T20:59:59-03:00", "13: expiresAt = data.expires_at");
  ok(r.json?.status === undefined, "13: data.status NAO vaza (fora do contrato)");
  semVazamento(r.txt, "13");
  const chamouSigmaComId = chamadas.some((c) => c.url.includes(`sigma/info/?cliente_id=${ID_INTERNO}`));
  ok(chamouSigmaComId, "13: sigma/info chamado com o id resolvido");
}
{
  // id_nao_encontrado: 2 botoes, nenhum casa nome+telefone
  resetCfg();
  resetarFakeSupabase();
  const html = `<table>${linha("111", "Fulano", "551100000001")}${linha("222", "Beltrano", "551100000002")}</table>`;
  cfg.pagina = respStatus(200, html);
  const r = await chamar(req({ corpo: { publicId: PUBLIC_ID, clienteNome: NOME_ALVO, telefone: TEL_ALVO } }));
  ok(r.json?.outcome === "id_nao_encontrado", "14: nenhum botao casa -> id_nao_encontrado");
  const d = r.json?.diagnostico ?? {};
  ok(d.totalBotoes === 2, "14: diagnostico.totalBotoes = 2");
  ok(d.botoesComNomeAlvo === 0, "14: diagnostico.botoesComNomeAlvo = 0");
  ok(typeof d.paginaStatus === "number" && typeof d.paginaTamanho === "number", "14: paginaStatus/paginaTamanho sao numeros");
  ok(Object.values(d).every((v) => typeof v === "number"), "14: diagnostico so' tem inteiros (nenhuma string)");
  semVazamento(r.txt, "14");
  ok(!r.txt.includes("Fulano") && !r.txt.includes("Beltrano"), "14: nenhum nome de cliente na resposta");
}
{
  // nome casa mas telefone nao -> botoesComNomeAlvo=1, ids vazio
  resetCfg();
  resetarFakeSupabase();
  cfg.pagina = respStatus(200, `<table>${linha(ID_INTERNO, NOME_ALVO, "551100009999")}</table>`);
  const r = await chamar(req({ corpo: { publicId: PUBLIC_ID, clienteNome: NOME_ALVO, telefone: TEL_ALVO } }));
  ok(r.json?.outcome === "id_nao_encontrado", "15: nome casa mas telefone diverge -> id_nao_encontrado");
  ok(r.json?.diagnostico?.totalBotoes === 1 && r.json?.diagnostico?.botoesComNomeAlvo === 1, "15: totalBotoes=1, botoesComNomeAlvo=1");
}
{
  // id_ambiguo: 2 botoes com o MESMO nome+telefone, ids diferentes
  resetCfg();
  resetarFakeSupabase();
  cfg.pagina = respStatus(200, `<table>${linha("100", NOME_ALVO, TEL_ALVO)}${linha("200", NOME_ALVO, TEL_ALVO)}</table>`);
  const r = await chamar(req({ corpo: { publicId: PUBLIC_ID, clienteNome: NOME_ALVO, telefone: TEL_ALVO } }));
  ok(r.json?.outcome === "id_ambiguo", "16: 2 ids p/ mesmo nome+telefone -> id_ambiguo");
  ok(Array.isArray(r.json?.candidatos) && r.json.candidatos.length === 2, "16: candidatos = 2 ids");
  ok(r.json.candidatos.every((c) => /^\d+$/.test(c)), "16: candidatos sao so' digitos (id interno)");
}
{
  // ordem nome/id trocada dentro da tag <button> -> ainda casa
  resetCfg();
  resetarFakeSupabase();
  cfg.pagina = respStatus(200, `<table>${linha(ID_INTERNO, NOME_ALVO, TEL_ALVO, { ordemTrocada: true })}</table>`);
  cfg.sigma = resp200Json({ data: { package: "1 MES - X", expires_at: "2026-10-01T00:00:00-03:00" } });
  const r = await chamar(req({ corpo: { publicId: PUBLIC_ID, clienteNome: NOME_ALVO, telefone: TEL_ALVO } }));
  ok(r.json?.outcome === "success" && r.json?.idClienteInterno === ID_INTERNO, "17: nome= antes de id= na tag <button> -> ainda resolve");
}
{
  // sigma/info !ok
  resetCfg();
  resetarFakeSupabase();
  cfg.pagina = respStatus(200, `<table>${linha(ID_INTERNO, NOME_ALVO, TEL_ALVO)}</table>`);
  cfg.sigma = respStatus(500, "erro interno");
  const r = await chamar(req({ corpo: { publicId: PUBLIC_ID, clienteNome: NOME_ALVO, telefone: TEL_ALVO } }));
  ok(r.json?.outcome === "unavailable" && r.json?.etapa === "sigma_info", "18: sigma/info HTTP 500 -> unavailable etapa sigma_info");
}
{
  // sigma/info 200 mas nao-JSON
  resetCfg();
  resetarFakeSupabase();
  cfg.pagina = respStatus(200, `<table>${linha(ID_INTERNO, NOME_ALVO, TEL_ALVO)}</table>`);
  cfg.sigma = new Response("<html>bloqueio da borda</html>", { status: 200 });
  const r = await chamar(req({ corpo: { publicId: PUBLIC_ID, clienteNome: NOME_ALVO, telefone: TEL_ALVO } }));
  ok(r.json?.outcome === "unavailable" && r.json?.etapa === "sigma_info", "19: sigma/info 200 nao-JSON -> unavailable etapa sigma_info");
}
{
  // sigma/info package vazio
  resetCfg();
  resetarFakeSupabase();
  cfg.pagina = respStatus(200, `<table>${linha(ID_INTERNO, NOME_ALVO, TEL_ALVO)}</table>`);
  cfg.sigma = resp200Json({ data: { package: "   ", expires_at: "2026-10-01T00:00:00-03:00" } });
  const r = await chamar(req({ corpo: { publicId: PUBLIC_ID, clienteNome: NOME_ALVO, telefone: TEL_ALVO } }));
  ok(r.json?.outcome === "pacote_vazio", "20: sigma/info package vazio -> pacote_vazio");
}
{
  // pagina !ok
  resetCfg();
  resetarFakeSupabase();
  cfg.pagina = respStatus(403, "forbidden");
  const r = await chamar(req({ corpo: { publicId: PUBLIC_ID, clienteNome: NOME_ALVO, telefone: TEL_ALVO } }));
  ok(r.json?.outcome === "unavailable" && r.json?.etapa === "pagina_cliente" && r.json?.status === 403, "21: pagina do cliente HTTP 403 -> unavailable etapa pagina_cliente status 403");
  const chamouSigma = chamadas.some((c) => c.url.includes("sigma/info/"));
  ok(!chamouSigma, "21: nao chega a chamar sigma/info se a pagina falhou");
}
{
  // pagina lanca
  resetCfg();
  resetarFakeSupabase();
  cfg.pagina = "throw";
  const r = await chamar(req({ corpo: { publicId: PUBLIC_ID, clienteNome: NOME_ALVO, telefone: TEL_ALVO } }));
  ok(r.json?.outcome === "unavailable" && r.json?.etapa === "pagina_cliente" && r.json?.status === 0, "22: fetch da pagina lanca -> unavailable etapa pagina_cliente status 0");
}

// ---------------------------------------------------------------------
// 23-24: fase "depois"
// ---------------------------------------------------------------------
{
  resetCfg();
  resetarFakeSupabase();
  cfg.sigma = resp200Json({ data: { package: "1 MES - X", expires_at: "2026-12-08T20:59:59-03:00" } });
  const r = await chamar(req({ corpo: { publicId: PUBLIC_ID, idClienteInterno: ID_INTERNO } }));
  ok(r.json?.outcome === "success" && r.json?.expiresAt === "2026-12-08T20:59:59-03:00", "23: depois -> success com expiresAt");
  ok(r.json?.sessaoValida === true, "23: sessaoValida = true");
  ok(r.json?.idClienteInterno === undefined && r.json?.pacoteAtual === undefined, "23: fase depois retorna so' sessaoValida + expiresAt");
  const chamouPagina = chamadas.some((c) => c.url.includes("/cliente/info/"));
  ok(!chamouPagina, "23: fase depois NUNCA faz o scrape da pagina (nenhum GET /cliente/info/)");
  semVazamento(r.txt, "23");
}
{
  resetCfg();
  resetarFakeSupabase();
  cfg.sigma = resp200Json({ data: { package: "", expires_at: null } });
  const r = await chamar(req({ corpo: { publicId: PUBLIC_ID, idClienteInterno: ID_INTERNO } }));
  ok(r.json?.outcome === "pacote_vazio", "24: depois com package vazio -> pacote_vazio");
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
