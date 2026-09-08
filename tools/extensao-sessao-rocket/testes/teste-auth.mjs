// Testes da LOGICA DE AUTENTICACAO (auth.js) -- sem credenciais reais,
// sem rede real: globalThis.fetch e globalThis.chrome sao stubs.
//
// Cobrem: entrar (sucesso / credenciais invalidas / erro de rede),
// renovacao automatica (fresco nao renova / expirado renova / refresh
// invalido limpa / refresh com erro de rede mantem stale), logout
// (com e sem sessao), e as INVARIANTES: nunca fala com a Edge Function,
// nunca envia sessionid/csrftoken, apikey sempre presente.
//
// Rodar:  node tools/extensao-sessao-rocket/testes/teste-auth.mjs

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config.js";

// --- fakes ---------------------------------------------------------------

function fakeChrome() {
  const store = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(chave) {
          return chave in store ? { [chave]: store[chave] } : {};
        },
        async set(obj) {
          Object.assign(store, obj);
        },
        async remove(chave) {
          delete store[chave];
        },
      },
    },
  };
  return {
    dump: () => ({ ...store }),
    seed: (chave, valor) => {
      store[chave] = valor;
    },
    limpo: () => Object.keys(store).length === 0,
  };
}

// rotas: array de [substringDaUrl, resposta]. resposta pode ser um
// Error (fetch lanca) ou { status, body }.
function fakeFetch(rotas) {
  const chamadas = [];
  globalThis.fetch = async (url, opts = {}) => {
    chamadas.push({
      url: String(url),
      method: opts.method,
      headers: opts.headers || {},
      body: opts.body,
    });
    for (const [padrao, resp] of rotas) {
      if (String(url).includes(padrao)) {
        if (resp instanceof Error) throw resp;
        return {
          ok: resp.status >= 200 && resp.status < 300,
          status: resp.status,
          async json() {
            return resp.body ?? {};
          },
        };
      }
    }
    throw new Error("rota nao mapeada no fake: " + url);
  };
  return chamadas;
}

// --- infra de assercao -------------------------------------------------

let falhas = 0;
function ok(cond, msg) {
  if (!cond) {
    falhas++;
    console.error(`FALHA: ${msg}`);
  } else {
    console.log(`ok: ${msg}`);
  }
}

// Reimporta auth.js "do zero" a cada caso (cache-buster) para nao
// carregar estado entre testes -- auth.js nao tem estado de modulo,
// mas assim fica explicito.
async function carregarAuth() {
  return import(`../auth.js?t=${Math.random()}`);
}

const EMAIL_FALSO = "operador@exemplo.test";
const CHAVE = "sessao_supabase";
const agoraS = () => Math.floor(Date.now() / 1000);

// Invariante global de qualquer bateria: nenhuma chamada para a Edge
// Function; nenhum corpo com sessionid/csrftoken; apikey sempre = anon.
function checarInvariantes(chamadas, ctx) {
  for (const c of chamadas) {
    ok(!c.url.includes("/functions/v1/"), `${ctx}: nao chama nenhuma Edge Function (${c.url})`);
    ok(c.url.startsWith(`${SUPABASE_URL}/auth/v1/`), `${ctx}: so' fala com /auth/v1/* (${c.url})`);
    const corpo = c.body || "";
    ok(!corpo.includes("sessionid") && !corpo.includes("csrftoken"), `${ctx}: corpo nunca contem sessionid/csrftoken`);
    ok(c.headers.apikey === SUPABASE_ANON_KEY, `${ctx}: header apikey === anon key publica`);
  }
}

