// F3-A da autocura do UNITV_DEALER_TOKEN (2026-08-30) -- PIPELINE DE OCR
// do CAPTCHA do painel de revenda (panel-web.revenda.site).
//
// PURO: recebe um bitmap grayscale (Uint8Array + width + height) e os
// templates de digito (scripts/lib/captcha-templates/digitos.json).
// Nao decodifica PNG (o runner faz isso com pngjs), nao acessa rede,
// nao grava nada, NUNCA loga a string prevista nem a imagem.
//
// CAPTCHA observado: 4 digitos numericos grandes, separados, ~92% de
// fundo branco, isolatedDarkPx:0, strikeLikeRows:0, formato client-side
// [0-9]{4}. Ver NEXT_SESSION.md secoes 0.3 / 4.6.2.
//
// Validacao SEM gabarito (F3-A nao faz login -> sem verdade de
// referencia): mede-se CONFIANCA e AUTO-CONSISTENCIA, nunca acuracia.
// A acuracia real so' e' confirmavel na F4 (login supervisionado).

// -- geometria esperada da imagem servida pelo painel --
export const CAPTCHA_LARGURA = 240;
export const CAPTCHA_ALTURA = 80;
// fracao de pixels "brancos" aceitavel num CAPTCHA legitimo
export const FUNDO_BRANCO_MIN = 0.80;
export const FUNDO_BRANCO_MAX = 0.985;
// limiar de binarizacao (0-255) -- pixel < LIMIAR_TINTA e' tinta
export const LIMIAR_TINTA = 160;
// tamanho ao qual cada blob e' normalizado antes do NCC
export const NORM_W = 16;
export const NORM_H = 24;
// pisos de sanidade (independentes de config -- sao "obviamente invalido")
export const SCORE_PISO_ABSURDO = 0.50; // digito abaixo disto nao parece nenhum numero
export const MARGEM_PISO_ABSURDO = 0.03; // dois templates empatados -> ambiguo

// ---------------------------------------------------------------------
// binariza: bitmap grayscale -> Uint8Array (0 = fundo, 1 = tinta)
// ---------------------------------------------------------------------
export function binarizar(gray, w, h, limiar = LIMIAR_TINTA) {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = gray[i] < limiar ? 1 : 0;
  return out;
}

export function fracaoBranco(bin) {
  let brancos = 0;
  for (let i = 0; i < bin.length; i++) if (bin[i] === 0) brancos++;
  return brancos / bin.length;
}

// linhas quase totalmente preenchidas de tinta -> "risco" atravessando o CAPTCHA
export function strikeLikeRows(bin, w, h, frac = 0.6) {
  let n = 0;
  for (let y = 0; y < h; y++) {
    let t = 0;
    for (let x = 0; x < w; x++) t += bin[y * w + x];
    if (t / w >= frac) n++;
  }
  return n;
}

// ---------------------------------------------------------------------
// segmenta em blobs pelo perfil de projecao vertical (colunas com tinta)
// devolve [{x0,x1}] dos grupos contiguos de colunas com tinta
// ---------------------------------------------------------------------
export function segmentar(bin, w, h, minColTinta = 1, minLargura = 3) {
  const colTem = new Uint8Array(w);
  for (let x = 0; x < w; x++) {
    let t = 0;
    for (let y = 0; y < h; y++) t += bin[y * w + x];
    colTem[x] = t >= minColTinta ? 1 : 0;
  }
  const grupos = [];
  let ini = -1;
  for (let x = 0; x <= w; x++) {
    const dentro = x < w && colTem[x] === 1;
    if (dentro && ini < 0) ini = x;
    else if (!dentro && ini >= 0) {
      if (x - ini >= minLargura) grupos.push({ x0: ini, x1: x - 1 });
      ini = -1;
    }
  }
  return grupos;
}

// recorta o blob (bounding box vertical real) e normaliza para NORM_W x NORM_H
export function normalizarBlob(bin, w, h, x0, x1) {
  let y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = x0; x <= x1; x++) {
      if (bin[y * w + x] === 1) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (y1 < 0) return { pix: new Uint8Array(NORM_W * NORM_H), bbox: null };
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const out = new Uint8Array(NORM_W * NORM_H);
  for (let ny = 0; ny < NORM_H; ny++) {
    const sy = y0 + Math.floor((ny * bh) / NORM_H);
    for (let nx = 0; nx < NORM_W; nx++) {
      const sx = x0 + Math.floor((nx * bw) / NORM_W);
      out[ny * NORM_W + nx] = bin[sy * w + sx];
    }
  }
  return { pix: out, bbox: { x0, x1, y0, y1, w: bw, h: bh } };
}

// correlacao cruzada normalizada (NCC) entre dois vetores 0/1
export function ncc(a, b) {
  let sa = 0, sb = 0;
  for (let i = 0; i < a.length; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / a.length, mb = sb / b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    const xa = a[i] - ma, xb = b[i] - mb;
    num += xa * xb; da += xa * xa; db += xb * xb;
  }
  if (da === 0 || db === 0) return 0;
  return num / Math.sqrt(da * db);
}

// pontua UM blob normalizado contra os 10 templates -> {digito, score_top1, score_top2, margem}
export function pontuarDigito(blobPix, templates) {
  const scores = [];
  for (let d = 0; d <= 9; d++) scores.push({ d, s: ncc(blobPix, templates[d]) });
  scores.sort((a, b) => b.s - a.s);
  return {
    digito: scores[0].d,
    score_top1: scores[0].s,
    score_top2: scores[1].s,
    margem: scores[0].s - scores[1].s,
  };
}

