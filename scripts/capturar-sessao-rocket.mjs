// TEMPORARIO E DESCARTAVEL -- captura sessionid + csrftoken do Rocket
// depois de um LOGIN HUMANO REAL, feito por voce, num navegador
// visivel (nao headless). Nao preenche usuario/senha por script, nao
// clica em nada por script, nao tenta resolver o Turnstile -- so abre
// a janela, espera voce logar por conta propria (exatamente como ja
// faz todo dia), e captura os cookies da sessao ja autenticada.
//
// Os valores capturados NUNCA sao impressos no terminal -- so
// confirmacao de presenca/tamanho. Salvos em
// scripts/.credentials/rocket-session.json, ja coberto por
// .gitignore (scripts/.credentials/), nunca commitado.
//
// Uso: de dentro de scripts/, rode:
//   node capturar-sessao-rocket.mjs
// e complete o login na janela que abrir.

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const LOGIN_URL = "https://app.rocketgestor.com/accounts/login/?next=/gerenciador/";
const CRED_DIR = path.join(process.cwd(), ".credentials");
const CRED_PATH = path.join(CRED_DIR, "rocket-session.json");
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos para completar o login manualmente

async function main() {
  console.log("Abrindo navegador VISIVEL (nao headless)...");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log(`Navegando para ${LOGIN_URL} ...`);
  await page.goto(LOGIN_URL, { waitUntil: "load" });

  console.log("");
  console.log("=================================================================");
  console.log("Faca o login normalmente NESSA JANELA: usuario, senha, resolva o");
  console.log("Turnstile como sempre faz. Este script nao vai digitar nem clicar");
  console.log("nada por voce -- so aguardando voce completar o login.");
  console.log(`Prazo: ${TIMEOUT_MS / 60000} minutos.`);
  console.log("=================================================================");
  console.log("");

  const inicio = Date.now();
  let logado = false;

  while (Date.now() - inicio < TIMEOUT_MS) {
    const url = page.url();
    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) => c.name.toLowerCase() === "sessionid");

    if (!url.includes("/accounts/login/") && sessionCookie && sessionCookie.value) {
      logado = true;
      break;
    }
    await page.waitForTimeout(2000);
  }

  if (!logado) {
    console.error("Tempo esgotado sem detectar login concluido. Nada foi salvo.");
    await browser.close();
    process.exit(1);
  }

  const cookies = await context.cookies();
  const sessionCookie = cookies.find((c) => c.name.toLowerCase() === "sessionid");
  const csrfCookie = cookies.find((c) => c.name.toLowerCase() === "csrftoken");

  if (!sessionCookie || !csrfCookie) {
    console.error(
      "Login parece ter funcionado, mas nao encontrei os dois cookies esperados " +
        "(sessionid e csrftoken). Nada foi salvo.",
    );
    console.error(
      "Cookies encontrados (so nomes, nunca valores):",
      cookies.map((c) => c.name).join(", "),
    );
    await browser.close();
    process.exit(1);
  }

  await mkdir(CRED_DIR, { recursive: true });
  await writeFile(
    CRED_PATH,
    JSON.stringify(
      {
        capturadoEm: new Date().toISOString(),
        sessionid: sessionCookie.value,
        csrftoken: csrfCookie.value,
        sessionidExpires: sessionCookie.expires ?? null,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );

  console.log("");
  console.log("=== SESSAO CAPTURADA COM SUCESSO ===");
  console.log("sessionid: presente (" + sessionCookie.value.length + " caracteres) -- valor NAO exibido");
  console.log("csrftoken: presente (" + csrfCookie.value.length + " caracteres) -- valor NAO exibido");
  console.log("Salvo em:", CRED_PATH);
  console.log("Fechando o navegador em 3s...");

  await page.waitForTimeout(3000);
  await browser.close();
}

main().catch((e) => {
  console.error("Erro inesperado:", e.message ?? e);
  process.exit(1);
});
