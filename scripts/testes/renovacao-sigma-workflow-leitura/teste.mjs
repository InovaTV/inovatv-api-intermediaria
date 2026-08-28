// Testes locais de scripts/renovacao-sigma-workflow.mjs (real, sem
// alteracao) na arquitetura NOVA (2026-08-28):
//   - o idClienteInterno e' resolvido pelo DOM RENDERIZADO do Playwright
//     (page.goto -> $$eval -> resolverIdInternoDoDom), NUNCA de HTML cru;
//   - so' DEPOIS de resolver o id o workflow chama renovacao-sigma-contexto
//     (Supabase) para pacoteAtual + expiresAt;
//   - o clique real e a operacao no Sigma continuam 100% no Playwright;
//   - depois do clique, renovacao-sigma-contexto de novo (so' expiresAt);
//   - o runner NUNCA faz fetch direto a app.rocketgestor.com.
//
// Roda main() de verdade, interceptando o fetch global e o pacote
// "playwright" (fake configuravel). O modulo real
// scripts/lib/resolver-id-interno-dom.mjs NAO e' fakeado -- a
// desambiguacao nome+telefone e' exercitada de verdade.
//
// Como rodar: npx tsx scripts/testes/renovacao-sigma-workflow-leitura/teste.mjs

import { register } from "node:module";

register("./mock-loader.mjs", import.meta.url);

const { configurarPlaywright, eventosPlaywright } = await import("./fake_playwright.mjs");

const PUBLIC_ID = "01a0271b-5a54-7d7e-8e4a-ef4c39730e0b";
const CLIENTE_NOME = "Meu Uso Testes";
const TELEFONE = "5517981625486";
const ID_INTERNO = "1569178";
const CALLBACK_TOKEN = "callback-token-de-teste";
const SUPABASE_URL = "https://exemplo-teste.supabase.co";

process.env.OPERACAO_ID = "operacao-de-teste-1234";
process.env.SUPABASE_URL = SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-teste";
process.env.RENOVACAO_SIGMA_CALLBACK_TOKEN = CALLBACK_TOKEN;

let falhas = 0;
function ok(cond, msg) {
  if (!cond) {
    falhas++;
    console.error(`FALHA: ${msg}`);
  } else {
    console.log(`ok: ${msg}`);
  }
}

// Sequencia monotonica compartilhada entre fetch mock e fake Playwright,
// pra permitir assercoes de ORDEM.
let seq = 0;
const proximoSeq = () => ++seq;

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
  chamadasFetch.push({ url: urlStr, method: opts.method ?? "GET", headers, corpo, seq: proximoSeq() });

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

async function rodarCenario(nome, { cliente, contexto, playwright } = {}) {
  seq = 0;
  chamadasFetch = [];
  configCliente = cliente ?? { status: 200, body: { outcome: "unavailable" } };
  configContexto = contexto ?? { status: 200, body: { outcome: "unavailable" } };
  configurarPlaywright({ proximoSeq, ...(playwright ?? {}) });
  novaPromessaResultado();

  const urlModulo = new URL("../../renovacao-sigma-workflow.mjs", import.meta.url).href + `?cenario=${nome}`;
  await import(urlModulo);

  const resultado = await Promise.race([promessaResultado, timeout(3000)]);
  // deixa o `finally` do Playwright (browser.close) e microtasks
  // pendentes assentarem antes de fotografar os eventos
  await new Promise((r) => setTimeout(r, 15));
  return { resultado, chamadas: [...chamadasFetch], eventos: [...eventosPlaywright()] };
}

// Invariantes checados em TODOS os cenarios
function checarInvariantes(rotulo, chamadas) {
  const bateuNoRocketDireto = chamadas.some((c) => c.url.includes("app.rocketgestor.com") || c.url.includes("/gerenciador/"));
  ok(!bateuNoRocketDireto, `${rotulo}: runner NUNCA faz fetch direto a app.rocketgestor.com / /gerenciador/`);
  const chamouCliente = chamadas.some((c) => c.url.endsWith("/functions/v1/renovacao-sigma-cliente"));
  ok(chamouCliente, `${rotulo}: leu vencimento via renovacao-sigma-cliente`);
}

const elemento = (id, nome, telefone) => ({ id, nome, telefone });

