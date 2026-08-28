// Testes locais de scripts/renovacao-sigma-workflow.mjs (real, sem
// alteracao) apos mover TODA leitura do Rocket para fora do runner:
//   - vencimento           -> renovacao-sigma-cliente   (ja existia)
//   - id_cliente interno   -> renovacao-sigma-contexto   (NOVO)
//   - pacote atual / expires_at do Sigma  -> renovacao-sigma-contexto
//   - validade da sessao    -> renovacao-sigma-contexto
//
// Roda main() de verdade (nao uma copia), interceptando so' o fetch
// global e o pacote npm "playwright" (fake, launch() lanca). Cada
// cenario ou forca um bail-out ANTES de chromium.launch(), ou (cenario
// G) deixa o fluxo AVANCAR ate o Playwright de proposito, para provar
// que o contexto foi obtido e o runner nunca falou direto com
// app.rocketgestor.com.
//
// GARANTIA CENTRAL, checada em TODOS os cenarios: o runner nao faz
// mais nenhum fetch a app.rocketgestor.com (nem a /gerenciador/) fora
// do Playwright.
//
// Como rodar: npx tsx scripts/testes/renovacao-sigma-workflow-leitura/teste.mjs

import { register } from "node:module";

register("./mock-loader.mjs", import.meta.url);

const PUBLIC_ID = "01a0271b-5a54-7d7e-8e4a-ef4c39730e0b";
const CLIENTE_NOME = "Cliente Teste";
const TELEFONE = "5511999999999";
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
let configCliente = { status: 200, body: { outcome: "unavailable" } };
let configContexto = { status: 200, body: { outcome: "unavailable" } };
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
  let corpo = null;
  if (opts.body) {
    try {
      corpo = JSON.parse(opts.body);
    } catch {
      /* ignore */
    }
  }
  chamadasFetch.push({ url: urlStr, method: opts.method ?? "GET", headers, corpo });

  if (urlStr.includes("/rest/v1/tokens_renovacao")) {
    return new Response(
      JSON.stringify([{ id: "tok-1", public_id: PUBLIC_ID, cliente_nome: CLIENTE_NOME, telefone: TELEFONE }]),
      { status: 200 },
    );
  }

  if (urlStr.includes("/rest/v1/rpc/rocket_sessao_ler")) {
    return new Response(JSON.stringify({ sessionid: "sess-fake", csrftoken: "csrf-fake" }), { status: 200 });
  }

  if (urlStr.endsWith("/functions/v1/renovacao-sigma-cliente")) {
    return new Response(JSON.stringify(configCliente.body), {
      status: configCliente.status,
      headers: { "content-type": "application/json" },
    });
  }

  if (urlStr.endsWith("/functions/v1/renovacao-sigma-contexto")) {
    return new Response(JSON.stringify(configContexto.body), {
      status: configContexto.status,
      headers: { "content-type": "application/json" },
    });
  }

  if (urlStr.endsWith("/functions/v1/renovacao-sigma-resultado")) {
    const c = JSON.parse(opts.body);
    if (capturarResultado) capturarResultado(c);
    return new Response(JSON.stringify({ outcome: "ok" }), { status: 200 });
  }

  throw new Error(`fetch inesperado no teste: ${opts.method ?? "GET"} ${urlStr}`);
};

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout esperando reportarResultado")), ms));
}

async function rodarCenario(nome, { cliente, contexto }) {
  chamadasFetch = [];
  configCliente = cliente ?? { status: 200, body: { outcome: "unavailable" } };
  configContexto = contexto ?? { status: 200, body: { outcome: "unavailable" } };
  novaPromessaResultado();

  const urlModulo = new URL("../../renovacao-sigma-workflow.mjs", import.meta.url).href + `?cenario=${nome}`;
  await import(urlModulo);

  const resultado = await Promise.race([promessaResultado, timeout(3000)]);
  return { resultado, chamadas: [...chamadasFetch] };
}

