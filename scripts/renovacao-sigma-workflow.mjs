// Executado pelo GitHub Actions (.github/workflows/renovacao-sigma.yml)
// -- Bloco 2, 2026-08-24 (inovatv_central/CLAUDE.md, desenho aprovado).
//
// Reaproveita o MECANISMO ja comprovado em
// executar-renovacao-controlada.mjs (preservado como referencia,
// intocado por este arquivo) -- Playwright real, sessao do Rocket
// injetada via cookies, clique real na UI. A diferenca aqui: tudo e'
// parametrizado a partir de um unico operacao_id (nenhum dado
// sensivel chega como parametro do workflow_dispatch), buscado em
// tempo de execucao direto no Supabase.
//
// Disciplina de resultado (regra explicita do usuario, Bloco 2):
// NUNCA decide "sucesso" pelo HTTP do Playwright/toast da UI -- so'
// depois de reconsultar Rocket E Sigma, de forma independente, e os
// dois confirmarem a mudanca esperada. Qualquer excecao nao prevista
// vira resultado_ambiguo (nunca falha/sucesso por suposicao).
//
// Nenhum retry automatico -- uma unica tentativa, sempre reporta um
// resultado final (sucesso/falha/sessao_expirada/resultado_ambiguo)
// de volta pro callback, mesmo em caso de excecao inesperada.

import { chromium } from "playwright";

import { resolverIdInternoDoDom } from "./lib/resolver-id-interno-dom.mjs";

const OPERACAO_ID = process.env.OPERACAO_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CALLBACK_TOKEN = process.env.RENOVACAO_SIGMA_CALLBACK_TOKEN;

function requireEnv() {
  const faltando = [
    ["OPERACAO_ID", OPERACAO_ID],
    ["SUPABASE_URL", SUPABASE_URL],
    ["SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY],
    ["RENOVACAO_SIGMA_CALLBACK_TOKEN", CALLBACK_TOKEN],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (faltando.length > 0) {
    throw new Error(`Variaveis de ambiente ausentes: ${faltando.join(", ")}`);
  }
}

async function reportarResultado(resultado, extra = {}) {
  const corpo = { operacao_id: OPERACAO_ID, resultado, ...extra };
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/renovacao-sigma-resultado`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": CALLBACK_TOKEN },
      body: JSON.stringify(corpo),
    });
    console.log(`[renovacao-sigma-workflow] callback enviado: ${resultado} -- HTTP ${resp.status}`);
  } catch (e) {
    // Ultimo recurso: se nem o callback funcionar, o watchdog (15min)
    // eventualmente marca resultado_ambiguo. Loga pra aparecer nos
    // logs do job (visiveis mesmo sem callback).
    console.error("[renovacao-sigma-workflow] FALHA AO REPORTAR RESULTADO", e.message ?? e);
  }
}

async function lerTokenRenovacao(operacaoId) {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/tokens_renovacao?operacao_id=eq.${operacaoId}&select=*`,
    { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } },
  );
  const linhas = await resp.json();
  return Array.isArray(linhas) ? linhas[0] ?? null : null;
}

async function lerSessaoRocket() {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rocket_sessao_ler`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const dados = await resp.json();
  const linha = Array.isArray(dados) ? dados[0] : dados;
  return { sessionid: linha?.sessionid ?? null, csrftoken: linha?.csrftoken ?? null };
}

// Le o cliente via funcao interna (renovacao-sigma-cliente), nao mais
// direto no Rocket -- a chamada direta do runner do GitHub Actions
// era bloqueada pela borda/Cloudflare (investigado e caracterizado em
// 2026-08-27/28, NEXT_SESSION.md). Mesma assinatura de retorno de
// antes ({ok, cliente}), nenhuma mudanca nos dois pontos que chamam
// esta funcao.
async function lerClienteRocket(publicId) {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/renovacao-sigma-cliente`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": CALLBACK_TOKEN },
      body: JSON.stringify({ publicId }),
    });
    const body = await resp.json().catch(() => null);
    if (!resp.ok || !body || body.outcome !== "success") {
      return { ok: false, cliente: null };
    }
    return { ok: true, cliente: body.cliente };
  } catch {
    return { ok: false, cliente: null };
  }
}