// =====================================================================
// A: renovacao-sigma-cliente (antes) unavailable -> bail ANTES do Playwright
// =====================================================================
{
  const { resultado, chamadas, eventos } = await rodarCenario("A-cliente-unavailable", {
    cliente: { status: 200, body: { outcome: "unavailable" } },
  });
  ok(resultado.resultado === "resultado_ambiguo", "A: cliente unavailable -> resultado_ambiguo");
  ok(resultado.detalhe === "falha ao ler cliente no Rocket antes da tentativa", "A: detalhe correto");
  checarInvariantes("A", chamadas);
  ok(!eventos.some((e) => e.tipo === "launch"), "A: Playwright nem chega a ser lancado (bail antes)");
  ok(!chamadas.some((c) => c.url.endsWith("/functions/v1/renovacao-sigma-contexto")), "A: contexto Sigma nao e' consultado");
}

// =====================================================================
// B: DOM sem nenhum elemento btn_add_pagamento_ -> id_cliente interno nao encontrado
// =====================================================================
{
  const { resultado, chamadas, eventos } = await rodarCenario("B-zero-elementos", {
    cliente: { status: 200, body: { outcome: "success", cliente: { vencimento: "2026-09-13T20:59:59-03:00" } } },
    playwright: { elementos: [] },
  });
  ok(resultado.resultado === "resultado_ambiguo", "B: zero elementos -> resultado_ambiguo");
  ok(resultado.detalhe === "id_cliente interno nao encontrado", "B: detalhe = 'id_cliente interno nao encontrado'");
  checarInvariantes("B", chamadas);
  ok(eventos.some((e) => e.tipo === "goto") && eventos.some((e) => e.tipo === "$$eval"), "B: o Playwright ABRIU a pagina e leu o DOM ($$eval)");
  ok(!chamadas.some((c) => c.url.endsWith("/functions/v1/renovacao-sigma-contexto")), "B: contexto Sigma NAO e' consultado (bail antes)");
  ok(eventos.some((e) => e.tipo === "close"), "B: browser.close() rodou (finally)");
}

// =====================================================================
// C: DOM com 2 elementos = mesmo nome+telefone, ids distintos -> ambiguo
// =====================================================================
{
  const { resultado, chamadas } = await rodarCenario("C-dois-matches", {
    cliente: { status: 200, body: { outcome: "success", cliente: { vencimento: "2026-09-13T20:59:59-03:00" } } },
    playwright: {
      elementos: [
        elemento("100", CLIENTE_NOME, TELEFONE),
        elemento("200", CLIENTE_NOME, TELEFONE),
        elemento("999", "Outro", "5511000000000"),
      ],
    },
  });
  ok(resultado.resultado === "resultado_ambiguo", "C: 2 ids p/ mesmo nome+telefone -> resultado_ambiguo");
  ok(resultado.detalhe === "id_cliente interno ambiguo", "C: detalhe = 'id_cliente interno ambiguo'");
  checarInvariantes("C", chamadas);
  ok(!chamadas.some((c) => c.url.endsWith("/functions/v1/renovacao-sigma-contexto")), "C: contexto Sigma NAO e' consultado");
}

// =====================================================================
// C2: 1 elemento com nome certo mas telefone divergente -> nao encontrado
//     (a desambiguacao por telefone e' exercitada de verdade)
// =====================================================================
{
  const { resultado } = await rodarCenario("C2-telefone-diverge", {
    cliente: { status: 200, body: { outcome: "success", cliente: { vencimento: "2026-09-13T20:59:59-03:00" } } },
    playwright: { elementos: [elemento(ID_INTERNO, CLIENTE_NOME, "5511000009999")] },
  });
  ok(resultado.resultado === "resultado_ambiguo" && resultado.detalhe === "id_cliente interno nao encontrado", "C2: nome certo + telefone divergente -> nao encontrado");
}

// =====================================================================
// C3: telefone com formatacao (o do DOM), mesmo numero -> resolve (1 match)
//     -> segue e cai no contexto (sessao_expirada aqui, so' pra parar)
// =====================================================================
{
  const { resultado, chamadas } = await rodarCenario("C3-telefone-formatado", {
    cliente: { status: 200, body: { outcome: "success", cliente: { vencimento: "2026-09-13T20:59:59-03:00" } } },
    contexto: { status: 200, body: { outcome: "sessao_expirada", detalhe: "sessao invalida (login)" } },
    playwright: { elementos: [elemento(ID_INTERNO, CLIENTE_NOME, "+55 (17) 98162-5486")] },
  });
  ok(resultado.resultado === "sessao_expirada", "C3: telefone formatado no DOM casa (normalizado) -> resolveu 1, seguiu ate o contexto");
  const ctx = chamadas.find((c) => c.url.endsWith("/functions/v1/renovacao-sigma-contexto"));
  ok(ctx?.corpo?.idClienteInterno === ID_INTERNO, "C3: contexto chamado com { idClienteInterno } (so' o id)");
  ok(ctx?.corpo?.publicId === undefined && ctx?.corpo?.clienteNome === undefined, "C3: contexto NAO recebe mais publicId/clienteNome/telefone");
}

