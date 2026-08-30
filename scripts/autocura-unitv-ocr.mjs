// F3-A da autocura do UNITV_DEALER_TOKEN (2026-08-30) -- RUNNER de
// CALIBRACAO DE OCR (modo observacao). Executado pelo GitHub Actions
// (.github/workflows/autocura-unitv-ocr.yml), disparado 1x/dia pela EF
// autocura-unitv-ocr-agendador.
//
// O QUE FAZ: abre a pagina de login do painel de revenda, coleta
// CALIBRACAO_AMOSTRAS CAPTCHAs pelo endpoint PRE-AUTENTICADO
// /api/dealer-core/security/get-info, roda o pipeline de OCR
// (scripts/lib/unitv-captcha-ocr.mjs) sobre cada um, agrega METRICAS e
// reporta a EF autocura-unitv-resultado.
//
// O QUE NAO FAZ (garantido por desenho + ausencia de credenciais no env):
//   * NAO faz login. NAO submete o formulario. NAO tem UNITV_DEALER_LOGIN
//     nem UNITV_DEALER_SENHA no ambiente.
//   * NAO chama nenhum endpoint autenticado do painel (get-info e' pre-auth).
//   * NAO escreve no Vault. NAO altera secret. NAO chama
//     /api/account/renew. NAO cria cobranca. NAO dispara outro workflow.
//   * NAO grava/loga os bytes do CAPTCHA nem a string de digitos prevista.
//     So' AGREGADOS numericos cruzam para o Supabase.

import { chromium } from "playwright";
import { PNG } from "pngjs";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analisarCaptcha, agregar, CAPTCHA_LARGURA, CAPTCHA_ALTURA } from "./lib/unitv-captcha-ocr.mjs";

const RAIZ = dirname(fileURLToPath(import.meta.url));

// Constante (NAO coluna de config -- ver comentario da migration). Pode
// virar autocura_unitv_config.calibracao_amostras depois.
const CALIBRACAO_AMOSTRAS = 20;
const PAINEL_BASE = "https://panel-web.revenda.site";
const GET_INFO = `${PAINEL_BASE}/api/dealer-core/security/get-info`;
const OCR_SCORE_MIN = 0.92;   // espelha o default de autocura_unitv_config
const OCR_MARGEM_MIN = 0.15;

const CICLO_ID = process.env.CICLO_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CALLBACK_TOKEN = process.env.AUTOCURA_UNITV_OCR_CALLBACK_TOKEN;

function requireEnv() {
  const faltando = [["CICLO_ID", CICLO_ID], ["SUPABASE_URL", SUPABASE_URL],
    ["SUPABASE_SERVICE_ROLE_KEY", SRK], ["AUTOCURA_UNITV_OCR_CALLBACK_TOKEN", CALLBACK_TOKEN]]
    .filter(([, v]) => !v).map(([k]) => k);
  if (faltando.length) throw new Error(`Env ausente: ${faltando.join(", ")}`);
}

function runnerSha() {
  try { return execSync("git rev-parse --short HEAD", { cwd: RAIZ }).toString().trim(); }
  catch { return process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 7) : null; }
}

function carregarTemplates() {
  const j = JSON.parse(readFileSync(join(RAIZ, "lib", "captcha-templates", "digitos.json"), "utf8"));
  const t = {};
  for (let d = 0; d <= 9; d++) t[d] = Uint8Array.from(j.templates[d]);
  return t;
}

// data:image/png;base64,.... OU base64 puro -> {gray, w, h}
function decodificarPng(dataUrlOuB64) {
  const b64 = String(dataUrlOuB64).replace(/^data:image\/png;base64,/, "");
  const png = PNG.sync.read(Buffer.from(b64, "base64"));
  const { width: w, height: h, data } = png; // RGBA
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
  }
  return { gray, w, h };
}

