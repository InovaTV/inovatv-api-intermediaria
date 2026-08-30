// F3-A -- testes do pipeline puro de OCR (scripts/lib/unitv-captcha-ocr.mjs).
// Sem PNG, sem rede: constroi bitmaps grayscale sinteticos e verifica
// segmentacao, NCC, buckets, validacao de formato e deteccao de
// "obviamente invalido".
//
// IMPORTANTE: a acuracia real NAO e' testada aqui (nem em F3-A) -- so' a
// CONSISTENCIA/CONFIABILIDADE do solver. Acuracia so' na F4.
//
// Rodar: npx tsx scripts/testes/autocura_ocr_pipeline/teste.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ocr = await import("../../../scripts/lib/unitv-captcha-ocr.mjs");
const TJSON = JSON.parse(readFileSync(join(RAIZ, "scripts/lib/captcha-templates/digitos.json"), "utf8"));
const TEMPLATES = {};
for (let d = 0; d <= 9; d++) TEMPLATES[d] = Uint8Array.from(TJSON.templates[d]);

let falhas = 0;
function ok(c, m) { if (!c) { falhas++; console.error(`FALHA: ${m}`); } else console.log(`ok: ${m}`); }

const W = ocr.CAPTCHA_LARGURA;  // 240
const H = ocr.CAPTCHA_ALTURA;   // 80

// font 5x7 (mesma de gerar-templates-sinteticos.mjs) para "pintar" um CAPTCHA sintetico
const FONT = {
  0: ["01110","10001","10011","10101","11001","10001","01110"],
  1: ["00100","01100","00100","00100","00100","00100","01110"],
  2: ["01110","10001","00001","00010","00100","01000","11111"],
  3: ["11111","00010","00100","00010","00001","10001","01110"],
  4: ["00010","00110","01010","10010","11111","00010","00010"],
  5: ["11111","10000","11110","00001","00001","10001","01110"],
  6: ["00110","01000","10000","11110","10001","10001","01110"],
  7: ["11111","00001","00010","00100","01000","01000","01000"],
  8: ["01110","10001","10001","01110","10001","10001","01110"],
  9: ["01110","10001","10001","01111","00001","00010","01100"],
};

// gray 240x80, fundo branco(255); pinta cada digito num bloco ~36px de largura
// com folga entre eles (garante 4 segmentos separados)
function pintar(str, { blocoW = 30, gap = 20, escX = 4, escY = 7, x0 = 20, y0 = 14 } = {}) {
  const gray = new Uint8Array(W * H).fill(255);
  for (let k = 0; k < str.length; k++) {
    const rows = FONT[str[k]];
    const bx = x0 + k * (blocoW + gap);
    for (let ry = 0; ry < 7; ry++) {
      for (let rx = 0; rx < 5; rx++) {
        if (rows[ry][rx] !== "1") continue;
        for (let dy = 0; dy < escY; dy++) for (let dx = 0; dx < escX; dx++) {
          const px = bx + rx * escX + dx;
          const py = y0 + ry * escY + dy;
          if (px >= 0 && px < W && py >= 0 && py < H) gray[py * W + px] = 0;
        }
      }
    }
  }
  return gray;
}

const CFG = { ocrScoreMin: 0.92, ocrMargemMin: 0.15 };

// 1. CAPTCHA sintetico limpo de 4 digitos -> 4 segmentos, formato ok, bucket alta, gate ok
{
  const g = pintar("7052");
  const r = ocr.analisarCaptcha(g, W, H, TEMPLATES, CFG);
  ok(r.quatroSegmentos, "1: 4 segmentos");
  ok(r.formatoOk, "1b: formato ^[0-9]{4}$");
  ok(r.bucket === "alta", `1c: bucket alta (veio ${r.bucket})`);
  ok(r.gateOk === true, "1d: gate ok");
  ok(r.obviamenteInvalida === false, "1e: nao e' obviamente invalida");
  ok(r.dimensaoOk && r.fundoOk && !r.estiloAlterado, "1f: dimensao/fundo ok, estilo nao alterado");
}

