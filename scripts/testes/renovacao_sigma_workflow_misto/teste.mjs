// Testes locais de scripts/renovacao-sigma-workflow.mjs (REAL) --
// GAP 1: processarLote com 1 filho Sigma + 1 filho UniTV na MESMA
// execucao.
//
// O filho Sigma passa pelo fluxo Playwright de verdade (fake
// seletor-ciente + fetch mock de renovacao-sigma-cliente/contexto).
// O filho UniTV passa pelo executor congelado (fakado) +
// sincronizarVencimentoRocket (renovacao-rocket-vencimento, mockado).
//
// Regras verificadas:
//   - processarLote roteia por filho.tipo: Sigma -> Playwright,
//     UniTV -> executor congelado. chromium.launch acontece
//     EXATAMENTE 1x (so' pro filho Sigma).
//   - o filho UniTV NAO e' afetado pela sessao do Rocket ja lida.
//   - callback UNICO de lote com resultados[] de tipos MISTOS
//     ({tipo:"sigma"} + {tipo:"unitv", rocketDesync?}).
//   - rocketDesync so' aparece quando o sync do filho UniTV falha;
//     nunca no filho Sigma; resultado do UniTV continua "sucesso".
//   - um filho que falha (Sigma) NAO derruba o outro (UniTV) e vira
//     um item "falha" no mesmo callback.
//
// Como rodar: npx tsx scripts/testes/renovacao_sigma_workflow_misto/teste.mjs

import { register } from "node:module";
register("./mock-loader.mjs", import.meta.url);

const { configurarPlaywright, eventosPlaywright } = await import("./fake_playwright.mjs");
const { definirRenovarUmAcessoUniTV, chamadasRenovarUniTV, resetarFakeUnitvRenovar } =
  await import("./fake_unitv_renovar.mjs");

const SUPABASE_URL = "https://exemplo-teste.supabase.co";
const CALLBACK_TOKEN = "callback-token-de-teste";
const GRUPO_ID = "grp-misto-1";
const PUBLIC_ID_SIGMA = "01a0271b-5a54-7d7e-8e4a-ef4c39730e0b";
const PUBLIC_ID_UNITV = "02b1382c-6b65-8e8f-9f5b-fa5d4a841f1c";
const CLIENTE_SIGMA = "Meu Uso Testes";
const CLIENTE_UNITV = "Karla Filha";
const TELEFONE = "5517981625486";
const ID_INTERNO = "1569178";
const UNITV_SN = "gcnv6v";
const UNITV_ID = 3433363;

process.env.OPERACAO_ID = "operacao-de-teste-misto";
process.env.SUPABASE_URL = SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-teste";
process.env.RENOVACAO_SIGMA_CALLBACK_TOKEN = CALLBACK_TOKEN;
process.env.UNITV_DEALER_TOKEN = "fake-dealer";
process.env.UNITV_DEALER_NAME = "inovatvstream2";

let falhas = 0;
function ok(cond, msg) {
  if (!cond) { falhas++; console.error(`FALHA: ${msg}`); }
  else console.log(`ok: ${msg}`);
}

// Sequencia monotonica compartilhada com o fake Playwright (p/ ordem).
let seq = 0;
const proximoSeq = () => ++seq;

// --- config por cenario ---
let cfgFilhos = [];
let cfgSessao = { sessionid: "sess-fake", csrftoken: "csrf-fake" };
let clienteSeq = []; // respostas de renovacao-sigma-cliente, por ordem de chamada
let contextoSeq = []; // respostas de renovacao-sigma-contexto, por ordem de chamada
let nCliente = 0;
let nContexto = 0;
let cfgSync = { outcome: "sincronizado" }; // resposta de renovacao-rocket-vencimento
let chamadasFetch = [];
let capturarCallback = null;
let promessaCallback = null;
function novaPromessa() { promessaCallback = new Promise((r) => { capturarCallback = r; }); }

