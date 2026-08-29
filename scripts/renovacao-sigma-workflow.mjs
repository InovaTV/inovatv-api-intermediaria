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
//
// Renovacao em lote (Etapa 1, 2026-08-29): se o OPERACAO_ID
// corresponder a um renovacoes_lote (e nao a um tokens_renovacao
// avulso), o script processa os N acessos filhos em sequencia e
// reporta um unico callback com resultados[]. Filho 'sigma' ->
// renovarUmAcessoSigma; filho 'unitv' -> renovarUmAcessoUniTVComSync
// (executor congelado + sync do vencimento no Rocket) -- Etapa 2,
// Bloco 4. 'unitv_pendente' segue existindo so' como fallback
// defensivo em renovacao-sigma-resultado, o workflow nao o emite mais.

import { chromium } from "playwright";

import { resolverIdInternoDoDom } from "./lib/resolver-id-interno-dom.mjs";
// Etapa 2 (Renovacao UniTV, Bloco 4). Executor do painel de revenda,
// CONGELADO -- este workflow so' o chama, nunca altera sua mecanica
// interna. Retorna o MESMO shape de renovarUmAcessoSigma
// ({ resultado, vencimentoConfirmado?, detalhe? }). Nunca repete
// /api/account/renew (a lib garante 1 unica chamada).
import { renovarUmAcessoUniTV } from "./lib/unitv-renovar.mjs";

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

// Renovacao em lote -- callback com resultados[] (um por acesso).
async function reportarResultadoLote(grupoId, resultados) {
  const corpo = { operacao_id: OPERACAO_ID, grupo_id: grupoId, resultados };
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/renovacao-sigma-resultado`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": CALLBACK_TOKEN },
      body: JSON.stringify(corpo),
    });
    console.log(`[renovacao-sigma-workflow] callback de lote enviado -- HTTP ${resp.status}`);
  } catch (e) {
    console.error("[renovacao-sigma-workflow] FALHA AO REPORTAR RESULTADO DO LOTE", e.message ?? e);
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

// Renovacao em lote: a "capa" (renovacoes_lote) e' quem carrega o
// operacao_id -- os filhos (tokens_renovacao) so' tem grupo_id.
async function lerLotePorOperacaoId(operacaoId) {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/renovacoes_lote?operacao_id=eq.${operacaoId}&select=*`,
    { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } },
  );
  const linhas = await resp.json();
  return Array.isArray(linhas) ? linhas[0] ?? null : null;
}

async function lerFilhosDoLote(grupoId) {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/tokens_renovacao?grupo_id=eq.${grupoId}&select=*&order=criado_em.asc`,
    { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } },
  );
  const linhas = await resp.json();
  return Array.isArray(linhas) ? linhas : [];
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

// Etapa 2 (Bloco 4). Depois de uma renovacao UniTV bem-sucedida no
// painel, espelha o novo vencimento (ja confirmado pelo painel) para o
// Rocket, via renovacao-rocket-vencimento. NUNCA re-renova. Uma falha
// aqui e' DESSINCRONIA de cadastro (rocketDesync), nunca falha de
// renovacao -- o chamador nao transforma isso em resultado != "sucesso".
async function sincronizarVencimentoRocket(publicId, vencimentoAlvo) {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/renovacao-rocket-vencimento`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": CALLBACK_TOKEN },
      body: JSON.stringify({ publicId, vencimentoAlvo }),
    });
    const body = await resp.json().catch(() => null);
    if (body && typeof body === "object" && typeof body.outcome === "string") return body;
    return { outcome: "rocket_desync", etapa: "resposta-invalida" };
  } catch (e) {
    return { outcome: "rocket_desync", etapa: "excecao-fetch", detalhe: e?.message ?? String(e) };
  }
}

