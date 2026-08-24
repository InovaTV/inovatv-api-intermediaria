// TEMPORARIO E DESCARTAVEL -- POC real e controlada, com um unico
// objetivo: fechar a ultima lacuna de evidencia da revisao do Bloco 2
// (renovacao automatica) -- comprovar, com reconsulta programatica
// real (nao so' leitura visual no painel Sigma), que o campo
// `expires_at` de GET /gerenciador/cliente/sigma/info/ realmente muda
// numa renovacao bem-sucedida. `scripts/renovacao-sigma-workflow.mjs`
// (producao real do Bloco 2) decide "sucesso" comparando exatamente
// esse campo antes/depois -- este script existe pra provar que essa
// comparacao e' confiavel antes de colocar o Bloco 2 em producao de
// verdade.
//
// NAO altera nenhum arquivo/fluxo de producao: nao toca em
// tokens_renovacao, nao chama nenhuma Edge Function, nao chama o
// callback renovacao-sigma-resultado, nao roda a partir do workflow
// renovacao-sigma.yml, NUNCA envia mensagem ao cliente (nenhuma
// chamada ao WhatsApp existe neste arquivo). E' um script standalone,
// isolado, no mesmo espirito de
// scripts/executar-renovacao-controlada.mjs (ja usado e aprovado
// nesta mesma investigacao).
//
// Reaproveita, byte a byte equivalente, os 3 mecanismos agora
// corrigidos e validados em scripts/renovacao-sigma-workflow.mjs
// (2026-08-24):
//   1. resolverIdInterno(html, nomeAlvo, telefoneAlvo) -- resolucao
//      deterministica do idClienteInterno via nome+telefone reais
//      (nunca coleta todos os numeros da pagina, nunca escolhe por
//      posicao).
//   2. Seletor de clique especifico do cliente:
//      #btn_add_pagamento_{idClienteInterno} (nunca o seletor
//      generico ambiguo).
//   3. Selecao do pacote por PREFIXO contra o `package` real do
//      Sigma (cobre o sufixo real de creditos/telas do <select>).
//
// Cliente de teste fixo, mesmo de toda a investigacao ate aqui:
// Js Informatica Rp / NewOne. Nenhum outro cliente e' tocado.
//
// Duas etapas, deliberadamente separadas por uma flag explicita:
//
//   node poc-confirmar-expires-at-renovacao.mjs
//     -> DRY RUN (padrao). Le sessao, resolve idClienteInterno, le
//        Sigma/Rocket "ANTES", abre o modal real, marca "Renovar no
//        Painel", seleciona a opcao certa no <select> -- e PARA.
//        NUNCA clica em Salvar.
//
//   node poc-confirmar-expires-at-renovacao.mjs --executar
//     -> Repete tudo o que o dry-run faz e ENTAO clica em Salvar de
//        verdade -- so' depois disso le Sigma/Rocket "DEPOIS"
//        (reconsulta independente, sessao/HTTP puro, sem navegador) e
//        imprime o veredito final.
//
// Fonte da sessao do Rocket (nesta ordem de preferencia):
//   1. Vault real (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY no
//      ambiente) via a MESMA RPC rocket_sessao_ler que
//      renovacao-sigma-workflow.mjs usa em producao.
//   2. scripts/.credentials/rocket-session.json (fallback, sessao
//      capturada manualmente via capturar-sessao-rocket.mjs).
//
// Nenhum valor de sessao/API key e' impresso em nenhum momento. Se
// qualquer estado for inesperado/ambiguo, o script aborta -- nunca
// tenta corrigir/adivinhar automaticamente.

import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import path from "node:path";

const PUBLIC_ID_TESTE = "019ff025-ae5a-7e96-a037-8cfec84178d1"; // Js Informatica Rp / NewOne
const NOME_CLIENTE_TESTE = "Js Informática Rp";
const TELEFONE_CLIENTE_TESTE = "5517981625486";
const CRED_PATH = path.join(process.cwd(), ".credentials", "rocket-session.json");
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const EXECUTAR = process.argv.includes("--executar");

