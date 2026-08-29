// Testes locais de supabase/functions/status/index.ts (REAL, importado
// sem alteracao). Alvo: a UX de renovacao 2026-08-28 -- opcao A --
// passou a expor `cliente.valor`; a Etapa 2 (Renovacao UniTV, Bloco 2)
// passa a expor tambem `cliente.usuario` (ambos campos JA existentes no
// cadastro do Rocket), SEM nenhuma outra mudanca de logica e SEM nunca
// repassar `senha`/`device_key_or_OTP_code`.
//
// So' Deno.env, Deno.serve e o fetch global sao interceptados aqui.
// Nenhuma chamada de rede real.
//
// Como rodar: npx tsx scripts/testes/status_valor/teste.mjs

const ENV = {
  ROCKET_BASE_URL: "https://rocket.example.test",
  ROCKET_API_KEY: "api-key-de-teste",
};
let handler;
globalThis.Deno = {
  env: { get: (k) => ENV[k] },
  serve: (fn) => {
    handler = fn;
  },
};

// fetch mock: devolve o payload cru do Rocket configurado por cenario
let rocketPayload;
let rocketStatus = 200;
globalThis.fetch = async () => ({
  ok: rocketStatus >= 200 && rocketStatus < 300,
  status: rocketStatus,
  json: async () => rocketPayload,
});

await import("../../../supabase/functions/status/index.ts");

let falhas = 0;
let total = 0;
function ok(cond, msg) {
  total++;
  if (cond) console.log("ok:", msg);
  else {
    falhas++;
    console.error("FALHA:", msg);
  }
}

const UUID = "01a0271b-5a54-7d7e-8e4a-ef4c39730e0b";
const reqStatus = () =>
  new Request(`https://x.test/functions/v1/status/${UUID}`, { method: "GET" });

// --- Cenario 1: cliente com valor -> /status expoe cliente.valor cru ---
{
  rocketStatus = 200;
  rocketPayload = {
    cliente: {
      nome: "Meu Uso Testes",
      vencimento: "2026-09-13T23:59:00-03:00",
      plano: { nome: "Mensal" },
      servidor: { nome: "BLAZE" },
      telas: 1,
      valor: "35.00",
      usuario: "828667229",
      // campos sensiveis que NUNCA podem sair:
      senha: "SENHA-SECRETA-123",
      device_key_or_OTP_code: "DEVKEY-999",
    },
  };
  const resp = await handler(reqStatus());
  const body = await resp.json();

  ok(body.outcome === "success", "C1: outcome success");
  ok(body.cliente.valor === "35.00", "C1: cliente.valor exposto EXATAMENTE como veio do Rocket (sem formatar, sem calcular)");
  ok(body.cliente.usuario === "828667229", "C1: cliente.usuario exposto EXATAMENTE como veio do Rocket (Bloco 2)");
  ok(body.cliente.nome === "Meu Uso Testes" && body.cliente.planoNome === "Mensal" && body.cliente.servidorNome === "BLAZE" && body.cliente.telas === 1, "C1: demais campos inalterados");
  const bruto = JSON.stringify(body);
  ok(!bruto.includes("SENHA-SECRETA-123") && !/"senha"/.test(bruto), "C1: `senha` NUNCA sai (invariante preservado)");
  ok(!bruto.includes("DEVKEY-999") && !/device_key_or_OTP_code/.test(bruto), "C1: `device_key_or_OTP_code` NUNCA sai");
  ok(Object.keys(body.cliente).sort().join(",") === "nome,planoNome,servidorNome,telas,usuario,valor,vencimento", "C1: cliente tem EXATAMENTE os 7 campos permitidos (5 antigos + valor + usuario)");
}

// --- Cenario 2: cliente sem valor/usuario -> null (mesmo fallback dos outros) ---
{
  rocketStatus = 200;
  rocketPayload = {
    cliente: { nome: "X", vencimento: null, plano: null, servidor: null, telas: null },
  };
  const resp = await handler(reqStatus());
  const body = await resp.json();
  ok(body.cliente.valor === null, "C2: valor ausente no Rocket -> null (nunca undefined, nunca inventado)");
  ok(body.cliente.usuario === null, "C2: usuario ausente no Rocket -> null (nunca undefined, nunca inventado)");
}

// --- Cenario 2b: usuario UniTV (formato de sn do painel de revenda) chega cru ---
{
  rocketStatus = 200;
  rocketPayload = { cliente: { nome: "Z", plano: { nome: "Mensal" }, servidor: { nome: "UNITV" }, telas: 1, valor: "35.00", usuario: "gcnv6v" } };
  const resp = await handler(reqStatus());
  const body = await resp.json();
  ok(body.cliente.usuario === "gcnv6v", "C2b: usuario UniTV (sn do painel) repassado cru, sem transformacao");
  ok(body.cliente.servidorNome === "UNITV", "C2b: servidor UNITV inalterado");
}

// --- Cenario 3: valor com virgula chega cru (formatacao e' na apresentacao, nao aqui) ---
{
  rocketStatus = 200;
  rocketPayload = { cliente: { nome: "Y", plano: { nome: "Anual" }, servidor: { nome: "S" }, telas: 2, valor: "199,90" } };
  const resp = await handler(reqStatus());
  const body = await resp.json();
  ok(body.cliente.valor === "199,90", "C3: /status nao normaliza o valor -- repassa cru (virgula ou ponto)");
}

// --- Cenario 4: 404 do Rocket -> sem cliente (comportamento inalterado) ---
{
  rocketStatus = 404;
  rocketPayload = {};
  const resp = await handler(reqStatus());
  const body = await resp.json();
  ok(body.outcome === "success" && body.linkState === "unlinked" && !("cliente" in body), "C4: 404 do Rocket -> unlinked sem cliente (inalterado)");
}

console.log(`\nResultado: ${total - falhas}/${total} passando`);
process.exit(falhas === 0 ? 0 : 1);
