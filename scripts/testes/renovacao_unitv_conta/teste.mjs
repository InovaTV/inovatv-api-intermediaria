// Testes locais de supabase/functions/renovacao-unitv-conta/index.ts
// (REAL). Fake: _shared/unitv_conta.ts. _shared/http.ts real.
//
// Etapa 2 (Renovacao UniTV, Bloco 3). Resolucao interna da conta UniTV
// (id do painel) a partir do sn, chamada pelo Orquestrador ANTES de
// criar token/cobranca. NUNCA chama /renew.
//
// Como rodar: npx tsx scripts/testes/renovacao_unitv_conta/teste.mjs

import { register } from "node:module";
register("./mock-loader.mjs", import.meta.url);

const { definirResultado, chamadasRegistradas, resetarFake } = await import("./fake_unitv_conta.mjs");

const TOKEN_VALIDO = "token-interno-renovacao-longo";

let handler;
globalThis.Deno = {
  serve: (fn) => { handler = fn; },
  env: { get: (n) => (n === "RENOVACAO_SIGMA_CALLBACK_TOKEN" ? TOKEN_VALIDO : undefined) },
};

await import("../../../supabase/functions/renovacao-unitv-conta/index.ts");

let falhas = 0;
function ok(cond, msg) {
  if (!cond) { falhas++; console.error(`FALHA: ${msg}`); }
  else console.log(`ok: ${msg}`);
}

function req({ method = "POST", token = TOKEN_VALIDO, corpo = { sn: "gcnv6v" }, corpoBruto } = {}) {
  const headers = {};
  if (token !== null) headers["X-Internal-Token"] = token;
  const semCorpo = method === "GET" || method === "HEAD";
  if (!semCorpo && (corpo !== undefined || corpoBruto !== undefined)) headers["Content-Type"] = "application/json";
  return new Request("https://x.test/renovacao-unitv-conta", {
    method, headers,
    body: semCorpo ? undefined : (corpoBruto !== undefined ? corpoBruto : (corpo !== undefined ? JSON.stringify(corpo) : undefined)),
  });
}
const corpoJson = (r) => r.json().catch(() => null);

// --- auth / metodo / validacao ---
{
  resetarFake();
  const r = await handler(req({ token: null }));
  ok(r.status === 401, "sem token -> 401");
  ok(chamadasRegistradas().length === 0, "sem token -> resolverContaUnitv nunca chamado");
}
{
  resetarFake();
  ok((await handler(req({ token: "errado" }))).status === 401, "token errado -> 401");
  ok(chamadasRegistradas().length === 0, "token errado -> resolvedor nunca chamado");
}
{
  resetarFake();
  ok((await handler(req({ method: "GET" }))).status === 405, "GET -> 405");
}
{
  resetarFake();
  ok((await handler(req({ corpo: undefined, corpoBruto: "{ nao json" }))).status === 400, "JSON invalido -> 400");
  ok(chamadasRegistradas().length === 0, "JSON invalido -> resolvedor nunca chamado");
}
{
  resetarFake();
  ok((await handler(req({ corpo: {} }))).status === 400, "sn ausente -> 400");
  ok((await handler(req({ corpo: { sn: "   " } }))).status === 400, "sn em branco -> 400");
  ok((await handler(req({ corpo: { sn: 12345 } }))).status === 400, "sn nao-string -> 400");
  ok((await handler(req({ corpo: { sn: "x".repeat(65) } }))).status === 400, "sn > 64 chars -> 400");
  ok(chamadasRegistradas().length === 0, "validacao de sn falhou -> resolvedor nunca chamado");
}

// --- mapeamento de resultado ---
{
  resetarFake();
  definirResultado({ ok: true, id: 3433363, sn: "gcnv6v", expireTimeRaw: "2026-11-03 02:31:01", customer: "UniTV" });
  const r = await handler(req());
  const body = await corpoJson(r);
  ok(r.status === 200 && body.outcome === "resolvido" && body.id === 3433363 && body.sn === "gcnv6v", "ok -> {outcome:'resolvido', id, sn}");
  ok(Object.keys(body).sort().join(",") === "id,outcome,sn", "resolvido -> resposta tem EXATAMENTE outcome/id/sn (nada de dealer_token/expireTime/customer)");
  ok(chamadasRegistradas()[0].sn === "gcnv6v", "sn (trimado) repassado ao resolvedor");
}
{
  resetarFake();
  definirResultado({ ok: false, reason: "nao_encontrado" });
  ok((await corpoJson(await handler(req()))).outcome === "nao_encontrado", "nao_encontrado -> outcome nao_encontrado");
}
{
  resetarFake();
  definirResultado({ ok: false, reason: "customer_inesperado" });
  ok((await corpoJson(await handler(req()))).outcome === "nao_encontrado", "customer_inesperado -> outcome nao_encontrado (nao e' alvo UniTV valido)");
}
{
  resetarFake();
  definirResultado({ ok: false, reason: "ambiguo" });
  ok((await corpoJson(await handler(req()))).outcome === "ambiguo", "ambiguo -> outcome ambiguo");
}
{
  resetarFake();
  for (const reason of ["unavailable", "credenciais_ausentes", "sn_invalido"]) {
    definirResultado({ ok: false, reason });
    ok((await corpoJson(await handler(req()))).outcome === "indisponivel", `${reason} -> outcome indisponivel`);
  }
}
{
  resetarFake();
  const r = await handler(req({ corpo: { sn: "  gcnv6v  ", extra: "campo-nao-doc" } }));
  const raw = JSON.stringify(await corpoJson(r));
  ok(!raw.includes("campo-nao-doc"), "campo extra no corpo nunca aparece na resposta");
  ok(chamadasRegistradas()[0].sn === "gcnv6v", "sn com espacos e' trimado antes de resolver");
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
