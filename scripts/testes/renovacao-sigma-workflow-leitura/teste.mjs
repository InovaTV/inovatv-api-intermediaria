// Testes locais de scripts/renovacao-sigma-workflow.mjs (real, sem
// alteracao) apos a mudanca de lerClienteRocket para chamar a nova
// funcao renovacao-sigma-cliente em vez de bater direto no Rocket.
//
// Roda main() de verdade (nao uma copia), interceptando so' fetch
// global (Supabase REST/RPC/Functions + a checagem de sessao do
// Rocket) e o pacote npm "playwright" (nao instalado neste ambiente
// local -- so' dentro do job do GitHub Actions). Cada cenario forca
// deliberadamente um bail-out ANTES de chromium.launch() (via sessao
// valida mas id_cliente interno nao encontrado, ou via falha logo na
// leitura do cliente) -- nunca chega perto de abrir um browser real,
// nunca toca Sigma/banco real.
//
// Cada cenario importa o modulo com uma query string diferente
// (cache-busting) pra forcar uma nova execucao de main() por cenario,
// ja que o arquivo dispara main() automaticamente ao ser importado.
//
// Como rodar: npx tsx scripts/testes/renovacao-sigma-workflow-leitura/teste.mjs

import { register } from "node:module";

register("./mock-loader.mjs", import.meta.url);

const PUBLIC_ID = "01a0271b-5a54-7d7e-8e4a-ef4c39730e0b";
const CALLBACK_TOKEN = "callback-token-de-teste";
const SUPABASE_URL = "https://exemplo-teste.supabase.co";

process.env.OPERACAO_ID = "operacao-de-teste-1234";
process.env.SUPABASE_URL = SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-teste";
process.env.RENOVACAO_SIGMA_CALLBACK_TOKEN = CALLBACK_TOKEN;

let falhas = 0;
function ok(condicao, mensagem) {
  if (!condicao) {
    falhas++;
    console.error(`FALHA: ${mensagem}`);
  } else {
    console.log(`ok: ${mensagem}`);
  }
}

let chamadasFetch = [];
let configRenovacaoSigmaCliente = { status: 200, body: { outcome: "unavailable" } };
let capturarResultado = null;
let promessaResultado = null;

function novaPromessaResultado() {
  promessaResultado = new Promise((resolve) => {
    capturarResultado = resolve;
  });
}

globalThis.fetch = async (url, opts = {}) => {
  const urlStr = String(url);
  const headers = opts.headers ?? {};
  chamadasFetch.push({ url: urlStr, method: opts.method ?? "GET", headers });

  if (urlStr.includes("/rest/v1/tokens_renovacao")) {
    return new Response(
      JSON.stringify([{ id: "tok-1", public_id: PUBLIC_ID, cliente_nome: "Cliente Teste", telefone: "5511999999999" }]),
      { status: 200 },
    );
  }

  if (urlStr.includes("/rest/v1/rpc/rocket_sessao_ler")) {
    return new Response(JSON.stringify({ sessionid: "sess-fake", csrftoken: "csrf-fake" }), { status: 200 });
  }

  if (urlStr === "https://app.rocketgestor.com/gerenciador/") {
    // Sessao "valida": 200, sem marcas de tela de login.
    return new Response("<html><body>dashboard</body></html>", { status: 200 });
  }

  if (urlStr.endsWith("/functions/v1/renovacao-sigma-cliente")) {
    return new Response(JSON.stringify(configRenovacaoSigmaCliente.body), {
      status: configRenovacaoSigmaCliente.status,
      headers: { "content-type": "application/json" },
    });
  }

  if (urlStr.includes("/gerenciador/cliente/info/")) {
    // HTML sem nenhum candidato -- forca bail-out limpo ("id_cliente
    // interno nao encontrado") ANTES de chromium.launch().
    return new Response("<html><body>sem nenhum botao de pagamento aqui</body></html>", { status: 200 });
  }

  if (urlStr.endsWith("/functions/v1/renovacao-sigma-resultado")) {
    const corpo = JSON.parse(opts.body);
    if (capturarResultado) capturarResultado(corpo);
    return new Response(JSON.stringify({ outcome: "ok" }), { status: 200 });
  }

  throw new Error(`fetch inesperado no teste: ${opts.method ?? "GET"} ${urlStr}`);
};

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout esperando reportarResultado")), ms));
}