// Renova UM acesso UniTV (Etapa 2, Bloco 4). So' orquestra: chama o
// executor congelado, e -- SO' em sucesso -- espelha o vencimento no
// Rocket. Retorna um item de resultado pronto (mesma forma dos itens
// Sigma de processarLote), com rocketDesync=true quando a renovacao
// deu certo mas o Rocket nao sincronizou.
async function renovarUmAcessoUniTVComSync({ sn, id, publicId, servidorNome, clienteNome, tokenId }) {
  const r = await renovarUmAcessoUniTV({ sn, id });
  const item = {
    token_id: tokenId,
    tipo: "unitv",
    servidor_nome: servidorNome,
    cliente_nome: clienteNome,
    resultado: r.resultado,
    vencimentoConfirmado: r.vencimentoConfirmado,
    detalhe: r.detalhe,
  };
  if (r.resultado === "sucesso") {
    const sync = await sincronizarVencimentoRocket(publicId, r.vencimentoConfirmado);
    if (sync.outcome !== "sincronizado") item.rocketDesync = true;
  }
  return item;
}

// Renova UM acesso Sigma. Extraido do antigo corpo de main() sem
// nenhuma mudanca de sequencia -- so' deixou de chamar reportarResultado
// diretamente: agora RETORNA { resultado, vencimentoConfirmado?, detalhe? }
// pro chamador (main individual OU processarLote) decidir como reportar.
// Recebe a sessao ja lida (uma vez por job, nao por acesso).
async function renovarUmAcessoSigma({ sessionid, csrftoken, publicId, clienteNome, telefone }) {
  const { ok: okAntes, cliente: clienteAntes } = await lerClienteRocket(publicId);
  if (!okAntes || !clienteAntes) {
    return { resultado: "resultado_ambiguo", detalhe: "falha ao ler cliente no Rocket antes da tentativa" };
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

      // --- Resolve o idClienteInterno pelo DOM RENDERIZADO. Na UI atual
      // do Rocket (investigacao 2026-08-28) o antigo #btn_add_pagamento_{id}
      // NAO existe mais -- o botao "Add Pagamento" e' um
      //   button.btn-success[data-bs-target="#modal-add-pagamento"]
      // que carrega o id do cliente no atributo `cliente_id` (mais
      // `nome`/`telefone` do cliente). O botao "Editar"
      // (data-bs-target="#modal-editar") tambem tem cliente_id+nome+
      // telefone -- por isso o seletor e' escopado por
      // data-bs-target="#modal-add-pagamento", nunca so' por [cliente_id].
      // Desambigua por nome+telefone, nunca por posicao/ordem, exatamente 1.
      const SELETOR_ADD_PAGAMENTO = '[data-bs-target="#modal-add-pagamento"][cliente_id]';
      await page
        .waitForSelector(SELETOR_ADD_PAGAMENTO, { timeout: 15000 })
        .catch(() => {}); // sem nenhum elemento -> lista abaixo vira [] -> "nao encontrado"
      const elementos = await page.$$eval(SELETOR_ADD_PAGAMENTO, (nodes) =>
        nodes.map((n) => ({
          id: n.getAttribute("cliente_id"),
          nome: n.getAttribute("nome"),
          telefone: n.getAttribute("telefone"),
        })),
      );
      const { ids, totalBotoes, botoesComNomeAlvo } = resolverIdInternoDoDom(
        elementos,
        clienteNome,
        telefone,
      );
      if (ids.length !== 1) {
        console.log(
          `[renovacao-sigma-workflow] id_cliente interno ${ids.length === 0 ? "nao encontrado" : "ambiguo"}`,
          JSON.stringify({ totalBotoes, botoesComNomeAlvo, candidatos: ids.length }),
        );
        return {
          resultado: "resultado_ambiguo",
          detalhe: `id_cliente interno ${ids.length === 0 ? "nao encontrado" : "ambiguo"}`,
        };
      }
      idClienteInterno = ids[0];

      // --- Pacote atual + expires_at (baseline) via renovacao-sigma-contexto
      // (Supabase), agora com o id ja resolvido pelo DOM.
      const ctxAntes = await lerContextoSigma(idClienteInterno);
      if (ctxAntes.outcome === "sessao_expirada") {
        return { resultado: "sessao_expirada", detalhe: ctxAntes.detalhe ?? "sessao invalida" };
      }
      if (ctxAntes.outcome === "pacote_vazio") {
        return { resultado: "resultado_ambiguo", detalhe: "Sigma nao informou o pacote atual (package vazio)" };
      }
      if (ctxAntes.outcome !== "success" || !ctxAntes.pacoteAtual) {
        return {
          resultado: "resultado_ambiguo",
          detalhe: `falha ao obter contexto Sigma (${ctxAntes.etapa ?? ctxAntes.outcome})`,
        };
      }
      pacoteAtualTexto = String(ctxAntes.pacoteAtual).trim();
      expiresAtAntes = ctxAntes.expiresAt ?? null;

      // --- Clique real (Playwright), no botao "Add Pagamento" da MESMA
      // pagina ja aberta -- mesmo seletor de cima, escopado pelo
      // cliente_id ja resolvido (nunca ambiguo). Abre #modal-add-pagamento.
      await page
        .locator(`[data-bs-target="#modal-add-pagamento"][cliente_id="${idClienteInterno}"]`)
        .click({ timeout: 10000 });
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
      return { resultado: "resultado_ambiguo", detalhe: "nao foi possivel completar o clique em Salvar" };
    }

    // Reconsulta INDEPENDENTE -- Rocket (via renovacao-sigma-cliente) e
    // Sigma (via renovacao-sigma-contexto, mesmo endpoint, so' o
    // expiresAt e' usado aqui), os dois, nunca confia so' no clique/
    // toast da UI.
    const { ok: okDepois, cliente: clienteDepois } = await lerClienteRocket(publicId);
    const ctxDepois = await lerContextoSigma(idClienteInterno);

    if (!okDepois || !clienteDepois || ctxDepois.outcome !== "success" || !ctxDepois.expiresAt) {
      return { resultado: "resultado_ambiguo", detalhe: "falha ao reconsultar Rocket/Sigma apos o clique" };
    }

    const vencimentoDepois = clienteDepois.vencimento;
    const expiresAtDepois = ctxDepois.expiresAt;

    const rocketMudou = vencimentoDepois !== vencimentoAntes;
    const sigmaMudou = expiresAtDepois !== expiresAtAntes;

    if (rocketMudou && sigmaMudou) {
      return { resultado: "sucesso", vencimentoConfirmado: vencimentoDepois };
    }

    if (!rocketMudou && !sigmaMudou) {
      return { resultado: "falha", detalhe: "vencimento nao mudou em nenhum dos dois sistemas apos o clique" };
    }

    // Um mudou, o outro nao -- divergencia real entre os dois sistemas,
    // nunca decide sozinho, sempre ambiguo.
    return {
      resultado: "resultado_ambiguo",
      detalhe: `divergencia entre sistemas: rocketMudou=${rocketMudou}, sigmaMudou=${sigmaMudou}`,
    };
  } catch (erro) {
    // Qualquer excecao nao prevista (elemento nao encontrado, timeout
    // do Playwright, etc.) -- NUNCA falha/sucesso por suposicao.
    console.error("[renovacao-sigma-workflow] excecao nao prevista", erro);
    return { resultado: "resultado_ambiguo", detalhe: `excecao: ${erro.message ?? String(erro)}` };
  }
}

