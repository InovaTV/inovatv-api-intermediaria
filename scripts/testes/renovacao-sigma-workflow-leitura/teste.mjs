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
  if (urlStr.includes("/rest/v1/rpc/unitv_dealer_token_ler")) {
    return new Response(JSON.stringify("tkn-vault-runner"), { status: 200 }); // Fase 2A (cenarios Sigma nem consultam)
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
// Iteracao 1 (2026-08-29): a Camada B pode re-clicar ate 3x com backoff
// real [1000, 2000]ms -- um cenario que esgota as tentativas leva ~3s.
const TIMEOUT_CENARIO_MS = 20000;

async function rodarCenario(nome, { cliente, contexto, dom, opcoesSelect } = {}) {
  seq = 0;
  chamadasFetch = [];
  configCliente = cliente ?? { status: 200, body: { outcome: "unavailable" } };
  configContexto = contexto ?? { status: 200, body: { outcome: "unavailable" } };
  configurarPlaywright({ proximoSeq, dom: dom ?? [], opcoesSelect: opcoesSelect ?? [] });
  novaPromessaResultado();

  const urlModulo = new URL("../../renovacao-sigma-workflow.mjs", import.meta.url).href + `?cenario=${nome}`;
  await import(urlModulo);

  const resultado = await Promise.race([promessaResultado, timeout(TIMEOUT_CENARIO_MS)]);
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
// F: 1 match -> contexto ANTES -> unavailable (a Camada A ja re-tentou
//    dentro da EF). O workflow -> resultado_ambiguo + sigmaIndisponivel,
//    NUNCA "falha", e NEM CHEGA a clicar. (spec Iteracao 1, testes 11/13)
// =====================================================================
{
  const { resultado, chamadas, eventos } = await rodarCenario("F-contexto-unavailable", {
    cliente: { status: 200, body: { outcome: "success", cliente: { vencimento: "2026-09-13T20:59:59-03:00" } } },
    contexto: { status: 200, body: { outcome: "unavailable", etapa: "sigma_info_auth", tentativas: 4 } },
    dom: [btnAddPag(ID_INTERNO)],
  });
  ok(resultado.resultado === "resultado_ambiguo", "F: ctxAntes unavailable -> resultado_ambiguo (nunca 'falha')");
  ok(resultado.sigmaIndisponivel === true, "F: ctxAntes unavailable -> carrega sigmaIndisponivel:true");
  ok(
    typeof resultado.detalhe === "string" &&
      resultado.detalhe.includes("painel Sigma indisponivel (auth) na leitura de contexto") &&
      resultado.detalhe.includes("sigma_info_auth") &&
      resultado.detalhe.includes("4 tentativas"),
    "F: detalhe cita 'painel Sigma indisponivel (auth)', a etapa e as 4 tentativas da Camada A",
  );
  ok(!eventos.some((e) => e.tipo === "click" && e.sel === "#btn_adicionar_pagamento"), "F: NUNCA clica Salvar quando o contexto antes ja veio unavailable");
  checarInvariantes("F", chamadas);
}

// =====================================================================
// G (revisao de seguranca): fake ESTATICO (nada muda) + ctxDepois=success.
//    O POST /pagamento/add/ roda 1x SO'; 1 reconsulta + 1 reconsulta
//    EXTRA (sem novo clique) e, continuando sem mudanca -> "falha".
//    PROVA CENTRAL: #btn_adicionar_pagamento clicado EXATAMENTE 1x.
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
  ok(resultado.resultado === "falha", "G: sem mudanca (com reconsulta extra) + painel autenticado -> 'falha'");
  ok(
    resultado.detalhe === "vencimento nao mudou em nenhum dos dois sistemas apos o clique (com reconsulta extra)",
    "G: detalhe cita 'apos o clique (com reconsulta extra)' -- nunca fala em multiplas tentativas de clique",
  );
  ok(resultado.sigmaIndisponivel === undefined, "G: 'falha' NAO carrega sigmaIndisponivel (painel respondeu autenticado)");
  checarInvariantes("G", chamadas);

  const salvarClicks = eventos.filter((e) => e.tipo === "click" && e.sel === "#btn_adicionar_pagamento");
  ok(salvarClicks.length === 1, "G: POST /pagamento/add/ (#btn_adicionar_pagamento) executado EXATAMENTE 1x -- NUNCA repetido");
  ok(!eventos.some((e) => e.tipo === "click" && String(e.sel).includes("#modal-editar")), "G: NUNCA clica no alvo de 'Editar' (#modal-editar)");
  ok(eventos.some((e) => e.tipo === "check" && e.sel === 'input[name="renovar_painel"]'), "G: marcou renovar_painel");
  ok(eventos.some((e) => e.tipo === "selectOption" && e.label === "1 MES - X - 1 creditos - 1 tela(s)"), "G: selecionou o pacote por prefixo");
  ok(eventos.some((e) => e.tipo === "waitForLoadState"), "G: espera ORIENTADA AO RESULTADO (waitForLoadState) apos o clique -- nao mais wait cego");
  ok(eventos.filter((e) => e.tipo === "goto").length === 1, "G: page.goto 1x so' (carga inicial) -- nao renavega, nao ha' re-tentativa de clique");
  ok(eventos.some((e) => e.tipo === "close"), "G: browser.close() rodou");

  const ctxCalls = chamadas.filter((c) => c.url.endsWith("/functions/v1/renovacao-sigma-contexto"));
  ok(ctxCalls.length === 3, "G: contexto chamado 3x (antes + reconsulta + reconsulta EXTRA)");
  ok(ctxCalls.every((c) => c.corpo?.idClienteInterno === ID_INTERNO && c.corpo?.publicId === undefined), "G: todas as chamadas ao contexto sao { idClienteInterno } (sem publicId)");
  const clienteCalls = chamadas.filter((c) => c.url.endsWith("/functions/v1/renovacao-sigma-cliente"));
  ok(clienteCalls.length === 3, "G: renovacao-sigma-cliente chamado 3x (antes + reconsulta + reconsulta EXTRA)");
  const seqEval = eventos.find((e) => e.tipo === "$$eval").seq;
  ok(seqEval < ctxCalls[0].seq && ctxCalls[0].seq < salvarClicks[0].seq && salvarClicks[0].seq < ctxCalls[1].seq, "G: ordem -- $$eval -> contexto antes -> Salvar (1x) -> reconsulta");
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

// =====================================================================
// ITERACAO 1 (2026-08-29) -- Camada B (retry do CLIQUE de renovacao).
// Numeracao = spec da Iteracao 1 (11..15). F (acima) cobre "ctxAntes
// unavailable -> resultado_ambiguo + sigmaIndisponivel, sem clicar";
// G (acima) cobre "sem mudanca apos 3 tentativas -> falha".
// =====================================================================

// Roda um cenario com SEQUENCIAS de resposta para renovacao-sigma-cliente
// e renovacao-sigma-contexto (o ultimo item repete). Conta os cliques em
// #btn_adicionar_pagamento e as chamadas ao contexto.
async function rodarCenarioSeq(nome, { clienteSeq, contextoSeq, dom, opcoesSelect }) {
  let nCli = 0;
  let nCtx = 0;
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.endsWith("/functions/v1/renovacao-sigma-cliente")) {
      chamadasFetch.push({ url: u, method: "POST", headers: opts.headers ?? {}, corpo: JSON.parse(opts.body ?? "{}"), seq: proximoSeq() });
      return new Response(JSON.stringify(clienteSeq[Math.min(nCli++, clienteSeq.length - 1)]), { status: 200 });
    }
    if (u.endsWith("/functions/v1/renovacao-sigma-contexto")) {
      chamadasFetch.push({ url: u, method: "POST", headers: opts.headers ?? {}, corpo: JSON.parse(opts.body ?? "{}"), seq: proximoSeq() });
      return new Response(JSON.stringify(contextoSeq[Math.min(nCtx++, contextoSeq.length - 1)]), { status: 200 });
    }
    return fetchOriginal(url, opts);
  };
  try {
    return await rodarCenario(nome, { dom, opcoesSelect });
  } finally {
    globalThis.fetch = fetchOriginal;
  }
}

