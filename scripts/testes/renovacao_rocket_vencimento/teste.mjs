// Testes locais de supabase/functions/renovacao-rocket-vencimento/index.ts
// (real, importada sem alteracao). Fakes: _shared/rocket_valor_cliente.ts
// e _shared/rocket_vencimento.ts. _shared/http.ts continua real.
//
// setTimeout e' neutralizado (fire imediato) para os retries nao
// segurarem o teste -- a LOGICA do retry (2 tentativas, so' na leitura/
// PATCH, nunca no /renew) continua exercitada.
//
// Como rodar: npx tsx scripts/testes/renovacao_rocket_vencimento/teste.mjs

import { register } from "node:module";

register("./mock-loader.mjs", import.meta.url);

const { definirSequencia, chamadasRegistradas, resetarFake, clienteSucesso } =
  await import("./fake_rocket_valor_cliente.mjs");
const { definirSequenciaPatch, definirResultadoPatch, patchChamadas, resetarFake: resetarPatch } =
  await import("./fake_rocket_vencimento.mjs");

const TOKEN_VALIDO = "token-interno-de-teste-valor-longo";
const PUBLIC_ID_VALIDO = "01a0271b-5a54-7d7e-8e4a-ef4c39730e0b";
const ALVO = "2026-11-08T20:59:59-03:00";
const ANTES = "2026-10-08T20:59:59-03:00";

// setTimeout imediato -- os ~3s entre tentativas nao seguram o teste.
const setTimeoutReal = globalThis.setTimeout;
globalThis.setTimeout = (fn) => { fn(); return 0; };

let handler;
globalThis.Deno = {
  serve: (fn) => { handler = fn; },
  env: {
    get: (nome) => (nome === "RENOVACAO_SIGMA_CALLBACK_TOKEN" ? TOKEN_VALIDO : undefined),
  },
};

await import("../../../supabase/functions/renovacao-rocket-vencimento/index.ts");

let falhas = 0;
function ok(condicao, mensagem) {
  if (!condicao) { falhas++; console.error(`FALHA: ${mensagem}`); }
  else console.log(`ok: ${mensagem}`);
}

function req({ method = "POST", token = TOKEN_VALIDO, corpo = { publicId: PUBLIC_ID_VALIDO, vencimentoAlvo: ALVO }, corpoBruto } = {}) {
  const headers = {};
  if (token !== null) headers["X-Internal-Token"] = token;
  const semCorpo = method === "GET" || method === "HEAD";
  if (!semCorpo && (corpo !== undefined || corpoBruto !== undefined)) headers["Content-Type"] = "application/json";
  return new Request("https://example.test/renovacao-rocket-vencimento", {
    method,
    headers,
    body: semCorpo ? undefined : (corpoBruto !== undefined ? corpoBruto : (corpo !== undefined ? JSON.stringify(corpo) : undefined)),
  });
}
const corpoJson = (resp) => resp.json().catch(() => null);
function reset() { resetarFake(); resetarPatch(); }

// =====================================================================
// Autenticacao / metodo / validacao
// =====================================================================
{
  reset();
  const resp = await handler(req({ token: null }));
  ok(resp.status === 401, "sem token -> 401");
  ok(chamadasRegistradas().length === 0 && patchChamadas().length === 0, "sem token -> Rocket nunca tocado");
}
{
  reset();
  const resp = await handler(req({ token: "errado" }));
  ok(resp.status === 401, "token errado -> 401");
  ok(patchChamadas().length === 0, "token errado -> PATCH nunca chamado");
}
{
  reset();
  const resp = await handler(req({ method: "GET" }));
  ok(resp.status === 405, "GET -> 405");
}
{
  reset();
  const resp = await handler(req({ corpo: undefined, corpoBruto: "{ nao e json" }));
  ok(resp.status === 400, "JSON invalido -> 400");
  ok(patchChamadas().length === 0, "JSON invalido -> PATCH nunca chamado");
}
{
  reset();
  ok((await handler(req({ corpo: { vencimentoAlvo: ALVO } }))).status === 400, "publicId ausente -> 400");
  ok((await handler(req({ corpo: { publicId: "nao-uuid", vencimentoAlvo: ALVO } }))).status === 400, "publicId invalido -> 400");
}
{
  reset();
  ok((await handler(req({ corpo: { publicId: PUBLIC_ID_VALIDO } }))).status === 400, "vencimentoAlvo ausente -> 400");
  ok((await handler(req({ corpo: { publicId: PUBLIC_ID_VALIDO, vencimentoAlvo: "amanha" } }))).status === 400, "vencimentoAlvo nao-data -> 400");
  ok((await handler(req({ corpo: { publicId: PUBLIC_ID_VALIDO, vencimentoAlvo: "  " } }))).status === 400, "vencimentoAlvo vazio -> 400");
  ok(chamadasRegistradas().length === 0 && patchChamadas().length === 0, "validacao falhou -> Rocket nunca tocado");
}

