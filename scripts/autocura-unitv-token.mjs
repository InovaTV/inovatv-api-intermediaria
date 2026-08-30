// F4 da autocura do UNITV_DEALER_TOKEN (2026-08-30) -- RUNNER do HEALER.
// Executado pelo GitHub Actions (.github/workflows/autocura-unitv-token.yml),
// disparado por workflow_dispatch com um ciclo_id tipo='disparo' ja
// registrado.
//
// LIGA as dependencias reais no nucleo testavel
// scripts/lib/autocura-unitv-healer.mjs. Toda a disciplina (1 UNICO POST
// de login, gravar SO' o Vault e so' depois do /api/account, revalidacao,
// failure_class) vive la -- este arquivo so' fornece Playwright/fetch.
//
// NAO FAZ (garantido por desenho): /api/account/renew, /pagamento/add/,
// cobranca, alteracao do Edge secret UNITV_DEALER_TOKEN. NAO importa
// scripts/lib/unitv-renovar.mjs.
//
// NAO LOGA (I6): token, senha, login, CAPTCHA resolvido, SN ancora.
//
// >>> A implementacao de postLogin/capturarCaptcha usa os melhores
// >>> palpites de endpoint/seletor do painel. O 1o disparo e' um TESTE
// >>> MANUAL SUPERVISIONADO (doc secao F4.M) -- ajustar os pontos
// >>> marcados "CONFIRMAR NO 1o RUN" ali, se necessario.

import { chromium } from "playwright";
import { PNG } from "pngjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analisarCaptcha } from "./lib/unitv-captcha-ocr.mjs";
import { executarHealer } from "./lib/autocura-unitv-healer.mjs";
import { resolverContaReadonly } from "./lib/autocura-unitv-conta-readonly.mjs";

const RAIZ = dirname(fileURLToPath(import.meta.url));

const PAINEL_BASE = "https://panel-web.revenda.site";
const GET_INFO = `${PAINEL_BASE}/api/dealer-core/security/get-info`;
const OCR_SCORE_MIN = 0.92; // espelha autocura_unitv_config.ocr_score_min
const OCR_MARGEM_MIN = 0.15;
const CAP_REFRESH_CAPTCHA = 12; // espelha autocura_unitv_config.cap_refresh_captcha

// CONFIRMAR NO 1o RUN -- seletores/endpoint de login do painel.
const SEL_USUARIO = "#form_item_username, input[name='username'], #username";
const SEL_SENHA = "#form_item_password, input[type='password'], #password";
const SEL_CODIGO = "#form_item_code, input[name='code'], input[name='validateCode'], #code";
const SEL_SUBMIT = "button[type='submit'], .login-btn, button:has-text('Entrar'), button:has-text('Login')";

const CICLO_ID = process.env.CICLO_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CALLBACK_TOKEN = process.env.AUTOCURA_UNITV_HEALER_CALLBACK_TOKEN;
const DEALER_LOGIN = process.env.UNITV_DEALER_LOGIN;
const DEALER_SENHA = process.env.UNITV_DEALER_SENHA;
const DEALER_NAME = process.env.UNITV_DEALER_NAME;
const ANCHOR_SN = process.env.UNITV_DIAG_ANCHOR_SN;

function requireEnv() {
  const faltando = [
    ["CICLO_ID", CICLO_ID], ["SUPABASE_URL", SUPABASE_URL], ["SUPABASE_SERVICE_ROLE_KEY", SRK],
    ["AUTOCURA_UNITV_HEALER_CALLBACK_TOKEN", CALLBACK_TOKEN], ["UNITV_DEALER_LOGIN", DEALER_LOGIN],
    ["UNITV_DEALER_SENHA", DEALER_SENHA], ["UNITV_DEALER_NAME", DEALER_NAME], ["UNITV_DIAG_ANCHOR_SN", ANCHOR_SN],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (faltando.length) throw new Error(`Env ausente: ${faltando.join(", ")}`);
}

function log(evento, dados) {
  console.log(`[autocura-unitv-token] ${evento}`, JSON.stringify({ evento, ...dados }));
}

function carregarTemplates() {
  const j = JSON.parse(readFileSync(join(RAIZ, "lib", "captcha-templates", "digitos.json"), "utf8"));
  const t = {};
  for (let d = 0; d <= 9; d++) t[d] = Uint8Array.from(j.templates[d]);
  return t;
}

function decodificarPng(dataUrlOuB64) {
  const b64 = String(dataUrlOuB64).replace(/^data:image\/png;base64,/, "");
  const png = PNG.sync.read(Buffer.from(b64, "base64"));
  const { width: w, height: h, data } = png;
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
  }
  return { gray, w, h };
}

function extrairImagem(obj) {
  if (!obj || typeof obj !== "object") return null;
  for (const k of ["img", "image", "captcha", "captchaImg", "data", "base64", "picture"]) {
    const v = obj[k];
    if (typeof v === "string" && (v.startsWith("data:image") || v.length > 200)) return v;
  }
  if (obj.data && typeof obj.data === "object") return extrairImagem(obj.data);
  return null;
}

async function obterCaptchaBruto(page) {
  try {
    const resp = await page.request.post(GET_INFO, { data: {}, timeout: 15000 });
    if (resp.ok()) {
      const j = await resp.json().catch(() => null);
      const img = extrairImagem(j);
      if (img) return img;
    }
  } catch { /* fallback */ }
  try {
    const src = await page.getAttribute("#form_item_validateCode, img[src^='data:image']", "src", { timeout: 5000 });
    if (src && src.startsWith("data:image")) return src;
  } catch { /* nada */ }
  return null;
}

