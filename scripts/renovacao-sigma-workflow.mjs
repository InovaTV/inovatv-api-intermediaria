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

// Camada B (Iteracao 1, 2026-08-29 -- revisada 2026-08-29 apos revisao de
// seguranca): o POST /pagamento/add/ (renovar_painel=true) NAO e'
// idempotente -- consome 1 credito de revenda e empurra +1 mes a CADA
// chamada, sem nenhuma chave de idempotencia. REGRA: o clique roda no
// MAXIMO 1x por acesso, NUNCA repetido, em nenhum cenario de duvida.
// O retry fica so' na LEITURA (Camada A do sigma/info) e numa unica
// reconsulta EXTRA pos-clique (tambem leitura), pra cobrir propagacao
// lenta do painel/Rocket sem nunca re-executar o POST.
const SIGMA_RECONSULTA_EXTRA_MS = 4000; // respiro antes da 1 reconsulta extra (so' leitura)
const TETO_RESULTADO_MS = 20000; // teto seguro da espera orientada ao resultado do painel
// Toast/alerta de resultado da UI do Rocket -- se nenhum aparecer no
// teto, seguimos: quem decide e' a reconsulta independente, nunca este wait.
const SELETOR_RESULTADO_PAINEL =
  '.toast-body, .swal2-popup, .alert-success, .alert-danger, .alert-warning, #toast-container .toast, .Toastify__toast';

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

