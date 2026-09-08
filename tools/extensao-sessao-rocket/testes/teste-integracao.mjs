// Testes de enviarSessaoParaRocket() (integracao.js, etapa 2B) --
// fetch / chrome.cookies / chrome.storage STUBADOS. Sem cookies reais,
// sem rede real, sem envio a producao.
//
// Cobre: 2 cookies presentes -> POST correto; cookie ausente -> sem
// POST; operador nao autenticado -> sem POST; operador nao autorizado
// -> sem POST; nenhum valor de cookie/token em saida/log/storage; URL,
// metodo e headers corretos; sessionid/csrftoken so' no corpo real.
//
// Rodar: node tools/extensao-sessao-rocket/testes/teste-integracao.mjs

import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  OPERADOR_AUTORIZADO_EMAIL,
} from "../config.js";

const SID = "SID-VALOR-SECRETO-DO-COOKIE";
const CSRF = "CSRF-VALOR-SECRETO-DO-COOKIE";
const ACCESS = "ACCESS-TOKEN-SUPABASE-SECRETO";
const CHAVE = "sessao_supabase";
const URL_EF = `${SUPABASE_URL}/functions/v1/atualizar-sessao-rocket`;
const agoraS = () => Math.floor(Date.now() / 1000);

let falhas = 0;
const ok = (c, m) => (c ? console.log("ok: " + m) : (falhas++, console.error("FALHA: " + m)));

// captura de console para provar que nada sensivel e' logado
const logCap = [];
for (const k of ["log", "error", "warn", "info", "debug"]) {
  const orig = console[k].bind(console);
  console[k] = (...a) => {
    logCap.push(a.map(String).join(" "));
    orig(...a);
  };
}

function stubAmbiente({ sessao, cookies }) {
  const store = {};
  if (sessao) store[CHAVE] = sessao;
  globalThis.chrome = {
    storage: {
      local: {
        async get(k) {
          return k in store ? { [k]: store[k] } : {};
        },
        async set(o) {
          Object.assign(store, o);
        },
        async remove(k) {
          delete store[k];
        },
      },
    },
    cookies: {
      async get({ url, name }) {
        if (url !== "https://app.rocketgestor.com/") throw new Error("url errada: " + url);
        return Object.prototype.hasOwnProperty.call(cookies, name) ? cookies[name] : null;
      },
    },
  };
  const chamadas = [];
  globalThis.fetch = async (u, opts = {}) => {
    chamadas.push({ url: String(u), method: opts.method, headers: opts.headers || {}, body: opts.body });
    if (String(u).includes("/auth/v1/")) {
      throw new Error("nao deveria renovar (sessao seedada fresca)");
    }
    return { ok: true, status: 200, async json() {
      return { outcome: "atualizada", sessaoValidada: true };
    } };
  };
  return { chamadas, dump: () => ({ ...store }) };
}

async function carregar() {
  return import(`../integracao.js?t=${Math.random()}`);
}

// Cookies do Rocket (SID/CSRF): SO' podem aparecer no corpo da
// requisicao real -- nunca em header, url, storage, log ou retorno.
function semCookiesRocket(str, ctx) {
  ok(!str.includes(SID) && !str.includes(CSRF), `${ctx}: sem valor de cookie do Rocket`);
}
// Access token Supabase: legitimo no header Authorization e no storage
// da sessao Supabase; PROIBIDO em log e no retorno da funcao.
function semAccessToken(str, ctx) {
  ok(!str.includes(ACCESS), `${ctx}: sem access token`);
}

const sessaoOperador = {
  access_token: ACCESS,
  refresh_token: "R",
  expires_at: agoraS() + 3600,
  email: OPERADOR_AUTORIZADO_EMAIL,
};

