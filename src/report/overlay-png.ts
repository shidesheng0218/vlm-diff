// Pixel-level PNG annotation: draws numbered, severity-colored region boxes
// directly into a PNG buffer (no canvas, no native deps — pure pngjs). The
// HTML reports use the SVG overlay (overlay.ts); anything that needs a *bitmap*
// (MCP image content blocks, demo GIF frames) uses this module instead.

import { PNG } from "pngjs";
import type { OverlayRegion } from "./overlay.js";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

// Mirrors SEVERITY_STROKE in overlay.ts (kept as numbers for pixel writes)
const SEVERITY_COLOR: Record<string, Rgb> = {
  breaking: { r: 220, g: 38, b: 38 },
  moderate: { r: 245, g: 158, b: 11 },
  cosmetic: { r: 37, g: 99, b: 235 },
};

export function setPixel(png: PNG, x: number, y: number, color: Rgb): void {
  if (x < 0 || x >= png.width || y < 0 || y >= png.height) return;
  const idx = (png.width * y + x) << 2;
  png.data[idx] = color.r;
  png.data[idx + 1] = color.g;
  png.data[idx + 2] = color.b;
  png.data[idx + 3] = 255;
}

/** Axis-aligned rectangle outline with `thickness` pixels. */
export function drawBox(png: PNG, x: number, y: number, w: number, h: number, color: Rgb, thickness = 2): void {
  for (let t = 0; t < thickness; t++) {
    for (let i = x; i < x + w; i++) {
      setPixel(png, i, y + t, color);
      setPixel(png, i, y + h - 1 - t, color);
    }
    for (let j = y; j < y + h; j++) {
      setPixel(png, x + t, j, color);
      setPixel(png, x + w - 1 - t, j, color);
    }
  }
}

// 5x7 bitmap font: digits for numbered region tags, plus the letters the demo
// GIF's frame labels need (BEFORE/AFTER/CHANGED/NO CHANGE). Column-major bytes.
const GLYPHS: Record<string, number[]> = {
  "0": [0x3e, 0x51, 0x49, 0x45, 0x3e],
  "1": [0x00, 0x42, 0x7f, 0x40, 0x00],
  "2": [0x42, 0x61, 0x51, 0x49, 0x46],
  "3": [0x21, 0x41, 0x45, 0x4b, 0x31],
  "4": [0x18, 0x14, 0x12, 0x7f, 0x10],
  "5": [0x27, 0x45, 0x45, 0x45, 0x39],
  "6": [0x3c, 0x4a, 0x49, 0x49, 0x30],
  "7": [0x01, 0x71, 0x09, 0x05, 0x03],
  "8": [0x36, 0x49, 0x49, 0x49, 0x36],
  "9": [0x06, 0x49, 0x49, 0x29, 0x1e],
  "B": [0x7e, 0x49, 0x49, 0x49, 0x36],
  "E": [0x7f, 0x49, 0x49, 0x49, 0x41],
  "F": [0x7f, 0x09, 0x09, 0x09, 0x01],
  "O": [0x3e, 0x41, 0x41, 0x41, 0x3e],
  "R": [0x7f, 0x09, 0x19, 0x29, 0x46],
  "A": [0x7e, 0x09, 0x09, 0x09, 0x7e],
  "T": [0x01, 0x01, 0x7f, 0x01, 0x01],
  "C": [0x3e, 0x41, 0x41, 0x41, 0x22],
  "H": [0x7f, 0x08, 0x08, 0x08, 0x7f],
  "N": [0x7f, 0x04, 0x08, 0x10, 0x7f],
  "G": [0x3e, 0x41, 0x49, 0x49, 0x3a],
  "D": [0x7f, 0x41, 0x41, 0x22, 0x1c],
  " ": [0x00, 0x00, 0x00, 0x00, 0x00],
  "(": [0x00, 0x1c, 0x22, 0x41, 0x00],
  ")": [0x00, 0x41, 0x22, 0x1c, 0x00],
};

const GLYPH_W = 5;
const GLYPH_H = 7;

function drawGlyph(png: PNG, x0: number, y0: number, ch: string, color: Rgb): void {
  const glyph = GLYPHS[ch.toUpperCase()] ?? GLYPHS[" "];
  for (let col = 0; col < GLYPH_W; col++) {
    const byte = glyph[col];
    for (let row = 0; row < GLYPH_H; row++) {
      if (byte & (1 << row)) setPixel(png, x0 + col, y0 + row, color);
    }
  }
}

function drawText(png: PNG, x0: number, y0: number, text: string, color: Rgb): void {
  for (let i = 0; i < text.length; i++) {
    drawGlyph(png, x0 + i * (GLYPH_W + 1), y0, text[i], color);
  }
}

/** Text label with a filled background at the top-left corner (demo GIF frames). */
export function drawLabel(png: PNG, text: string, bg: Rgb): void {
  const padding = 4;
  const w = text.length * (GLYPH_W + 1) + padding * 2 - 1;
  const h = GLYPH_H + padding * 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) setPixel(png, x, y, bg);
  }
  drawText(png, padding, padding, text, { r: 255, g: 255, b: 255 });
}

/** Small filled tag with a 1–2 digit index, placed above the box's top-left corner. */
function drawTag(png: PNG, x: number, y: number, index: number, color: Rgb): void {
  const text = String(index).slice(0, 2);
  const padding = 2;
  const w = text.length * (GLYPH_W + 1) + padding * 2 - 1;
  const h = GLYPH_H + padding * 2;
  const ty = Math.max(0, y - h); // above the box, clamped to the frame
  for (let yy = ty; yy < ty + h; yy++) {
    for (let xx = x; xx < x + w; xx++) setPixel(png, xx, yy, color);
  }
  drawText(png, x + padding, ty + padding, text, { r: 255, g: 255, b: 255 });
}

/**
 * Draw numbered, severity-colored boxes for `regions` into a copy of
 * `pngBuffer` and return the annotated PNG. Indices are 1-based to match the
 * region list shown in text output/reports.
 */
export function annotatePng(pngBuffer: Buffer, regions: OverlayRegion[]): Buffer {
  if (regions.length === 0) return pngBuffer;
  const png = PNG.sync.read(pngBuffer);
  for (const r of regions) {
    const color = SEVERITY_COLOR[r.severity ?? "cosmetic"] ?? SEVERITY_COLOR.cosmetic;
    drawBox(png, r.x, r.y, r.w, r.h, color, 2);
    drawTag(png, r.x, r.y, r.index, color);
  }
  return PNG.sync.write(png);
}
