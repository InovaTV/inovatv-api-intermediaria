// TEMPORARIO E DESCARTAVEL -- so testa se um navegador headless
// (Playwright) consegue logar no Rocket passando pelo Cloudflare
// Turnstile (achado da secao 13.2 do levantamento
// documentos/levantamentos/2026-08-21_renovacao_automatica_painel_primeiro.md).
//
// NAO abre nenhum cliente, NAO chama /gerenciador/pagamento/add/, NAO
// toca em nenhum dado real. So confirma se a sessao (cookie sessionid)
// e obtida com sucesso. Fecha o navegador e descarta tudo ao final --
// nenhuma sessao e salva em disco nesta etapa.
//
// Uso: coloque ROCKET_LOGIN_USUARIO e ROCKET_LOGIN_SENHA num arquivo
// scripts/.env (nunca commitado, ja coberto por .env* no .gitignore) e
// rode, de dentro de scripts/:
//   node --env-file=.env teste-login-rocket-turnstile.mjs
//
// Apagar este arquivo depois de usado -- mesmo padrao ja usado em
// outros repositorios do ecossistema para diagnosticos pontuais.

import { chromium } from "playwright";

const USUARIO = process.env.ROCKET_LOGIN_USUARIO;
const SENHA = process.env.ROCKET_LOGIN_SENHA;

if (!USUARIO || !SENHA) {
  console.error(
    "Defina ROCKET_LOGIN_USUARIO e ROCKET_LOGIN_SENHA (ex.: scripts/.env) antes de rodar.",
  );
  process.exit(1);
}

const LOGIN_URL = "https://app.rocketgestor.com/accounts/login/?next=/gerenciador/";

async function main() {
  console.log("Abrindo navegador headless...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log(`Navegando para ${LOGIN_URL} ...`);
    await page.goto(LOGIN_URL, { waitUntil: "load", timeout: 30000 });

    console.log("Aguardando o formulario de login aparecer...");
    await page.waitForSelector('input[name="username"]', { timeout: 15000 });

    console.log("Preenchendo usuario/senha...");
    await page.fill('input[name="username"]', USUARIO);
    await page.fill('input[name="password"]', SENHA);

    console.log("Aguardando o Turnstile resolver (ate 20s)...");
    let turnstileResolvido = false;
    try {
      await page.waitForFunction(
        () => {
          const el = document.querySelector('input[name="cf-turnstile-response"]');
          return !!(el && el.value && el.value.length > 0);
        },
        { timeout: 20000 },
      );
      turnstileResolvido = true;
      console.log("Turnstile resolveu sozinho (token presente).");
    } catch {
      console.log(
        "Turnstile NAO resolveu dentro de 20s -- token continua vazio. " +
          "Vou tentar submeter mesmo assim, para ver a mensagem de erro real.",
      );
    }

    console.log("Submetendo o formulario de login...");
    await Promise.all([
      page.waitForLoadState("load", { timeout: 20000 }).catch(() => {}),
      page.click('#login-form button[type="submit"], #login-form input[type="submit"]'),
    ]);
    await page.waitForTimeout(2000);

    const urlFinal = page.url();
    const cookies = await context.cookies();
    const temSessionId = cookies.some((c) => c.name.toLowerCase() === "sessionid");

    console.log("--- RESULTADO ---");
    console.log("URL final:", urlFinal);
    console.log("Turnstile resolveu sozinho:", turnstileResolvido);
    console.log("Cookie sessionid presente:", temSessionId);
    console.log(
      "Login bem-sucedido (heuristica: saiu de /accounts/login/ e tem sessionid):",
      !urlFinal.includes("/accounts/login/") && temSessionId,
    );

    // Se o login falhou, tenta capturar alguma mensagem de erro visivel na pagina.
    if (urlFinal.includes("/accounts/login/")) {
      const possivelErro = await page
        .locator(".errorlist, .alert-danger, [class*='error']")
        .first()
        .textContent()
        .catch(() => null);
      if (possivelErro) {
        console.log("Mensagem de erro encontrada na pagina:", possivelErro.trim());
      }
    }
  } finally {
    await browser.close();
    console.log("Navegador fechado. Nenhuma sessao foi salva em disco.");
  }
}

main().catch((e) => {
  console.error("Erro inesperado:", e);
  process.exit(1);
});
