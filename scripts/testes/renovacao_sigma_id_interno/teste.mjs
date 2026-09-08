// Testes de supabase/functions/renovacao-sigma-id-interno/index.ts
// (real). _shared/supabase_client.ts e _shared/rocket_sigma_contexto.ts
// sao fakes; _shared/http.ts real. Sem rede real, sem HTML real.
//
// npx tsx scripts/testes/renovacao_sigma_id_interno/teste.mjs
import { register } from "node:module";
register("./mock-loader.mjs", import.meta.url);

const supa = await import("./fake_supabase_client.mjs");
const sig = await import("./fake_rocket_sigma_contexto.mjs");

const TOKEN = "callback-token-de-teste-longo";
const PID = "01a026ef-8bdd-7641-a4f2-2ae37b184ac0";

let handler;
let fetchResp = { status: 200, text: '<a cliente_id="1569097"></a>' };
globalThis.Deno = {
  serve: (fn) => { handler = fn; },
  env: { get: (n) => (n === "RENOVACAO_SIGMA_CALLBACK_TOKEN" ? TOKEN : undefined) },
};
globalThis.fetch = async () => ({
  status: fetchResp.status,
  ok: fetchResp.status >= 200 && fetchResp.status < 300,
  headers: { get: () => fetchResp.location ?? "" },
  async text() { return fetchResp.text ?? ""; },
});

await import("../../../supabase/functions/renovacao-sigma-id-interno/index.ts");

let falhas = 0;
const ok = (c, m) => (c ? console.log("ok: " + m) : (falhas++, console.error("FALHA: " + m)));
const req = (o = {}) => new Request("https://x.test/f", {
  method: o.method ?? "POST",
  headers: { "Content-Type": "application/json", ...(o.token === null ? {} : { "X-Internal-Token": o.token ?? TOKEN }) },
  body: o.method === "GET" ? undefined : JSON.stringify(o.body ?? { publicId: PID }),
});
const J = (r) => r.json();

// 1. resolvido + cross-check
{
  sig.chamadasSigma.length = 0;
  supa.setSessao([{ sessionid: "SID", csrftoken: "CSRF" }]);
  sig.setSigma({ outcome: "success", package: "Mensal", expiresAt: null });
  fetchResp = { status: 200, text: '<button data-bs-target="#modal-add-pagamento" cliente_id="1569097" nome="X"></button>' };
  const r = await handler(req());
  const b = await J(r);
  ok(r.status === 200 && b.outcome === "resolvido" && b.idInterno === "1569097", "1: resolvido idInterno=1569097");
  ok(JSON.stringify(b).indexOf("<") === -1 && !JSON.stringify(b).includes("modal-add-pagamento"), "1: nunca devolve HTML");
  ok(sig.chamadasSigma.length === 1 && sig.chamadasSigma[0].id === "1569097", "1: cross-check sigma/info com o id extraido");
}
// 1b. pacote_vazio tambem valida o id
{
  sig.setSigma({ outcome: "pacote_vazio" });
  fetchResp = { status: 200, text: 'cliente_id="42"' };
  const b = await J(await handler(req()));
  ok(b.outcome === "resolvido" && b.idInterno === "42", "1b: pacote_vazio -> id valido");
}
// 2. sem cliente_id no HTML -> nao_encontrado, sem sigma
{
  sig.chamadasSigma.length = 0;
  sig.setSigma({ outcome: "success", package: "M" });
  fetchResp = { status: 200, text: "<html>nada aqui</html>" };
  const b = await J(await handler(req()));
  ok(b.outcome === "nao_encontrado", "2: sem cliente_id -> nao_encontrado");
  ok(sig.chamadasSigma.length === 0, "2: nao chama sigma/info se nao extraiu id");
}
// 3. redirect (sessao invalida) -> unavailable/auth
{
  fetchResp = { status: 302, location: "/accounts/login/", text: "" };
  const b = await J(await handler(req()));
  ok(b.outcome === "unavailable" && b.motivo === "auth", "3: 302 -> unavailable auth");
}
// 4. sigma/info nao valida -> unavailable/sigma_invalido
{
  sig.setSigma({ outcome: "unavailable", motivo: "auth_painel" });
  fetchResp = { status: 200, text: 'cliente_id="999"' };
  const b = await J(await handler(req()));
  ok(b.outcome === "unavailable" && b.motivo === "sigma_invalido", "4: sigma invalido -> unavailable");
}
// 5. sem sessao no Vault -> unavailable/sem_sessao
{
  supa.setSessao([{ sessionid: null, csrftoken: null }]);
  const b = await J(await handler(req()));
  ok(b.outcome === "unavailable" && b.motivo === "sem_sessao", "5: sem sessao Vault -> unavailable");
  supa.setSessao([{ sessionid: "SID", csrftoken: "CSRF" }]);
}
// 6. auth / metodo / corpo
{
  ok((await handler(req({ token: null }))).status === 401, "6: sem token -> 401");
  ok((await handler(req({ token: "errado" }))).status === 401, "6: token errado -> 401");
  ok((await handler(req({ method: "GET" }))).status === 405, "6: GET -> 405");
  ok((await handler(req({ body: {} }))).status === 400, "6: publicId ausente -> 400");
  ok((await handler(req({ body: { publicId: "nao-uuid" } }))).status === 400, "6: publicId invalido -> 400");
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
