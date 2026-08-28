// Testes locais de scripts/renovacao-sigma-workflow.mjs (real, sem
// alteracao) na arquitetura de 2026-08-28 + correcao do seletor:
//   - o idClienteInterno e' resolvido pelo DOM RENDERIZADO do Playwright.
//     Na UI atual do Rocket, a fonte e' o botao "Add Pagamento":
//       button[data-bs-target="#modal-add-pagamento"] com atributo
//       `cliente_id` (mais `nome`/`telefone`).
//     O botao "Editar" (data-bs-target="#modal-editar") TAMBEM tem
//     cliente_id+nome+telefone -- o seletor e' escopado por
//     data-bs-target="#modal-add-pagamento", entao "Editar" nunca e'
//     selecionado.
//   - so' DEPOIS de resolver o id o workflow chama renovacao-sigma-contexto
//     (Supabase) para pacoteAtual + expiresAt;
//   - o clique real acontece no MESMO seletor, escopado pelo cliente_id;
//   - depois do clique, renovacao-sigma-contexto de novo (so' expiresAt);
//   - o runner NUNCA faz fetch direto a app.rocketgestor.com.
//
// O modulo real scripts/lib/resolver-id-interno-dom.mjs NAO e' fakeado
// -- a desambiguacao nome+telefone e' exercitada de verdade. O fake do
// Playwright e' seletor-ciente (ver fake_playwright.mjs).
//
// Como rodar: npx tsx scripts/testes/renovacao-sigma-workflow-leitura/teste.mjs

import { register } from "node:module";

register("./mock-loader.mjs", import.meta.url);

const { configurarPlaywright, eventosPlaywright } = await import("./fake_playwright.mjs");

const PUBLIC_ID = "01a0271b-5a54-7d7e-8e4a-ef4c39730e0b";
const CLIENTE_NOME = "Meu Uso Testes";
const TELEFONE = "5517981625486";
const ID_INTERNO = "1569178";
const SEL_ADD = '[data-bs-target="#modal-add-pagamento"][cliente_id]';
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

// Sequencia monotonica compartilhada entre fetch mock e fake Playwright.
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

  // Renovacao em lote (Etapa 1): o workflow consulta renovacoes_lote
  // pelo operacao_id antes do caminho individual. Nestes cenarios nao
  // ha' lote -> [] -> segue individual, byte a byte como antes.
  if (urlStr.includes("/rest/v1/renovacoes_lote")) {
    return new Response(JSON.stringify([]), { status: 200 });
  }
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

async function rodarCenario(nome, { cliente, contexto, dom, opcoesSelect } = {}) {
  seq = 0;
  chamadasFetch = [];
  configCliente = cliente ?? { status: 200, body: { outcome: "unavailable" } };
  configContexto = contexto ?? { status: 200, body: { outcome: "unavailable" } };
  configurarPlaywright({ proximoSeq, dom: dom ?? [], opcoesSelect: opcoesSelect ?? [] });
  novaPromessaResultado();

  const urlModulo = new URL("../../renovacao-sigma-workflow.mjs", import.meta.url).href + `?cenario=${nome}`;
  await import(urlModulo);

  const resultado = await Promise.race([promessaResultado, timeout(3000)]);
  await new Promise((r) => setTimeout(r, 15)); // deixa o finally (browser.close) assentar
  return { resultado, chamadas: [...chamadasFetch], eventos: [...eventosPlaywright()] };
}

function checarInvariantes(rotulo, chamadas) {
  const bateuNoRocketDireto = chamadas.some((c) => c.url.includes("app.rocketgestor.com") || c.url.includes("/gerenciador/"));
  ok(!bateuNoRocketDireto, `${rotulo}: runner NUNCA faz fetch direto a app.rocketgestor.com / /gerenciador/`);
  const chamouCliente = chamadas.some((c) => c.url.endsWith("/functions/v1/renovacao-sigma-cliente"));
  ok(chamouCliente, `${rotulo}: leu vencimento via renovacao-sigma-cliente`);
}