// Pacote atual + expires_at do Sigma + validade da sessao vem da Edge
// Function interna renovacao-sigma-contexto -- roda DENTRO do Supabase,
// nao no runner. O runner nao fala com app.rocketgestor.com fora do
// Playwright.
//
// Contrato unico: manda { idClienteInterno } (ja resolvido pelo DOM do
// Playwright -- ver resolverIdInternoDoDom) e recebe
// { outcome, sessaoValida, pacoteAtual, expiresAt }. Chamada antes do
// clique (usa pacoteAtual + expiresAt) e de novo depois (usa so'
// expiresAt).
async function lerContextoSigma(idClienteInterno) {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/renovacao-sigma-contexto`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": CALLBACK_TOKEN },
      body: JSON.stringify({ idClienteInterno }),
    });
    const body = await resp.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return { outcome: "unavailable", etapa: "resposta-invalida" };
    }
    return body;
  } catch {
    return { outcome: "unavailable", etapa: "excecao-fetch" };
  }
}

async function main() {
  requireEnv();

  const token = await lerTokenRenovacao(OPERACAO_ID);
  if (!token) {
    await reportarResultado("resultado_ambiguo", { detalhe: "tokens_renovacao nao encontrado pra este operacao_id" });
    return;
  }

  const { sessionid, csrftoken } = await lerSessaoRocket();
  if (!sessionid || !csrftoken) {
    await reportarResultado("sessao_expirada", { detalhe: "sessao do Vault ausente" });
    return;
  }

  // A checagem de validade da sessao acontece dentro de
  // renovacao-sigma-contexto (abaixo) -- ela roda no Supabase, onde o
  // GET /gerenciador/ nao e' bloqueado pela borda. Aqui so' garantimos
  // que a sessao existe no Vault (necessaria pros cookies do
  // Playwright).
  const publicId = token.public_id;

  const { ok: okAntes, cliente: clienteAntes } = await lerClienteRocket(publicId);
  if (!okAntes || !clienteAntes) {
    await reportarResultado("resultado_ambiguo", { detalhe: "falha ao ler cliente no Rocket antes da tentativa" });
    return;
  }
  const vencimentoAntes = clienteAntes.vencimento;

  let idClienteInterno = null;
  let pacoteAtualTexto = null;
  let expiresAtAntes = null;
  let clicouSalvar = false;

  try {
    // URL so' para navegacao do Playwright (navegador real executa o JS
    // da pagina -- nao e' um fetch direto do runner).
    const paginaClienteUrl = `https://app.rocketgestor.com/gerenciador/cliente/info/${publicId}/`;

    // Playwright real -- mesma sequencia ja comprovada em
    // executar-renovacao-controlada.mjs, so' parametrizada.
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      await context.addCookies([
        { name: "sessionid", value: sessionid, domain: "app.rocketgestor.com", path: "/", httpOnly: true, secure: true },
        { name: "csrftoken", value: csrftoken, domain: "app.rocketgestor.com", path: "/", httpOnly: false, secure: true },
      ]);
      const page = await context.newPage();

      await page.goto(paginaClienteUrl, { waitUntil: "load", timeout: 20000 });

      // --- Resolve o idClienteInterno pelo DOM RENDERIZADO (o runtime
      // Vue da pagina materializa a lista de clientes DEPOIS do load --
      // o #btn_add_pagamento_{id} nao existe no HTML cru, so' aqui).
      // Le todos os elementos [id^="btn_add_pagamento_"] e desambigua
      // por nome+telefone, nunca por posicao/ordem, exatamente 1.
      await page
        .waitForSelector('[id^="btn_add_pagamento_"]', { timeout: 15000 })
        .catch(() => {}); // sem nenhum elemento -> lista abaixo vira [] -> "nao encontrado"
      const elementos = await page.$$eval('[id^="btn_add_pagamento_"]', (nodes) =>
        nodes.map((n) => {
          const m = /^btn_add_pagamento_(\d+)$/.exec(n.id);
          return { id: m ? m[1] : "", nome: n.getAttribute("nome"), telefone: n.getAttribute("telefone") };
        }),
      );
      const { ids, totalBotoes, botoesComNomeAlvo } = resolverIdInternoDoDom(
        elementos,
        token.cliente_nome,
        token.telefone,
      );
      if (ids.length !== 1) {
        console.log(
          `[renovacao-sigma-workflow] id_cliente interno ${ids.length === 0 ? "nao encontrado" : "ambiguo"}`,
          JSON.stringify({ totalBotoes, botoesComNomeAlvo, candidatos: ids.length }),
        );
        await reportarResultado("resultado_ambiguo", {
          detalhe: `id_cliente interno ${ids.length === 0 ? "nao encontrado" : "ambiguo"}`,
        });
        return;
      }
      idClienteInterno = ids[0];

      // --- Pacote atual + expires_at (baseline) via renovacao-sigma-contexto
      // (Supabase), agora com o id ja resolvido pelo DOM.
      const ctxAntes = await lerContextoSigma(idClienteInterno);
      if (ctxAntes.outcome === "sessao_expirada") {
        await reportarResultado("sessao_expirada", { detalhe: ctxAntes.detalhe ?? "sessao invalida" });
        return;
      }
      if (ctxAntes.outcome === "pacote_vazio") {
        await reportarResultado("resultado_ambiguo", { detalhe: "Sigma nao informou o pacote atual (package vazio)" });
        return;
      }
      if (ctxAntes.outcome !== "success" || !ctxAntes.pacoteAtual) {
        await reportarResultado("resultado_ambiguo", {
          detalhe: `falha ao obter contexto Sigma (${ctxAntes.etapa ?? ctxAntes.outcome})`,
        });
        return;
      }
      pacoteAtualTexto = String(ctxAntes.pacoteAtual).trim();
      expiresAtAntes = ctxAntes.expiresAt ?? null;

      // --- Clique real (Playwright), na MESMA pagina ja aberta. Cada
      // botao carrega seu proprio cliente_id no id
      // (#btn_add_pagamento_{id}) -- escopado pelo idClienteInterno
      // resolvido acima, nunca ambiguo.
      await page.locator(`#btn_add_pagamento_${idClienteInterno}`).click({ timeout: 10000 });
      await page.waitForTimeout(1000);

      const renovarCheckbox = page.locator('input[name="renovar_painel"]');
      await renovarCheckbox.waitFor({ state: "visible", timeout: 10000 });
      await renovarCheckbox.check();

      await page.waitForTimeout(3000);

      const selects = await page.locator("select:visible").all();
      let pacoteSelecionado = null;
      for (const sel of selects) {
        const options = await sel.locator("option").allTextContents();
        // Correcao de risco (2026-08-24, comprovada em
        // scripts/poc-confirmar-expires-at-renovacao.mjs, dry-run
        // real): o `<select>` real inclui um sufixo que o campo
        // `package` do Sigma NAO tem (ex.: "1 MES - P2P & IPTV COM
        // ADULTOS - 1 creditos - 1 tela(s)" no select, contra "1 MES -
        // P2P & IPTV COM ADULTOS" em pacoteAtualTexto) -- o match
        // exato nunca encontrava a opcao contra dado real. Corrigido
        // pra prefixo -- pacoteAtualTexto continua sendo a fonte de
        // verdade (Sigma), nunca um texto fixo.
        const match = options.find((o) => o.trim().startsWith(pacoteAtualTexto));
        if (match) {
          await sel.selectOption({ label: match });
          pacoteSelecionado = match.trim();
          break;
        }
      }
      if (!pacoteSelecionado) {
        throw new Error(`pacote "${pacoteAtualTexto}" nao encontrado nas opcoes do select`);
      }
      await page.waitForTimeout(1500);

      await page.locator("#btn_adicionar_pagamento").click({ timeout: 10000 });
      clicouSalvar = true;
      await page.waitForTimeout(3000);
    } finally {
      await browser.close();
    }

    if (!clicouSalvar) {
      await reportarResultado("resultado_ambiguo", { detalhe: "nao foi possivel completar o clique em Salvar" });
      return;
    }

    // Reconsulta INDEPENDENTE -- Rocket (via renovacao-sigma-cliente) e
    // Sigma (via renovacao-sigma-contexto, mesmo endpoint, so' o
    // expiresAt e' usado aqui), os dois, nunca confia so' no clique/
    // toast da UI.
    const { ok: okDepois, cliente: clienteDepois } = await lerClienteRocket(publicId);
    const ctxDepois = await lerContextoSigma(idClienteInterno);

    if (!okDepois || !clienteDepois || ctxDepois.outcome !== "success" || !ctxDepois.expiresAt) {
      await reportarResultado("resultado_ambiguo", { detalhe: "falha ao reconsultar Rocket/Sigma apos o clique" });
      return;
    }

    const vencimentoDepois = clienteDepois.vencimento;
    const expiresAtDepois = ctxDepois.expiresAt;

    const rocketMudou = vencimentoDepois !== vencimentoAntes;
    const sigmaMudou = expiresAtDepois !== expiresAtAntes;

    if (rocketMudou && sigmaMudou) {
      await reportarResultado("sucesso", { vencimentoConfirmado: vencimentoDepois });
      return;
    }

    if (!rocketMudou && !sigmaMudou) {
      await reportarResultado("falha", { detalhe: "vencimento nao mudou em nenhum dos dois sistemas apos o clique" });
      return;
    }

    // Um mudou, o outro nao -- divergencia real entre os dois sistemas,
    // nunca decide sozinho, sempre ambiguo.
    await reportarResultado("resultado_ambiguo", {
      detalhe: `divergencia entre sistemas: rocketMudou=${rocketMudou}, sigmaMudou=${sigmaMudou}`,
    });
  } catch (erro) {
    // Qualquer excecao nao prevista (elemento nao encontrado, timeout
    // do Playwright, etc.) -- NUNCA falha/sucesso por suposicao.
    console.error("[renovacao-sigma-workflow] excecao nao prevista", erro);
    await reportarResultado("resultado_ambiguo", { detalhe: `excecao: ${erro.message ?? String(erro)}` });
  }
}

main().catch(async (erro) => {
  console.error("[renovacao-sigma-workflow] erro fatal fora do fluxo principal", erro);
  try {
    await reportarResultado("resultado_ambiguo", { detalhe: `erro fatal: ${erro.message ?? String(erro)}` });
  } catch {
    // Se nem isso funcionar, o watchdog (15min) e' a rede de seguranca final.
  }
  process.exit(1);
});
