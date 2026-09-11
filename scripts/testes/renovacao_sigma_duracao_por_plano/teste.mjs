// Testes locais de scripts/renovacao-sigma-workflow.mjs (REAL, sem
// alteracao) -- CORRECAO do gap de duracao Sigma/Rocket (2026-09-11,
// AUDITORIA GERAL DE ENCERRAMENTO).
//
// Ate esta correcao, a duracao da renovacao Sigma vinha de
// extrairDuracaoMeses(pacoteAtualTexto) -- o pacote TECNICO ATUAL do
// cliente no Sigma, nunca o plano CONTRATADO. Essa e' exatamente a
// classe de erro que causou a renovacao UniTV incorreta (1 mes aplicado
// num plano Trimestral) corrigida em scripts/lib/unitv-renovar.mjs.
//
// Esta suite prova, ponta a ponta (fluxo individual, sem lote):
//   1. a duracao agora vem de plano_nome (Mensal/Trimestral/Semestral/
//      Anual), nao do pacote atual -- inclusive quando o pacote atual
//      diverge do plano contratado (o cenario CENTRAL desta correcao);
//   2. o flag adulto/nao-adulto continua vindo do pacote atual (nao do
//      plano -- plano nao carrega essa informacao);
//   3. quantidade de telas nunca influencia a escolha;
//   4. plano ausente/desconhecido -> resultado_ambiguo, ZERO chamadas
//      de rede especificas da tentativa de renovacao (nunca adivinha
//      1 mes);
//   5. pacote correspondente inexistente no <select> -> resultado_ambiguo,
//      nunca clica em "Salvar" (#btn_adicionar_pagamento).
//
// Como rodar:
//   npx tsx scripts/testes/renovacao_sigma_duracao_por_plano/teste.mjs

import { register } from "node:module";
register("./mock-loader.mjs", import.meta.url);

const { configurarPlaywright, eventosPlaywright } = await import("./fake_playwright.mjs");

const SUPABASE_URL = "https://exemplo-teste.supabase.co";
const CALLBACK_TOKEN = "callback-token-de-teste";
const PUBLIC_ID = "01a0271b-5a54-7d7e-8e4a-ef4c39730e0b";
const CLIENTE_NOME = "Cliente Duracao Teste";
const TELEFONE = "5517981625486";
const ID_INTERNO = "1569178";

process.env.SUPABASE_URL = SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-teste";
process.env.RENOVACAO_SIGMA_CALLBACK_TOKEN = CALLBACK_TOKEN;

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