// =====================================================================
// Caminho feliz
// =====================================================================
{
  reset();
  definirSequencia([clienteSucesso(ANTES), clienteSucesso(ALVO)]); // GET antes, GET depois
  definirResultadoPatch({ outcome: "success", httpStatus: 200 });
  const resp = await handler(req());
  const body = await corpoJson(resp);
  ok(resp.status === 200 && body.outcome === "sincronizado", "feliz -> outcome 'sincronizado'");
  ok(body.vencimentoAntes === ANTES && body.vencimentoDepois === ALVO, "feliz -> vencimentoAntes/Depois corretos");
  ok(body.tentativas === 1, "feliz -> resolve na 1a tentativa");
  ok(patchChamadas().length === 1, "feliz -> PATCH chamado exatamente 1 vez");
  ok(patchChamadas()[0].vencimento === ALVO, "feliz -> PATCH envia EXATAMENTE o vencimentoAlvo (nunca recalculado)");
  ok(patchChamadas()[0].publicId === PUBLIC_ID_VALIDO, "feliz -> PATCH no publicId certo");
}

// =====================================================================
// Nao vazamento de campos sensiveis
// =====================================================================
{
  reset();
  definirSequencia([clienteSucesso(ANTES), clienteSucesso(ALVO)]);
  const resp = await handler(req());
  const raw = JSON.stringify(await corpoJson(resp));
  ok(!raw.includes("SENHA-SECRETA") && !raw.includes("DEVICEKEY"), "resposta NAO contem senha/device_key");
  ok(!raw.includes("Cliente Sensivel Fake") && !raw.includes("35.00") && !raw.includes("Mensal"), "resposta NAO contem nome/valor/plano");
}

// =====================================================================
// Retry: PATCH falha na 1a, sucede na 2a
// =====================================================================
{
  reset();
  // 1a tentativa: GET antes ok, PATCH unavailable  -> retry
  // 2a tentativa: GET antes ok, PATCH ok, GET depois ok(novo)
  definirSequencia([clienteSucesso(ANTES), clienteSucesso(ANTES), clienteSucesso(ALVO)]);
  definirSequenciaPatch([{ outcome: "unavailable", httpStatus: 502 }, { outcome: "success", httpStatus: 200 }]);
  const resp = await handler(req());
  const body = await corpoJson(resp);
  ok(body.outcome === "sincronizado" && body.tentativas === 2, "PATCH falha 1x -> retry -> sincronizado na 2a");
  ok(patchChamadas().length === 2, "PATCH chamado 2x (uma por tentativa)");
  ok(body.vencimentoAntes === ANTES, "vencimentoAntes e' o da 1a leitura (baseline fixo)");
}