// --- Invariantes checados em TODOS os cenarios ---
function checarInvariantes(rotulo, chamadas) {
  const bateuNoRocketDireto = chamadas.some((c) => c.url.includes("app.rocketgestor.com") || c.url.includes("/gerenciador/"));
  ok(!bateuNoRocketDireto, `${rotulo}: runner NUNCA faz fetch direto a app.rocketgestor.com / /gerenciador/ (fora do Playwright)`);

  const chamouCliente = chamadas.some((c) => c.url.endsWith("/functions/v1/renovacao-sigma-cliente"));
  ok(chamouCliente, `${rotulo}: leu vencimento via renovacao-sigma-cliente`);
}

// =====================================================================
// A: renovacao-sigma-cliente responde "unavailable" (falha ANTES do contexto)
// =====================================================================
{
  const { resultado, chamadas } = await rodarCenario("A-cliente-unavailable", {
    cliente: { status: 200, body: { outcome: "unavailable" } },
  });
  ok(resultado.resultado === "resultado_ambiguo", "A: cliente unavailable -> resultado_ambiguo");
  ok(resultado.detalhe === "falha ao ler cliente no Rocket antes da tentativa", "A: detalhe correto");
  checarInvariantes("A", chamadas);
  const chamouContexto = chamadas.some((c) => c.url.endsWith("/functions/v1/renovacao-sigma-contexto"));
  ok(!chamouContexto, "A: nem chega a chamar renovacao-sigma-contexto (bail antes)");
  ok(!String(resultado.detalhe).includes("chromium"), "A: nunca alcancou chromium.launch()");
}

// =====================================================================
// B: contexto -> id_nao_encontrado
// =====================================================================
{
  const { resultado, chamadas } = await rodarCenario("B-id-nao-encontrado", {
    cliente: { status: 200, body: { outcome: "success", cliente: { vencimento: "2026-12-08T20:59:59-03:00" } } },
    contexto: {
      status: 200,
      body: { outcome: "id_nao_encontrado", diagnostico: { paginaStatus: 200, paginaTamanho: 42000, totalBotoes: 97, botoesComNomeAlvo: 0 } },
    },
  });
  ok(resultado.resultado === "resultado_ambiguo", "B: id_nao_encontrado -> resultado_ambiguo");
  ok(resultado.detalhe === "id_cliente interno nao encontrado", "B: detalhe = 'id_cliente interno nao encontrado'");
  checarInvariantes("B", chamadas);

  const chamadaCtx = chamadas.find((c) => c.url.endsWith("/functions/v1/renovacao-sigma-contexto"));
  ok(chamadaCtx?.method === "POST", "B: contexto chamado via POST");
  ok(chamadaCtx?.headers?.["X-Internal-Token"] === CALLBACK_TOKEN, "B: X-Internal-Token enviado ao contexto");
  ok(chamadaCtx?.corpo?.publicId === PUBLIC_ID, "B: corpo do contexto tem publicId do token");
  ok(chamadaCtx?.corpo?.clienteNome === CLIENTE_NOME, "B: corpo do contexto tem clienteNome do snapshot do token");
  ok(chamadaCtx?.corpo?.telefone === TELEFONE, "B: corpo do contexto tem telefone do snapshot do token");
  ok(chamadaCtx?.corpo?.idClienteInterno === undefined, "B: fase 'antes' nao manda idClienteInterno");
  ok(!String(resultado.detalhe).includes("chromium"), "B: nunca alcancou chromium.launch()");
}

