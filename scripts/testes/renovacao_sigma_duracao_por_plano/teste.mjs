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
//      plano -- plano nao carrega essa informacao), reconhecendo COM/
//      SEM por extenso e C//S abreviado (ChannelTV);
//   3. a quantidade de telas/pontos vem do CADASTRO do cliente (lido de
//      input[name="telas"], ja preenchido pelo Rocket no formulario "ADD
//      Pagamento" -- nenhuma chamada de rede nova), NUNCA um numero fixo
//      (revisao 2026-09-11: a 1a versao desta correcao chegou a fixar
//      "sempre 1 tela", o que estava ERRADO -- o Rocket so' reproduz o
//      catalogo do Sigma, nao define quantos pontos o cliente comprou);
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
  // Trilha de auditoria (Fase 3, 2026-09-14) -- fora de chamadasFetch.
  if (u.includes("/rest/v1/renovacao_eventos")) {
    return new Response(null, { status: 201 });
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

async function rodarCenario(nome, { planoNome, pacoteAtual, opcoesSelect, cliente, contexto, semToken, telasCliente } = {}) {
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
  // telasCliente simula o valor que o Rocket ja preenche sozinho em
  // input[name="telas"] do formulario "ADD Pagamento" (cadastro do
  // cliente) -- default "1" quando o cenario nao testa telas
  // explicitamente. `null` simula o campo nao existir na pagina.
  configurarPlaywright({ opcoesSelect: opcoesSelect ?? [], telasInputValue: telasCliente === undefined ? "1" : telasCliente });
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
// 9a/9b/9c. REVISAO 2026-09-11 (a 1a versao desta correcao chegou a
//    fixar "sempre 1 tela" -- ERRADO, revertido: o Rocket NAO cria os
//    pacotes Sigma, so' reproduz o catalogo real do painel Sigma no
//    dropdown; a Tope TV vende por PONTO/ACESSO cadastrado no cliente).
//    Catalogo com 1/2/3 telas (caso real do BLAZE) -- a automacao tem
//    que escolher a opcao que bate com a quantidade JA CADASTRADA pro
//    cliente (simulada aqui via telasCliente, que representa o valor
//    que o Rocket ja preenche sozinho em input[name="telas"]), nunca um
//    numero fixo nem a primeira opcao do array.
// =====================================================================
{
  const opcoes = [
    "PLANO COMPLETO 3 MESES(1 TELA) - 3 creditos - 1 tela(s)",
    "PLANO COMPLETO 3 MESES(2 TELAS) - 3 creditos - 2 tela(s)",
    "PLANO COMPLETO 3 MESES(3 TELAS) - 3 creditos - 3 tela(s)",
  ];
  // 9a: cliente cadastrado com 1 ponto/acesso -> escolhe a opcao de 1 tela.
  const { resultado: r1, eventos: e1 } = await rodarCenario("9a-cliente-1-ponto", {
    planoNome: "Trimestral",
    pacoteAtual: "PLANO COMPLETO 1 MES(3 TELAS)",
    opcoesSelect: opcoes,
    telasCliente: "1",
  });
  ok(r1.resultado === "sucesso", "9a: cliente com 1 ponto -> sucesso");
  ok(
    opcaoEscolhida(e1, opcoes) === "PLANO COMPLETO 3 MESES(1 TELA) - 3 creditos - 1 tela(s)",
    "9a: escolheu a opcao de 1 TELA (cadastro do cliente = 1 ponto)",
  );
}
{
  // 9b: cliente cadastrado com 2 pontos/acessos -> escolhe a opcao de 2 telas.
  const opcoes = [
    "PLANO COMPLETO 3 MESES(1 TELA) - 3 creditos - 1 tela(s)",
    "PLANO COMPLETO 3 MESES(2 TELAS) - 3 creditos - 2 tela(s)",
    "PLANO COMPLETO 3 MESES(3 TELAS) - 3 creditos - 3 tela(s)",
  ];
  const { resultado, eventos } = await rodarCenario("9b-cliente-2-pontos", {
    planoNome: "Trimestral",
    pacoteAtual: "PLANO COMPLETO 1 MES(3 TELAS)",
    opcoesSelect: opcoes,
    telasCliente: "2",
  });
  ok(resultado.resultado === "sucesso", "9b: cliente com 2 pontos -> sucesso");
  ok(
    opcaoEscolhida(eventos, opcoes) === "PLANO COMPLETO 3 MESES(2 TELAS) - 3 creditos - 2 tela(s)",
    "9b: escolheu a opcao de 2 TELAS (cadastro do cliente = 2 pontos), NAO a de 1 tela",
  );
}
{
  // 9c: cliente cadastrado com 3 pontos/acessos -> escolhe a opcao de 3 telas.
  const opcoes = [
    "PLANO COMPLETO 3 MESES(1 TELA) - 3 creditos - 1 tela(s)",
    "PLANO COMPLETO 3 MESES(2 TELAS) - 3 creditos - 2 tela(s)",
    "PLANO COMPLETO 3 MESES(3 TELAS) - 3 creditos - 3 tela(s)",
  ];
  const { resultado, eventos } = await rodarCenario("9c-cliente-3-pontos", {
    planoNome: "Trimestral",
    pacoteAtual: "PLANO COMPLETO 1 MES(3 TELAS)",
    opcoesSelect: opcoes,
    telasCliente: "3",
  });
  ok(resultado.resultado === "sucesso", "9c: cliente com 3 pontos -> sucesso");
  ok(
    opcaoEscolhida(eventos, opcoes) === "PLANO COMPLETO 3 MESES(3 TELAS) - 3 creditos - 3 tela(s)",
    "9c: escolheu a opcao de 3 TELAS (cadastro do cliente = 3 pontos)",
  );
}

// =====================================================================
// 10. FAIL-SAFE -- nenhuma opcao do catalogo bate com a quantidade
//     cadastrada do cliente (cliente com 2 pontos, catalogo so' tem 1 e
//     3 telas) -> resultado_ambiguo, NUNCA cai para 1 ou 3 como
//     fallback, nunca clica em "Salvar".
// =====================================================================
{
  const opcoes = [
    "PLANO COMPLETO 3 MESES(1 TELA) - 3 creditos - 1 tela(s)",
    "PLANO COMPLETO 3 MESES(3 TELAS) - 3 creditos - 3 tela(s)",
  ];
  const { resultado, eventos } = await rodarCenario("10-sem-opcao-compativel", {
    planoNome: "Trimestral",
    pacoteAtual: "PLANO COMPLETO 1 MES(2 TELAS)",
    opcoesSelect: opcoes,
    telasCliente: "2",
  });
  ok(resultado.resultado === "resultado_ambiguo", "10: sem opcao de 2 telas (cadastro do cliente) -> resultado_ambiguo");
  ok(String(resultado.detalhe).includes("nenhuma opcao"), "10: detalhe diz que nenhuma opcao casou");
  ok(String(resultado.detalhe).includes("2 tela"), "10: detalhe cita explicitamente a quantidade cadastrada (2 telas)");
  ok(cliqueSalvar(eventos) === 0, "10: NUNCA clica em Salvar -- nunca cai para 1 ou 3 telas");
}

// =====================================================================
// 11. FAIL-SAFE -- ambiguidade entre DUAS opcoes com a MESMA duracao +
//     adulto + quantidade de telas do cadastro (catalogo com entrada
//     duplicada) -> resultado_ambiguo, nunca escolhe arbitrariamente a
//     primeira.
// =====================================================================
{
  const opcoes = [
    "PLANO COMPLETO 3 MESES(1 TELA) - 3 creditos - 1 tela(s)",
    "PLANO COMPLETO 3 MESES PROMO(1 TELA) - 3 creditos - 1 tela(s)",
  ];
  const { resultado, eventos } = await rodarCenario("11-duas-opcoes-1-tela", {
    planoNome: "Trimestral",
    pacoteAtual: "PLANO COMPLETO 1 MES(1 TELA)",
    opcoesSelect: opcoes,
  });
  ok(resultado.resultado === "resultado_ambiguo", "11: duas opcoes de 1 tela -> resultado_ambiguo");
  ok(String(resultado.detalhe).includes("2 opcoes ambiguas"), "11: detalhe cita as 2 opcoes ambiguas");
  ok(cliqueSalvar(eventos) === 0, "11: NUNCA clica em Salvar sob ambiguidade -- nao escolhe arbitrariamente");
}

// =====================================================================
// 11a/11b/11c. FAIL-SAFE -- input[name="telas"] ausente, vazio ou nao
//     numerico -> resultado_ambiguo. NUNCA assume 1 (nem qualquer outro
//     numero) como padrao. Nunca chega a clicar em "Salvar".
// =====================================================================
{
  // 11a: campo nao existe na pagina (locator nunca resolve).
  const { resultado, eventos } = await rodarCenario("11a-telas-campo-ausente", {
    planoNome: "Trimestral",
    pacoteAtual: "PLANO COMPLETO 1 MES(1 TELA)",
    opcoesSelect: ["PLANO COMPLETO 3 MESES(1 TELA) - 3 creditos - 1 tela(s)"],
    telasCliente: null,
  });
  ok(resultado.resultado === "resultado_ambiguo", "11a: campo telas ausente -> resultado_ambiguo");
  ok(String(resultado.detalhe).includes("nao foi possivel ler a quantidade de telas"), "11a: detalhe explica a falha de leitura");
  ok(cliqueSalvar(eventos) === 0, "11a: NUNCA clica em Salvar sem conseguir ler a quantidade cadastrada");
}
{
  // 11b: campo existe mas esta vazio.
  const { resultado, eventos } = await rodarCenario("11b-telas-vazio", {
    planoNome: "Trimestral",
    pacoteAtual: "PLANO COMPLETO 1 MES(1 TELA)",
    opcoesSelect: ["PLANO COMPLETO 3 MESES(1 TELA) - 3 creditos - 1 tela(s)"],
    telasCliente: "",
  });
  ok(resultado.resultado === "resultado_ambiguo", "11b: campo telas vazio -> resultado_ambiguo");
  ok(String(resultado.detalhe).includes("nao foi possivel ler a quantidade de telas"), "11b: detalhe explica a falha de leitura");
  ok(cliqueSalvar(eventos) === 0, "11b: NUNCA clica em Salvar com o campo vazio");
}
{
  // 11c: campo com valor nao numerico (dado inesperado do Rocket).
  const { resultado, eventos } = await rodarCenario("11c-telas-nao-numerico", {
    planoNome: "Trimestral",
    pacoteAtual: "PLANO COMPLETO 1 MES(1 TELA)",
    opcoesSelect: ["PLANO COMPLETO 3 MESES(1 TELA) - 3 creditos - 1 tela(s)"],
    telasCliente: "abc",
  });
  ok(resultado.resultado === "resultado_ambiguo", "11c: campo telas nao numerico -> resultado_ambiguo");
  ok(String(resultado.detalhe).includes("nao foi possivel ler a quantidade de telas"), "11c: detalhe explica a falha de leitura");
  ok(cliqueSalvar(eventos) === 0, "11c: NUNCA clica em Salvar com valor nao numerico");
}

// =====================================================================
// 12/13. CHANNELTV -- nomenclatura abreviada "C/ADULTOS" / "S/ADULTOS"
//        (achado da auditoria de verificacao no Rocket: a regex antiga
//        so' reconhecia "SEM ADULTOS" por extenso e nunca distinguia
//        essas duas formas abreviadas). Mesmo catalogo (1 opcao "com" +
//        1 "sem", ambas 1 tela) em ambos os cenarios -- so' o pacote
//        atual do cliente muda.
// =====================================================================
{
  const opcoes = [
    "⭐3 MÊS C/ADULTOS⭐🔞 - 3 créditos - 1 tela(s)",
    "⭐3 MÊS S/ADULTOS⭐ - 3 créditos - 1 tela(s)",
  ];
  // 12: pacote atual "C/ADULTOS" -> com adultos -> escolhe a opcao C/ADULTOS.
  const { resultado: r12, eventos: e12 } = await rodarCenario("12-channeltv-c-adultos", {
    planoNome: "Trimestral",
    pacoteAtual: "⭐1 MÊS C/ADULTOS⭐🔞 - 1 créditos - 1 tela(s)",
    opcoesSelect: opcoes,
  });
  ok(r12.resultado === "sucesso", "12: ChannelTV C/ADULTOS -> sucesso");
  ok(
    opcaoEscolhida(e12, opcoes) === "⭐3 MÊS C/ADULTOS⭐🔞 - 3 créditos - 1 tela(s)",
    "12: ChannelTV 'C/ADULTOS' no pacote atual -> reconhecido como COM adultos, escolhe a opcao C/ADULTOS",
  );
}
{
  // 13: pacote atual "S/ADULTOS" -> sem adultos -> escolhe a opcao S/ADULTOS.
  const opcoes = [
    "⭐3 MÊS C/ADULTOS⭐🔞 - 3 créditos - 1 tela(s)",
    "⭐3 MÊS S/ADULTOS⭐ - 3 créditos - 1 tela(s)",
  ];
  const { resultado, eventos } = await rodarCenario("13-channeltv-s-adultos", {
    planoNome: "Trimestral",
    pacoteAtual: "⭐1 MÊS S/ADULTOS⭐ - 1 créditos - 1 tela(s)",
    opcoesSelect: opcoes,
  });
  ok(resultado.resultado === "sucesso", "13: ChannelTV S/ADULTOS -> sucesso");
  ok(
    opcaoEscolhida(eventos, opcoes) === "⭐3 MÊS S/ADULTOS⭐ - 3 créditos - 1 tela(s)",
    "13: ChannelTV 'S/ADULTOS' no pacote atual -> reconhecido como SEM adultos, escolhe a opcao S/ADULTOS",
  );
}

// =====================================================================
// 14. FAIL-SAFE -- adulto/sem adulto NAO DETERMINAVEL (pacote atual com
//     marcadores contraditorios: "COM ADULTOS" e "SEM ADULTOS" ao mesmo
//     tempo) -> resultado_ambiguo ANTES de sequer carregar o <select>
//     (zero efeito colateral -- nunca chega a escolher opcao nem clicar).
// =====================================================================
{
  const { resultado, eventos, chamadas } = await rodarCenario("14-adulto-indeterminavel", {
    planoNome: "Trimestral",
    pacoteAtual: "PLANO COMPLETO 1 MES COM ADULTOS SEM ADULTOS",
    opcoesSelect: ["3 MESES - X - 1 tela(s)"],
  });
  ok(resultado.resultado === "resultado_ambiguo", "14: marcadores contraditorios -> resultado_ambiguo");
  ok(String(resultado.detalhe).includes("marcadores contraditorios"), "14: detalhe explica a contradicao");
  ok(!eventos.some((e) => e.tipo === "selectOption"), "14: NUNCA chega a selecionar nenhuma opcao do select");
  ok(cliqueSalvar(eventos) === 0, "14: NUNCA clica em Salvar");
  // a leitura do pacote atual (renovacao-sigma-contexto) ja aconteceu antes
  // deste ponto (e' de onde vem o texto contraditorio) -- o que importa e'
  // que nao ha' NENHUMA chamada extra depois disso (nem reconsulta).
  ok(
    chamadas.filter((c) => c.url.endsWith("/functions/v1/renovacao-sigma-contexto")).length === 1,
    "14: contexto Sigma consultado so' 1x (antes) -- nunca reconsulta apos falhar em determinar adulto",
  );
}

console.log(`\nResultado: ${total - falhas}/${total} passando`);
process.exit(falhas === 0 ? 0 : 1);
