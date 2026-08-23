// TEMPORARIO E DESCARTAVEL -- so reconhecimento, SOMENTE LEITURA.
// Injeta a sessao ja capturada, abre a pagina do cliente de teste e
// inspeciona o modal "Adicionar pagamento" (campos, valores atuais,
// csrfmiddlewaretoken) SEM clicar em Salvar. Nao altera nada.

import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import path from "node:path";

const CRED_PATH = path.join(process.cwd(), ".credentials", "rocket-session.json");
const PUBLIC_ID_TESTE = "019ff025-ae5a-7e96-a037-8cfec84178d1"; // Js Informatica Rp / NewOne

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
  console.log("URL final:", page.url());
  console.log("Titulo:", await page.title());

  // Procura por elementos que mencionem "pagamento" (botao/link que abre o modal)
  const candidatos = await page.locator("text=/adicionar pagamento/i").all();
  console.log(`Elementos com texto "adicionar pagamento": ${candidatos.length}`);

  // Le o csrfmiddlewaretoken de QUALQUER form na pagina (Django usa o mesmo por pagina)
  const csrfValue = await page
    .locator('input[name="csrfmiddlewaretoken"]')
    .first()
    .getAttribute("value")
    .catch(() => null);
  console.log("csrfmiddlewaretoken encontrado na pagina:", csrfValue ? `sim (${csrfValue.length} chars)` : "nao");

  // Lista todos os forms e seus campos relevantes de pagamento, sem clicar
  const formsInfo = await page.evaluate(() => {
    const campos = [
      "vencimento",
      "hora_vencimento",
      "plano",
      "valor",
      "forma_de_pagamento",
      "telas",
      "custo",
      "custo_creditos",
      "data_pagamento",
      "observacao",
      "atualizar_cliente",
      "enviar_mensagem",
      "renovar_painel",
      "sigma_package_id",
    ];
    const forms = Array.from(document.querySelectorAll("form"));
    return forms
      .map((f) => {
        const action = f.getAttribute("action") || "";
        const temCampoRelevante = campos.some((nome) => f.querySelector(`[name="${nome}"]`));
        if (!temCampoRelevante) return null;
        const encontrados = {};
        for (const nome of campos) {
          const el = f.querySelector(`[name="${nome}"]`);
          if (el) {
            encontrados[nome] = {
              tag: el.tagName,
              type: el.getAttribute("type") || null,
              value: el.value ?? el.getAttribute("value") ?? null,
              checked: el.checked ?? null,
            };
          }
        }
        return { action, method: f.getAttribute("method"), encontrados };
      })
      .filter(Boolean);
  });
  console.log("");
  console.log("Forms de pagamento encontrados na pagina:");
  console.log(JSON.stringify(formsInfo, null, 2));

  await browser.close();
}

main().catch((e) => {
  console.error("Erro:", e.message ?? e);
  process.exit(1);
});
