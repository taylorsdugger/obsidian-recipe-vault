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

const BG = [23, 23, 23]; // neutral-900, same as the buttons in the app
const BOWL = [250, 250, 250];
const STEAM = [245, 158, 11]; // amber, the one bit of warmth

// ---- signed distance fields ----------------------------------------------
// Each returns the distance from (x, y) to the shape's edge: negative inside.

function sdRoundedRect(x, y, cx, cy, halfW, halfH, r) {
  const dx = Math.abs(x - cx) - (halfW - r);
  const dy = Math.abs(y - cy) - (halfH - r);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - r;
}

function sdCircle(x, y, cx, cy, r) {
  return Math.hypot(x - cx, y - cy) - r;
}

/**
 * Cheap ellipse field: squash the space, measure a circle, unsquash. Not an
 * exact distance, but the error is well under a pixel at these radii and it
 * only ever feeds a `< 0` test and the anti-aliasing ramp.
 */
function sdEllipse(x, y, cx, cy, rx, ry) {
  return (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry);
}

/** Distance to a line segment thickened by `r` — a rounded stroke. */
function sdCapsule(x, y, ax, ay, bx, by, r) {
  const pax = x - ax;
  const pay = y - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
}

/** A polyline thickened by a radius tapering `r0` -> `r1` along its length. */
function sdStroke(x, y, pts, r0, r1) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const t = i / (pts.length - 2 || 1);
    const r = r0 + (r1 - r0) * t;
    const p = pts[i];
    const q = pts[i + 1];
    d = Math.min(d, sdCapsule(x, y, p[0], p[1], q[0], q[1], r));
  }
  return d;
}

/**
 * A rising wisp: a sine wobble on the way up, so it curls rather than points.
 * Built once at module scope - `paint` runs sixteen times per pixel, and
 * rebuilding these there is twelve million throwaway arrays per icon.
 */
function wisp(x0, y0, height, amp, phase, steps = 20) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push([x0 + amp * Math.sin(phase + t * Math.PI * 1.5), y0 - height * t]);
  }
  return pts;
}

// ---- the glyph ------------------------------------------------------------
// A bowl of something hot. Three things earn their specific values here, and
// all three were wrong in the first version of this icon:
//
//   The rim is flush with the bowl. It runs to `RX - RIM` so the capsule's
//   cap lands exactly on the bowl's edge. A rim overhanging a rounded body is
//   a lid or a tray, which is what the old one read as.
//
//   The bowl is an ellipse cut at its centre, not a circle cut below one.
//   Cutting a circle low does give a deeper bowl, but its widest point ends up
//   under the rim, so it bulges out past it - the same fault, mirrored.
//
//   The steam starts at the rim and curls. Detached marks don't read as coming
//   off anything, and three straight strokes fanned symmetrically read as rays.
//   Staggering the heights gives the group a centre.

const RX = 0.28;
const RY = 0.3;
const CY = 0.52;
const RIM = 0.036;

const WISPS = [
  { pts: wisp(0.36, 0.45, 0.17, 0.03, 0.55), r0: 0.028, r1: 0.016 },
  { pts: wisp(0.5, 0.46, 0.25, 0.036, 0), r0: 0.031, r1: 0.017 },
  { pts: wisp(0.64, 0.45, 0.19, -0.03, -0.55), r0: 0.028, r1: 0.016 },
];

/**
 * Drawn in a unit square so the same geometry works at every size. `scale`
 * shrinks the glyph for the maskable icon, whose outer 20% may be cropped to
 * a circle by the launcher.
 */
function paint(u, v, scale, rounded) {
  // Move to glyph space: centred on the middle of the canvas, then scaled.
  const x = 0.5 + (u - 0.5) / scale;
  const y = 0.5 + (v - 0.5) / scale;

  for (const { pts, r0, r1 } of WISPS) {
    if (sdStroke(x, y, pts, r0, r1) < 0) return STEAM;
  }

  const bowl = Math.max(sdEllipse(x, y, 0.5, CY, RX, RY), CY - y);
  const rim = sdCapsule(x, y, 0.5 - (RX - RIM), CY, 0.5 + (RX - RIM), CY, RIM);
  if (Math.min(bowl, rim) < 0) return BOWL;

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