// =====================================================================
// C: contexto -> id_ambiguo
// =====================================================================
{
  const { resultado, chamadas } = await rodarCenario("C-id-ambiguo", {
    cliente: { status: 200, body: { outcome: "success", cliente: { vencimento: "2026-12-08T20:59:59-03:00" } } },
    contexto: { status: 200, body: { outcome: "id_ambiguo", candidatos: ["100", "200"] } },
  });
  ok(resultado.resultado === "resultado_ambiguo", "C: id_ambiguo -> resultado_ambiguo");
  ok(resultado.detalhe === "id_cliente interno ambiguo", "C: detalhe = 'id_cliente interno ambiguo'");
  checarInvariantes("C", chamadas);
  ok(!String(resultado.detalhe).includes("chromium"), "C: nunca alcancou chromium.launch()");
}

// =====================================================================
// D: contexto -> sessao_expirada
// =====================================================================
{
  const { resultado, chamadas } = await rodarCenario("D-sessao-expirada", {
    cliente: { status: 200, body: { outcome: "success", cliente: { vencimento: "2026-12-08T20:59:59-03:00" } } },
    contexto: { status: 200, body: { outcome: "sessao_expirada", detalhe: "sessao invalida (login)" } },
  });
  ok(resultado.resultado === "sessao_expirada", "D: contexto sessao_expirada -> reporta sessao_expirada");
  ok(resultado.detalhe === "sessao invalida (login)", "D: detalhe repassado do contexto");
  checarInvariantes("D", chamadas);
}

// =====================================================================
// E: contexto -> pacote_vazio
// =====================================================================
{
  const { resultado, chamadas } = await rodarCenario("E-pacote-vazio", {
    cliente: { status: 200, body: { outcome: "success", cliente: { vencimento: "2026-12-08T20:59:59-03:00" } } },
    contexto: { status: 200, body: { outcome: "pacote_vazio" } },
  });
  ok(resultado.resultado === "resultado_ambiguo", "E: pacote_vazio -> resultado_ambiguo");
  ok(resultado.detalhe === "Sigma nao informou o pacote atual (package vazio)", "E: detalhe correto");
  checarInvariantes("E", chamadas);
}

// =====================================================================
// F: contexto -> unavailable (etapa sigma_info)
// =====================================================================
{
  const { resultado, chamadas } = await rodarCenario("F-contexto-unavailable", {
    cliente: { status: 200, body: { outcome: "success", cliente: { vencimento: "2026-12-08T20:59:59-03:00" } } },
    contexto: { status: 200, body: { outcome: "unavailable", etapa: "sigma_info" } },
  });
  ok(resultado.resultado === "resultado_ambiguo", "F: contexto unavailable -> resultado_ambiguo");
  ok(resultado.detalhe === "falha ao obter contexto Sigma (sigma_info)", "F: detalhe cita a etapa");
  checarInvariantes("F", chamadas);
}

// =====================================================================
// G: contexto -> success -> fluxo AVANCA ate o Playwright (fake lanca)
//    Prova: contexto obtido, e ainda assim ZERO fetch direto ao Rocket.
// =====================================================================
{
  const { resultado, chamadas } = await rodarCenario("G-contexto-success", {
    cliente: { status: 200, body: { outcome: "success", cliente: { vencimento: "2026-12-08T20:59:59-03:00" } } },
    contexto: {
      status: 200,
      body: { outcome: "success", sessaoValida: true, idClienteInterno: "1569178", pacoteAtual: "1 MES - X", expiresAt: "2026-09-13T20:59:59-03:00" },
    },
  });
  ok(resultado.resultado === "resultado_ambiguo", "G: sucesso do contexto -> segue e cai no fake do Playwright (resultado_ambiguo)");
  ok(String(resultado.detalhe).includes("chromium.launch"), "G: detalhe prova que AVANCOU ate chromium.launch() (contexto obtido com sucesso)");
  checarInvariantes("G", chamadas);
  const chamadaCtx = chamadas.find((c) => c.url.endsWith("/functions/v1/renovacao-sigma-contexto"));
  ok(chamadaCtx?.corpo?.clienteNome === CLIENTE_NOME && chamadaCtx?.corpo?.telefone === TELEFONE, "G: contexto 'antes' chamado com nome+telefone do token");
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