// 2. varios digitos -> sempre 4 segmentos + nenhum bucket 'baixa'
//    (consistencia do solver; a taxa exata de 'alta' contra CAPTCHAs
//    REAIS e' o que a observacao de >=14 dias mede -- nao se trava aqui)
{
  let todos4 = true, nenhumBaixa = true, algumAlta = false;
  for (const s of ["1234", "9876", "0000", "5309", "8080"]) {
    const r = ocr.analisarCaptcha(pintar(s), W, H, TEMPLATES, CFG);
    if (!r.quatroSegmentos) todos4 = false;
    if (r.bucket === "baixa") nenhumBaixa = false;
    if (r.bucket === "alta") algumAlta = true;
  }
  ok(todos4, "2: todos os sinteticos segmentam em 4");
  ok(nenhumBaixa, "2b: nenhum sintetico limpo cai em bucket 'baixa'");
  ok(algumAlta, "2c: pelo menos um sintetico limpo atinge 'alta'");
}

// 3. imagem quase-branca -> fundo fora da banda -> estilo_alterado; sem 4 segmentos
{
  const g = new Uint8Array(W * H).fill(255); // 100% branco
  const r = ocr.analisarCaptcha(g, W, H, TEMPLATES, CFG);
  ok(r.fundoOk === false, "3: fundo 100% branco -> fora da banda [0.80,0.985]");
  ok(r.estiloAlterado === true, "3b: estilo_alterado");
  ok(r.gateOk === false && r.quatroSegmentos === false, "3c: nao passa gate, nao tem 4 segmentos");
}

// 4. dimensao errada -> estilo_alterado
{
  const g = new Uint8Array(200 * 60).fill(200);
  const r = ocr.analisarCaptcha(g, 200, 60, TEMPLATES, CFG);
  ok(r.dimensaoOk === false && r.estiloAlterado === true, "4: dimensao != 240x80 -> estilo_alterado");
}

// 5. 3 digitos -> !quatroSegmentos -> obviamente invalida, gate false
{
  const r = ocr.analisarCaptcha(pintar("123"), W, H, TEMPLATES, CFG);
  ok(r.quatroSegmentos === false, "5: 3 digitos -> nao 4 segmentos");
  ok(r.obviamenteInvalida === true, "5b: obviamente invalida");
  ok(r.gateOk === false, "5c: gate false");
}

// 6. linha de "risco" atravessando -> strikeLikeRows > 0 -> estilo_alterado
{
  const g = pintar("4242");
  for (let x = 0; x < W; x++) g[40 * W + x] = 0; // linha preta cheia na altura 40
  const r = ocr.analisarCaptcha(g, W, H, TEMPLATES, CFG);
  ok(r.estiloAlterado === true, "6: strike row -> estilo_alterado");
}

// 7. blob tocando a borda superior -> algumTocaBorda -> obviamente invalida
{
  const r = ocr.analisarCaptcha(pintar("5678", { y0: 0 }), W, H, TEMPLATES, CFG);
  ok(r.obviamenteInvalida === true, "7: digito colado na borda -> obviamente invalida");
}

// 8. agregar() -- percentis e contagens
{
  const rs = [];
  for (const s of ["1234", "5678", "9012", "3456"]) {
    const r = ocr.analisarCaptcha(pintar(s), W, H, TEMPLATES, CFG);
    const { predicao: _p, ...sp } = r; rs.push(sp);
  }
  const ag = ocr.agregar(rs, 4, "abc1234");
  ok(ag.amostras_total === 4, "8: amostras_total");
  ok(ag.amostras_4_segmentos === 4, "8b: 4_segmentos");
  ok(ag.bucket_alta + ag.bucket_media === 4 && ag.bucket_baixa === 0, "8c: nenhuma amostra limpa em 'baixa'");
  ok(ag.amostras_gate_ok === ag.bucket_alta, "8d: gate_ok == bucket_alta (sinteticos sem flags de invalido)");
  ok(ag.refreshes_total === 4 && ag.runner_sha === "abc1234", "8e: refreshes/runner_sha");
  ok(ag.score_top1_p50 != null && ag.score_top1_p50 <= 1 && ag.margem_p10 != null, "8f: percentis calculados");
  ok(!("predicao" in ag) && Object.keys(ag).every((k) => k !== "captcha" && k !== "imagem"), "8g: agregado nao carrega predicao/imagem");
}

// 9. percentil()
{
  ok(ocr.percentil([1, 2, 3, 4, 5], 50) === 3, "9: percentil 50");
  ok(ocr.percentil([], 50) === null, "9b: percentil de vazio -> null");
}

console.log(falhas === 0 ? "\nTODOS OS TESTES OK" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