const btnAddPag = (id) => ({
  tag: "button",
  class: "btn btn-success flex-fill flex-sm-grow-0",
  "data-bs-target": "#modal-add-pagamento",
  "data-bs-toggle": "modal",
  cliente_id: id,
  nome: CLIENTE_SIGMA,
  telefone: "+55 17 98162-5486",
});

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  let corpo = null;
  try { corpo = opts.body ? JSON.parse(opts.body) : null; } catch { /* ok */ }
  chamadasFetch.push({ url: u, method: opts.method ?? "GET", corpo, seq: proximoSeq() });

  if (u.includes("/rest/v1/renovacoes_lote")) {
    return new Response(JSON.stringify([{ grupo_id: GRUPO_ID, operacao_id: process.env.OPERACAO_ID }]), { status: 200 });
  }
  if (u.includes("/rest/v1/tokens_renovacao")) {
    // no lote presente, o workflow so' consulta por grupo_id (filhos).
    return new Response(JSON.stringify(cfgFilhos), { status: 200 });
  }
  if (u.includes("/rest/v1/rpc/rocket_sessao_ler")) {
    return new Response(JSON.stringify(cfgSessao), { status: 200 });
  }
  if (u.endsWith("/functions/v1/renovacao-sigma-cliente")) {
    const body = clienteSeq[Math.min(nCliente++, clienteSeq.length - 1)];
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (u.endsWith("/functions/v1/renovacao-sigma-contexto")) {
    const body = contextoSeq[Math.min(nContexto++, contextoSeq.length - 1)];
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (u.endsWith("/functions/v1/renovacao-rocket-vencimento")) {
    return new Response(JSON.stringify(cfgSync), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (u.endsWith("/functions/v1/renovacao-sigma-resultado")) {
    if (capturarCallback) capturarCallback(corpo);
    return new Response(JSON.stringify({ outcome: "ok" }), { status: 200 });
  }
  throw new Error(`fetch inesperado: ${opts.method ?? "GET"} ${u}`);
};

function timeout(ms) {
  return new Promise((_, rej) => setTimeout(() => rej(new Error("timeout esperando callback do lote")), ms));
}
// Iteracao 1 (2026-08-29): a Camada B pode re-clicar ate 3x com backoff
// real [1000, 2000]ms -- um cenario que esgota as tentativas leva ~3s.
const TIMEOUT_LOTE_MS = 20000;

async function rodar(nome, cfg) {
  seq = 0;
  nCliente = 0;
  nContexto = 0;
  chamadasFetch = [];
  cfgFilhos = cfg.filhos;
  cfgSessao = cfg.sessao ?? { sessionid: "sess-fake", csrftoken: "csrf-fake" };
  clienteSeq = cfg.clienteSeq;
  contextoSeq = cfg.contextoSeq;
  cfgSync = cfg.sync ?? { outcome: "sincronizado" };
  resetarFakeUnitvRenovar();
  if (cfg.unitv) definirRenovarUmAcessoUniTV(cfg.unitv);
  configurarPlaywright({ proximoSeq, dom: cfg.dom ?? [], opcoesSelect: cfg.opcoesSelect ?? [] });
  novaPromessa();

  const urlMod = new URL("../../renovacao-sigma-workflow.mjs", import.meta.url).href + `?cenario=${nome}`;
  await import(urlMod);
  const callback = await Promise.race([promessaCallback, timeout(TIMEOUT_LOTE_MS)]);
  await new Promise((r) => setTimeout(r, 15)); // deixa o finally (browser.close) assentar
  return { callback, chamadas: [...chamadasFetch], eventos: [...eventosPlaywright()] };
}

const filhosMisto = [
  {
    id: "f-sigma", tipo: "sigma", public_id: PUBLIC_ID_SIGMA,
    unitv_sn: null, unitv_id: null,
    servidor_nome: "BLAZE", cliente_nome: CLIENTE_SIGMA, telefone: TELEFONE,
  },
  {
    id: "f-unitv", tipo: "unitv", public_id: PUBLIC_ID_UNITV,
    unitv_sn: UNITV_SN, unitv_id: UNITV_ID,
    servidor_nome: "UNITV", cliente_nome: CLIENTE_UNITV, telefone: TELEFONE,
  },
];

const VENC_A = "2026-09-13T20:59:59-03:00";
const VENC_B = "2026-10-13T20:59:59-03:00";
const VENC_UNITV = "2026-10-22T00:00:00-03:00";

// Sequencias que fazem o filho Sigma SUCEDER (venc E expiresAt mudam).
const clienteSucesso = [
  { outcome: "success", cliente: { vencimento: VENC_A } },
  { outcome: "success", cliente: { vencimento: VENC_B } },
];
const contextoSucesso = [
  { outcome: "success", sessaoValida: true, pacoteAtual: "1 MES - X", expiresAt: VENC_A },
  { outcome: "success", sessaoValida: true, pacoteAtual: "1 MES - X", expiresAt: VENC_B },
];
// Sequencias que fazem o filho Sigma FALHAR (nada muda antes/depois).
const clienteFalha = [
  { outcome: "success", cliente: { vencimento: VENC_A } },
  { outcome: "success", cliente: { vencimento: VENC_A } },
];
const contextoFalha = [
  { outcome: "success", sessaoValida: true, pacoteAtual: "1 MES - X", expiresAt: VENC_A },
  { outcome: "success", sessaoValida: true, pacoteAtual: "1 MES - X", expiresAt: VENC_A },
];
const opcoesSelect = ["1 MES - X - 1 creditos - 1 tela(s)"];

function itemPorTipo(callback, tipo) {
  return (callback.resultados ?? []).find((it) => it.tipo === tipo);
}

// =====================================================================
// M1: misto, filho Sigma SUCESSO + filho UniTV SUCESSO + sync OK.
//     Callback unico com 2 itens de tipos diferentes.
// =====================================================================
{
  const { callback, chamadas, eventos } = await rodar("misto-m1", {
    filhos: filhosMisto,
    clienteSeq: clienteSucesso,
    contextoSeq: contextoSucesso,
    sync: { outcome: "sincronizado" },
    unitv: { resultado: "sucesso", vencimentoConfirmado: VENC_UNITV },
    dom: [btnAddPag(ID_INTERNO)],
    opcoesSelect,
  });

  ok(callback.grupo_id === GRUPO_ID, "M1: callback e' de LOTE (grupo_id presente)");
  ok(Array.isArray(callback.resultados) && callback.resultados.length === 2, "M1: resultados[] com 2 itens");

  const sig = itemPorTipo(callback, "sigma");
  const uni = itemPorTipo(callback, "unitv");
  ok(sig && sig.resultado === "sucesso", "M1: item Sigma -> resultado 'sucesso'");
  ok(sig && sig.vencimentoConfirmado === VENC_B, "M1: item Sigma -> vencimentoConfirmado = venc 'depois'");
  ok(sig && sig.rocketDesync === undefined, "M1: item Sigma NUNCA carrega rocketDesync");
  ok(sig && sig.token_id === "f-sigma", "M1: item Sigma com token_id do filho");
  ok(uni && uni.resultado === "sucesso", "M1: item UniTV -> resultado 'sucesso'");
  ok(uni && uni.vencimentoConfirmado === VENC_UNITV, "M1: item UniTV -> vencimentoConfirmado do executor");
  ok(uni && uni.rocketDesync === undefined, "M1: item UniTV sem rocketDesync (sync deu 'sincronizado')");
  ok(uni && uni.token_id === "f-unitv", "M1: item UniTV com token_id do filho");

  ok(chamadasRenovarUniTV().length === 1, "M1: executor UniTV chamado EXATAMENTE 1x");
  ok(chamadasRenovarUniTV()[0].sn === UNITV_SN && chamadasRenovarUniTV()[0].id === UNITV_ID, "M1: executor UniTV recebeu sn/id do filho");

  const launches = eventos.filter((e) => e.tipo === "launch").length;
  ok(launches === 1, "M1: chromium.launch acontece 1x (so' pro filho Sigma)");
  ok(eventos.some((e) => e.tipo === "click" && e.sel === "#btn_adicionar_pagamento"), "M1: filho Sigma clicou Salvar (fluxo Playwright real)");
  ok(eventos.filter((e) => e.tipo === "close").length === 1, "M1: browser.close() 1x");

  const sync = chamadas.filter((c) => c.url.endsWith("/functions/v1/renovacao-rocket-vencimento"));
  ok(sync.length === 1, "M1: sincronizarVencimentoRocket chamado 1x (so' pro filho UniTV)");
  ok(sync[0].corpo?.publicId === PUBLIC_ID_UNITV && sync[0].corpo?.vencimentoAlvo === VENC_UNITV, "M1: sync com publicId + vencimentoAlvo do filho UniTV");

  // ordem: o filho Sigma (Playwright) executa e o UniTV (sync) depois --
  // basta garantir que os dois aconteceram no MESMO callback.
  ok(eventos.some((e) => e.tipo === "launch") && chamadasRenovarUniTV().length === 1, "M1: os DOIS filhos executaram na mesma passada de processarLote");
}

// =====================================================================
// M2: misto, filho Sigma FALHA + filho UniTV SUCESSO.
//     Um filho que falha NAO impede o outro; item 'falha' no callback.
// =====================================================================
{
  const { callback, eventos } = await rodar("misto-m2", {
    filhos: filhosMisto,
    clienteSeq: clienteFalha,
    contextoSeq: contextoFalha,
    sync: { outcome: "sincronizado" },
    unitv: { resultado: "sucesso", vencimentoConfirmado: VENC_UNITV },
    dom: [btnAddPag(ID_INTERNO)],
    opcoesSelect,
  });

  ok(Array.isArray(callback.resultados) && callback.resultados.length === 2, "M2: callback com 2 itens");
  const sig = itemPorTipo(callback, "sigma");
  const uni = itemPorTipo(callback, "unitv");
  ok(sig && sig.resultado === "falha", "M2: item Sigma -> 'falha' (venc nao mudou)");
  ok(
    sig && sig.detalhe === "vencimento nao mudou em nenhum dos dois sistemas apos o clique (com reconsulta extra)",
    "M2: item Sigma -> detalhe do veredito 'falha' cita a reconsulta extra (nunca multiplos cliques)",
  );
  ok(sig && sig.sigmaIndisponivel === undefined, "M2: item Sigma 'falha' (lote) NAO carrega sigmaIndisponivel");
  ok(
    eventos.filter((e) => e.tipo === "click" && e.sel === "#btn_adicionar_pagamento").length === 1,
    "M2: filho Sigma disparou o POST /pagamento/add/ EXATAMENTE 1x (nunca repetido no lote)",
  );
  ok(uni && uni.resultado === "sucesso", "M2: item UniTV -> 'sucesso' mesmo com o filho Sigma falhando");
  ok(uni && uni.rocketDesync === undefined, "M2: item UniTV sem rocketDesync");
  ok(chamadasRenovarUniTV().length === 1, "M2: executor UniTV ainda foi chamado (filho Sigma falho nao aborta o lote)");
  ok(eventos.filter((e) => e.tipo === "launch").length === 1, "M2: Playwright lancado 1x (filho Sigma)");
}

// =====================================================================
// M3: misto, filho Sigma SUCESSO + filho UniTV SUCESSO mas SYNC FALHA.
//     rocketDesync SO' no item UniTV; resultado do UniTV continua sucesso.
// =====================================================================
{
  const { callback, chamadas } = await rodar("misto-m3", {
    filhos: filhosMisto,
    clienteSeq: clienteSucesso,
    contextoSeq: contextoSucesso,
    sync: { outcome: "rocket_desync", etapa: "patch" },
    unitv: { resultado: "sucesso", vencimentoConfirmado: VENC_UNITV },
    dom: [btnAddPag(ID_INTERNO)],
    opcoesSelect,
  });

  const sig = itemPorTipo(callback, "sigma");
  const uni = itemPorTipo(callback, "unitv");
  ok(sig && sig.resultado === "sucesso" && sig.rocketDesync === undefined, "M3: item Sigma sucesso, sem rocketDesync");
  ok(uni && uni.resultado === "sucesso", "M3: item UniTV -> resultado continua 'sucesso' mesmo com Rocket dessincronizado");
  ok(uni && uni.rocketDesync === true, "M3: item UniTV -> rocketDesync = true");
  const sync = chamadas.filter((c) => c.url.endsWith("/functions/v1/renovacao-rocket-vencimento"));
  ok(sync.length === 1, "M3: 1 tentativa de sync (do filho UniTV)");
}

// =====================================================================
// M4 (spec Iteracao 1, teste 17): LOTE MISTO -- o filho Sigma cai em
// ctxAntes=unavailable (painel Sigma indisponivel, a Camada A ja
// re-tentou dentro da EF). O filho Sigma -> item 'resultado_ambiguo'
// (NUNCA 'falha', NUNCA re-clica); o filho UniTV -> 'sucesso',
// independente. Callback UNICO. O item de lote NAO carrega
// sigmaIndisponivel (a mensagem consolidada + avisarCliente:false do
// lote e' quem trata isso -- comportamento validado, inalterado).
// =====================================================================
{
  const { callback, eventos } = await rodar("misto-m4-sigma-unavailable", {
    filhos: filhosMisto,
    // Sigma le o cliente 1x (baseline) e depois bate no ctxAntes unavailable.
    clienteSeq: [{ outcome: "success", cliente: { vencimento: VENC_A } }],
    contextoSeq: [{ outcome: "unavailable", etapa: "sigma_info_auth", tentativas: 4 }],
    sync: { outcome: "sincronizado" },
    unitv: { resultado: "sucesso", vencimentoConfirmado: VENC_UNITV },
    dom: [btnAddPag(ID_INTERNO)],
    opcoesSelect,
  });

  ok(callback.grupo_id === GRUPO_ID && Array.isArray(callback.resultados) && callback.resultados.length === 2, "M4: callback UNICO de lote com 2 itens");
  const sig = itemPorTipo(callback, "sigma");
  const uni = itemPorTipo(callback, "unitv");
  ok(sig && sig.resultado === "resultado_ambiguo", "M4: filho Sigma -> 'resultado_ambiguo' (NUNCA 'falha') com painel Sigma indisponivel");
  ok(sig && String(sig.detalhe).includes("painel Sigma indisponivel (auth)"), "M4: detalhe do filho Sigma cita 'painel Sigma indisponivel (auth)'");
  ok(sig && sig.sigmaIndisponivel === undefined, "M4: item de LOTE NAO carrega sigmaIndisponivel (tratamento e' a consolidada + avisarCliente:false)");
  ok(uni && uni.resultado === "sucesso", "M4: filho UniTV -> 'sucesso', independente da falha do Sigma");
  ok(chamadasRenovarUniTV().length === 1, "M4: executor UniTV chamado 1x (nao abortou pela falha do Sigma)");
  ok(eventos.filter((e) => e.tipo === "launch").length === 1, "M4: Playwright lancado 1x (filho Sigma)");
  ok(!eventos.some((e) => e.tipo === "click" && e.sel === "#btn_adicionar_pagamento"), "M4: filho Sigma NUNCA clica Salvar (bail no ctxAntes unavailable)");
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM (renovacao_sigma_workflow_misto)" : `${falhas} FALHA(S) (renovacao_sigma_workflow_misto)`}`);
process.exit(falhas === 0 ? 0 : 1);