// =====================================================================
// D: 1 match -> contexto ANTES -> pacote_vazio
//    + ASSERCAO DE ORDEM: goto/$$eval do Playwright ANTES do fetch ao contexto
// =====================================================================
{
  const { resultado, chamadas, eventos } = await rodarCenario("D-pacote-vazio", {
    cliente: { status: 200, body: { outcome: "success", cliente: { vencimento: "2026-09-13T20:59:59-03:00" } } },
    contexto: { status: 200, body: { outcome: "pacote_vazio" } },
    playwright: { elementos: [elemento(ID_INTERNO, CLIENTE_NOME, TELEFONE)] },
  });
  ok(resultado.resultado === "resultado_ambiguo" && resultado.detalhe === "Sigma nao informou o pacote atual (package vazio)", "D: contexto pacote_vazio -> resultado_ambiguo");
  checarInvariantes("D", chamadas);

  const seqGoto = eventos.find((e) => e.tipo === "goto")?.seq;
  const seqEval = eventos.find((e) => e.tipo === "$$eval")?.seq;
  const seqCtx = chamadas.find((c) => c.url.endsWith("/functions/v1/renovacao-sigma-contexto"))?.seq;
  ok(typeof seqGoto === "number" && typeof seqEval === "number" && typeof seqCtx === "number", "D: goto, $$eval e contexto todos aconteceram");
  ok(seqGoto < seqCtx && seqEval < seqCtx, "D: o Playwright (goto + $$eval) acontece ANTES de consultar o contexto Sigma");
}

// =====================================================================
// F: 1 match -> contexto ANTES -> unavailable (etapa sigma_info)
// =====================================================================
{
  const { resultado, chamadas } = await rodarCenario("F-contexto-unavailable", {
    cliente: { status: 200, body: { outcome: "success", cliente: { vencimento: "2026-09-13T20:59:59-03:00" } } },
    contexto: { status: 200, body: { outcome: "unavailable", etapa: "sigma_info" } },
    playwright: { elementos: [elemento(ID_INTERNO, CLIENTE_NOME, TELEFONE)] },
  });
  ok(resultado.resultado === "resultado_ambiguo" && resultado.detalhe === "falha ao obter contexto Sigma (sigma_info)", "F: contexto unavailable -> resultado_ambiguo com a etapa");
  checarInvariantes("F", chamadas);
}