// ---------------------------------------------------------------------
// analisarCaptcha: pipeline completo de UMA amostra.
// gray: Uint8Array grayscale; w,h: dimensoes; templates: {0:Uint8Array,...}
// cfg: { ocrScoreMin, ocrMargemMin }
// Devolve METRICAS + `predicao` (string) -- o CHAMADOR usa `predicao` so'
// transitoriamente (F4) e NUNCA a persiste/loga em F3-A.
// ---------------------------------------------------------------------
export function analisarCaptcha(gray, w, h, templates, cfg) {
  const ocrScoreMin = cfg?.ocrScoreMin ?? 0.92;
  const ocrMargemMin = cfg?.ocrMargemMin ?? 0.15;

  const dimensaoOk = w === CAPTCHA_LARGURA && h === CAPTCHA_ALTURA;
  const bin = binarizar(gray, w, h);
  const branco = fracaoBranco(bin);
  const strikes = strikeLikeRows(bin, w, h);
  const fundoOk = branco >= FUNDO_BRANCO_MIN && branco <= FUNDO_BRANCO_MAX && strikes === 0;
  const estiloAlterado = !dimensaoOk || !fundoOk;

  const grupos = segmentar(bin, w, h);
  const quatroSegmentos = grupos.length === 4;

  const digitos = [];
  if (quatroSegmentos) {
    for (const g of grupos) {
      const { pix, bbox } = normalizarBlob(bin, w, h, g.x0, g.x1);
      const r = pontuarDigito(pix, templates);
      const tocaBorda = bbox ? (bbox.y0 <= 0 || bbox.y1 >= h - 1) : true;
      digitos.push({ ...r, tocaBorda });
    }
  }

  const predicao = quatroSegmentos ? digitos.map((d) => d.digito).join("") : null;
  const formatoOk = predicao != null && /^[0-9]{4}$/.test(predicao);

  // -- flags de "obviamente invalido" (auto-consistencia / sanidade) --
  const scoreAbsurdo = digitos.some((d) => d.score_top1 < SCORE_PISO_ABSURDO);
  const margemAbsurda = digitos.some((d) => d.margem <= MARGEM_PISO_ABSURDO);
  const algumTocaBorda = digitos.some((d) => d.tocaBorda);
  const todosIguais = formatoOk && new Set(predicao.split("")).size === 1;
  const margemMediaBaixa = digitos.length === 4 &&
    (digitos.reduce((a, d) => a + d.margem, 0) / 4) < 0.06;
  const obviamenteInvalida = !quatroSegmentos || !formatoOk || scoreAbsurdo ||
    margemAbsurda || algumTocaBorda || (todosIguais && margemMediaBaixa);

  // -- confianca por digito e bucket da amostra --
  const digitosConfiantes = digitos.filter(
    (d) => d.score_top1 >= ocrScoreMin && d.margem >= ocrMargemMin,
  ).length;
  let bucket = "baixa";
  if (quatroSegmentos && digitosConfiantes === 4) bucket = "alta";
  else if (quatroSegmentos && digitosConfiantes === 3) bucket = "media";

  const gateOk = bucket === "alta" && quatroSegmentos && formatoOk && !obviamenteInvalida;

  return {
    // METRICAS (o que pode ser agregado/persistido)
    dimensaoOk,
    fundoOk,
    estiloAlterado,
    quatroSegmentos,
    formatoOk,
    obviamenteInvalida,
    bucket,
    gateOk,
    scoresTop1: digitos.map((d) => d.score_top1),
    margens: digitos.map((d) => d.margem),
    // TRANSITORIO -- nunca persistir/logar em F3-A
    predicao,
  };
}

// percentil simples (p em 0..100) sobre um array de numeros
export function percentil(arr, p) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}

// agrega N resultados de analisarCaptcha() -> o payload de metricas
export function agregar(resultados, refreshesTotal, runnerSha) {
  const total = resultados.length;
  const scores = resultados.flatMap((r) => r.scoresTop1);
  const margens = resultados.flatMap((r) => r.margens);
  const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
  return {
    amostras_total: total,
    amostras_4_segmentos: resultados.filter((r) => r.quatroSegmentos).length,
    amostras_gate_ok: resultados.filter((r) => r.gateOk).length,
    amostras_formato_invalido: resultados.filter((r) => !r.formatoOk).length,
    amostras_obviamente_invalida: resultados.filter((r) => r.obviamenteInvalida).length,
    score_top1_p50: r3(percentil(scores, 50)),
    score_top1_p90: r3(percentil(scores, 90)),
    score_top1_min: r3(scores.length ? Math.min(...scores) : null),
    margem_p50: r3(percentil(margens, 50)),
    margem_p10: r3(percentil(margens, 10)),
    bucket_alta: resultados.filter((r) => r.bucket === "alta").length,
    bucket_media: resultados.filter((r) => r.bucket === "media").length,
    bucket_baixa: resultados.filter((r) => r.bucket === "baixa").length,
    refreshes_total: refreshesTotal,
    runner_sha: runnerSha ?? null,
    estilo_alterado: resultados.some((r) => r.estiloAlterado),
  };
}