// =====================================================================
// Falhas -> rocket_desync com a etapa certa
// =====================================================================
{
  reset();
  definirSequencia([{ outcome: "unavailable" }]); // GET antes sempre falha
  const resp = await handler(req());
  const body = await corpoJson(resp);
  ok(body.outcome === "rocket_desync" && body.etapa === "get_antes" && body.tentativas === 2, "GET antes sempre falha -> rocket_desync (get_antes)");
  ok(patchChamadas().length === 0, "sem baseline -> PATCH NUNCA chamado");
  ok(body.vencimentoAntes === null, "sem baseline -> vencimentoAntes null");
}
{
  reset();
  definirSequencia([clienteSucesso(ANTES)]); // GET antes ok sempre (repete)
  definirResultadoPatch({ outcome: "unavailable", httpStatus: 500 });
  const resp = await handler(req());
  const body = await corpoJson(resp);
  ok(body.outcome === "rocket_desync" && body.etapa === "patch", "PATCH sempre falha -> rocket_desync (patch)");
  ok(body.vencimentoAntes === ANTES, "PATCH falha -> vencimentoAntes preenchido");
  ok(patchChamadas().length === 2, "PATCH tentado 2x antes de desistir");
}
{
  reset();
  // GET antes ok, PATCH ok, GET depois falha -- nas duas tentativas
  definirSequencia([clienteSucesso(ANTES), { outcome: "unavailable" }, clienteSucesso(ANTES), { outcome: "unavailable" }]);
  const resp = await handler(req());
  const body = await corpoJson(resp);
  ok(body.outcome === "rocket_desync" && body.etapa === "get_depois", "GET depois sempre falha -> rocket_desync (get_depois)");
  ok(body.vencimentoAntes === ANTES, "GET depois falha -> vencimentoAntes preenchido");
}

// =====================================================================
// nao_avancou: PATCH "ok" mas o vencimento nao mudou
// =====================================================================
{
  reset();
  // antes e depois iguais (ANTES) nas duas tentativas
  definirSequencia([clienteSucesso(ANTES), clienteSucesso(ANTES), clienteSucesso(ANTES), clienteSucesso(ANTES)]);
  const resp = await handler(req());
  const body = await corpoJson(resp);
  ok(body.outcome === "rocket_desync" && body.etapa === "nao_avancou", "PATCH ok mas vencimento igual -> rocket_desync (nao_avancou)");
  ok(body.vencimentoAntes === ANTES && body.vencimentoDepois === ANTES, "nao_avancou -> antes == depois == valor antigo");
}
{
  reset();
  // vencimento RETROCEDEU (Rocket aplicou lixo) -> nunca 'sincronizado'
  const RETROCEDIDO = "2026-09-01T20:59:59-03:00";
  definirSequencia([clienteSucesso(ANTES), clienteSucesso(RETROCEDIDO), clienteSucesso(ANTES), clienteSucesso(RETROCEDIDO)]);
  const resp = await handler(req());
  const body = await corpoJson(resp);
  ok(body.outcome === "rocket_desync" && body.etapa === "nao_avancou", "vencimento retrocedeu -> rocket_desync, nunca sincronizado");
}

// =====================================================================
// Tolerancia ao drift de fuso do Rocket (<=3h): depois = alvo - 3h
// =====================================================================
{
  reset();
  const DEPOIS_DRIFT = "2026-11-08T17:59:59-03:00"; // alvo (20:59) - 3h
  definirSequencia([clienteSucesso(ANTES), clienteSucesso(DEPOIS_DRIFT)]);
  const resp = await handler(req());
  const body = await corpoJson(resp);
  ok(body.outcome === "sincronizado", "depois = alvo - 3h (bug de fuso do Rocket) -> ainda 'sincronizado'");
  ok(body.vencimentoDepois === DEPOIS_DRIFT, "sincronizado com drift -> reporta o vencimentoDepois real");
}

// =====================================================================
// Ja sincronizado (re-dispatch): antes ja == alvo, PATCH e' no-op
// =====================================================================
{
  reset();
  definirSequencia([clienteSucesso(ALVO), clienteSucesso(ALVO)]);
  const resp = await handler(req());
  const body = await corpoJson(resp);
  ok(body.outcome === "sincronizado", "antes ja == alvo (re-dispatch idempotente) -> 'sincronizado', nao falso desync");
  ok(body.vencimentoAntes === ALVO && body.vencimentoDepois === ALVO, "re-dispatch -> antes == depois == alvo");
}

// =====================================================================
// Campo extra no corpo e' ignorado / nunca refletido
// =====================================================================
{
  reset();
  definirSequencia([clienteSucesso(ANTES), clienteSucesso(ALVO)]);
  const resp = await handler(req({ corpo: { publicId: PUBLIC_ID_VALIDO, vencimentoAlvo: ALVO, extra: "campo-nao-documentado" } }));
  const raw = JSON.stringify(await corpoJson(resp));
  ok(!raw.includes("campo-nao-documentado"), "campo extra no corpo nunca aparece na resposta");
}

globalThis.setTimeout = setTimeoutReal;
console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
