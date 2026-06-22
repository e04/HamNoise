// Generates the HamNoise PWA icon: a dot-matrix "N" emerging from a field of
// noise dots, matching the circular-dot aesthetic of pamphlet/index.html.
//
// Output: public/icon.svg (full-bleed square, usable as "any" and "maskable").
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// Optional CLI overrides: `node gen-icon.mjs <size> <outPath>`. Defaults to the
// 512px public/icon.svg used by the app and manifest.
const SIZE = Number(process.argv[2]) || 512;
const OUT = resolve(HERE, "..", process.argv[3] || "public/icon.svg");

// Deterministic RNG so the icon renders identically every build (mulberry32,
// same generator the pamphlet uses).
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260623);

const COLS = 13;
const ROWS = 13;
const PITCH = SIZE / COLS;
const RADIUS = PITCH * 0.4;
const BG = "#0a0a0a";

// 5x7 dot-matrix "N" (font5x7, column-major, bit0 = top) — the glyph the
// pamphlet stamps for its headline text.
const GLYPH_N = [0x7f, 0x04, 0x08, 0x10, 0x7f];
const GLYPH_W = 5;
const GLYPH_H = 7;
const startCol = Math.round((COLS - GLYPH_W) / 2);
const startRow = Math.round((ROWS - GLYPH_H) / 2);

const textCells = new Set();
for (let gx = 0; gx < GLYPH_W; gx++) {
  for (let gy = 0; gy < GLYPH_H; gy++) {
    if ((GLYPH_N[gx] >> gy) & 1) {
      textCells.add(`${startCol + gx},${startRow + gy}`);
    }
  }
}

function lum(l) {
  const v = Math.max(0, Math.min(255, Math.round(l * 255)));
  return `rgb(${v},${v},${v})`;
}

let dots = "";
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const cx = (c + 0.5) * PITCH;
    const cy = (r + 0.5) * PITCH;
    const isText = textCells.has(`${c},${r}`);
    // Noise dots: dim grey (0.07..0.24). Text dots: bright, standing out of it.
    const L = isText ? 0.9 + rand() * 0.1 : 0.07 + rand() * 0.17;
    dots +=
      `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" ` +
      `r="${RADIUS.toFixed(2)}" fill="${lum(L)}"/>`;
  }
}

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" ` +
  `viewBox="0 0 ${SIZE} ${SIZE}" shape-rendering="geometricPrecision">` +
  `<rect width="${SIZE}" height="${SIZE}" fill="${BG}"/>` +
  dots +
  `</svg>\n`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, svg);
console.log(`Wrote ${OUT}`);