const CTX_OK = (exp) => ({ outcome: "success", sessaoValida: true, pacoteAtual: "1 MES - X", expiresAt: exp });
const CLI_OK = (venc) => ({ outcome: "success", cliente: { vencimento: venc } });
const V_A = "2026-09-13T20:59:59-03:00";
const V_B = "2026-10-13T20:59:59-03:00";
const OPC = ["1 MES - X - 1 creditos - 1 tela(s)"];

// helper: quantas vezes o POST /pagamento/add/ (clique em
// #btn_adicionar_pagamento) foi disparado nesse cenario.
const cliquesSalvar = (eventos) => eventos.filter((e) => e.tipo === "click" && e.sel === "#btn_adicionar_pagamento").length;

// spec 11: ctxAntes success (a Camada A ja re-tentou dentro da EF) e a
//          renovacao aplica -> sucesso. 1 clique. (o "unavailable x2
//          depois success" e' exercitado em rocket-sigma-contexto spec6.)
{
  const { resultado, chamadas, eventos } = await rodarCenarioSeq("11-ctxAntes-ok-aplica", {
    clienteSeq: [CLI_OK(V_A), CLI_OK(V_B)],
    contextoSeq: [CTX_OK(V_A), CTX_OK(V_B)],
    dom: [btnAddPag(ID_INTERNO)],
    opcoesSelect: OPC,
  });
  ok(resultado.resultado === "sucesso" && resultado.vencimentoConfirmado === V_B, "spec11: ctxAntes success + renovacao aplica -> sucesso");
  ok(cliquesSalvar(eventos) === 1, "spec11: POST /pagamento/add/ EXATAMENTE 1x");
  const ctxCalls = chamadas.filter((c) => c.url.endsWith("/functions/v1/renovacao-sigma-contexto"));
  ok(ctxCalls.length === 2, "spec11: contexto chamado 2x (antes + 1 reconsulta)");
}