// --- descritores de elemento da UI atual do Rocket ---
const btnAddPag = (id, tel = "+55 17 98162-5486", nome = CLIENTE_NOME) => ({
  tag: "button",
  class: "btn btn-success flex-fill flex-sm-grow-0",
  "data-bs-target": "#modal-add-pagamento",
  "data-bs-toggle": "modal",
  cliente_id: id,
  nome,
  telefone: tel,
});
const btnEditar = (id, tel = "+55 17 98162-5486", nome = CLIENTE_NOME) => ({
  tag: "button",
  class: "btn btn-warning flex-fill flex-sm-grow-0",
  "data-bs-target": "#modal-editar",
  "data-bs-toggle": "modal",
  cliente_id: id,
  nome,
  telefone: tel,
});
const btnEnviarMsg = (id) => ({
  tag: "button",
  class: "btn btn-primary flex-fill flex-sm-grow-0",
  "data-bs-target": "#modal_enviar_mensagem_clientes",
  "data-bs-toggle": "modal",
  cliente_id: id,
  usuario: "828667229",
});

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
// B: pagina sem "Add Pagamento" (so' "Editar" e "Enviar Mensagem", que
//    tambem tem cliente_id) -> id_cliente interno nao encontrado.
//    Prova: "Editar" tem cliente_id mas NAO e' selecionado.
// =====================================================================
{
  const { resultado, chamadas, eventos } = await rodarCenario("B-so-editar", {
    cliente: { status: 200, body: { outcome: "success", cliente: { vencimento: "2026-09-13T20:59:59-03:00" } } },
    dom: [btnEditar(ID_INTERNO), btnEnviarMsg(ID_INTERNO)],
  });
  ok(resultado.resultado === "resultado_ambiguo", "B: sem 'Add Pagamento' -> resultado_ambiguo");
  ok(resultado.detalhe === "id_cliente interno nao encontrado", "B: detalhe = 'id_cliente interno nao encontrado'");
  checarInvariantes("B", chamadas);
  const evalEv = eventos.find((e) => e.tipo === "$$eval");
  ok(evalEv && evalEv.sel === SEL_ADD, "B: $$eval usou o seletor '[data-bs-target=\"#modal-add-pagamento\"][cliente_id]'");
  ok(!chamadas.some((c) => c.url.endsWith("/functions/v1/renovacao-sigma-contexto")), "B: contexto Sigma NAO e' consultado (bail antes)");
  ok(eventos.some((e) => e.tipo === "close"), "B: browser.close() rodou (finally)");
}

// =====================================================================
// B2: pagina com "Editar" (cliente_id=999) + "Add Pagamento"
//     (cliente_id=1569178) -> seletor pega SO' o Add Pagamento -> resolve
//     1569178 e segue ate o contexto. Prova que "Editar" e' ignorado
//     mesmo tendo cliente_id+nome+telefone iguais.
// =====================================================================
{
  const { resultado, chamadas } = await rodarCenario("B2-editar-mais-addpag", {
    cliente: { status: 200, body: { outcome: "success", cliente: { vencimento: "2026-09-13T20:59:59-03:00" } } },
    contexto: { status: 200, body: { outcome: "pacote_vazio" } }, // so' pra parar limpo depois de resolver
    dom: [btnEditar("999"), btnAddPag(ID_INTERNO), btnEnviarMsg(ID_INTERNO)],
  });
  ok(
    resultado.resultado === "resultado_ambiguo" && resultado.detalhe === "Sigma nao informou o pacote atual (package vazio)",
    "B2: resolveu o id do 'Add Pagamento' e chamou o contexto (parou em pacote_vazio)",
  );
  const ctx = chamadas.find((c) => c.url.endsWith("/functions/v1/renovacao-sigma-contexto"));
  ok(ctx?.corpo?.idClienteInterno === ID_INTERNO, "B2: contexto chamado com o cliente_id do 'Add Pagamento' (1569178), NAO o 999 do 'Editar'");
}