// === 1. dois cookies presentes -> POST correto ===
{
  logCap.length = 0;
  const env = stubAmbiente({
    sessao: sessaoOperador,
    cookies: { sessionid: { value: SID }, csrftoken: { value: CSRF } },
  });
  const { enviarSessaoParaRocket } = await carregar();
  const r = await enviarSessaoParaRocket();

  ok(r.ok === true && r.resultado === "sessao_atualizada_validada", "1: resultado seguro 'sessao_atualizada_validada'");
  ok(env.chamadas.length === 1, "1: exatamente 1 POST");
  const c = env.chamadas[0];
  ok(c.url === URL_EF, "1: URL = " + URL_EF);
  ok(c.method === "POST", "1: metodo POST");
  ok(c.headers.Authorization === `Bearer ${ACCESS}`, "1: header Authorization: Bearer <access token do operador>");
  ok(c.headers.apikey === SUPABASE_ANON_KEY, "1: header apikey = anon key publica");
  ok(c.headers["Content-Type"] === "application/json", "1: Content-Type application/json");
  const corpo = JSON.parse(c.body);
  ok(corpo.sessionid === SID && corpo.csrftoken === CSRF, "1: corpo = { sessionid, csrftoken } com os valores reais");
  ok(Object.keys(corpo).sort().join(",") === "csrftoken,sessionid", "1: corpo NAO leva mais nada");

  // cookies do Rocket so' no corpo -- nunca em header/url/storage/log/retorno
  semCookiesRocket(JSON.stringify({ url: c.url, headers: c.headers }), "1(headers/url)");
  semCookiesRocket(JSON.stringify(env.dump()), "1(storage)");
  semCookiesRocket(logCap.join("\n"), "1(console)");
  semCookiesRocket(JSON.stringify(r), "1(retorno)");
  // access token: ok no header Authorization; proibido em log e retorno
  semAccessToken(logCap.join("\n"), "1(console)");
  semAccessToken(JSON.stringify(r), "1(retorno)");
  ok(Object.keys(env.dump()).join(",") === CHAVE, "1: storage inalterado (so' a sessao Supabase; cookies do Rocket NAO armazenados)");
}

// === 2. cookie ausente -> nenhum POST ===
for (const [faltaNome, cookies] of [
  ["sessionid", { csrftoken: { value: CSRF } }],
  ["csrftoken", { sessionid: { value: SID } }],
  ["ambos", {}],
]) {
  const env = stubAmbiente({ sessao: sessaoOperador, cookies });
  const { enviarSessaoParaRocket } = await carregar();
  const r = await enviarSessaoParaRocket();
  ok(r.ok === false && r.resultado === "cookie_faltando", `2(${faltaNome}): resultado 'cookie_faltando'`);
  ok(env.chamadas.length === 0, `2(${faltaNome}): NENHUM POST`);
  ok(Array.isArray(r.faltando) && r.faltando.length >= 1, `2(${faltaNome}): 'faltando' lista nomes`);
}

// === 3. operador nao autenticado -> nenhum POST ===
{
  const env = stubAmbiente({ sessao: null, cookies: { sessionid: { value: SID }, csrftoken: { value: CSRF } } });
  const { enviarSessaoParaRocket } = await carregar();
  const r = await enviarSessaoParaRocket();
  ok(r.ok === false && r.resultado === "sem_operador", "3: sem sessao -> 'sem_operador'");
  ok(env.chamadas.length === 0, "3: NENHUM POST sem operador");
}

// === 4. operador nao autorizado -> nenhum POST ===
{
  const env = stubAmbiente({
    sessao: { ...sessaoOperador, email: "intruso@outro.test" },
    cookies: { sessionid: { value: SID }, csrftoken: { value: CSRF } },
  });
  const { enviarSessaoParaRocket } = await carregar();
  const r = await enviarSessaoParaRocket();
  ok(r.ok === false && r.resultado === "sem_operador", "4: e-mail nao autorizado -> 'sem_operador'");
  ok(env.chamadas.length === 0, "4: NENHUM POST com operador nao autorizado");
}

// === 5. 401 do servidor -> resultado seguro, sem detalhe ===
{
  const env = stubAmbiente({ sessao: sessaoOperador, cookies: { sessionid: { value: SID }, csrftoken: { value: CSRF } } });
  globalThis.fetch = async () => ({ ok: false, status: 401, async json() {
    return { outcome: "error", message: "Nao autorizado" };
  } });
  env.chamadas.length = 0;
  const { enviarSessaoParaRocket } = await carregar();
  const r = await enviarSessaoParaRocket();
  ok(r.ok === false && r.resultado === "nao_autorizado_servidor", "5: 401 -> 'nao_autorizado_servidor'");
}

// === 6. erro de rede -> resultado 'erro' generico ===
{
  const env = stubAmbiente({ sessao: sessaoOperador, cookies: { sessionid: { value: SID }, csrftoken: { value: CSRF } } });
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  const { enviarSessaoParaRocket } = await carregar();
  const r = await enviarSessaoParaRocket();
  ok(r.ok === false && r.resultado === "erro", "6: fetch lanca -> 'erro' generico");
  semCookiesRocket(JSON.stringify(r), "6(retorno)");
  semAccessToken(JSON.stringify(r), "6(retorno)");
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