async function lerSessao() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceRoleKey) {
    console.log("Fonte da sessao: Vault real (mesma RPC que renovacao-sigma-workflow.mjs usa em producao).");
    const resp = await fetch(`${supabaseUrl}/rest/v1/rpc/rocket_sessao_ler`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (!resp.ok) {
      throw new Error(`Falha ao ler sessao do Vault -- HTTP ${resp.status}`);
    }
    const dados = await resp.json();
    const linha = Array.isArray(dados) ? dados[0] : dados;
    if (!linha?.sessionid || !linha?.csrftoken) {
      throw new Error("Vault respondeu, mas sem sessionid/csrftoken -- sessao ausente/nao capturada.");
    }
    return { sessionid: linha.sessionid, csrftoken: linha.csrftoken, origem: "vault" };
  }

  console.log(
    "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY nao definidos -- usando fallback local:",
    CRED_PATH,
  );
  const raw = await readFile(CRED_PATH, "utf8").catch(() => {
    throw new Error(
      `Nao encontrei ${CRED_PATH} nem SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY no ambiente. ` +
        "Rode capturar-sessao-rocket.mjs primeiro, ou exporte as duas variaveis do Vault real.",
    );
  });
  const sessao = JSON.parse(raw);
  if (!sessao.sessionid || !sessao.csrftoken) {
    throw new Error("Arquivo de sessao local encontrado, mas sem sessionid/csrftoken. Recapture a sessao.");
  }
  return { sessionid: sessao.sessionid, csrftoken: sessao.csrftoken, origem: "arquivo_local" };
}

// Mecanismo 1 (2026-08-24, comprovado em
// scripts/renovacao-sigma-workflow.mjs) -- equivalente byte a byte a
// producao: resolve idClienteInterno via nome+telefone reais, nunca
// coleta todos os numeros da pagina, nunca escolhe por posicao. Exige
// exatamente 1 correspondencia -- senao aborta ambiguo.
function normalizarTelefonePagina(telefoneBruto) {
  return String(telefoneBruto ?? "").replace(/\D/g, "");
}

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

async function lerSigmaInfo(cookieHeader, clienteIdInterno) {
  const resp = await fetch(
    `https://app.rocketgestor.com/gerenciador/cliente/sigma/info/?cliente_id=${clienteIdInterno}`,
    {
      headers: {
        Cookie: cookieHeader,
        "User-Agent": USER_AGENT,
        Referer: "https://app.rocketgestor.com/gerenciador/",
        "X-Requested-With": "XMLHttpRequest",
      },
    },
  );
  const body = await resp.json().catch(() => null);
  return {
    status: resp.status,
    package: body?.data?.package ?? null,
    expiresAt: body?.data?.expires_at ?? null,
    statusSigma: body?.data?.status ?? null,
  };
}

// Vencimento do Rocket lido direto dos atributos HTML do botao do
// cliente especifico (fonte mais direta e confiavel que scraping de
// texto -- achado real desta mesma investigacao).
async function lerVencimentoRocket(cookieHeader, urlCliente, clienteIdInterno) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies([
    { name: "sessionid", value: cookieHeader.sessionid, domain: "app.rocketgestor.com", path: "/", httpOnly: true, secure: true },
    { name: "csrftoken", value: cookieHeader.csrftoken, domain: "app.rocketgestor.com", path: "/", httpOnly: false, secure: true },
  ]);
  const page = await context.newPage();
  await page.goto(urlCliente, { waitUntil: "load", timeout: 20000 });
  const botao = page.locator(`#btn_add_pagamento_${clienteIdInterno}`);
  const existe = (await botao.count()) > 0;
  const dados = existe
    ? {
        vencimento: await botao.getAttribute("vencimento"),
        horaVencimento: await botao.getAttribute("hora_vencimento"),
        nome: await botao.getAttribute("nome"),
      }
    : null;
  await browser.close();
  return dados;
}

function formatarComparacao(antes, depois) {
  const linhas = [];
  linhas.push(`  package:    antes="${antes.package}"  depois="${depois.package}"  ${antes.package === depois.package ? "(igual)" : "(MUDOU)"}`);
  linhas.push(`  expires_at: antes="${antes.expiresAt}"  depois="${depois.expiresAt}"  ${antes.expiresAt === depois.expiresAt ? "(igual)" : "(MUDOU)"}`);
  linhas.push(`  status:     antes="${antes.statusSigma}"  depois="${depois.statusSigma}"  ${antes.statusSigma === depois.statusSigma ? "(igual)" : "(mudou)"}`);
  return linhas.join("\n");
}