// Renovacao em lote: processa os N filhos em sequencia e reporta um
// unico callback com resultados[]. Filho 'sigma' -> renovarUmAcessoSigma;
// filho 'unitv' -> renovarUmAcessoUniTVComSync (Etapa 2, Bloco 4).
async function processarLote(lote, sessionid, csrftoken) {
  const filhos = await lerFilhosDoLote(lote.grupo_id);
  if (filhos.length === 0) {
    await reportarResultadoLote(lote.grupo_id, []);
    return;
  }

  const resultados = [];
  for (const filho of filhos) {
    if (filho.tipo === "unitv") {
      // Etapa 2 (Bloco 4): executa a renovacao UniTV real (painel de
      // revenda) + sincroniza o vencimento no Rocket. Nao depende da
      // sessao do Rocket. rocketDesync (renovou no painel, Rocket nao
      // sincronizou) vai no item -- o resultado continua "sucesso".
      resultados.push(
        await renovarUmAcessoUniTVComSync({
          sn: filho.unitv_sn,
          id: filho.unitv_id,
          publicId: filho.public_id,
          servidorNome: filho.servidor_nome,
          clienteNome: filho.cliente_nome,
          tokenId: filho.id,
        }),
      );
      continue;
    }

    const r = await renovarUmAcessoSigma({
      sessionid,
      csrftoken,
      publicId: filho.public_id,
      clienteNome: filho.cliente_nome,
      telefone: filho.telefone,
    });
    resultados.push({
      token_id: filho.id,
      tipo: "sigma",
      servidor_nome: filho.servidor_nome,
      cliente_nome: filho.cliente_nome,
      resultado: r.resultado,
      vencimentoConfirmado: r.vencimentoConfirmado,
      detalhe: r.detalhe,
    });
  }

  await reportarResultadoLote(lote.grupo_id, resultados);
}