// spec 12 (revisao de seguranca): 1a reconsulta pos-clique nao mudou nada
//          (ctxDepois=success). NAO re-clica -- faz UMA reconsulta EXTRA
//          (so' leitura). A reconsulta extra ja ve a mudanca -> sucesso.
//          POST continua 1x.
{
  const { resultado, chamadas, eventos } = await rodarCenarioSeq("12-reconsulta-extra-ve-mudanca", {
    clienteSeq: [CLI_OK(V_A), CLI_OK(V_A), CLI_OK(V_B)], // antes, 1a reconsulta (=), reconsulta EXTRA (mudou)
    contextoSeq: [CTX_OK(V_A), CTX_OK(V_A), CTX_OK(V_B)],
    dom: [btnAddPag(ID_INTERNO)],
    opcoesSelect: OPC,
  });
  ok(resultado.resultado === "sucesso" && resultado.vencimentoConfirmado === V_B, "spec12: 1a reconsulta '=', reconsulta EXTRA ve a mudanca -> sucesso");
  ok(cliquesSalvar(eventos) === 1, "spec12: POST /pagamento/add/ EXATAMENTE 1x -- reconsulta extra NUNCA re-clica");
  ok(eventos.filter((e) => e.tipo === "goto").length === 1, "spec12: page.goto 1x (nao renavega pra re-clicar)");
  const ctxCalls = chamadas.filter((c) => c.url.endsWith("/functions/v1/renovacao-sigma-contexto"));
  ok(ctxCalls.length === 3, "spec12: contexto 3x (antes + reconsulta + reconsulta EXTRA)");
  const cliCalls = chamadas.filter((c) => c.url.endsWith("/functions/v1/renovacao-sigma-cliente"));
  ok(cliCalls.length === 3, "spec12: renovacao-sigma-cliente 3x (antes + reconsulta + reconsulta EXTRA)");
  ok(resultado.sigmaIndisponivel === undefined, "spec12: sucesso NAO carrega sigmaIndisponivel");
}

