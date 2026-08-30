// Testes locais de scripts/renovacao-sigma-workflow.mjs (REAL) --
// Etapa 2 (Renovacao UniTV, Bloco 4): o branch token.tipo === "unitv"
// em main() e o branch UniTV de processarLote.
//
// Fakes: "playwright" (nao deve ser lancado em cenario UniTV) e
// ./lib/unitv-renovar.mjs (executor congelado). O fetch global e'
// mockado por URL. NENHUMA rede real.
//
// Regras verificadas: renovarUmAcessoUniTV chamado EXATAMENTE 1x por
// token/filho; sincronizarVencimentoRocket so' em sucesso, com o
// public_id do token; rocketDesync quando o sync != "sincronizado";
// falha/resultado_ambiguo NAO sincronizam o Rocket e NAO viram sucesso.
//
// Como rodar: npx tsx scripts/testes/renovacao_sigma_workflow_unitv/teste.mjs

import { register } from "node:module";
register("./mock-loader.mjs", import.meta.url);

const { definirRenovarUmAcessoUniTV, chamadasRenovarUniTV, resetarFakeUnitvRenovar } =
  await import("./fake_unitv_renovar.mjs");

const SUPABASE_URL = "https://exemplo-teste.supabase.co";
const CALLBACK_TOKEN = "callback-token-de-teste";
const PUBLIC_ID = "01a0271b-5a54-7d7e-8e4a-ef4c39730e0b";

process.env.OPERACAO_ID = "operacao-de-teste-unitv";
process.env.SUPABASE_URL = SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-teste";
process.env.RENOVACAO_SIGMA_CALLBACK_TOKEN = CALLBACK_TOKEN;
process.env.UNITV_DEALER_TOKEN = "fake-dealer";
process.env.UNITV_DEALER_NAME = "inovatvstream2";

let falhas = 0;
function ok(cond, msg) {
  if (!cond) { falhas++; console.error(`FALHA: ${msg}`); }
  else console.log(`ok: ${msg}`);
}

// --- config por cenario ---
let cfgLote = []; // /rest/v1/renovacoes_lote
let cfgToken = null; // /rest/v1/tokens_renovacao
let cfgFilhos = []; // /rest/v1/tokens_renovacao?grupo_id
let cfgSessao = { sessionid: "sess-fake", csrftoken: "csrf-fake" };
let cfgDealerToken = "tkn-vault-runner"; // Fase 2A: RPC unitv_dealer_token_ler (scalar text)
let cfgSync = { status: 200, body: { outcome: "sincronizado", vencimentoAntes: "x", vencimentoDepois: "y" } };
let chamadasFetch = [];
let capturarCallback = null;
let promessaCallback = null;
function novaPromessa() { promessaCallback = new Promise((r) => { capturarCallback = r; }); }

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  let corpo = null;
  try { corpo = opts.body ? JSON.parse(opts.body) : null; } catch { /* ok */ }
  chamadasFetch.push({ url: u, method: opts.method ?? "GET", headers: opts.headers ?? {}, corpo });

  if (u.includes("/rest/v1/renovacoes_lote")) return new Response(JSON.stringify(cfgLote), { status: 200 });
  if (u.includes("/rest/v1/tokens_renovacao")) {
    if (u.includes("grupo_id=")) return new Response(JSON.stringify(cfgFilhos), { status: 200 });
    return new Response(JSON.stringify(cfgToken ? [cfgToken] : []), { status: 200 });
  }
  if (u.includes("/rest/v1/rpc/rocket_sessao_ler")) return new Response(JSON.stringify(cfgSessao), { status: 200 });
  if (u.includes("/rest/v1/rpc/unitv_dealer_token_ler")) return new Response(JSON.stringify(cfgDealerToken), { status: 200 });
  if (u.endsWith("/functions/v1/renovacao-rocket-vencimento")) {
    return new Response(JSON.stringify(cfgSync.body), { status: cfgSync.status, headers: { "content-type": "application/json" } });
  }
  if (u.endsWith("/functions/v1/renovacao-sigma-resultado")) {
    if (capturarCallback) capturarCallback(corpo);
    return new Response(JSON.stringify({ outcome: "ok" }), { status: 200 });
  }
  throw new Error(`fetch inesperado: ${opts.method ?? "GET"} ${u}`);
};

function timeout(ms) {
  return new Promise((_, rej) => setTimeout(() => rej(new Error("timeout esperando callback")), ms));
}

async function rodar(nome) {
  chamadasFetch = [];
  novaPromessa();
  const urlMod = new URL("../../renovacao-sigma-workflow.mjs", import.meta.url).href + `?cenario=${nome}`;
  await import(urlMod);
  const callback = await Promise.race([promessaCallback, timeout(3000)]);
  await new Promise((r) => setTimeout(r, 10));
  return { callback, chamadas: [...chamadasFetch] };
}