// tenta extrair um PNG base64 de uma resposta JSON do get-info
function extrairImagem(obj) {
  if (!obj || typeof obj !== "object") return null;
  for (const k of ["img", "image", "captcha", "captchaImg", "data", "base64", "picture"]) {
    const v = obj[k];
    if (typeof v === "string" && (v.startsWith("data:image") || v.length > 200)) return v;
  }
  // as vezes vem aninhado em .data
  if (obj.data && typeof obj.data === "object") return extrairImagem(obj.data);
  return null;
}

async function obterCaptcha(page) {
  // caminho primario: endpoint pre-auth
  try {
    const resp = await page.request.post(GET_INFO, { data: {}, timeout: 15000 });
    if (resp.ok()) {
      const j = await resp.json().catch(() => null);
      const img = extrairImagem(j);
      if (img) return img;
    }
  } catch { /* cai no fallback */ }
  // fallback: <img> do CAPTCHA na propria pagina de login
  try {
    const src = await page.getAttribute("#form_item_validateCode, img[src^='data:image']", "src", { timeout: 5000 });
    if (src && src.startsWith("data:image")) return src;
  } catch { /* nada */ }
  return null;
}

async function reportar(payload) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/autocura-unitv-resultado`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Token": CALLBACK_TOKEN },
    body: JSON.stringify(payload),
  });
  console.log(`[autocura-unitv-ocr] callback: HTTP ${resp.status}`);
}

async function main() {
  requireEnv();
  const templates = carregarTemplates();
  const sha = runnerSha();
  const browser = await chromium.launch();
  const resultados = [];
  let refreshes = 0;
  try {
    const page = await browser.newPage();
    await page.goto(`${PAINEL_BASE}/#/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
    for (let i = 0; i < CALIBRACAO_AMOSTRAS; i++) {
      if (i > 0) refreshes++;
      const img = await obterCaptcha(page);
      if (!img) { console.log(`[autocura-unitv-ocr] amostra ${i}: sem CAPTCHA`); continue; }
      let dec;
      try { dec = decodificarPng(img); }
      catch (e) { console.log(`[autocura-unitv-ocr] amostra ${i}: PNG ilegivel (${String(e).slice(0, 60)})`); continue; }
      const r = analisarCaptcha(dec.gray, dec.w, dec.h, templates, { ocrScoreMin: OCR_SCORE_MIN, ocrMargemMin: OCR_MARGEM_MIN });
      // LOG: so' bucket + flags. NUNCA r.predicao, NUNCA a imagem.
      console.log(`[autocura-unitv-ocr] amostra ${i}: bucket=${r.bucket} 4seg=${r.quatroSegmentos} gate=${r.gateOk} inval=${r.obviamenteInvalida} dim=${dec.w}x${dec.h}`);
      // descarta r.predicao antes de guardar
      const { predicao: _p, ...semPredicao } = r;
      resultados.push(semPredicao);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const metricas = agregar(resultados, refreshes, sha);
  console.log(`[autocura-unitv-ocr] agregado: total=${metricas.amostras_total} gate_ok=${metricas.amostras_gate_ok} 4seg=${metricas.amostras_4_segmentos} obv_inval=${metricas.amostras_obviamente_invalida} p50_score=${metricas.score_top1_p50} p10_margem=${metricas.margem_p10}`);

  const bucketDominante = ["alta", "media", "baixa"]
    .reduce((a, b) => (metricas[`bucket_${b}`] > metricas[`bucket_${a}`] ? b : a), "baixa");

  await reportar({
    ciclo_id: CICLO_ID,
    outcome: "calibracao",
    metrics: {
      ...metricas,
      captcha_confianca_bucket: metricas.amostras_total === 0 ? "n_a" : bucketDominante,
      login_posts: 0, // sempre -- runner nao tem credenciais
    },
  });
}

main().catch(async (e) => {
  console.error("[autocura-unitv-ocr] FALHA:", e?.message ?? e);
  // reporta a falha para o ciclo nao ficar orfao (watchdog/expirar_orfaos cobre se nem isto funcionar)
  try {
    await reportar({ ciclo_id: CICLO_ID, outcome: "indeterminado", failure_class: "excecao", metrics: { login_posts: 0 } });
  } catch { /* watchdog cobre */ }
  process.exit(1);
});