// =====================================================================
// C: dois botoes "Add Pagamento" com mesmo nome+telefone, ids distintos
//    -> ambiguo
// =====================================================================
{
  const { resultado, chamadas } = await rodarCenario("C-dois-addpag", {
    cliente: { status: 200, body: { outcome: "success", cliente: { vencimento: "2026-09-13T20:59:59-03:00" } } },
    dom: [btnAddPag("100"), btnAddPag("200"), btnEnviarMsg("300")],
  });
  ok(resultado.resultado === "resultado_ambiguo" && resultado.detalhe === "id_cliente interno ambiguo", "C: 2 'Add Pagamento' p/ mesmo nome+telefone -> ambiguo");
  checarInvariantes("C", chamadas);
  ok(!chamadas.some((c) => c.url.endsWith("/functions/v1/renovacao-sigma-contexto")), "C: contexto Sigma NAO e' consultado");
}

// =====================================================================
// C2: 1 "Add Pagamento" com nome certo mas telefone divergente -> nada
// =====================================================================
{
  const { resultado } = await rodarCenario("C2-telefone-diverge", {
    cliente: { status: 200, body: { outcome: "success", cliente: { vencimento: "2026-09-13T20:59:59-03:00" } } },
    dom: [btnAddPag(ID_INTERNO, "5511000009999")],
  });
  ok(resultado.resultado === "resultado_ambiguo" && resultado.detalhe === "id_cliente interno nao encontrado", "C2: nome certo + telefone divergente -> nao encontrado");
}

// =====================================================================
// C3: telefone formatado no atributo -> normalizado casa -> resolve 1
// =====================================================================
{
  const { resultado, chamadas } = await rodarCenario("C3-telefone-formatado", {
    cliente: { status: 200, body: { outcome: "success", cliente: { vencimento: "2026-09-13T20:59:59-03:00" } } },
    contexto: { status: 200, body: { outcome: "sessao_expirada", detalhe: "sessao invalida (login)" } },
    dom: [btnAddPag(ID_INTERNO, "+55 (17) 98162-5486")],
  });
  ok(resultado.resultado === "sessao_expirada", "C3: telefone formatado no atributo casa (normalizado) -> resolveu 1, seguiu ate o contexto");
  const ctx = chamadas.find((c) => c.url.endsWith("/functions/v1/renovacao-sigma-contexto"));
  ok(ctx?.corpo?.idClienteInterno === ID_INTERNO, "C3: contexto chamado com { idClienteInterno } (so' o id)");
  ok(ctx?.corpo?.publicId === undefined && ctx?.corpo?.clienteNome === undefined, "C3: contexto NAO recebe publicId/clienteNome/telefone");
}

// =====================================================================
// D: 1 match -> contexto ANTES -> pacote_vazio + ASSERCAO DE ORDEM
// =====================================================================
{
  const { resultado, chamadas, eventos } = await rodarCenario("D-pacote-vazio", {
    cliente: { status: 200, body: { outcome: "success", cliente: { vencimento: "2026-09-13T20:59:59-03:00" } } },
    contexto: { status: 200, body: { outcome: "pacote_vazio" } },
    dom: [btnAddPag(ID_INTERNO)],
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
    dom: [btnAddPag(ID_INTERNO)],
  });
  ok(resultado.resultado === "resultado_ambiguo" && resultado.detalhe === "falha ao obter contexto Sigma (sigma_info)", "F: contexto unavailable -> resultado_ambiguo com a etapa");
  checarInvariantes("F", chamadas);
}

