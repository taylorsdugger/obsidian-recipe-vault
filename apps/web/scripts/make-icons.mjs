#!/usr/bin/env node
// Draws the app icons into public/. No image dependency: the shapes are signed
// distance fields sampled 4x4 per pixel for anti-aliasing, and the PNG is
// written by hand (node:zlib does the only hard part).
//
//   node scripts/make-icons.mjs
//
// Re-run it after changing a colour or a shape. The output is deterministic,
// so a run with no edits leaves the files byte-identical.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../public/", import.meta.url));

// Logo C5 from the redesign canvas: an ink pot on the app's amber, its lid
// tipped open. Both colours are the app's own tokens (accent and ink) turned
// into sRGB, so the icon matches the sidebar mark drawn from them.
const BG = [231, 140, 8]; // --color-accent, oklch(0.72 0.16 65)
const INK = [35, 30, 26]; // --color-ink, oklch(0.24 0.01 65)

// ---- signed distance fields ----------------------------------------------
// Distance from (x, y) to the shape's edge: negative inside.

function sdRoundedRect(x, y, cx, cy, halfW, halfH, r) {
  const dx = Math.abs(x - cx) - (halfW - r);
  const dy = Math.abs(y - cy) - (halfH - r);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - r;
}

/**
 * The canvas's `rect(x, y, w, h, r)`, optionally turned `deg` about a pivot.
 * The point is turned back the other way rather than the box turned forward,
 * which keeps the field exact.
 */
function box(x, y, w, h, r, pivot) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  if (!pivot) {
    return (px, py) => sdRoundedRect(px, py, cx, cy, w / 2, h / 2, r);
  }
  const [ox, oy, deg] = pivot;
  const a = (-deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return (px, py) => {
    const dx = px - ox;
    const dy = py - oy;
    return sdRoundedRect(
      ox + dx * cos - dy * sin,
      oy + dx * sin + dy * cos,
      cx,
      cy,
      w / 2,
      h / 2,
      r,
    );
  };
}

// ---- the glyph ------------------------------------------------------------
// In the canvas's 100-unit box, numbers copied from its `potFun` mark so the
// two stay comparable. The lid and its knob tip 6 degrees about the lid's
// left end, like it's been nudged open to check on something.

const LID_TIP = [18, 41, -6];

const POT = [
  box(44, 24, 12, 8, 3, LID_TIP), // knob
  box(18, 33, 64, 8, 4, LID_TIP), // lid
  box(22, 44, 56, 42, 11), // body
  box(10, 50, 14, 8, 4), // left handle
  box(76, 50, 14, 8, 4), // right handle
];

/** The glare down the pot's left side, cut back to the background. */
const GLARE = box(30, 52, 5, 15, 2.5);

/**
 * Drawn in a unit square so the same geometry works at every size. `scale`
 * shrinks the glyph for the maskable icon, whose outer 20% may be cropped to
 * a circle by the launcher.
 */
function paint(u, v, scale, rounded) {
  // Move to glyph space: centred on the middle of the canvas, then scaled,
  // then into the canvas's 100-unit box.
  const x = (0.5 + (u - 0.5) / scale) * 100;
  const y = (0.5 + (v - 0.5) / scale) * 100;

  if (GLARE(x, y) >= 0 && POT.some((shape) => shape(x, y) < 0)) return INK;

  // A maskable icon bleeds to the edge; a plain one gets its own rounded square.
  if (!rounded) return BG;
  return sdRoundedRect(u, v, 0.5, 0.5, 0.5, 0.5, 0.22) < 0 ? BG : null;
}

// ---- raster ---------------------------------------------------------------

const SAMPLES = 4; // per axis, so 16 samples a pixel

function render(size, { scale = 1, rounded = true } = {}) {
  const pixels = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const u = (px + (sx + 0.5) / SAMPLES) / size;
          const v = (py + (sy + 0.5) / SAMPLES) / size;
          const colour = paint(u, v, scale, rounded);
          if (colour) {
            r += colour[0];
            g += colour[1];
            b += colour[2];
            a += 255;
          }
        }
      }

      const total = SAMPLES * SAMPLES;
      const covered = a / 255;
      const i = (py * size + px) * 4;
      // Average over covered samples only, so edge pixels keep their colour
      // and vary in alpha instead of darkening towards transparent black.
      pixels[i] = covered ? Math.round(r / covered) : 0;
      pixels[i + 1] = covered ? Math.round(g / covered) : 0;
      pixels[i + 2] = covered ? Math.round(b / covered) : 0;
      pixels[i + 3] = Math.round(a / total);
    }
  }

  return pixels;
}

// ---- PNG ------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  // 10-12: deflate, adaptive filtering, no interlace — all zero.

  // One filter byte per scanline, filter type 0 (none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const from = y * size * 4;
    pixels.copy(raw, y * (size * 4 + 1) + 1, from, from + size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- output ---------------------------------------------------------------

const ICONS = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  // Launchers crop a maskable icon to their own shape, so it bleeds to the
  // edge and the glyph sits inside the safe area.
  { file: "icon-maskable-512.png", size: 512, scale: 0.7, rounded: false },
  // iOS puts its own rounding on, and doesn't handle transparency well.
  { file: "apple-touch-icon.png", size: 180, rounded: false },
  { file: "favicon-32.png", size: 32 },
];

mkdirSync(OUT, { recursive: true });
for (const { file, size, scale, rounded } of ICONS) {
  writeFileSync(OUT + file, png(size, render(size, { scale, rounded })));
  console.log(`${file}  ${size}x${size}`);
}