// --- 1. entrar() sucesso --------------------------------------------------
{
  const chrome = fakeChrome();
  const chamadas = fakeFetch([
    [
      "grant_type=password",
      {
        status: 200,
        body: {
          access_token: "fake-access-1",
          refresh_token: "fake-refresh-1",
          expires_at: agoraS() + 3600,
          user: { email: EMAIL_FALSO },
        },
      },
    ],
  ]);
  const auth = await carregarAuth();

  const r = await auth.entrar(EMAIL_FALSO, "senha-de-teste");
  ok(r.ok === true && r.email === EMAIL_FALSO, "1: entrar sucesso -> { ok:true, email }");
  ok(!("access_token" in r) && !("refresh_token" in r), "1: retorno de entrar() NAO expoe tokens");

  const s = chrome.dump()[CHAVE];
  ok(
    s && s.access_token === "fake-access-1" && s.refresh_token === "fake-refresh-1" && s.email === EMAIL_FALSO,
    "1: sessao persistida em chrome.storage.local com tokens + email",
  );
  ok(!("password" in s) && !("senha" in s), "1: a senha NAO e' persistida");

  const c = chamadas[0];
  ok(c.url === `${SUPABASE_URL}/auth/v1/token?grant_type=password`, "1: chamou /auth/v1/token?grant_type=password");
  const corpo = JSON.parse(c.body);
  ok(corpo.email === EMAIL_FALSO && corpo.password === "senha-de-teste", "1: corpo = { email, password }");
  checarInvariantes(chamadas, "1");
}

// --- 2. entrar() credenciais invalidas (400) ---------------------------
{
  const chrome = fakeChrome();
  const chamadas = fakeFetch([
    [
      "grant_type=password",
      { status: 400, body: { error: "invalid_grant", error_description: "Invalid login credentials" } },
    ],
  ]);
  const auth = await carregarAuth();

  const r = await auth.entrar(EMAIL_FALSO, "errada");
  ok(r.ok === false && r.motivo === "credenciais_invalidas", "2: 400 -> { ok:false, motivo:'credenciais_invalidas' }");
  ok(!JSON.stringify(r).includes("Invalid login credentials"), "2: NAO vaza a mensagem de erro do GoTrue");
  ok(chrome.limpo(), "2: storage continua vazio apos falha");
  checarInvariantes(chamadas, "2");
}

// --- 3. entrar() erro de rede ----------------------------------------------
{
  const chrome = fakeChrome();
  fakeFetch([["grant_type=password", new Error("network down")]]);
  const auth = await carregarAuth();

  const r = await auth.entrar(EMAIL_FALSO, "x");
  ok(r.ok === false && r.motivo === "rede", "3: fetch lanca -> { ok:false, motivo:'rede' }");
  ok(chrome.limpo(), "3: storage continua vazio");
}

// --- 4. sessaoValida(): token fresco NAO renova -------------------------
{
  const chrome = fakeChrome();
  chrome.seed(CHAVE, {
    access_token: "a-fresco",
    refresh_token: "r-fresco",
    expires_at: agoraS() + 3600,
    email: EMAIL_FALSO,
  });
  const chamadas = fakeFetch([["grant_type=refresh_token", { status: 200, body: {} }]]);
  const auth = await carregarAuth();

  const s = await auth.sessaoValida();
  ok(s && s.access_token === "a-fresco", "4: token fresco -> devolve a sessao atual");
  ok(chamadas.length === 0, "4: nenhuma renovacao (rede nao foi tocada)");
}

// --- 5. sessaoValida(): token expirado -> renova automaticamente ------
{
  const chrome = fakeChrome();
  chrome.seed(CHAVE, {
    access_token: "a-velho",
    refresh_token: "r-velho",
    expires_at: agoraS() - 10,
    email: EMAIL_FALSO,
  });
  const chamadas = fakeFetch([
    [
      "grant_type=refresh_token",
      {
        status: 200,
        body: {
          access_token: "a-novo",
          refresh_token: "r-novo",
          expires_at: agoraS() + 3600,
          user: { email: EMAIL_FALSO },
        },
      },
    ],
  ]);
  const auth = await carregarAuth();

  const s = await auth.sessaoValida();
  ok(s && s.access_token === "a-novo" && s.refresh_token === "r-novo", "5: token expirado -> renovado automaticamente");
  ok(chrome.dump()[CHAVE].access_token === "a-novo", "5: storage atualizado com o par novo");
  const corpo = JSON.parse(chamadas[0].body);
  ok(corpo.refresh_token === "r-velho", "5: renovacao usou o refresh_token guardado");
  ok(chamadas[0].url.includes("grant_type=refresh_token"), "5: chamou o endpoint de refresh");
  checarInvariantes(chamadas, "5");
}

