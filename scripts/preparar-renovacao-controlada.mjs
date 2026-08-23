// TEMPORARIO E DESCARTAVEL -- prepara o teste controlado de renovacao
// (abre o modal "Adicionar pagamento" de verdade, marca "Renovar no
// Painel", seleciona o mesmo pacote Sigma do teste anterior) mas NAO
// clica em Salvar. So dumpa o estado final do formulario + tira um
// screenshot, para revisao antes de qualquer acao real.

import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import path from "node:path";

const CRED_PATH = path.join(process.cwd(), ".credentials", "rocket-session.json");
const PUBLIC_ID_TESTE = "019ff025-ae5a-7e96-a037-8cfec84178d1"; // Js Informatica Rp / NewOne
const PACOTE_ALVO_TEXTO = "1 MÊS"; // mesmo pacote do teste anterior (secao 12 do levantamento)

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

  console.log('Clicando no botao real que abre o modal (data-bs-target="#modal-add-pagamento")...');
  await page.locator('[data-bs-target="#modal-add-pagamento"]').click({ timeout: 10000 });
  await page.waitForTimeout(1000);

  console.log('Marcando "Renovar no Painel"...');
  const renovarCheckbox = page.locator('input[name="renovar_painel"]');
  await renovarCheckbox.waitFor({ state: "visible", timeout: 10000 });
  await renovarCheckbox.check();

  console.log("Aguardando o select de pacote Sigma carregar (chamada GET .../sigma/packages/)...");
  await page.waitForTimeout(3000);

  // Procura um <select> visivel cujo texto de alguma option contenha "1 MÊS"
  const selects = await page.locator("select:visible").all();
  let pacoteSelecionado = null;
  for (const sel of selects) {
    const options = await sel.locator("option").allTextContents();
    const match = options.find((o) => o.includes(PACOTE_ALVO_TEXTO) && /sem adultos/i.test(o));
    if (match) {
      console.log(`Select de pacote encontrado. Selecionando opcao: "${match.trim()}"`);
      await sel.selectOption({ label: match });
      pacoteSelecionado = match.trim();
      break;
    }
  }

  if (!pacoteSelecionado) {
    console.log("AVISO: nao encontrei um select com a opcao esperada. Dumpando todos os selects visiveis:");
    for (const sel of selects) {
      const name = await sel.getAttribute("name");
      const options = await sel.locator("option").allTextContents();
      console.log(`  select name="${name}": ${JSON.stringify(options)}`);
    }
  }

  await page.waitForTimeout(1500);

  // Dump final do estado do formulario de pagamento, SEM clicar em Salvar
  const estadoFinal = await page.evaluate(() => {
    const campos = [
      "vencimento", "hora_vencimento", "plano", "valor", "forma_de_pagamento",
      "telas", "custo", "custo_creditos", "data_pagamento", "observacao",
      "atualizar_cliente", "enviar_mensagem", "renovar_painel", "sigma_package_id",
    ];
    const forms = Array.from(document.querySelectorAll("form"));
    const alvo = forms.find((f) => f.querySelector('[name="renovar_painel"]'));
    if (!alvo) return null;
    const out = {};
    for (const nome of campos) {
      const el = alvo.querySelector(`[name="${nome}"]`);
      if (el) {
        out[nome] = {
          tag: el.tagName,
          type: el.getAttribute("type") || null,
          value: el.value ?? null,
          checked: el.checked ?? null,
        };
      }
    }
    return { action: alvo.getAttribute("action"), method: alvo.getAttribute("method"), campos: out };
  });

  console.log("");
  console.log("=== ESTADO FINAL DO FORMULARIO (Salvar NAO foi clicado) ===");
  console.log(JSON.stringify(estadoFinal, null, 2));

  const screenshotPath = path.join(process.cwd(), ".credentials", "modal-pagamento-preview.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log("");
  console.log("Screenshot salvo em:", screenshotPath);

  await browser.close();
}

main().catch((e) => {
  console.error("Erro:", e.message ?? e);
  process.exit(1);
});