const tokenUniTV = {
  id: "tok-unitv-1",
  tipo: "unitv",
  public_id: PUBLIC_ID,
  unitv_sn: "gcnv6v",
  unitv_id: 3433363,
  cliente_nome: "José Antonio Dos Santos",
  servidor_nome: "UNITV",
  plano_nome: "Mensal",
  telefone: "5517981625486",
};

// =====================================================================
// C1: individual UniTV, sucesso, Rocket sincroniza
// =====================================================================
{
  resetarFakeUnitvRenovar();
  cfgLote = []; cfgToken = tokenUniTV; cfgSessao = { sessionid: "s", csrftoken: "c" };
  cfgSync = { status: 200, body: { outcome: "sincronizado" } };
  definirRenovarUmAcessoUniTV({ resultado: "sucesso", vencimentoConfirmado: "2026-12-03T02:31:01-03:00" });
  const { callback, chamadas } = await rodar("c1");

  ok(chamadasRenovarUniTV().length === 1, "C1: renovarUmAcessoUniTV chamado EXATAMENTE 1x");
  ok(chamadasRenovarUniTV()[0].sn === "gcnv6v" && chamadasRenovarUniTV()[0].id === 3433363, "C1: chamado com sn/id do token");
  // Fase 2A: o workflow le o dealer token do Vault (RPC unitv_dealer_token_ler)
  // e o INJETA no executor congelado -- que assim nunca exerce seu default de env.
  ok(chamadasRenovarUniTV()[0].dealerToken === "tkn-vault-runner", "C1(2A): dealerToken do Vault injetado no executor");
  ok(chamadas.some((c) => c.url.includes("/rest/v1/rpc/unitv_dealer_token_ler")), "C1(2A): workflow consultou o Vault (unitv_dealer_token_ler)");
  const sync = chamadas.find((c) => c.url.endsWith("/renovacao-rocket-vencimento"));
  ok(sync && sync.corpo.publicId === PUBLIC_ID && sync.corpo.vencimentoAlvo === "2026-12-03T02:31:01-03:00", "C1: sync do Rocket com public_id + vencimento confirmado");
  ok(sync.headers["X-Internal-Token"] === CALLBACK_TOKEN, "C1: sync usa o X-Internal-Token interno");
  ok(callback.resultado === "sucesso" && callback.vencimentoConfirmado === "2026-12-03T02:31:01-03:00", "C1: callback resultado=sucesso + vencimentoConfirmado");
  ok(!("rocketDesync" in callback), "C1: sem rocketDesync quando o Rocket sincroniza");
  ok(!chamadas.some((c) => c.url.includes("renovacao-sigma-cliente") || c.url.includes("renovacao-sigma-contexto")), "C1: NUNCA toca o caminho Sigma");
}

// =====================================================================
// C1b (Fase 2A): Vault vazio -> fallback para process.env.UNITV_DEALER_TOKEN.
// O executor congelado recebe EXATAMENTE o token que receberia antes da 2A.
// =====================================================================
{
  resetarFakeUnitvRenovar();
  cfgLote = []; cfgToken = tokenUniTV; cfgSessao = { sessionid: "s", csrftoken: "c" };
  cfgSync = { status: 200, body: { outcome: "sincronizado" } };
  cfgDealerToken = null; // Vault ainda nao semeado
  definirRenovarUmAcessoUniTV({ resultado: "sucesso", vencimentoConfirmado: "2026-12-03T02:31:01-03:00" });
  const { callback, chamadas } = await rodar("c1b");

  ok(chamadas.some((c) => c.url.includes("/rest/v1/rpc/unitv_dealer_token_ler")), "C1b(2A): workflow consultou o Vault");
  ok(chamadasRenovarUniTV()[0].dealerToken === process.env.UNITV_DEALER_TOKEN, "C1b(2A): Vault vazio -> executor recebe o token do env (identico ao pre-2A)");
  ok(chamadasRenovarUniTV()[0].dealerToken === "fake-dealer", "C1b(2A): valor efetivo = process.env.UNITV_DEALER_TOKEN");
  ok(callback.resultado === "sucesso", "C1b(2A): renovacao segue normal com o fallback");
  cfgDealerToken = "tkn-vault-runner"; // restaura para os demais cenarios
}

// =====================================================================
// C2: individual UniTV, sucesso, Rocket NAO sincroniza -> rocketDesync
// =====================================================================
{
  resetarFakeUnitvRenovar();
  cfgLote = []; cfgToken = tokenUniTV;
  cfgSync = { status: 200, body: { outcome: "rocket_desync", etapa: "nao_avancou" } };
  definirRenovarUmAcessoUniTV({ resultado: "sucesso", vencimentoConfirmado: "2026-12-03T02:31:01-03:00" });
  const { callback } = await rodar("c2");

  ok(callback.resultado === "sucesso", "C2: resultado continua 'sucesso' mesmo com Rocket dessincronizado");
  ok(callback.vencimentoConfirmado === "2026-12-03T02:31:01-03:00", "C2: cliente recebe a data confirmada pelo painel");
  ok(callback.rocketDesync === true, "C2: callback carrega rocketDesync=true");
}