// Fase 2A (2026-08-30): o dealer token do painel de revenda UniTV vem
// do Vault (fonte viva, RPC unitv_dealer_token_ler via service_role --
// mesma mecanica de lerSessaoRocket, NENHUMA credencial nova), com
// fallback para process.env.UNITV_DEALER_TOKEN (ainda injetado pelo
// .yml). NAO rotaciona nada nesta fase: Vault == secret. O valor NUNCA
// e' logado. scripts/lib/unitv-renovar.mjs permanece intocado -- o
// token e' injetado por quem o chama.
async function lerDealerTokenVault() {
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/unitv_dealer_token_ler`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (!resp.ok) return null;
    const t = await resp.json();
    return typeof t === "string" && t.trim() !== "" ? t : null;
  } catch {
    return null;
  }
}

let _dealerTokenCache; // resolvido uma vez por execucao do runner
async function obterDealerTokenRunner() {
  if (_dealerTokenCache !== undefined) return _dealerTokenCache;
  const doVault = await lerDealerTokenVault();
  if (!doVault) console.log("[unitv-dealer-token] runner: vault indisponivel/vazio -> fallback do env");
  _dealerTokenCache = doVault ?? process.env.UNITV_DEALER_TOKEN ?? "";
  return _dealerTokenCache;
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
  // Fase 2A: injeta o token resolvido (Vault -> fallback env). O
  // executor congelado recebe o valor pronto -- seu default
  // process.env.UNITV_DEALER_TOKEN nunca e' exercido, mas o valor
  // entregue e' identico ao que ele leria (nao ha rotacao nesta fase).
  const dealerToken = await obterDealerTokenRunner();
  const r = await renovarUmAcessoUniTV({ sn, id, dealerToken });
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

  try {
    // URL so' para navegacao do Playwright (navegador real executa o JS
    // da pagina -- nao e' um fetch direto do runner).
    const paginaClienteUrl = `https://app.rocketgestor.com/gerenciador/cliente/info/${publicId}/`;
    const SELETOR_ADD_PAGAMENTO = '[data-bs-target="#modal-add-pagamento"][cliente_id]';

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
      // (Supabase), agora com o id ja resolvido pelo DOM. A Camada A
      // (retry curto) roda DENTRO daquela Edge Function -- aqui uma unica
      // chamada ja vem com "success" ou com "unavailable" ja esgotado.
      const ctxAntes = await lerContextoSigma(idClienteInterno);
      if (ctxAntes.outcome === "sessao_expirada") {
        return { resultado: "sessao_expirada", detalhe: ctxAntes.detalhe ?? "sessao invalida" };
      }
      if (ctxAntes.outcome === "pacote_vazio") {
        // Pos-reclassificacao (Iteracao 1): pacote_vazio agora SO' significa
        // resposta valida do painel + cliente realmente sem plano -- nunca
        // mais um Unauthenticated disfarcado.
        return { resultado: "resultado_ambiguo", detalhe: "Sigma nao informou o pacote atual (package vazio)" };
      }
      if (ctxAntes.outcome === "unavailable") {
        // A Camada A ja re-tentou N vezes. Auth do painel Sigma
        // indisponivel -> resultado_ambiguo + sigmaIndisponivel (mensagem
        // de instabilidade temporaria ao cliente). NUNCA "falha".
        return {
          resultado: "resultado_ambiguo",
          sigmaIndisponivel: true,
          detalhe: `painel Sigma indisponivel (auth) na leitura de contexto -- ${ctxAntes.etapa ?? "unavailable"}${ctxAntes.tentativas ? `, ${ctxAntes.tentativas} tentativas` : ""}`,
        };
      }
      if (ctxAntes.outcome !== "success" || !ctxAntes.pacoteAtual) {
        return {
          resultado: "resultado_ambiguo",
          detalhe: `falha ao obter contexto Sigma (${ctxAntes.etapa ?? ctxAntes.outcome})`,
        };
      }
      pacoteAtualTexto = String(ctxAntes.pacoteAtual).trim();
      expiresAtAntes = ctxAntes.expiresAt ?? null;

      // --- UM UNICO clique de renovacao. NUNCA repetido, em nenhum
      // cenario. O POST /pagamento/add/ consome credito e nao e'
      // idempotente -- repetir renovaria 2x. Todo retry desta etapa fica
      // so' na LEITURA (reconsulta), nunca no clique.
      await executarCliqueAddPagamento(page, idClienteInterno, pacoteAtualTexto);

      // Reconsulta INDEPENDENTE -- Rocket (via renovacao-sigma-cliente) e
      // Sigma (via renovacao-sigma-contexto), nunca confia no clique/toast
      // da UI. `avaliarVeredito` devolve o resultado final OU null quando
      // as duas fontes dizem "nada mudou" (com o painel autenticado) --
      // unico caso que pede a reconsulta EXTRA.
      const reconsultar = async () => {
        const rocket = await lerClienteRocket(publicId);
        const ctx = await lerContextoSigma(idClienteInterno);
        return { okDepois: rocket.ok, clienteDepois: rocket.cliente, ctxDepois: ctx };
      };
      const avaliarVeredito = ({ okDepois, clienteDepois, ctxDepois }) => {
        if (!okDepois || !clienteDepois) {
          return { resultado: "resultado_ambiguo", detalhe: "falha ao reconsultar o cliente no Rocket apos o clique" };
        }
        if (ctxDepois.outcome === "unavailable") {
          // A Camada A (4 tentativas) ja se esgotou nesta leitura. Nao da'
          // pra confirmar NEM negar a renovacao -> resultado_ambiguo +
          // sigmaIndisponivel. NUNCA "falha".
          return {
            resultado: "resultado_ambiguo",
            sigmaIndisponivel: true,
            detalhe: `painel Sigma indisponivel (auth) na reconsulta pos-clique -- ${ctxDepois.etapa ?? "unavailable"}${ctxDepois.tentativas ? `, ${ctxDepois.tentativas} tentativas` : ""}`,
          };
        }
        if (ctxDepois.outcome !== "success" || !ctxDepois.expiresAt) {
          return { resultado: "resultado_ambiguo", detalhe: `falha ao reconsultar o Sigma apos o clique (${ctxDepois.outcome})` };
        }
        const rocketMudou = clienteDepois.vencimento !== vencimentoAntes;
        const sigmaMudou = ctxDepois.expiresAt !== expiresAtAntes;
        if (rocketMudou && sigmaMudou) {
          return { resultado: "sucesso", vencimentoConfirmado: clienteDepois.vencimento };
        }
        if (rocketMudou !== sigmaMudou) {
          // XOR -- divergencia real entre os dois sistemas: sempre ambiguo.
          return {
            resultado: "resultado_ambiguo",
            detalhe: `divergencia entre sistemas: rocketMudou=${rocketMudou}, sigmaMudou=${sigmaMudou}`,
          };
        }
        return null; // !rocketMudou && !sigmaMudou && ctxDepois success -> reconsulta EXTRA
      };

      let veredito = avaliarVeredito(await reconsultar());

      if (veredito === null) {
        // As duas fontes dizem "nada mudou" e o painel esta autenticado.
        // UMA reconsulta EXTRA (so' leitura, SEM novo clique) apos um
        // respiro -- cobre propagacao lenta do painel/Rocket sem nunca
        // re-executar o POST.
        await new Promise((r) => setTimeout(r, SIGMA_RECONSULTA_EXTRA_MS));
        veredito = avaliarVeredito(await reconsultar());
      }

      if (veredito === null) {
        // Ainda sem mudanca em nenhum dos dois sistemas, painel
        // autenticado -> renovacao genuinamente nao aplicada. Um eventual
        // falso-"falha" residual de POST muito lento e' coberto pelas
        // redes ja existentes (transferencia humana + Peca 3/watchdog),
        // NUNCA por um 2o clique.
        veredito = {
          resultado: "falha",
          detalhe: "vencimento nao mudou em nenhum dos dois sistemas apos o clique (com reconsulta extra)",
        };
      }

      return veredito;
    } finally {
      await browser.close();
    }
  } catch (erro) {
    // Qualquer excecao nao prevista (elemento nao encontrado, timeout
    // do Playwright, etc.) -- NUNCA falha/sucesso por suposicao.
    console.error("[renovacao-sigma-workflow] excecao nao prevista", erro);
    return { resultado: "resultado_ambiguo", detalhe: `excecao: ${erro.message ?? String(erro)}` };
  }
}

