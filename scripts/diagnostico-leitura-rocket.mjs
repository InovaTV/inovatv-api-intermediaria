// Diagnostico DESCARTAVEL -- valida, isoladamente, que o ambiente do
// GitHub Actions consegue ler um cliente real no Rocket Gestor apos a
// rotacao de ROCKET_API_KEY (inovatv_central/CLAUDE.md, 2026-08-28).
//
// Reaproveita exatamente a mesma chamada de scripts/renovacao-sigma-workflow.mjs
// (lerClienteRocket) -- mesmo endpoint, mesmo header de autenticacao.
// Deliberadamente NAO faz nada alem disso: sem Playwright, sem Sigma,
// sem Supabase, sem cobranca, sem escrita em banco. Nunca imprime
// ROCKET_API_KEY.
//
// Remover este arquivo (e o workflow correspondente) apos a validacao.

const ROCKET_BASE_URL = process.env.ROCKET_BASE_URL;
const ROCKET_API_KEY = process.env.ROCKET_API_KEY;
const PUBLIC_ID = "01a0271b-5a54-7d7e-8e4a-ef4c39730e0b"; // BLAZE (Meu Uso Testes)

if (!ROCKET_BASE_URL || !ROCKET_API_KEY) {
  console.error("Faltando ROCKET_BASE_URL ou ROCKET_API_KEY no ambiente.");
  process.exit(1);
}

const resp = await fetch(`${ROCKET_BASE_URL}/gerenciador/api/v1/cliente/${PUBLIC_ID}`, {
  headers: { "X-API-Key": ROCKET_API_KEY },
});
const body = await resp.json().catch(() => null);

console.log(JSON.stringify({
  http_status: resp.status,
  ok: resp.ok,
  cliente_encontrado: Boolean(body?.cliente),
  nome: body?.cliente?.nome ?? null,
  servidor: body?.cliente?.servidor ?? null,
  vencimento: body?.cliente?.vencimento ?? null,
}, null, 2));