// --- 6. sessaoValida(): refresh invalido (400) -> limpa a sessao -----
{
  const chrome = fakeChrome();
  chrome.seed(CHAVE, {
    access_token: "a-velho",
    refresh_token: "r-revogado",
    expires_at: agoraS() - 10,
    email: EMAIL_FALSO,
  });
  fakeFetch([["grant_type=refresh_token", { status: 400, body: { error: "invalid_grant" } }]]);
  const auth = await carregarAuth();

  const s = await auth.sessaoValida();
  ok(s === null, "6: refresh_token revogado -> sessaoValida() devolve null");
  ok(chrome.limpo(), "6: storage LIMPO (nao adianta insistir num refresh invalido)");
}

// --- 7. sessaoValida(): refresh com erro de REDE -> mantem stale -----
{
  const chrome = fakeChrome();
  const stale = {
    access_token: "a-stale",
    refresh_token: "r-stale",
    expires_at: agoraS() - 10,
    email: EMAIL_FALSO,
  };
  chrome.seed(CHAVE, stale);
  fakeFetch([["grant_type=refresh_token", new Error("offline")]]);
  const auth = await carregarAuth();

  const s = await auth.sessaoValida();
  ok(s && s.access_token === "a-stale", "7: refresh falhou por rede -> devolve a sessao stale (nao null)");
  ok(chrome.dump()[CHAVE] && chrome.dump()[CHAVE].refresh_token === "r-stale", "7: storage PRESERVADO (tenta de novo depois)");
}

// --- 8. sair(): revoga + limpa ------------------------------------------
{
  const chrome = fakeChrome();
  chrome.seed(CHAVE, {
    access_token: "a-para-sair",
    refresh_token: "r-para-sair",
    expires_at: agoraS() + 3600,
    email: EMAIL_FALSO,
  });
  const chamadas = fakeFetch([["/auth/v1/logout", { status: 204, body: {} }]]);
  const auth = await carregarAuth();

  const r = await auth.sair();
  ok(r.ok === true, "8: sair() -> { ok:true }");
  ok(chrome.limpo(), "8: storage limpo apos logout");
  ok(chamadas.length === 1 && chamadas[0].url === `${SUPABASE_URL}/auth/v1/logout`, "8: chamou /auth/v1/logout");
  ok(chamadas[0].headers.Authorization === "Bearer a-para-sair", "8: logout enviou Authorization: Bearer <access_token>");
  ok(chamadas[0].headers.apikey === SUPABASE_ANON_KEY, "8: logout enviou apikey");
  checarInvariantes(chamadas, "8");
}

// --- 9. sair(): logout falha por rede -> AINDA limpa localmente -------
{
  const chrome = fakeChrome();
  chrome.seed(CHAVE, { access_token: "a", refresh_token: "r", expires_at: agoraS() + 3600, email: EMAIL_FALSO });
  fakeFetch([["/auth/v1/logout", new Error("offline")]]);
  const auth = await carregarAuth();

  const r = await auth.sair();
  ok(r.ok === true && chrome.limpo(), "9: logout com erro de rede -> storage limpo mesmo assim (best-effort)");
}

// --- 10. sair(): sem sessao -> idempotente, sem rede ------------------
{
  const chrome = fakeChrome();
  const chamadas = fakeFetch([["/auth/v1/logout", { status: 204, body: {} }]]);
  const auth = await carregarAuth();

  const r = await auth.sair();
  ok(r.ok === true && chrome.limpo(), "10: sair() sem sessao -> ok, storage vazio");
  ok(chamadas.length === 0, "10: sem sessao -> nenhuma chamada de rede");
}

// --- 11. lerSessao(): sem nada -> null --------------------------------
{
  fakeChrome();
  fakeFetch([]);
  const auth = await carregarAuth();
  ok((await auth.lerSessao()) === null, "11: lerSessao() sem storage -> null");
  ok((await auth.sessaoValida()) === null, "11: sessaoValida() sem storage -> null");
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