// spec 12b: 1a reconsulta '=' + reconsulta EXTRA tambem '=' (painel
//           autenticado) -> "falha". POST continua 1x.
{
  const { resultado, chamadas, eventos } = await rodarCenarioSeq("12b-reconsulta-extra-nada-mudou", {
    clienteSeq: [CLI_OK(V_A)], // repete (nada muda em nenhuma reconsulta)
    contextoSeq: [CTX_OK(V_A)],
    dom: [btnAddPag(ID_INTERNO)],
    opcoesSelect: OPC,
  });
  ok(resultado.resultado === "falha", "spec12b: reconsulta + reconsulta EXTRA sem mudanca -> 'falha'");
  ok(resultado.detalhe === "vencimento nao mudou em nenhum dos dois sistemas apos o clique (com reconsulta extra)", "spec12b: detalhe cita a reconsulta extra");
  ok(cliquesSalvar(eventos) === 1, "spec12b: POST /pagamento/add/ EXATAMENTE 1x mesmo esgotando as leituras");
  const ctxCalls = chamadas.filter((c) => c.url.endsWith("/functions/v1/renovacao-sigma-contexto"));
  ok(ctxCalls.length === 3, "spec12b: contexto 3x (antes + reconsulta + reconsulta EXTRA)");
}

// spec 13: reconsulta pos-clique -> ctxDepois=unavailable (Camada A ja
//          se esgotou nessa leitura) -> resultado_ambiguo +
//          sigmaIndisponivel, NUNCA "falha", NUNCA re-clica, e sem
//          reconsulta extra (nao e' o caso "nada mudou").
{
  const { resultado, eventos } = await rodarCenarioSeq("13-ctxDepois-unavailable", {
    clienteSeq: [CLI_OK(V_A), CLI_OK(V_A)],
    contextoSeq: [CTX_OK(V_A), { outcome: "unavailable", etapa: "sigma_info_auth", tentativas: 4 }],
    dom: [btnAddPag(ID_INTERNO)],
    opcoesSelect: OPC,
  });
  ok(resultado.resultado === "resultado_ambiguo", "spec13: ctxDepois unavailable -> resultado_ambiguo (nunca 'falha')");
  ok(resultado.sigmaIndisponivel === true, "spec13: ctxDepois unavailable -> sigmaIndisponivel:true");
  ok(String(resultado.detalhe).includes("reconsulta pos-clique"), "spec13: detalhe cita a reconsulta pos-clique");
  ok(cliquesSalvar(eventos) === 1, "spec13: POST /pagamento/add/ EXATAMENTE 1x -- nunca re-clica sob duvida");
}