// --- extrator do dealer_token da resposta/estado pos-login ---
function acharTokenEmTexto(txt) {
  if (typeof txt !== "string") return null;
  const m = txt.match(/[0-9a-f]{32}/i);
  return m ? m[0].toLowerCase() : null;
}

async function main() {
  requireEnv();
  const templates = carregarTemplates();
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // guarda a ultima resposta que "parece" a de login (contem 32-hex)
  let tokenDaRede = null;
  page.on("response", async (resp) => {
    try {
      const url = resp.url();
      if (!/login|auth|signin|sign-in|session/i.test(url)) return;
      const body = await resp.text().catch(() => "");
      const t = acharTokenEmTexto(body);
      if (t) tokenDaRede = t;
    } catch { /* ignora */ }
  });

  await page.goto(`${PAINEL_BASE}/#/login`, { waitUntil: "domcontentloaded", timeout: 30000 });

  const analisar = (gray, w, h) =>
    analisarCaptcha(gray, w, h, templates, { ocrScoreMin: OCR_SCORE_MIN, ocrMargemMin: OCR_MARGEM_MIN });

  const capturarCaptcha = async () => {
    const bruto = await obterCaptchaBruto(page);
    if (!bruto) return null;
    try { return decodificarPng(bruto); } catch { return null; }
  };

  const refreshCaptcha = async () => {
    // "Eu nao vejo" / recarregar imagem -- NAO conta como login.
    try {
      const botao = page.locator("text=/n[aã]o vejo|recarregar|refresh/i").first();
      if (await botao.count()) { await botao.click({ timeout: 3000 }); return; }
    } catch { /* cai no get-info */ }
    try { await page.request.post(GET_INFO, { data: {}, timeout: 10000 }); } catch { /* nada */ }
  };

  // 1 UNICO POST de login. Preenche o formulario e submete uma vez.
  const postLogin = async (codigo) => {
    tokenDaRede = null;
    try {
      await page.fill(SEL_USUARIO, DEALER_LOGIN, { timeout: 8000 });
      await page.fill(SEL_SENHA, DEALER_SENHA, { timeout: 8000 });
      await page.fill(SEL_CODIGO, codigo, { timeout: 8000 });
    } catch (e) {
      return { resultado: "transporte" }; // formulario nao respondeu -> tratado como transporte, sem 2o POST
    }
    let respLogin = null;
    try {
      const [resp] = await Promise.all([
        page.waitForResponse((r) => /login|auth|signin|sign-in|session/i.test(r.url()), { timeout: 20000 }).catch(() => null),
        page.click(SEL_SUBMIT, { timeout: 8000 }),
      ]);
      respLogin = resp;
    } catch {
      return { resultado: "transporte" };
    }

    // classifica
    let token = tokenDaRede;
    if (!token) {
      try { token = acharTokenEmTexto(await page.evaluate(() => JSON.stringify(window.localStorage))); } catch { /* nada */ }
    }
    if (!token) {
      try {
        const cookies = await context.cookies();
        token = acharTokenEmTexto(cookies.map((c) => c.value).join(" "));
      } catch { /* nada */ }
    }

    const status = respLogin ? respLogin.status() : null;
    if (token && (status === null || (status >= 200 && status < 300))) {
      return { resultado: "sucesso", token };
    }
    if (status !== null && status >= 500) return { resultado: "transporte" };
    // 2xx sem token, ou 4xx, ou toast de erro -> recusa (NUNCA 2o POST)
    return { resultado: "recusa" };
  };

  const validarConta = async (token) => {
    const r = await resolverContaReadonly(ANCHOR_SN, { dealerToken: token, dealerName: DEALER_NAME });
    if (r.ok) return { ok: true };
    return { ok: false, ...(typeof r.returnCode === "number" ? { returnCode: r.returnCode } : {}) };
  };

  const gravarVault = async (token) => {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/unitv_dealer_token_definir`, {
      method: "POST",
      headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_token: token, p_origem: "autocura", p_por: "healer" }),
    });
    if (!resp.ok) throw new Error(`unitv_dealer_token_definir HTTP ${resp.status}`);
  };

  const lerVault = async () => {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/unitv_dealer_token_ler`, {
      method: "POST",
      headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (!resp.ok) return null;
    const t = await resp.json().catch(() => null);
    return typeof t === "string" && t.trim() !== "" ? t : null;
  };

  const reportar = async (payload) => {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/autocura-unitv-resultado`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": CALLBACK_TOKEN },
      body: JSON.stringify(payload),
    });
    log("callback", { http: resp.status });
  };

  try {
    const resumo = await executarHealer({
      cicloId: CICLO_ID,
      cfg: { capRefreshCaptcha: CAP_REFRESH_CAPTCHA },
      capturarCaptcha, analisar, refreshCaptcha, postLogin, validarConta, gravarVault, lerVault, reportar, log,
    });
    log("fim", { outcome: resumo.outcome, failure_class: resumo.failureClass, login_posts: resumo.loginPosts, vault_gravado: resumo.vaultGravado });
    if (resumo.postLoginChamado > 1) { console.error("[autocura-unitv-token] INVARIANTE VIOLADA: >1 POST de login"); process.exit(1); }
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(async (e) => {
  console.error("[autocura-unitv-token] FALHA:", e?.message ?? e);
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/autocura-unitv-resultado`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": CALLBACK_TOKEN },
      body: JSON.stringify({ ciclo_id: CICLO_ID, outcome: "falhou", failure_class: "excecao", metrics: { login_posts: 0, vault_gravado: false } }),
    });
  } catch { /* watchdog/expirar_orfaos cobre */ }
  process.exit(1);
});