// Sequencia de clique da renovacao no modal "Add Pagamento". Roda no
// MAXIMO 1x por acesso (nunca repetida). Lanca se qualquer passo nao
// completar (ex.: pacote nao encontrado no <select>) -- nesse caso o
// POST /pagamento/add/ nunca chega a ser submetido.
async function executarCliqueAddPagamento(page, idClienteInterno, pacoteAtualTexto) {
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
    // scripts/poc-confirmar-expires-at-renovacao.mjs, dry-run real): o
    // `<select>` real inclui um sufixo que o campo `package` do Sigma
    // NAO tem (ex.: "1 MES - P2P & IPTV COM ADULTOS - 1 creditos - 1
    // tela(s)" no select, contra "1 MES - P2P & IPTV COM ADULTOS" em
    // pacoteAtualTexto) -- o match exato nunca encontrava a opcao contra
    // dado real. Corrigido pra prefixo -- pacoteAtualTexto continua
    // sendo a fonte de verdade (Sigma), nunca um texto fixo.
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

  // O clique submete o formulario Django (POST /pagamento/add/ ->
  // navegacao). Executado UMA vez.
  await page.locator("#btn_adicionar_pagamento").click({ timeout: 10000 });

  // Espera ORIENTADA AO RESULTADO do painel, com teto seguro -- no lugar
  // do antigo waitForTimeout(3000) cego, que reconsultava enquanto o POST
  // ainda podia estar em curso. Aguarda a pagina de resultado carregar E
  // um toast/alerta de resultado aparecer; se qualquer um estourar o
  // teto, seguimos -- quem decide e' a reconsulta independente, nunca
  // este wait. Cada passo e' best-effort (.catch), nunca lanca.
  await page.waitForLoadState("load", { timeout: TETO_RESULTADO_MS }).catch(() => {});
  await page.waitForSelector(SELETOR_RESULTADO_PAINEL, { timeout: TETO_RESULTADO_MS }).catch(() => {});
  await page.waitForTimeout(1500); // respiro curto pro banco do Rocket assentar
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
  // Iteracao 1 (2026-08-29): painel Sigma indisponivel (auth) apos a
  // Camada A -- o callback carrega isso pra renovacao-sigma-resultado
  // enviar a mensagem de instabilidade temporaria ao cliente (individual).
  if (r.sigmaIndisponivel) extra.sigmaIndisponivel = true;
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
