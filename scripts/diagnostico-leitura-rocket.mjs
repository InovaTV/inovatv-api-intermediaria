// Diagnostico DESCARTAVEL -- v3 (2026-08-28): valida que o ambiente do
// GitHub Actions consegue chamar a nova ponte renovacao-sigma-cliente
// (Supabase, commit d528377) para ler o vencimento do cliente no
// Rocket, em vez de bater direto em app.rocketgestor.com -- chamada
// direta bloqueada pela borda/Cloudflare especificamente para trafego
// do GitHub Actions (investigado e caracterizado em 2026-08-27/28,
// NEXT_SESSION.md).
//
// v1/v2 (ate commit 9f64170) chamavam o Rocket diretamente -- superado.
// Este script agora exercita exatamente o mesmo caminho que
// scripts/renovacao-sigma-workflow.mjs usa hoje pra lerClienteRocket.
//
// Nunca imprime RENOVACAO_SIGMA_CALLBACK_TOKEN.
//
// Remover este arquivo (e o workflow correspondente) apos a validacao.

const SUPABASE_URL = process.env.SUPABASE_URL;
const RENOVACAO_SIGMA_CALLBACK_TOKEN = process.env.RENOVACAO_SIGMA_CALLBACK_TOKEN;
const PUBLIC_ID = "01a0271b-5a54-7d7e-8e4a-ef4c39730e0b"; // BLAZE (Meu Uso Testes)

if (!SUPABASE_URL || !RENOVACAO_SIGMA_CALLBACK_TOKEN) {
  console.error("Faltando SUPABASE_URL ou RENOVACAO_SIGMA_CALLBACK_TOKEN no ambiente.");
  process.exit(1);
}

const resp = await fetch(`${SUPABASE_URL}/functions/v1/renovacao-sigma-cliente`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Internal-Token": RENOVACAO_SIGMA_CALLBACK_TOKEN },
  body: JSON.stringify({ publicId: PUBLIC_ID }),
});

const corpoBruto = await resp.text();

let corpoJson = null;
let jsonValido = false;
try {
  corpoJson = JSON.parse(corpoBruto);
  jsonValido = true;
} catch {
  jsonValido = false;
}

console.log(JSON.stringify({
  http_status: resp.status,
  ok: resp.ok,
  json_valido: jsonValido,
  outcome: jsonValido ? (corpoJson?.outcome ?? null) : null,
  vencimento: jsonValido ? (corpoJson?.cliente?.vencimento ?? null) : null,
  corpo_bruto_preview: corpoBruto.slice(0, 500),
}, null, 2));
