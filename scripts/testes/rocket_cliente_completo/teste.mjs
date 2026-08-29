// Testes locais de _shared/rocket_valor_cliente.ts -> consultarClienteCompletoRocket
// (REAL, importada sem alteracao). Alvo: Etapa 2 (Renovacao UniTV,
// Bloco 2) -- a funcao passa a devolver `usuario` (campo JA existente
// no cadastro do Rocket), SEM entrar no guard de sucesso e SEM nunca
// repassar `senha`/`device_key_or_OTP_code`.
//
// Esta e' a funcao usada pelo Orquestrador (fluxo individual de
// renovacao, monta o snapshot do token) -- o `usuario` que ela devolve
// vira o `unitv_sn` de um token UniTV no Bloco 3.
//
// So' Deno.env e o fetch global sao interceptados. Nenhuma rede real.
//
// Como rodar: npx tsx scripts/testes/rocket_cliente_completo/teste.mjs

const ENV = {
  ROCKET_BASE_URL: "https://rocket.example.test",
  ROCKET_API_KEY: "api-key-de-teste",
};
globalThis.Deno = { env: { get: (k) => ENV[k] } };

let rocketPayload;
let rocketStatus = 200;
let ultimaUrl = null;
globalThis.fetch = async (url) => {
  ultimaUrl = String(url);
  return {
    ok: rocketStatus >= 200 && rocketStatus < 300,
    status: rocketStatus,
    json: async () => rocketPayload,
  };
};

const { consultarClienteCompletoRocket } = await import(
  "../../../supabase/functions/_shared/rocket_valor_cliente.ts"
);

let falhas = 0;
let total = 0;
function ok(cond, msg) {
  total++;
  if (cond) console.log("ok:", msg);
  else { falhas++; console.error("FALHA:", msg); }
}

const PUBLIC_ID = "01a0271b-5a54-7d7e-8e4a-ef4c39730e0b";

function payloadCompleto(extra = {}) {
  return {
    cliente: {
      nome: "Cliente Teste",
      servidor: { nome: "NewOne" },
      plano: { nome: "Mensal" },
      valor: "35.00",
      vencimento: "2026-12-08T20:59:59-03:00",
      senha: "SENHA-SECRETA-XYZ",
      device_key_or_OTP_code: "DEVKEY-ABC",
      ...extra,
    },
  };
}

// --- C1: usuario presente -> devolvido exatamente como veio ---
{
  rocketStatus = 200;
  rocketPayload = payloadCompleto({ usuario: "828667229" });
  const r = await consultarClienteCompletoRocket(PUBLIC_ID);
  ok(r.outcome === "success", "C1: outcome success");
  ok(r.usuario === "828667229", "C1: usuario devolvido EXATAMENTE como veio do Rocket");
  ok(r.nome === "Cliente Teste" && r.servidorNome === "NewOne" && r.planoNome === "Mensal" && r.vencimento === "2026-12-08T20:59:59-03:00" && r.valor === "35.00", "C1: demais campos inalterados");
  const bruto = JSON.stringify(r);
  ok(!bruto.includes("SENHA-SECRETA-XYZ") && !/"senha"/.test(bruto), "C1: `senha` NUNCA aparece no retorno");
  ok(!bruto.includes("DEVKEY-ABC") && !/device_key_or_OTP_code/.test(bruto), "C1: `device_key_or_OTP_code` NUNCA aparece no retorno");
  ok(Object.keys(r).sort().join(",") === "nome,outcome,planoNome,servidorNome,usuario,valor,vencimento", "C1: retorno tem EXATAMENTE os campos do contrato (com usuario)");
}

// --- C2: usuario ausente -> null, mas ainda outcome success (nao entra no guard) ---
{
  rocketStatus = 200;
  rocketPayload = payloadCompleto(); // sem `usuario`
  const r = await consultarClienteCompletoRocket(PUBLIC_ID);
  ok(r.outcome === "success", "C2: cliente sem `usuario` ainda resolve (usuario nao esta no guard de sucesso)");
  ok(r.usuario === null, "C2: usuario ausente -> null (nunca undefined, nunca inventado)");
}

// --- C2b: acesso UniTV (servidor UNITV, usuario == sn do painel) ---
{
  rocketStatus = 200;
  rocketPayload = payloadCompleto({ servidor: { nome: "UNITV" }, usuario: "gcnv6v" });
  const r = await consultarClienteCompletoRocket(PUBLIC_ID);
  ok(r.outcome === "success" && r.servidorNome === "UNITV", "C2b: acesso UNITV resolve normalmente");
  ok(r.usuario === "gcnv6v", "C2b: usuario UniTV (sn do painel de revenda) repassado cru");
}

// --- C3: guard de sucesso INALTERADO -- falta nome/servidor/plano/vencimento -> unavailable ---
{
  rocketStatus = 200;
  rocketPayload = { cliente: { servidor: { nome: "NewOne" }, plano: { nome: "Mensal" }, vencimento: "2026-12-08T20:59:59-03:00", usuario: "abc123" } }; // sem nome
  const r = await consultarClienteCompletoRocket(PUBLIC_ID);
  ok(r.outcome === "unavailable", "C3: falta `nome` -> unavailable (guard inalterado, mesmo com usuario presente)");
}
{
  rocketStatus = 200;
  rocketPayload = { cliente: { nome: "N", servidor: { nome: "NewOne" }, plano: { nome: "Mensal" }, usuario: "abc123" } }; // sem vencimento
  const r = await consultarClienteCompletoRocket(PUBLIC_ID);
  ok(r.outcome === "unavailable", "C3b: falta `vencimento` -> unavailable (guard inalterado)");
}

// --- C4: HTTP nao-ok do Rocket -> unavailable (inalterado) ---
{
  rocketStatus = 500;
  rocketPayload = payloadCompleto({ usuario: "828667229" });
  const r = await consultarClienteCompletoRocket(PUBLIC_ID);
  ok(r.outcome === "unavailable", "C4: HTTP 500 do Rocket -> unavailable");
}

// --- C5: sem secrets -> unavailable, sem tocar a rede ---
{
  const salvo = ENV.ROCKET_API_KEY;
  delete ENV.ROCKET_API_KEY;
  ultimaUrl = null;
  const r = await consultarClienteCompletoRocket(PUBLIC_ID);
  ok(r.outcome === "unavailable", "C5: sem ROCKET_API_KEY -> unavailable");
  ok(ultimaUrl === null, "C5: sem secret -> fetch nunca chamado");
  ENV.ROCKET_API_KEY = salvo;
}

console.log(`\nResultado: ${total - falhas}/${total} passando`);
process.exit(falhas === 0 ? 0 : 1);