// =====================================================================
// G: caminho feliz completo -> veredito. Clique no botao "Add Pagamento".
// =====================================================================
{
  const { resultado, chamadas, eventos } = await rodarCenario("G-veredito", {
    cliente: { status: 200, body: { outcome: "success", cliente: { vencimento: "2026-09-13T20:59:59-03:00" } } },
    contexto: {
      status: 200,
      body: { outcome: "success", sessaoValida: true, pacoteAtual: "1 MES - X", expiresAt: "2026-09-13T20:59:59-03:00" },
    },
    dom: [btnEditar("999"), btnAddPag(ID_INTERNO)],
    opcoesSelect: ["1 MES - X - 1 creditos - 1 tela(s)"],
  });
  // valores identicos antes/depois -> rocketMudou/sigmaMudou false -> "falha" (exercita o caminho feliz INTEIRO)
  ok(resultado.resultado === "falha", "G: fluxo completo ate o veredito -- sem mudanca antes/depois -> 'falha' (esperado com fake estatico)");
  ok(resultado.detalhe === "vencimento nao mudou em nenhum dos dois sistemas apos o clique", "G: detalhe do veredito 'falha'");
  checarInvariantes("G", chamadas);

  const selClique = `[data-bs-target="#modal-add-pagamento"][cliente_id="${ID_INTERNO}"]`;
  ok(eventos.some((e) => e.tipo === "click" && e.sel === selClique), "G: clique no botao 'Add Pagamento' (seletor com data-bs-target=#modal-add-pagamento + cliente_id)");
  ok(!eventos.some((e) => e.tipo === "click" && String(e.sel).includes("#modal-editar")), "G: NUNCA clica no alvo de 'Editar' (#modal-editar)");
  ok(eventos.some((e) => e.tipo === "check" && e.sel === 'input[name="renovar_painel"]'), "G: marcou renovar_painel");
  ok(eventos.some((e) => e.tipo === "selectOption" && e.label === "1 MES - X - 1 creditos - 1 tela(s)"), "G: selecionou o pacote por prefixo");
  ok(eventos.some((e) => e.tipo === "click" && e.sel === "#btn_adicionar_pagamento"), "G: clicou Salvar (#btn_adicionar_pagamento)");
  ok(eventos.some((e) => e.tipo === "close"), "G: browser.close() rodou");

  const ctxCalls = chamadas.filter((c) => c.url.endsWith("/functions/v1/renovacao-sigma-contexto"));
  ok(ctxCalls.length === 2, "G: renovacao-sigma-contexto chamado 2x (antes e depois do clique)");
  ok(ctxCalls.every((c) => c.corpo?.idClienteInterno === ID_INTERNO && c.corpo?.publicId === undefined), "G: as 2 chamadas ao contexto sao { idClienteInterno } (sem publicId)");
  const seqEval = eventos.find((e) => e.tipo === "$$eval").seq;
  const seqSalvar = eventos.find((e) => e.tipo === "click" && e.sel === "#btn_adicionar_pagamento").seq;
  ok(seqEval < ctxCalls[0].seq && ctxCalls[0].seq < seqSalvar && seqSalvar < ctxCalls[1].seq, "G: ordem -- $$eval -> contexto antes -> Salvar -> contexto depois");
}

// =====================================================================
// G2: caminho feliz com MUDANCA real antes/depois -> "sucesso"
// =====================================================================
{
  let nCliente = 0;
  let nContexto = 0;
  const clienteSeq = [
    { outcome: "success", cliente: { vencimento: "2026-09-13T20:59:59-03:00" } },
    { outcome: "success", cliente: { vencimento: "2026-10-13T20:59:59-03:00" } },
  ];
  const contextoSeq = [
    { outcome: "success", sessaoValida: true, pacoteAtual: "1 MES - X", expiresAt: "2026-09-13T20:59:59-03:00" },
    { outcome: "success", sessaoValida: true, pacoteAtual: "1 MES - X", expiresAt: "2026-10-13T20:59:59-03:00" },
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
    dom: [btnAddPag(ID_INTERNO)],
    opcoesSelect: ["1 MES - X - 1 creditos - 1 tela(s)"],
  });
  globalThis.fetch = fetchOriginal;

  ok(resultado.resultado === "sucesso", "G2: vencimento E expiresAt mudaram antes/depois -> 'sucesso'");
  ok(resultado.vencimentoConfirmado === "2026-10-13T20:59:59-03:00", "G2: vencimentoConfirmado = vencimento 'depois'");
  checarInvariantes("G2", chamadas);
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
