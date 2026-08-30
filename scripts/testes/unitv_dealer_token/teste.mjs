// Testes locais de supabase/functions/_shared/unitv_dealer_token.ts (REAL)
// -- Fase 2A da autocura do UNITV_DEALER_TOKEN (2026-08-30).
//
// obterDealerToken(): Vault (RPC unitv_dealer_token_ler) -> fallback
// Edge secret UNITV_DEALER_TOKEN. Cache em memoria de 30s. NUNCA loga
// o valor.
//
// supabase_client.ts e' stub (mock-loader). `supa`/`env`/`agora` sao
// injetados via opts.
//
// Regras que estes testes travam:
//   1. Vault valido VENCE o secret.
//   2. Vault vazio / whitespace -> fallback do secret.
//   3. Vault indisponivel (rpc lanca) -> fallback do secret.
//   4. Vault vazio + secret vazio -> "".
//   5. Cache de 30s (nao repete a RPC); expira; ignoravel; limpavel.
//   6. O valor do token NUNCA aparece em console.log.
//   7. Caminho de sucesso do Vault e' silencioso (sem log).
//
// Como rodar: npx tsx scripts/testes/unitv_dealer_token/teste.mjs

import { register } from "node:module";
register("./mock-loader.mjs", import.meta.url);

globalThis.Deno = { env: { get: () => undefined } };

const mod = await import("../../../supabase/functions/_shared/unitv_dealer_token.ts");
const { obterDealerToken, limparCacheDealerToken } = mod;

let falhas = 0;
function ok(cond, msg) {
  if (!cond) { falhas++; console.error(`FALHA: ${msg}`); }
  else console.log(`ok: ${msg}`);
}

const TKN_VAULT = "tkn-vault-vivo-abc123";
const TKN_SECRET = "tkn-secret-bootstrap-xyz789";

function fakeSupa({ data, throwRpc } = {}) {
  let calls = 0;
  return {
    get calls() { return calls; },
    rpc: async (_nome) => {
      calls++;
      if (throwRpc) throw new Error("rpc unitv_dealer_token_ler falhou (fake)");
      return { data };
    },
  };
}
const envCom = (secret) => (n) => (n === "UNITV_DEALER_TOKEN" ? secret : undefined);
function relogio(t0 = 1000) {
  let t = t0;
  return { agora: () => t, avancar: (ms) => { t += ms; } };
}

// captura de console.log
let logs = [];
const logOrig = console.log;
function capturar() { logs = []; console.log = (...a) => logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); }
function parar() { console.log = logOrig; }

async function chamar(opts) {
  capturar();
  try { return await obterDealerToken(opts); }
  finally { parar(); }
}

// =====================================================================
// 1. Vault valido VENCE o secret
// =====================================================================
{
  limparCacheDealerToken();
  const rel = relogio();
  const supa = fakeSupa({ data: TKN_VAULT });
  const v = await chamar({ supa, env: envCom(TKN_SECRET), agora: rel.agora });
  ok(v === TKN_VAULT, "1: Vault valido -> retorna o valor do Vault, nao o secret");
  ok(!logs.join("\n").includes("fallback"), "1: caminho de sucesso do Vault e' silencioso");
}

// =====================================================================
// 2. Vault vazio -> fallback do secret
// =====================================================================
{
  limparCacheDealerToken();
  const rel = relogio();
  for (const vazio of [null, "", "   ", undefined]) {
    limparCacheDealerToken();
    const supa = fakeSupa({ data: vazio });
    const v = await chamar({ supa, env: envCom(TKN_SECRET), agora: rel.agora });
    ok(v === TKN_SECRET, `2: Vault data=${JSON.stringify(vazio)} -> fallback do secret`);
  }
}

// =====================================================================
// 3. Vault indisponivel (rpc lanca) -> fallback do secret
// =====================================================================
{
  limparCacheDealerToken();
  const rel = relogio();
  const supa = fakeSupa({ throwRpc: true });
  const v = await chamar({ supa, env: envCom(TKN_SECRET), agora: rel.agora });
  ok(v === TKN_SECRET, "3: Vault rpc lanca -> fallback do secret");
}

// =====================================================================
// 4. Vault vazio + secret vazio -> ""
// =====================================================================
{
  limparCacheDealerToken();
  const rel = relogio();
  const supa = fakeSupa({ data: "" });
  const v = await chamar({ supa, env: () => undefined, agora: rel.agora });
  ok(v === "", "4: Vault vazio + secret ausente -> string vazia");
}

// =====================================================================
// 5. data como array (branch defensivo de 'returns table')
// =====================================================================
{
  limparCacheDealerToken();
  const rel = relogio();
  const supa = fakeSupa({ data: [TKN_VAULT] });
  const v = await chamar({ supa, env: envCom(TKN_SECRET), agora: rel.agora });
  ok(v === TKN_VAULT, "5: data como array -> primeiro elemento");
}

// =====================================================================
// 6. Cache de 30s -- nao repete a RPC
// =====================================================================
{
  limparCacheDealerToken();
  const rel = relogio();
  const supa = fakeSupa({ data: TKN_VAULT });
  await obterDealerToken({ supa, env: envCom(TKN_SECRET), agora: rel.agora });
  rel.avancar(29_000);
  const v2 = await obterDealerToken({ supa, env: envCom(TKN_SECRET), agora: rel.agora });
  ok(v2 === TKN_VAULT && supa.calls === 1, "6: dentro de 30s -> cache hit, RPC nao repetida (calls=1)");
  rel.avancar(2_000); // total 31s
  const v3 = await obterDealerToken({ supa, env: envCom(TKN_SECRET), agora: rel.agora });
  ok(v3 === TKN_VAULT && supa.calls === 2, "6: apos 30s -> cache expira, RPC repetida (calls=2)");
}
{
  limparCacheDealerToken();
  const rel = relogio();
  const supa = fakeSupa({ data: TKN_VAULT });
  await obterDealerToken({ supa, env: envCom(TKN_SECRET), agora: rel.agora });
  await obterDealerToken({ supa, env: envCom(TKN_SECRET), agora: rel.agora, ignorarCache: true });
  ok(supa.calls === 2, "6b: ignorarCache=true -> RPC sempre repetida");
  limparCacheDealerToken();
  await obterDealerToken({ supa, env: envCom(TKN_SECRET), agora: rel.agora });
  ok(supa.calls === 3, "6c: limparCacheDealerToken() -> proxima chamada re-consulta");
}

// =====================================================================
// 7. NENHUM VAZAMENTO -- valor nunca em console.log
// =====================================================================
{
  limparCacheDealerToken();
  const rel = relogio();
  // caminho de fallback (loga status) + caminho de sucesso (silencioso)
  const supaFallback = fakeSupa({ throwRpc: true });
  await chamar({ supa: supaFallback, env: envCom(TKN_SECRET), agora: rel.agora });
  const blobFallback = logs.join("\n");
  limparCacheDealerToken();
  const supaOk = fakeSupa({ data: TKN_VAULT });
  await chamar({ supa: supaOk, env: envCom(TKN_SECRET), agora: rel.agora });
  const blobOk = logs.join("\n");

  ok(!blobFallback.includes(TKN_SECRET) && !blobFallback.includes(TKN_VAULT), "7: fallback loga status, NUNCA o valor do token");
  ok(blobFallback.includes("vault indisponivel/vazio -> fallback"), "7: fallback loga a frase de status esperada");
  ok(blobOk === "" , "7: sucesso do Vault nao produz nenhum log");
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