async function main() {
  console.log(EXECUTAR ? ">>> MODO EXECUCAO REAL (--executar) <<<" : "modo DRY RUN (padrao -- nunca clica em Salvar)");
  console.log("Cliente de teste fixo: Js Informatica Rp / NewOne");
  console.log("Nenhuma mensagem sera enviada ao cliente (este script nunca chama WhatsApp).\n");

  const sessao = await lerSessao();
  const cookieHeader = `sessionid=${sessao.sessionid}; csrftoken=${sessao.csrftoken}`;
  const urlCliente = `https://app.rocketgestor.com/gerenciador/cliente/info/${PUBLIC_ID_TESTE}/`;

  console.log("Resolvendo idClienteInterno via nome+telefone (mesmo mecanismo de producao)...");
  const paginaRes = await fetch(urlCliente, { headers: { Cookie: cookieHeader, "User-Agent": USER_AGENT } });
  const paginaHtml = await paginaRes.text();
  const candidatosId = resolverIdInterno(paginaHtml, NOME_CLIENTE_TESTE, TELEFONE_CLIENTE_TESTE);
  if (candidatosId.length !== 1) {
    console.error(
      `\nidClienteInterno ${candidatosId.length === 0 ? "nao encontrado" : "ambiguo"} (candidatos: ${JSON.stringify(candidatosId)}) -- abortando sem tentar corrigir.`,
    );
    process.exit(1);
  }
  const clienteIdInterno = candidatosId[0];
  console.log("idClienteInterno resolvido:", clienteIdInterno, clienteIdInterno === "1569097" ? "(bate com o esperado, 1569097)" : "(DIFERENTE DO ESPERADO 1569097 -- revisar antes de prosseguir)");

  console.log("\n=== ESTADO ANTES ===");
  const sigmaAntes = await lerSigmaInfo(cookieHeader, clienteIdInterno);
  console.log("Sigma (GET .../sigma/info/):", JSON.stringify(sigmaAntes, null, 2));
  const rocketAntes = await lerVencimentoRocket(sessao, urlCliente, clienteIdInterno);
  console.log("Rocket (atributos do botao do cliente):", JSON.stringify(rocketAntes, null, 2));

  if (sigmaAntes.status !== 200 || !sigmaAntes.package) {
    console.error("\nSessao invalida ou Sigma nao respondeu como esperado -- abortando antes de qualquer acao.");
    process.exit(1);
  }
  if (sigmaAntes.statusSigma !== "ACTIVE") {
    console.error(`\nStatus do Sigma nao e' ACTIVE ("${sigmaAntes.statusSigma}") antes de comecar -- abortando sem tentar corrigir.`);
    process.exit(1);
  }
  if (!rocketAntes) {
    console.error("\nNao encontrei o botao do cliente resolvido na pagina -- abortando antes de qualquer acao.");
    process.exit(1);
  }

  console.log("\nAbrindo o browser (Playwright, headless) para abrir o modal real...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies([
    { name: "sessionid", value: sessao.sessionid, domain: "app.rocketgestor.com", path: "/", httpOnly: true, secure: true },
    { name: "csrftoken", value: sessao.csrftoken, domain: "app.rocketgestor.com", path: "/", httpOnly: false, secure: true },
  ]);
  const page = await context.newPage();
  await page.goto(urlCliente, { waitUntil: "load", timeout: 20000 });

  console.log('Abrindo modal "Adicionar pagamento" (botao especifico do cliente resolvido)...');
  await page.locator(`#btn_add_pagamento_${clienteIdInterno}`).click({ timeout: 10000 });
  await page.waitForTimeout(1000);

  console.log('Marcando "Renovar no Painel"...');
  const renovarCheckbox = page.locator('input[name="renovar_painel"]');
  await renovarCheckbox.waitFor({ state: "visible", timeout: 10000 });
  await renovarCheckbox.check();

  console.log("Aguardando select de pacote Sigma carregar...");
  await page.waitForTimeout(3000);

  // Mecanismo 3 (comprovado em producao): match por PREFIXO contra o
  // `package` real do Sigma -- cobre o sufixo real de creditos/telas.
  const selects = await page.locator("select:visible").all();
  let pacoteSelecionado = null;
  for (const sel of selects) {
    const options = await sel.locator("option").allTextContents();
    const match = options.find((o) => o.trim().startsWith(sigmaAntes.package.trim()));
    if (match) {
      await sel.selectOption({ label: match });
      pacoteSelecionado = match.trim();
      break;
    }
  }
  if (!pacoteSelecionado) {
    console.error(`\nNao encontrei a opcao "${sigmaAntes.package}" no select -- abortando antes de qualquer clique.`);
    await browser.close();
    process.exit(1);
  }
  console.log("Pacote selecionado (bate com o package atual do Sigma):", pacoteSelecionado);
  await page.waitForTimeout(1500);

  if (!EXECUTAR) {
    const screenshotPath = path.join(process.cwd(), ".credentials", "poc-expires-at-dry-run.png");
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    await browser.close();
    console.log("\n=== DRY RUN CONCLUIDO -- Salvar NUNCA foi clicado ===");
    console.log("Screenshot (se .credentials/ existir):", screenshotPath);
    console.log("\nPra rodar a acao real e comprovar expires_at de verdade:");
    console.log("  node poc-confirmar-expires-at-renovacao.mjs --executar");
    return;
  }

  const respostaPromise = page
    .waitForResponse((res) => res.url().includes("/gerenciador/pagamento/add/"), { timeout: 20000 })
    .catch(() => null);

  console.log("\n>>> CLICANDO EM SALVAR (acao real, cliente de teste) <<<");
  await page.locator("#btn_adicionar_pagamento").click({ timeout: 10000 });

  const resposta = await respostaPromise;
  console.log(
    resposta
      ? `Resposta do POST -- status: ${resposta.status()} URL: ${resposta.url()}`
      : "Nao capturei a resposta do POST diretamente (pode ter sido via redirect/reload).",
  );
  await page.waitForTimeout(3000);
  await browser.close();

  console.log("\n=== ESTADO DEPOIS (reconsulta independente, sessao/HTTP puro) ===");
  const sigmaDepois = await lerSigmaInfo(cookieHeader, clienteIdInterno);
  console.log("Sigma (GET .../sigma/info/):", JSON.stringify(sigmaDepois, null, 2));
  const rocketDepois = await lerVencimentoRocket(sessao, urlCliente, clienteIdInterno);
  console.log("Rocket (atributos do botao do cliente):", JSON.stringify(rocketDepois, null, 2));

  console.log("\n=== COMPARACAO ===");
  console.log(formatarComparacao(sigmaAntes, sigmaDepois));
  console.log(`  Rocket vencimento: antes=${JSON.stringify(rocketAntes)} depois=${JSON.stringify(rocketDepois)}`);

  const expiresAtMudou = sigmaAntes.expiresAt !== sigmaDepois.expiresAt;
  const rocketMudou = JSON.stringify(rocketAntes) !== JSON.stringify(rocketDepois);
  const pacoteContinuaCorreto = sigmaDepois.package === sigmaAntes.package;
  const statusContinuaActive = sigmaDepois.statusSigma === "ACTIVE";

  let direcaoCoerente = null;
  if (sigmaAntes.expiresAt && sigmaDepois.expiresAt) {
    const antesMs = new Date(sigmaAntes.expiresAt).getTime();
    const depoisMs = new Date(sigmaDepois.expiresAt).getTime();
    if (Number.isFinite(antesMs) && Number.isFinite(depoisMs)) {
      const diffDias = (depoisMs - antesMs) / (1000 * 60 * 60 * 24);
      direcaoCoerente = diffDias > 0;
      console.log(`  expires_at: diferenca = ${diffDias.toFixed(2)} dias (${direcaoCoerente ? "avancou, coerente com renovacao" : "NAO avancou -- incoerente"})`);
    }
  }

  console.log("\n=== CRITERIOS EXIGIDOS ===");
  console.log(`  rocketMudou = ${rocketMudou}`);
  console.log(`  sigmaMudou (expires_at) = ${expiresAtMudou}`);
  console.log(`  expires_at mudou de forma coerente (avancou) = ${direcaoCoerente}`);
  console.log(`  pacote permanece correto (igual ao de antes) = ${pacoteContinuaCorreto}`);
  console.log(`  status permanece ACTIVE = ${statusContinuaActive}`);

  console.log("\n=== VEREDITO (mesma logica rocketMudou/sigmaMudou de renovacao-sigma-workflow.mjs) ===");
  const todosCriteriosOk = rocketMudou && expiresAtMudou && direcaoCoerente === true && pacoteContinuaCorreto && statusContinuaActive;
  if (todosCriteriosOk) {
    console.log("CONFIRMADO: todos os criterios exigidos foram atendidos.");
    console.log("expires_at mudou de verdade, em conjunto com o vencimento do Rocket, avancou coerentemente,");
    console.log("o pacote permanece o mesmo e o status continua ACTIVE.");
    console.log("A logica de confirmacao de sucesso do Bloco 2 (comparar expires_at antes/depois) e' confiavel.");
  } else if (!rocketMudou && !expiresAtMudou) {
    console.log("NAO CONFIRMADO: nem o Rocket nem o expires_at do Sigma mudaram -- renovacao real nao aconteceu.");
    console.log("Nao tentando corrigir automaticamente -- investigacao manual necessaria.");
  } else {
    console.log("DIVERGENTE/INESPERADO: nem todos os criterios exigidos foram atendidos simultaneamente --");
    console.log("ver o detalhe de cada criterio acima. Nao tentando corrigir automaticamente.");
  }
}

main().catch((e) => {
  console.error("\nErro:", e.message ?? e);
  process.exit(1);
});