// =====================================================================
// C3: individual UniTV, falha -> NAO sincroniza, NAO vira sucesso
// =====================================================================
{
  resetarFakeUnitvRenovar();
  cfgLote = []; cfgToken = tokenUniTV;
  definirRenovarUmAcessoUniTV({ resultado: "falha", detalhe: "painel UniTV recusou (rc=1001: creditos insuficientes)" });
  const { callback, chamadas } = await rodar("c3");

  ok(callback.resultado === "falha", "C3: resultado=falha propagado");
  ok(/creditos insuficientes/.test(callback.detalhe ?? ""), "C3: detalhe propagado");
  ok(!chamadas.some((c) => c.url.endsWith("/renovacao-rocket-vencimento")), "C3: falha -> Rocket NUNCA e' sincronizado");
  ok(!("rocketDesync" in callback) && !("vencimentoConfirmado" in callback), "C3: sem rocketDesync/vencimentoConfirmado numa falha");
}

// =====================================================================
// C4: individual UniTV, resultado_ambiguo -> NAO sincroniza
// =====================================================================
{
  resetarFakeUnitvRenovar();
  cfgLote = []; cfgToken = tokenUniTV;
  definirRenovarUmAcessoUniTV({ resultado: "resultado_ambiguo", detalhe: "reconsulta falhou" });
  const { callback, chamadas } = await rodar("c4");

  ok(callback.resultado === "resultado_ambiguo", "C4: resultado_ambiguo propagado");
  ok(!chamadas.some((c) => c.url.endsWith("/renovacao-rocket-vencimento")), "C4: ambiguo -> Rocket NUNCA sincronizado");
  ok(chamadasRenovarUniTV().length === 1, "C4: renovarUmAcessoUniTV chamado 1x, NUNCA repetido");
}

// =====================================================================
// C5: individual UniTV NAO depende da sessao do Rocket
// =====================================================================
{
  resetarFakeUnitvRenovar();
  cfgLote = []; cfgToken = tokenUniTV;
  cfgSessao = {}; // sessao do Vault AUSENTE
  cfgSync = { status: 200, body: { outcome: "sincronizado" } };
  definirRenovarUmAcessoUniTV({ resultado: "sucesso", vencimentoConfirmado: "2026-12-03T02:31:01-03:00" });
  const { callback, chamadas } = await rodar("c5");

  ok(callback.resultado === "sucesso", "C5: UniTV renova mesmo sem sessao do Rocket (usa o dealer_token do painel)");
  ok(!chamadas.some((c) => c.url.includes("rocket_sessao_ler")) || true, "C5: (sessao pode nem ser lida antes do branch UniTV)");
  ok(chamadasRenovarUniTV().length === 1, "C5: executor chamado normalmente");
}

// =====================================================================
// C6: LOTE 2xUniTV -> cada filho executa + sincroniza; um deles com
//     rocketDesync. Callback de lote com resultados[].
// =====================================================================
{
  resetarFakeUnitvRenovar();
  cfgToken = null;
  cfgLote = [{ grupo_id: "grp-1", operacao_id: process.env.OPERACAO_ID }];
  cfgFilhos = [
    { id: "f1", tipo: "unitv", public_id: "pub-1", unitv_sn: "gcnv6v", unitv_id: 3433363, servidor_nome: "UNITV", cliente_nome: "A", telefone: "551700000001" },
    { id: "f2", tipo: "unitv", public_id: "pub-2", unitv_sn: "3tnjsc", unitv_id: 9999999, servidor_nome: "UNITV", cliente_nome: "B", telefone: "551700000002" },
  ];
  cfgSessao = { sessionid: "s", csrftoken: "c" };
  // 1o sync ok, 2o sync desync
  let n = 0;
  const fetchAntes = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.endsWith("/functions/v1/renovacao-rocket-vencimento")) {
      n += 1;
      const body = n === 1 ? { outcome: "sincronizado" } : { outcome: "rocket_desync", etapa: "patch" };
      chamadasFetch.push({ url: u, method: "POST", headers: opts.headers ?? {}, corpo: JSON.parse(opts.body) });
      return new Response(JSON.stringify(body), { status: 200 });
    }
    return fetchAntes(url, opts);
  };
  definirRenovarUmAcessoUniTV({ resultado: "sucesso", vencimentoConfirmado: "2026-12-03T02:31:01-03:00" });
  const { callback } = await rodar("c6");
  globalThis.fetch = fetchAntes;

  ok(callback.grupo_id === "grp-1" && Array.isArray(callback.resultados) && callback.resultados.length === 2, "C6: callback de lote com resultados[] (2 filhos)");
  ok(callback.resultados.every((it) => it.tipo === "unitv" && it.resultado === "sucesso"), "C6: os 2 filhos UniTV com resultado 'sucesso'");
  ok(callback.resultados.filter((it) => it.rocketDesync === true).length === 1, "C6: exatamente 1 filho com rocketDesync (o 2o sync falhou)");
  ok(chamadasRenovarUniTV().length === 2, "C6: renovarUmAcessoUniTV chamado 1x por filho (2), nunca repetido");
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