// spec 14: rocketMudou XOR sigmaMudou -> divergencia -> resultado_ambiguo,
//          sem reconsulta extra, sem re-clique.
{
  const { resultado, chamadas, eventos } = await rodarCenarioSeq("14-divergencia", {
    clienteSeq: [CLI_OK(V_A), CLI_OK(V_B)], // rocket MUDOU
    contextoSeq: [CTX_OK(V_A), CTX_OK(V_A)], // sigma NAO mudou
    dom: [btnAddPag(ID_INTERNO)],
    opcoesSelect: OPC,
  });
  ok(resultado.resultado === "resultado_ambiguo", "spec14: XOR (rocket mudou, sigma nao) -> resultado_ambiguo");
  ok(resultado.detalhe === "divergencia entre sistemas: rocketMudou=true, sigmaMudou=false", "spec14: detalhe da divergencia inalterado");
  ok(resultado.sigmaIndisponivel === undefined, "spec14: divergencia NAO e' sigmaIndisponivel");
  ok(cliquesSalvar(eventos) === 1, "spec14: POST /pagamento/add/ EXATAMENTE 1x");
  const ctxCalls = chamadas.filter((c) => c.url.endsWith("/functions/v1/renovacao-sigma-contexto"));
  ok(ctxCalls.length === 2, "spec14: contexto 2x (XOR decide na 1a reconsulta, sem reconsulta extra)");
}

// spec 15: caminho feliz na 1a reconsulta -> sucesso, ZERO extra,
//          nenhuma chamada a mais que antes da Iteracao 1 (contexto 2x,
//          clique 1x).
{
  const { resultado, chamadas, eventos } = await rodarCenarioSeq("15-feliz-1a", {
    clienteSeq: [CLI_OK(V_A), CLI_OK(V_B)],
    contextoSeq: [CTX_OK(V_A), CTX_OK(V_B)],
    dom: [btnAddPag(ID_INTERNO)],
    opcoesSelect: OPC,
  });
  ok(resultado.resultado === "sucesso", "spec15: caminho feliz -> sucesso na 1a reconsulta");
  ok(cliquesSalvar(eventos) === 1, "spec15: exatamente 1 clique Salvar (zero extra)");
  const ctxCalls = chamadas.filter((c) => c.url.endsWith("/functions/v1/renovacao-sigma-contexto"));
  ok(ctxCalls.length === 2, "spec15: contexto 2x, exatamente como antes da Iteracao 1");
  ok(eventos.some((e) => e.tipo === "waitForLoadState"), "spec15: espera orientada ao resultado (waitForLoadState) apos o clique");
  ok(!chamadas.some((c) => String(c.url).includes("app.rocketgestor.com")), "spec15: runner nunca fala direto com o Rocket");
}

// spec 16 (prova explicita, todos os desfechos): o POST /pagamento/add/
// ocorre NO MAXIMO 1x, em QUALQUER cenario pos-clique.
{
  const cenarios = [
    ["sucesso-1a", [CLI_OK(V_A), CLI_OK(V_B)], [CTX_OK(V_A), CTX_OK(V_B)]],
    ["sucesso-extra", [CLI_OK(V_A), CLI_OK(V_A), CLI_OK(V_B)], [CTX_OK(V_A), CTX_OK(V_A), CTX_OK(V_B)]],
    ["falha", [CLI_OK(V_A)], [CTX_OK(V_A)]],
    ["divergencia", [CLI_OK(V_A), CLI_OK(V_B)], [CTX_OK(V_A), CTX_OK(V_A)]],
    ["ctxDepois-unavailable", [CLI_OK(V_A), CLI_OK(V_A)], [CTX_OK(V_A), { outcome: "unavailable", etapa: "sigma_info_auth", tentativas: 4 }]],
    ["reconsulta-cliente-falha", [CLI_OK(V_A), { outcome: "unavailable" }], [CTX_OK(V_A), CTX_OK(V_A)]],
  ];
  for (const [nome, clienteSeq, contextoSeq] of cenarios) {
    const { eventos } = await rodarCenarioSeq(`16-1clique-${nome}`, { clienteSeq, contextoSeq, dom: [btnAddPag(ID_INTERNO)], opcoesSelect: OPC });
    ok(cliquesSalvar(eventos) === 1, `spec16: '${nome}' -> POST /pagamento/add/ executado EXATAMENTE 1x`);
    ok(eventos.filter((e) => e.tipo === "goto").length === 1, `spec16: '${nome}' -> page.goto 1x (nunca renavega pra re-clicar)`);
  }
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
