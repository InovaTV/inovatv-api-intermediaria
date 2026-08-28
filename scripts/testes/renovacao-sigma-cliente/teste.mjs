// Testes locais da nova funcao supabase/functions/renovacao-sigma-cliente/index.ts
// (real, importada sem alteracao) -- so' _shared/rocket_valor_cliente.ts
// e' substituido por um fake (fake_rocket_valor_cliente.mjs).
// _shared/http.ts continua real (nenhuma dependencia de Deno alem do
// que este arquivo ja shima).
//
// Como rodar: npx tsx scripts/testes/renovacao-sigma-cliente/teste.mjs

import { register } from "node:module";

register("./mock-loader.mjs", import.meta.url);

const { definirProximoResultado, chamadasRegistradas, resetarFake } =
  await import("./fake_rocket_valor_cliente.mjs");

const TOKEN_VALIDO = "token-interno-de-teste-valor-longo";
const PUBLIC_ID_VALIDO = "01a0271b-5a54-7d7e-8e4a-ef4c39730e0b";

let handler;
globalThis.Deno = {
  serve: (fn) => {
    handler = fn;
  },
  env: {
    get: (nome) => (nome === "RENOVACAO_SIGMA_CALLBACK_TOKEN" ? TOKEN_VALIDO : undefined),
  },
};

await import("../../../supabase/functions/renovacao-sigma-cliente/index.ts");

let falhas = 0;
function ok(condicao, mensagem) {
  if (!condicao) {
    falhas++;
    console.error(`FALHA: ${mensagem}`);
  } else {
    console.log(`ok: ${mensagem}`);
  }
}

function req({ method = "POST", token = TOKEN_VALIDO, corpo = { publicId: PUBLIC_ID_VALIDO }, corpoBruto } = {}) {
  const headers = {};
  if (token !== null) headers["X-Internal-Token"] = token;
  const semCorpo = method === "GET" || method === "HEAD";
  if (!semCorpo && (corpo !== undefined || corpoBruto !== undefined)) {
    headers["Content-Type"] = "application/json";
  }
  return new Request("https://example.test/renovacao-sigma-cliente", {
    method,
    headers,
    body: semCorpo ? undefined : (corpoBruto !== undefined ? corpoBruto : (corpo !== undefined ? JSON.stringify(corpo) : undefined)),
  });
}

async function corpoJson(resp) {
  return resp.json().catch(() => null);
}

// --- Teste 1: sem token -> 401 ---
{
  resetarFake();
  const resp = await handler(req({ token: null }));
  const body = await corpoJson(resp);
  ok(resp.status === 401, "Teste 1a: sem token -> HTTP 401");
  ok(body?.outcome === "error", "Teste 1a: sem token -> outcome error");
  ok(chamadasRegistradas().length === 0, "Teste 1a: Rocket nunca chamado sem token");
}

// --- Teste 1b: token errado -> 401 ---
{
  resetarFake();
  const resp = await handler(req({ token: "token-errado" }));
  ok(resp.status === 401, "Teste 1b: token errado -> HTTP 401");
  ok(chamadasRegistradas().length === 0, "Teste 1b: Rocket nunca chamado com token errado");
}

// --- Teste 2: metodo GET -> 405 ---
{
  resetarFake();
  const resp = await handler(req({ method: "GET" }));
  const body = await corpoJson(resp);
  ok(resp.status === 405, "Teste 2: GET -> HTTP 405");
  ok(body?.outcome === "error", "Teste 2: GET -> outcome error");
  ok(chamadasRegistradas().length === 0, "Teste 2: Rocket nunca chamado com metodo errado");
}

// --- Teste 3: corpo nao e' JSON valido -> 400 ---
{
  resetarFake();
  const resp = await handler(req({ corpo: undefined, corpoBruto: "{ isso nao e json" }));
  ok(resp.status === 400, "Teste 3: JSON invalido -> HTTP 400");
  ok(chamadasRegistradas().length === 0, "Teste 3: Rocket nunca chamado com JSON invalido");
}

// --- Teste 4: publicId ausente -> 400 ---
{
  resetarFake();
  const resp = await handler(req({ corpo: {} }));
  ok(resp.status === 400, "Teste 4a: publicId ausente -> HTTP 400");
  ok(chamadasRegistradas().length === 0, "Teste 4a: Rocket nunca chamado sem publicId");
}

// --- Teste 4b: publicId com formato invalido -> 400 ---
{
  resetarFake();
  const resp = await handler(req({ corpo: { publicId: "nao-e-um-uuid" } }));
  ok(resp.status === 400, "Teste 4b: publicId invalido -> HTTP 400");
  ok(chamadasRegistradas().length === 0, "Teste 4b: Rocket nunca chamado com publicId invalido");
}

// --- Teste 5: Rocket indisponivel/cliente nao encontrado -> 200 unavailable ---
{
  resetarFake();
  definirProximoResultado({ outcome: "unavailable" });
  const resp = await handler(req());
  const body = await corpoJson(resp);
  ok(resp.status === 200, "Teste 5: unavailable -> HTTP 200");
  ok(body?.outcome === "unavailable", "Teste 5: unavailable -> outcome unavailable");
  ok(body?.cliente === undefined, "Teste 5: unavailable -> sem campo cliente");
  ok(chamadasRegistradas().length === 1, "Teste 5: Rocket chamado exatamente 1 vez");
}

// --- Teste 6: sucesso -> 200 com vencimento, sem mais nenhum campo ---
{
  resetarFake();
  definirProximoResultado({
    outcome: "success",
    nome: "Meu Uso Testes",
    servidorNome: "BLAZE",
    planoNome: "Mensal",
    valor: "35.0",
    vencimento: "2026-12-08T20:59:59-03:00",
  });
  const resp = await handler(req());
  const body = await corpoJson(resp);
  ok(resp.status === 200, "Teste 6: sucesso -> HTTP 200");
  ok(body?.outcome === "success", "Teste 6: sucesso -> outcome success");
  ok(body?.cliente?.vencimento === "2026-12-08T20:59:59-03:00", "Teste 6: sucesso -> vencimento correto");
  ok(Object.keys(body.cliente).length === 1, "Teste 6: cliente so' tem o campo vencimento (contrato minimo)");
  ok(body.cliente.nome === undefined, "Teste 6: nome NAO vaza na resposta (fora do contrato)");
  ok(body.cliente.valor === undefined, "Teste 6: valor NAO vaza na resposta (fora do contrato)");
  ok(chamadasRegistradas()[0] === PUBLIC_ID_VALIDO, "Teste 6: publicId repassado corretamente ao Rocket");
}

// --- Teste 7: campo extra no corpo e' ignorado (nunca amplia o escopo) ---
{
  resetarFake();
  definirProximoResultado({ outcome: "success", vencimento: "2026-01-01T00:00:00-03:00" });
  const resp = await handler(req({ corpo: { publicId: PUBLIC_ID_VALIDO, extra: "campo-nao-documentado" } }));
  const body = await corpoJson(resp);
  ok(resp.status === 200 && body?.outcome === "success", "Teste 7: campo extra no corpo nao quebra nem e' refletido");
  ok(JSON.stringify(body).includes("campo-nao-documentado") === false, "Teste 7: campo extra nunca aparece na resposta");
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