// =====================================================================
// G: caminho feliz completo -> "sucesso"
// =====================================================================
{
  const { resultado, chamadas, eventos } = await rodarCenario("G-sucesso", {
    cliente: {
      status: 200,
      // 1a chamada (antes) e 2a chamada (depois) usam o MESMO fake, mas
      // a comparacao rocketMudou compara com o expiresAt do contexto,
      // e o vencimento aqui muda so' se configCliente mudar. Pra ter
      // rocketMudou=true, o fake devolve sempre o mesmo vencimento
      // "antes"; o teste forca a mudanca no expiresAt via contexto e no
      // vencimento via... -> usamos dois estados sequenciais abaixo.
      body: { outcome: "success", cliente: { vencimento: "2026-09-13T20:59:59-03:00" } },
    },
    contexto: {
      status: 200,
      body: { outcome: "success", sessaoValida: true, pacoteAtual: "1 MES - X", expiresAt: "2026-09-13T20:59:59-03:00" },
    },
    playwright: {
      elementos: [elemento(ID_INTERNO, CLIENTE_NOME, TELEFONE)],
      opcoesSelect: ["1 MES - X - 1 creditos - 1 tela(s)"],
    },
  });
  // Com cliente/contexto devolvendo SEMPRE os mesmos valores antes/depois,
  // rocketMudou=false e sigmaMudou=false -> "falha" (nao "sucesso").
  // Isso ja exercita o caminho feliz INTEIRO ate o veredito.
  ok(resultado.resultado === "falha", "G: fluxo completo ate o veredito -- sem mudanca antes/depois -> 'falha' (esperado com o fake estatico)");
  ok(resultado.detalhe === "vencimento nao mudou em nenhum dos dois sistemas apos o clique", "G: detalhe do veredito 'falha'");
  checarInvariantes("G", chamadas);

  // O clique real e a operacao ficaram no Playwright:
  ok(eventos.some((e) => e.tipo === "click" && e.sel === `#btn_add_pagamento_${ID_INTERNO}`), "G: clicou #btn_add_pagamento_{id} (Playwright)");
  ok(eventos.some((e) => e.tipo === "check" && e.sel === 'input[name="renovar_painel"]'), "G: marcou renovar_painel (Playwright)");
  ok(eventos.some((e) => e.tipo === "selectOption" && e.label === "1 MES - X - 1 creditos - 1 tela(s)"), "G: selecionou o pacote por prefixo (Playwright)");
  ok(eventos.some((e) => e.tipo === "click" && e.sel === "#btn_adicionar_pagamento"), "G: clicou Salvar (Playwright)");
  ok(eventos.some((e) => e.tipo === "close"), "G: browser.close() rodou");

  // contexto chamado 2x (antes e depois), sempre so' com { idClienteInterno }
  const ctxCalls = chamadas.filter((c) => c.url.endsWith("/functions/v1/renovacao-sigma-contexto"));
  ok(ctxCalls.length === 2, "G: renovacao-sigma-contexto chamado 2x (antes e depois do clique)");
  ok(ctxCalls.every((c) => c.corpo?.idClienteInterno === ID_INTERNO && c.corpo?.publicId === undefined), "G: as 2 chamadas ao contexto sao { idClienteInterno } (sem publicId)");
  // ordem: goto/$$eval < 1o contexto < clique Salvar < 2o contexto
  const seqEval = eventos.find((e) => e.tipo === "$$eval").seq;
  const seqSalvar = eventos.find((e) => e.tipo === "click" && e.sel === "#btn_adicionar_pagamento").seq;
  ok(seqEval < ctxCalls[0].seq && ctxCalls[0].seq < seqSalvar && seqSalvar < ctxCalls[1].seq, "G: ordem correta -- DOM($$eval) -> contexto antes -> clique Salvar -> contexto depois");
}

// =====================================================================
// G2: caminho feliz com MUDANCA real antes/depois -> "sucesso"
//     (cliente e contexto devolvem valores diferentes na 2a chamada)
// =====================================================================
{
  // configCliente/configContexto alternam por chamada
  let nCliente = 0;
  let nContexto = 0;
  const clienteSeq = [
    { outcome: "success", cliente: { vencimento: "2026-09-13T20:59:59-03:00" } }, // antes
    { outcome: "success", cliente: { vencimento: "2026-10-13T20:59:59-03:00" } }, // depois (mudou)
  ];
  const contextoSeq = [
    { outcome: "success", sessaoValida: true, pacoteAtual: "1 MES - X", expiresAt: "2026-09-13T20:59:59-03:00" }, // antes
    { outcome: "success", sessaoValida: true, pacoteAtual: "1 MES - X", expiresAt: "2026-10-13T20:59:59-03:00" }, // depois (mudou)
  ];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.endsWith("/functions/v1/renovacao-sigma-cliente")) {
      chamadasFetch.push({ url: u, method: "POST", headers: opts.headers ?? {}, corpo: JSON.parse(opts.body ?? "{}"), seq: proximoSeq() });
      return new Response(JSON.stringify(clienteSeq[Math.min(nCliente++, clienteSeq.length - 1)]), { status: 200 });
    }
    if (u.endsWith("/functions/v1/renovacao-sigma-contexto")) {
      chamadasFetch.push({ url: u, method: "POST", headers: opts.headers ?? {}, corpo: JSON.parse(opts.body ?? "{}"), seq: proximoSeq() });
      return new Response(JSON.stringify(contextoSeq[Math.min(nContexto++, contextoSeq.length - 1)]), { status: 200 });
    }
    return fetchOriginal(url, opts);
  };

  const { resultado, chamadas } = await rodarCenario("G2-sucesso-real", {
    playwright: {
      elementos: [elemento(ID_INTERNO, CLIENTE_NOME, TELEFONE)],
      opcoesSelect: ["1 MES - X - 1 creditos - 1 tela(s)"],
    },
  });
  globalThis.fetch = fetchOriginal;

  ok(resultado.resultado === "sucesso", "G2: vencimento E expiresAt mudaram antes/depois -> 'sucesso'");
  ok(resultado.vencimentoConfirmado === "2026-10-13T20:59:59-03:00", "G2: vencimentoConfirmado = vencimento 'depois'");
  checarInvariantes("G2", chamadas);
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
