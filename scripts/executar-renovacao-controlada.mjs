// TEMPORARIO E DESCARTAVEL -- EXECUTA de verdade o teste controlado de
// renovacao, autorizado explicitamente pelo usuario apos revisao do
// screenshot do modal (ver preparar-renovacao-controlada.mjs). Repete
// exatamente os mesmos passos (abrir modal, marcar "Renovar no
// Painel", selecionar o pacote "1 MES ... SEM ADULTOS") e desta vez
// CLICA em Salvar. Depois confirma independentemente o resultado no
// Sigma (GET .../sigma/info/) e no Rocket (texto visivel na pagina do
// cliente).

import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import path from "node:path";

const CRED_PATH = path.join(process.cwd(), ".credentials", "rocket-session.json");
const PUBLIC_ID_TESTE = "019ff025-ae5a-7e96-a037-8cfec84178d1"; // Js Informatica Rp / NewOne
const CLIENTE_ID_INTERNO_TESTE = "1553554";
const PACOTE_ALVO_TEXTO = "1 MÊS";

async function main() {
  const sessao = JSON.parse(await readFile(CRED_PATH, "utf8"));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies([
    { name: "sessionid", value: sessao.sessionid, domain: "app.rocketgestor.com", path: "/", httpOnly: true, secure: true },
    { name: "csrftoken", value: sessao.csrftoken, domain: "app.rocketgestor.com", path: "/", httpOnly: false, secure: true },
  ]);

  const page = await context.newPage();
  const url = `https://app.rocketgestor.com/gerenciador/cliente/info/${PUBLIC_ID_TESTE}/`;
  console.log("Navegando para", url);
  await page.goto(url, { waitUntil: "load", timeout: 20000 });

  console.log('Abrindo modal "Adicionar pagamento"...');
  await page.locator('[data-bs-target="#modal-add-pagamento"]').click({ timeout: 10000 });
  await page.waitForTimeout(1000);

  console.log('Marcando "Renovar no Painel"...');
  const renovarCheckbox = page.locator('input[name="renovar_painel"]');
  await renovarCheckbox.waitFor({ state: "visible", timeout: 10000 });
  await renovarCheckbox.check();

  console.log("Aguardando select de pacote Sigma carregar...");
  await page.waitForTimeout(3000);

  const selects = await page.locator("select:visible").all();
  let pacoteSelecionado = null;
  for (const sel of selects) {
    const options = await sel.locator("option").allTextContents();
    const match = options.find((o) => o.includes(PACOTE_ALVO_TEXTO) && /sem adultos/i.test(o));
    if (match) {
      await sel.selectOption({ label: match });
      pacoteSelecionado = match.trim();
      break;
    }
  }
  if (!pacoteSelecionado) {
    throw new Error("Nao encontrei o pacote esperado -- abortando antes de qualquer clique em Salvar.");
  }
  console.log("Pacote selecionado:", pacoteSelecionado);
  await page.waitForTimeout(1500);

  // Escuta a resposta real do POST antes de clicar
  const respostaPromise = page
    .waitForResponse((res) => res.url().includes("/gerenciador/pagamento/add/"), { timeout: 20000 })
    .catch(() => null);

  console.log("");
  console.log(">>> CLICANDO EM SALVAR (acao real) <<<");
  await page.locator("#btn_adicionar_pagamento").click({ timeout: 10000 });

  const resposta = await respostaPromise;
  if (resposta) {
    console.log("Resposta do POST -- status:", resposta.status(), "URL:", resposta.url());
  } else {
    console.log("Nao capturei a resposta do POST diretamente (pode ter sido via redirect/reload).");
  }

  await page.waitForTimeout(3000);

  // Procura mensagens de confirmacao/toast visiveis na pagina
  const mensagens = await page.evaluate(() => {
    const seletores = [".toast", ".alert", ".swal2-popup", ".notification", "[role='alert']"];
    const achados = [];
    for (const sel of seletores) {
      document.querySelectorAll(sel).forEach((el) => {
        const t = (el.textContent || "").trim();
        if (t) achados.push(t);
      });
    }
    return achados;
  });
  console.log("");
  console.log("Mensagens/toasts visiveis apos o clique:");
  console.log(JSON.stringify(mensagens, null, 2));

  const screenshotDepois = path.join(process.cwd(), ".credentials", "resultado-renovacao.png");
  await page.screenshot({ path: screenshotDepois, fullPage: true });
  console.log("Screenshot pos-renovacao salvo em:", screenshotDepois);

  await browser.close();

  // --- Verificacao independente 1: Sigma (mesmo endpoint ja validado, so leitura) ---
  console.log("");
  console.log("=== VERIFICACAO INDEPENDENTE 1: SIGMA ===");
  const cookieHeader = `sessionid=${sessao.sessionid}; csrftoken=${sessao.csrftoken}`;
  const resSigma = await fetch(
    `https://app.rocketgestor.com/gerenciador/cliente/sigma/info/?cliente_id=${CLIENTE_ID_INTERNO_TESTE}`,
    {
      headers: {
        Cookie: cookieHeader,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Referer: "https://app.rocketgestor.com/gerenciador/",
        "X-Requested-With": "XMLHttpRequest",
      },
    },
  );
  const corpoSigma = await resSigma.json().catch(() => null);
  console.log("Status:", resSigma.status);
  console.log(
    JSON.stringify(
      corpoSigma
        ? {
            plano: corpoSigma.data?.package,
            vencimento: corpoSigma.data?.expires_at,
            status: corpoSigma.data?.status,
          }
        : corpoSigma,
      null,
      2,
    ),
  );

  // --- Verificacao independente 2: Rocket (texto visivel na pagina do cliente, recarregada do zero) ---
  console.log("");
  console.log("=== VERIFICACAO INDEPENDENTE 2: ROCKET (pagina do cliente recarregada) ===");
  const browser2 = await chromium.launch({ headless: true });
  const context2 = await browser2.newContext();
  await context2.addCookies([
    { name: "sessionid", value: sessao.sessionid, domain: "app.rocketgestor.com", path: "/", httpOnly: true, secure: true },
    { name: "csrftoken", value: sessao.csrftoken, domain: "app.rocketgestor.com", path: "/", httpOnly: false, secure: true },
  ]);
  const page2 = await context2.newPage();
  await page2.goto(url, { waitUntil: "load", timeout: 20000 });
  const textoVencimento = await page2.evaluate(() => {
    const corpo = document.body.innerText;
    const linhas = corpo.split("\n").map((l) => l.trim()).filter(Boolean);
    const idx = linhas.findIndex((l) => /vencimento/i.test(l));
    return idx >= 0 ? linhas.slice(idx, idx + 3) : null;
  });
  console.log("Trecho perto de 'Vencimento' na pagina do cliente:", JSON.stringify(textoVencimento, null, 2));
  await browser2.close();
}

main().catch((e) => {
  console.error("Erro:", e.message ?? e);
  process.exit(1);
});