let opId = 0;
let chamadasFetch = [];
let cfgToken = null;
let clienteSeq = [];
let contextoSeq = [];
let nCliente = 0;
let nContexto = 0;
let capturarResultado = null;
let promessaResultado = null;
function novaPromessa() {
  promessaResultado = new Promise((r) => {
    capturarResultado = r;
  });
}

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  let corpo = null;
  try {
    corpo = opts.body ? JSON.parse(opts.body) : null;
  } catch {
    /* ignore */
  }
  chamadasFetch.push({ url: u, method: opts.method ?? "GET", corpo });

  if (u.includes("/rest/v1/renovacoes_lote")) {
    return new Response(JSON.stringify([]), { status: 200 });
  }
  if (u.includes("/rest/v1/tokens_renovacao")) {
    return new Response(JSON.stringify([cfgToken]), { status: 200 });
  }
  if (u.includes("/rest/v1/rpc/rocket_sessao_ler")) {
    return new Response(JSON.stringify({ sessionid: "sess-fake", csrftoken: "csrf-fake" }), { status: 200 });
  }
  if (u.endsWith("/functions/v1/renovacao-sigma-id-interno")) {
    return new Response(JSON.stringify({ outcome: "resolvido", idInterno: ID_INTERNO }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (u.endsWith("/functions/v1/renovacao-sigma-cliente")) {
    const body = clienteSeq[Math.min(nCliente++, clienteSeq.length - 1)];
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (u.endsWith("/functions/v1/renovacao-sigma-contexto")) {
    const body = contextoSeq[Math.min(nContexto++, contextoSeq.length - 1)];
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (u.endsWith("/functions/v1/renovacao-sigma-resultado")) {
    if (capturarResultado) capturarResultado(corpo);
    return new Response(JSON.stringify({ outcome: "ok" }), { status: 200 });
  }
  throw new Error(`fetch inesperado no teste: ${opts.method ?? "GET"} ${u}`);
};

function timeout(ms) {
  return new Promise((_, rej) => setTimeout(() => rej(new Error("timeout esperando reportarResultado")), ms));
}
const TIMEOUT_MS = 20000;

const V_A = "2026-09-13T20:59:59-03:00";
const V_B = "2026-10-13T20:59:59-03:00";
const CLI_OK = (v) => ({ outcome: "success", cliente: { vencimento: v } });
const CTX_OK = (pacoteAtual, expiresAt) => ({ outcome: "success", sessaoValida: true, pacoteAtual, expiresAt });

// Sequencias padrao pra um caminho feliz (venc + expiresAt mudam na 1a
// reconsulta -> "sucesso" sem precisar de reconsulta extra).
function seqSucesso(pacoteAtual) {
  return {
    clienteSeq: [CLI_OK(V_A), CLI_OK(V_B)],
    contextoSeq: [CTX_OK(pacoteAtual, V_A), CTX_OK(pacoteAtual, V_B)],
  };
}

async function rodarCenario(nome, { planoNome, pacoteAtual, opcoesSelect, cliente, contexto, semToken } = {}) {
  opId += 1;
  const operacaoId = `op-duracao-sigma-${opId}`;
  process.env.OPERACAO_ID = operacaoId;
  chamadasFetch = [];
  nCliente = 0;
  nContexto = 0;
  cfgToken = semToken
    ? null
    : {
        id: `tok-${opId}`,
        public_id: PUBLIC_ID,
        cliente_nome: CLIENTE_NOME,
        telefone: TELEFONE,
        ...(planoNome !== undefined ? { plano_nome: planoNome } : {}),
      };
  const padrao = pacoteAtual ? seqSucesso(pacoteAtual) : { clienteSeq: [], contextoSeq: [] };
  clienteSeq = cliente ?? padrao.clienteSeq;
  contextoSeq = contexto ?? padrao.contextoSeq;
  configurarPlaywright({ opcoesSelect: opcoesSelect ?? [] });
  novaPromessa();

  const urlModulo = new URL("../../renovacao-sigma-workflow.mjs", import.meta.url).href + `?cenario=${nome}`;
  await import(urlModulo);

  const resultado = await Promise.race([promessaResultado, timeout(TIMEOUT_MS)]);
  await new Promise((r) => setTimeout(r, 15)); // deixa o finally (browser.close) assentar
  return { resultado, chamadas: [...chamadasFetch], eventos: [...eventosPlaywright()] };
}

const cliqueSalvar = (eventos) => eventos.filter((e) => e.tipo === "click" && e.sel === "#btn_adicionar_pagamento").length;

// O codigo real seleciona por `value` (fake-value-<indice>, gerado pelo
// fake na mesma ordem de opcoesSelect) -- nunca por `label`. Resolve de
// volta pro texto da opcao pra deixar as asserções legiveis.
function opcaoEscolhida(eventos, opcoesSelect) {
  const evt = eventos.find((e) => e.tipo === "selectOption");
  if (!evt) return null;
  const m = /^fake-value-(\d+)$/.exec(evt.value ?? "");
  if (!m) return evt.value ?? null;
  return opcoesSelect[Number(m[1])] ?? null;
}

// =====================================================================
// 1. Sigma Mensal -- pacote atual JA e' mensal (caso comum, sem
//    divergencia) -> escolhe a opcao de 1 mes -> sucesso.
// =====================================================================
{
  const { resultado, eventos } = await rodarCenario("1-mensal", {
    planoNome: "Mensal",
    pacoteAtual: "1 MES - X",
    opcoesSelect: ["1 MES - X - 1 creditos - 1 tela(s)"],
  });
  ok(resultado.resultado === "sucesso", "1: Sigma Mensal -> sucesso");
  ok(
    opcaoEscolhida(eventos, ["1 MES - X - 1 creditos - 1 tela(s)"]) === "1 MES - X - 1 creditos - 1 tela(s)",
    "1: opcao de 1 mes escolhida",
  );
}

// =====================================================================
// 2. CENARIO CENTRAL DA CORRECAO: pacote TECNICO ATUAL e' mensal ("1
//    MES"), mas o PLANO CONTRATADO e' Trimestral -> tem que escolher a
//    opcao de 3 MESES, nunca a de 1 mes (regressao explicita do bug que
//    causou o incidente UniTV, agora coberta no lado Sigma).
// =====================================================================
{
  const { resultado, eventos } = await rodarCenario("2-trimestral-pacote-atual-mensal", {
    planoNome: "Trimestral",
    pacoteAtual: "1 MES - X",
    opcoesSelect: ["1 MES - X - 1 creditos - 1 tela(s)", "3 MESES - X - 3 creditos - 1 tela(s)"],
  });
  ok(resultado.resultado === "sucesso", "2: Sigma Trimestral com pacote atual mensal -> sucesso");
  ok(
    opcaoEscolhida(eventos, ["1 MES - X - 1 creditos - 1 tela(s)", "3 MESES - X - 3 creditos - 1 tela(s)"]) ===
      "3 MESES - X - 3 creditos - 1 tela(s)",
    "2: escolheu a opcao de 3 MESES (plano), NAO a de 1 mes (pacote atual) -- prova central da correcao",
  );
}

// =====================================================================
// 3. Sigma Semestral -- pacote atual mensal, plano Semestral -> 6 meses.
// =====================================================================
{
  const { resultado, eventos } = await rodarCenario("3-semestral-pacote-atual-mensal", {
    planoNome: "Semestral",
    pacoteAtual: "1 MES - X",
    opcoesSelect: ["1 MES - X - 1 creditos - 1 tela(s)", "6 MESES - X - 6 creditos - 1 tela(s)"],
  });
  ok(resultado.resultado === "sucesso", "3: Sigma Semestral -> sucesso");
  ok(
    opcaoEscolhida(eventos, ["1 MES - X - 1 creditos - 1 tela(s)", "6 MESES - X - 6 creditos - 1 tela(s)"]) ===
      "6 MESES - X - 6 creditos - 1 tela(s)",
    "3: escolheu a opcao de 6 MESES",
  );
}

// =====================================================================
// 4. Sigma Anual -- pacote atual mensal, plano Anual -> 12 meses.
// =====================================================================
{
  const { resultado, eventos } = await rodarCenario("4-anual-pacote-atual-mensal", {
    planoNome: "Anual",
    pacoteAtual: "1 MES - X",
    opcoesSelect: ["1 MES - X - 1 creditos - 1 tela(s)", "12 MESES - X - 12 creditos - 1 tela(s)"],
  });
  ok(resultado.resultado === "sucesso", "4: Sigma Anual -> sucesso");
  ok(
    opcaoEscolhida(eventos, ["1 MES - X - 1 creditos - 1 tela(s)", "12 MESES - X - 12 creditos - 1 tela(s)"]) ===
      "12 MESES - X - 12 creditos - 1 tela(s)",
    "4: escolheu a opcao de 12 MESES",
  );
}

// =====================================================================
// 5. Plano desconhecido -> resultado_ambiguo, ZERO chamadas de rede da
//    tentativa de renovacao (nunca adivinha 1 mes).
// =====================================================================
{
  const { resultado, chamadas, eventos } = await rodarCenario("5-plano-desconhecido", {
    planoNome: "Plano Personalizado 45 dias",
  });
  ok(resultado.resultado === "resultado_ambiguo", "5: plano desconhecido -> resultado_ambiguo");
  ok(String(resultado.detalhe).includes("nao mapeado"), "5: detalhe explica que o plano nao foi mapeado");
  ok(!chamadas.some((c) => c.url.endsWith("/functions/v1/renovacao-sigma-cliente")), "5: NUNCA chama renovacao-sigma-cliente");
  ok(!chamadas.some((c) => c.url.endsWith("/functions/v1/renovacao-sigma-contexto")), "5: NUNCA chama renovacao-sigma-contexto");
  ok(!eventos.some((e) => e.tipo === "launch"), "5: Playwright NUNCA e' lancado");
}

// =====================================================================
// 6. Plano ausente (token sem plano_nome) -> mesma disciplina do 5.
// =====================================================================
{
  const { resultado, chamadas, eventos } = await rodarCenario("6-plano-ausente", {
    planoNome: undefined,
  });
  ok(resultado.resultado === "resultado_ambiguo", "6: plano ausente -> resultado_ambiguo");
  ok(String(resultado.detalhe).includes("nao mapeado"), "6: detalhe explica que o plano nao foi mapeado");
  ok(!chamadas.some((c) => c.url.endsWith("/functions/v1/renovacao-sigma-cliente")), "6: NUNCA chama renovacao-sigma-cliente");
  ok(!eventos.some((e) => e.tipo === "launch"), "6: Playwright NUNCA e' lancado");
}

// =====================================================================
// 7. Pacote correspondente inexistente no <select> (plano Anual, mas o
//    Sigma so' oferece 1 e 3 meses pra este cliente/servidor) ->
//    resultado_ambiguo, NUNCA clica em "Salvar".
// =====================================================================
{
  const { resultado, eventos } = await rodarCenario("7-pacote-inexistente", {
    planoNome: "Anual",
    pacoteAtual: "1 MES - X",
    opcoesSelect: ["1 MES - X - 1 creditos - 1 tela(s)", "3 MESES - X - 3 creditos - 1 tela(s)"],
  });
  ok(resultado.resultado === "resultado_ambiguo", "7: pacote de 12 meses inexistente -> resultado_ambiguo");
  ok(String(resultado.detalhe).includes("nenhuma opcao do select casa com duracao=12"), "7: detalhe cita a duracao=12 nao encontrada");
  ok(cliqueSalvar(eventos) === 0, "7: NUNCA clica em #btn_adicionar_pagamento sem opcao correspondente");
}

// =====================================================================
// 8. Adulto vs nao-adulto -- o flag continua vindo do PACOTE ATUAL
//    (nao do plano), mesmo com a duracao vindo do plano.
// =====================================================================
{
  // 8a: pacote atual "SEM ADULTOS" -> deve escolher a opcao "SEM ADULTOS".
  const { resultado, eventos } = await rodarCenario("8a-sem-adultos", {
    planoNome: "Trimestral",
    pacoteAtual: "1 MES - X - SEM ADULTOS",
    opcoesSelect: ["3 MESES - X - SEM ADULTOS - 1 tela(s)", "3 MESES - X - 1 tela(s)"],
  });
  ok(resultado.resultado === "sucesso", "8a: sucesso");
  ok(
    opcaoEscolhida(eventos, ["3 MESES - X - SEM ADULTOS - 1 tela(s)", "3 MESES - X - 1 tela(s)"]) ===
      "3 MESES - X - SEM ADULTOS - 1 tela(s)",
    "8a: escolheu a opcao SEM ADULTOS (flag do pacote atual)",
  );
}
{
  // 8b: pacote atual SEM a expressao "SEM ADULTOS" (= com adultos) ->
  // deve escolher a opcao que TAMBEM nao tem "SEM ADULTOS".
  const { resultado, eventos } = await rodarCenario("8b-com-adultos", {
    planoNome: "Trimestral",
    pacoteAtual: "1 MES - X",
    opcoesSelect: ["3 MESES - X - SEM ADULTOS - 1 tela(s)", "3 MESES - X - 1 tela(s)"],
  });
  ok(resultado.resultado === "sucesso", "8b: sucesso");
  ok(
    opcaoEscolhida(eventos, ["3 MESES - X - SEM ADULTOS - 1 tela(s)", "3 MESES - X - 1 tela(s)"]) === "3 MESES - X - 1 tela(s)",
    "8b: escolheu a opcao COM adultos (flag do pacote atual)",
  );
}

// =====================================================================
// 9. Telas NUNCA influencia a escolha -- uma unica opcao com contagem
//    de telas atipica (5 telas) ainda e' escolhida quando duracao +
//    adulto batem.
// =====================================================================
{
  const { resultado, eventos } = await rodarCenario("9-telas-nao-importa", {
    planoNome: "Trimestral",
    pacoteAtual: "1 MES - X",
    opcoesSelect: ["3 MESES - X - 3 creditos - 5 tela(s)"],
  });
  ok(resultado.resultado === "sucesso", "9: sucesso mesmo com contagem de telas atipica");
  ok(
    opcaoEscolhida(eventos, ["3 MESES - X - 3 creditos - 5 tela(s)"]) === "3 MESES - X - 3 creditos - 5 tela(s)",
    "9: escolheu a opcao de 3 meses independente da quantidade de telas",
  );
}

console.log(`\nResultado: ${total - falhas}/${total} passando`);
process.exit(falhas === 0 ? 0 : 1);
