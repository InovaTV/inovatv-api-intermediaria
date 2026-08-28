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

const OPERACAO_ID = process.env.OPERACAO_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CALLBACK_TOKEN = process.env.RENOVACAO_SIGMA_CALLBACK_TOKEN;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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

// Mesma logica/criterio de _shared/rocket_session_check.ts (Deno) --
// reescrita aqui em Node porque o job roda fora do runtime Deno.
async function verificarSessaoRocket(sessionid, csrftoken) {
  const cookieHeader = `sessionid=${sessionid}; csrftoken=${csrftoken}`;
  try {
    const res = await fetch("https://app.rocketgestor.com/gerenciador/", {
      method: "GET",
      redirect: "manual",
      headers: { Cookie: cookieHeader, "User-Agent": USER_AGENT },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location") ?? "";
      return !location.includes("/accounts/login/");
    }
    if (res.status === 200) {
      const corpo = await res.text();
      return !(corpo.includes('id="login-form"') || corpo.includes('name="username"'));
    }
    return null; // status inesperado -- tratado como incerto, nao invalido
  } catch {
    return null; // erro de rede -- NUNCA marca invalida
  }
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

function normalizarTelefonePagina(telefoneBruto) {
  return String(telefoneBruto ?? "").replace(/\D/g, "");
}

// Correcao de risco (2026-08-24, achado real durante a preparacao da
// POC scripts/poc-confirmar-expires-at-renovacao.mjs): a versao
// antiga coletava TODOS os numeros que pareciam id_cliente na pagina
// inteira, exigindo "exatamente 1 numero na pagina" -- a pagina do
// cliente hoje renderiza o botao "Adicionar pagamento" repetido pra
// ~100 clientes (mesmo widget que motivou a correcao do seletor de
// clique, ver mais abaixo), entao esse criterio antigo sempre falhava
// (achava ~100 candidatos), mesmo depois de corrigido o clique.
//
// Reescrito pra associar deterministicamente ao cliente certo via
// dois atributos estruturais reais, ambos ja conhecidos de forma
// independente (nunca inferidos por posicao/ordem): `nome` (atributo
// do proprio botao "Adicionar pagamento") e `telefone` (atributo de
// um elemento na mesma linha, textualmente antes do botao, mesmo
// grupo de acoes) -- comparados contra token.cliente_nome e
// token.telefone (snapshot ja gravado no momento da criacao do token,
// _shared/tokens_renovacao.ts, sem nenhuma chamada nova).
//
// `telefone` sozinho NAO e' suficiente -- achado real, comprovado com
// o cliente de teste: 2 clientes REAIS distintos ("Js Informática Rp",
// cliente_id 1569097, e "Meu Uso Testes", cliente_id 1569178)
// compartilham o mesmo telefone (provavelmente o mesmo titular com
// dois cadastros no Rocket). Por isso a combinacao nome+telefone e'
// exigida, nunca so' um dos dois isoladamente.
//
// Continua nunca escolhendo por posicao/ordem -- exige exatamente 1
// correspondencia, senao resultado_ambiguo, exatamente como antes
// (main() abaixo nao mudou esse criterio).
function resolverIdInterno(html, nomeAlvo, telefoneAlvo) {
  const telefoneAlvoNormalizado = normalizarTelefonePagina(telefoneAlvo);
  const regexBotao = /<button[^>]*\bid="btn_add_pagamento_(\d+)"[^>]*\bnome="([^"]*)"[^>]*>/g;
  const regexTelefone = /\btelefone="([^"]*)"/g;
  const candidatos = new Set();

  let m;
  while ((m = regexBotao.exec(html)) !== null) {
    const clienteId = m[1];
    const nome = m[2];
    if (nome !== nomeAlvo) continue;

    // Telefone da mesma linha: atributo mais proximo ANTES deste
    // botao (estrutura real observada -- o item "Agendar Mensagem",
    // que carrega telefone, sempre aparece antes do botao "Adicionar
    // pagamento" dentro do mesmo grupo de acoes da linha).
    const janelaAntes = html.slice(Math.max(0, m.index - 3000), m.index);
    regexTelefone.lastIndex = 0;
    let ultimoTelefone = null;
    let mt;
    while ((mt = regexTelefone.exec(janelaAntes)) !== null) ultimoTelefone = mt[1];

    if (ultimoTelefone && normalizarTelefonePagina(ultimoTelefone) === telefoneAlvoNormalizado) {
      candidatos.add(clienteId);
    }
  }
  return [...candidatos];
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

  const sessaoValida = await verificarSessaoRocket(sessionid, csrftoken);
  if (sessaoValida === false) {
    await reportarResultado("sessao_expirada", { detalhe: "sessao do Rocket invalida (redirect pra login)" });
    return;
  }
  // sessaoValida === null (erro de rede na checagem) NAO aborta --
  // segue tentando, mesma disciplina de "falha de rede nunca marca
  // invalida" ja usada no monitoramento.

  const publicId = token.public_id;
  const cookieHeader = `sessionid=${sessionid}; csrftoken=${csrftoken}`;

  const { ok: okAntes, cliente: clienteAntes } = await lerClienteRocket(publicId);
  if (!okAntes || !clienteAntes) {
    await reportarResultado("resultado_ambiguo", { detalhe: "falha ao ler cliente no Rocket antes da tentativa" });
    return;
  }
  const vencimentoAntes = clienteAntes.vencimento;

  try {
    // Resolve id_cliente interno -- so' na pagina autenticada por
    // sessao (nao existe em nenhum schema da API publica, achado real
    // da investigacao desta mesma frente).
    const paginaClienteUrl = `https://app.rocketgestor.com/gerenciador/cliente/info/${publicId}/`;
    const paginaRes = await fetch(paginaClienteUrl, { headers: { Cookie: cookieHeader, "User-Agent": USER_AGENT } });
    const paginaHtml = await paginaRes.text();
    const candidatosId = resolverIdInterno(paginaHtml, token.cliente_nome, token.telefone);
    if (candidatosId.length !== 1) {
      await reportarResultado("resultado_ambiguo", {
        detalhe: `id_cliente interno ${candidatosId.length === 0 ? "nao encontrado" : "ambiguo"}`,
      });
      return;
    }
    const idClienteInterno = candidatosId[0];

    // Pacote atual, direto do Sigma -- fonte de verdade comprovada por
    // teste real controlado (nunca server_id, so' o texto de "package").
    const sigmaInfoRes = await fetch(
      `https://app.rocketgestor.com/gerenciador/cliente/sigma/info/?cliente_id=${idClienteInterno}`,
      { headers: { Cookie: cookieHeader, "User-Agent": USER_AGENT, Referer: "https://app.rocketgestor.com/gerenciador/", "X-Requested-With": "XMLHttpRequest" } },
    );
    const sigmaInfoBody = await sigmaInfoRes.json().catch(() => null);
    const pacoteAtualTexto = String(sigmaInfoBody?.data?.package ?? "").trim();
    if (!pacoteAtualTexto) {
      await reportarResultado("resultado_ambiguo", { detalhe: "Sigma nao informou o pacote atual (package vazio)" });
      return;
    }

    // Playwright real -- mesma sequencia ja comprovada em
    // executar-renovacao-controlada.mjs, so' parametrizada.
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addCookies([
      { name: "sessionid", value: sessionid, domain: "app.rocketgestor.com", path: "/", httpOnly: true, secure: true },
      { name: "csrftoken", value: csrftoken, domain: "app.rocketgestor.com", path: "/", httpOnly: false, secure: true },
    ]);
    const page = await context.newPage();

    let clicouSalvar = false;
    try {
      await page.goto(paginaClienteUrl, { waitUntil: "load", timeout: 20000 });
      // Correcao de risco (2026-08-24, comprovada em
      // scripts/poc-confirmar-expires-at-renovacao.mjs, dry-run real):
      // o seletor generico `[data-bs-target="#modal-add-pagamento"]`
      // deixou de ser unico -- a pagina do cliente hoje renderiza esse
      // botao repetido pra varios clientes (widget cresceu com o
      // volume de testes desta investigacao), causando "strict mode
      // violation" no Playwright. Cada botao carrega seu proprio
      // cliente_id como atributo HTML
      // (id="btn_add_pagamento_{cliente_id}") -- escopado aqui pelo
      // mesmo idClienteInterno ja resolvido acima, nunca ambiguo.
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

    // Reconsulta INDEPENDENTE -- Rocket e Sigma, os dois, nunca confia
    // so' no clique/toast da UI.
    const { ok: okDepois, cliente: clienteDepois } = await lerClienteRocket(publicId);
    const sigmaInfoDepoisRes = await fetch(
      `https://app.rocketgestor.com/gerenciador/cliente/sigma/info/?cliente_id=${idClienteInterno}`,
      { headers: { Cookie: cookieHeader, "User-Agent": USER_AGENT, Referer: "https://app.rocketgestor.com/gerenciador/", "X-Requested-With": "XMLHttpRequest" } },
    );
    const sigmaInfoDepoisBody = await sigmaInfoDepoisRes.json().catch(() => null);

    if (!okDepois || !clienteDepois || !sigmaInfoDepoisBody?.data) {
      await reportarResultado("resultado_ambiguo", { detalhe: "falha ao reconsultar Rocket/Sigma apos o clique" });
      return;
    }

    const vencimentoDepois = clienteDepois.vencimento;
    const expiresAtAntes = sigmaInfoBody?.data?.expires_at;
    const expiresAtDepois = sigmaInfoDepoisBody.data.expires_at;

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