async function rodarCenario(nome, configResposta) {
  chamadasFetch = [];
  configRenovacaoSigmaCliente = configResposta;
  novaPromessaResultado();

  const urlModulo = new URL("../../renovacao-sigma-workflow.mjs", import.meta.url).href + `?cenario=${nome}`;
  await import(urlModulo);

  const resultado = await Promise.race([promessaResultado, timeout(3000)]);
  return { resultado, chamadas: [...chamadasFetch] };
}

// --- Cenario A: renovacao-sigma-cliente responde "unavailable" ---
{
  const { resultado, chamadas } = await rodarCenario("A-unavailable", { status: 200, body: { outcome: "unavailable" } });

  ok(resultado.resultado === "resultado_ambiguo", "Cenario A: unavailable -> reporta resultado_ambiguo");
  ok(
    resultado.detalhe === "falha ao ler cliente no Rocket antes da tentativa",
    "Cenario A: detalhe correto (falha ao ler cliente no Rocket antes da tentativa)",
  );

  const chamouNovaFuncao = chamadas.some((c) => c.url.endsWith("/functions/v1/renovacao-sigma-cliente"));
  ok(chamouNovaFuncao, "Cenario A: chamou a nova funcao renovacao-sigma-cliente");

  const chamouRocketDireto = chamadas.some((c) => c.url.includes("/gerenciador/api/v1/cliente/"));
  ok(!chamouRocketDireto, "Cenario A: NUNCA chamou o Rocket diretamente (api/v1/cliente)");

  const chamadaNovaFuncao = chamadas.find((c) => c.url.endsWith("/functions/v1/renovacao-sigma-cliente"));
  ok(chamadaNovaFuncao?.method === "POST", "Cenario A: chamada e' POST");
  ok(chamadaNovaFuncao?.headers?.["X-Internal-Token"] === CALLBACK_TOKEN, "Cenario A: X-Internal-Token enviado corretamente");

  // Nunca chegou perto do Playwright -- se tivesse chegado,
  // chromium.launch() (fake) teria lancado excecao e o main().catch()
  // teria reportado "erro fatal", nao "falha ao ler cliente...".
  ok(chromiumNuncaChamado(resultado), "Cenario A: nunca alcancou chromium.launch()");
}

// --- Cenario B: renovacao-sigma-cliente responde sucesso com vencimento ---
{
  const { resultado, chamadas } = await rodarCenario("B-sucesso", {
    status: 200,
    body: { outcome: "success", cliente: { vencimento: "2026-12-08T20:59:59-03:00" } },
  });

  // Se lerClienteRocket tivesse falhado, o detalhe seria "falha ao ler
  // cliente no Rocket antes da tentativa" -- como o detalhe abaixo e'
  // outro (id_cliente interno), prova que okAntes/clienteAntes vieram
  // corretos da nova funcao e o fluxo avancou de verdade.
  ok(resultado.resultado === "resultado_ambiguo", "Cenario B: reporta resultado_ambiguo (esperado neste bail-out controlado)");
  ok(
    String(resultado.detalhe ?? "").includes("id_cliente interno"),
    "Cenario B: avancou ALEM da leitura do cliente (detalhe e' sobre id_cliente interno, nao sobre falha de leitura)",
  );

  const chamouNovaFuncao = chamadas.some((c) => c.url.endsWith("/functions/v1/renovacao-sigma-cliente"));
  ok(chamouNovaFuncao, "Cenario B: chamou a nova funcao renovacao-sigma-cliente");

  const chamouRocketDireto = chamadas.some((c) => c.url.includes("/gerenciador/api/v1/cliente/"));
  ok(!chamouRocketDireto, "Cenario B: NUNCA chamou o Rocket diretamente (api/v1/cliente)");

  ok(chromiumNuncaChamado(resultado), "Cenario B: nunca alcancou chromium.launch()");
}

function chromiumNuncaChamado(resultado) {
  return !String(resultado.detalhe ?? "").includes("chromium.launch");
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
