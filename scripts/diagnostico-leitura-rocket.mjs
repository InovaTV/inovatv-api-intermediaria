// Diagnostico DESCARTAVEL -- valida, isoladamente, que o ambiente do
// GitHub Actions consegue ler um cliente real no Rocket Gestor apos a
// rotacao de ROCKET_API_KEY (inovatv_central/CLAUDE.md, 2026-08-28).
//
// Reaproveita exatamente a mesma chamada de scripts/renovacao-sigma-workflow.mjs
// (lerClienteRocket) -- mesmo endpoint, mesmo header de autenticacao.
// Deliberadamente NAO faz nada alem disso: sem Playwright, sem Sigma,
// sem Supabase, sem cobranca, sem escrita em banco. Nunca imprime
// ROCKET_API_KEY nem ROCKET_BASE_URL.
//
// v2 (2026-08-28) -- investigacao da divergencia Supabase x GitHub
// Actions (HTTP 200 sem cliente, achado nas duas primeiras execucoes
// deste mesmo diagnostico). Passa a capturar headers e o corpo bruto
// da resposta (como texto, antes do parse), pra distinguir "Rocket
// respondeu JSON valido sem cliente" de "resposta nao-JSON / pagina de
// erro / bloqueio silencioso" -- distincao que a v1 nao permitia (o
// `.catch(() => null)` do parse mascarava os dois casos com o mesmo
// output). Headers potencialmente sensiveis (cookie, token, key, auth,
// secret no nome) sao redigidos, nunca impressos.
//
// Remover este arquivo (e o workflow correspondente) apos a validacao.

const ROCKET_BASE_URL = process.env.ROCKET_BASE_URL;
const ROCKET_API_KEY = process.env.ROCKET_API_KEY;
const PUBLIC_ID = "01a0271b-5a54-7d7e-8e4a-ef4c39730e0b"; // BLAZE (Meu Uso Testes)

if (!ROCKET_BASE_URL || !ROCKET_API_KEY) {
  console.error("Faltando ROCKET_BASE_URL ou ROCKET_API_KEY no ambiente.");
  process.exit(1);
}

const PADRAO_HEADER_SENSIVEL = /cookie|token|key|auth|secret/i;
const TAMANHO_MAX_PREVIEW = 2000;

function headersSeguros(headers) {
  const resultado = {};
  for (const [nome, valor] of headers.entries()) {
    resultado[nome] = PADRAO_HEADER_SENSIVEL.test(nome) ? "[REDIGIDO]" : valor;
  }
  return resultado;
}

const resp = await fetch(`${ROCKET_BASE_URL}/gerenciador/api/v1/cliente/${PUBLIC_ID}`, {
  headers: { "X-API-Key": ROCKET_API_KEY },
});

// Corpo lido como texto primeiro -- nunca chama resp.json() direto,
// pra nao perder a evidencia bruta se o parse falhar.
const corpoBruto = await resp.text();

let corpoJson = null;
let jsonValido = false;
try {
  corpoJson = JSON.parse(corpoBruto);
  jsonValido = true;
} catch {
  jsonValido = false;
}

const clientePresente = jsonValido ? Boolean(corpoJson?.cliente) : null;

console.log(JSON.stringify({
  http_status: resp.status,
  ok: resp.ok,
  content_type: resp.headers.get("content-type"),
  headers: headersSeguros(resp.headers),
  corpo_bruto_tamanho: corpoBruto.length,
  corpo_bruto_preview: corpoBruto.slice(0, TAMANHO_MAX_PREVIEW),
  json_valido: jsonValido,
  cliente_presente: clientePresente,
  nome: clientePresente ? (corpoJson?.cliente?.nome ?? null) : null,
  servidor: clientePresente ? (corpoJson?.cliente?.servidor ?? null) : null,
  vencimento: clientePresente ? (corpoJson?.cliente?.vencimento ?? null) : null,
}, null, 2));