async function main() {
  requireEnv();

  // A "capa" (renovacoes_lote) carrega o operacao_id; senao e' um token
  // avulso.
  const lote = await lerLotePorOperacaoId(OPERACAO_ID);
  const token = lote ? null : await lerTokenRenovacao(OPERACAO_ID);

  // --- Individual UniTV (Etapa 2, Bloco 4): NAO depende da sessao do
  // Rocket -- usa o dealer_token do painel de revenda. Tratado ANTES da
  // checagem de sessao. Sucesso -> sincroniza o vencimento no Rocket
  // (rocketDesync se falhar, mas o resultado continua "sucesso").
  if (token && token.tipo === "unitv") {
    const item = await renovarUmAcessoUniTVComSync({
      sn: token.unitv_sn,
      id: token.unitv_id,
      publicId: token.public_id,
      servidorNome: token.servidor_nome,
      clienteNome: token.cliente_nome,
      tokenId: token.id,
    });
    const extra = {};
    if (item.detalhe) extra.detalhe = item.detalhe;
    if (item.resultado === "sucesso") {
      if (item.vencimentoConfirmado) extra.vencimentoConfirmado = item.vencimentoConfirmado;
      if (item.rocketDesync) extra.rocketDesync = true;
    }
    await reportarResultado(item.resultado, extra);
    return;
  }

  const { sessionid, csrftoken } = await lerSessaoRocket();
  if (!sessionid || !csrftoken) {
    // Sem sessao: um unico modo de falha, vale pros fluxos que dependem
    // dela (Sigma individual e lote -- inclusive filhos UniTV de um
    // lote, tratamento conservador).
    if (lote) {
      const filhos = await lerFilhosDoLote(lote.grupo_id);
      await reportarResultadoLote(
        lote.grupo_id,
        filhos.map((f) => ({
          token_id: f.id,
          tipo: f.tipo,
          servidor_nome: f.servidor_nome,
          cliente_nome: f.cliente_nome,
          resultado: "sessao_expirada",
          detalhe: "sessao do Vault ausente",
        })),
      );
      return;
    }
    await reportarResultado("sessao_expirada", { detalhe: "sessao do Vault ausente" });
    return;
  }

  if (lote) {
    await processarLote(lote, sessionid, csrftoken);
    return;
  }

  // --- Fluxo individual Sigma (byte a byte o de antes).
  if (!token) {
    await reportarResultado("resultado_ambiguo", { detalhe: "tokens_renovacao nao encontrado pra este operacao_id" });
    return;
  }

  const r = await renovarUmAcessoSigma({
    sessionid,
    csrftoken,
    publicId: token.public_id,
    clienteNome: token.cliente_nome,
    telefone: token.telefone,
  });
  const extra = {};
  if (r.vencimentoConfirmado) extra.vencimentoConfirmado = r.vencimentoConfirmado;
  if (r.detalhe) extra.detalhe = r.detalhe;
  await reportarResultado(r.resultado, extra);
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
