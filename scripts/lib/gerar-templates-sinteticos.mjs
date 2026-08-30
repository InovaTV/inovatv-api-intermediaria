// F3-A -- gera scripts/lib/captcha-templates/digitos.json a partir de um
// font 5x7 sintetico, escalado para NORM_W x NORM_H (16x24) por
// vizinho-mais-proximo. Sao GLIFOS DE REFERENCIA GENERICOS -- NAO sao
// CAPTCHAs capturados, nao tem segredo.
//
// Ponto de partida da F3-A: as metricas de calibracao (>= 14 dias) dirao
// se estes templates sinteticos ja dao gate_ok >= 0.95; se nao, o Jose
// substitui por glifos recortados de amostras limpas reais e roda
// `node scripts/lib/gerar-templates-sinteticos.mjs` (ou edita a mao) --
// isso muda o runner_sha e reinicia o relogio de "7 dias estavel".
//
// Rodar: node scripts/lib/gerar-templates-sinteticos.mjs

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const NORM_W = 16;
const NORM_H = 24;

// 5 col x 7 lin
const FONT = {
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  3: ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  6: ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
};

function escalar(rows) {
  const sh = rows.length;      // 7
  const sw = rows[0].length;   // 5
  const out = new Array(NORM_W * NORM_H).fill(0);
  for (let ny = 0; ny < NORM_H; ny++) {
    const sy = Math.min(sh - 1, Math.floor((ny * sh) / NORM_H));
    for (let nx = 0; nx < NORM_W; nx++) {
      const sx = Math.min(sw - 1, Math.floor((nx * sw) / NORM_W));
      out[ny * NORM_W + nx] = rows[sy][sx] === "1" ? 1 : 0;
    }
  }
  return out;
}

const templates = {};
for (let d = 0; d <= 9; d++) templates[d] = escalar(FONT[d]);

const dest = join(dirname(fileURLToPath(import.meta.url)), "captcha-templates");
mkdirSync(dest, { recursive: true });
writeFileSync(
  join(dest, "digitos.json"),
  JSON.stringify({ norm_w: NORM_W, norm_h: NORM_H, gerado_de: "font-5x7-sintetico", templates }, null, 0) + "\n",
);
console.log(`digitos.json gerado (${Object.keys(templates).length} digitos, ${NORM_W}x${NORM_H})`);
