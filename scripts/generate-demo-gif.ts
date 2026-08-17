// Generates a GIF showing the detection pipeline on a few representative pairs.
// Reads dataset.json, runs Stage 1 detection, overlays bounding boxes on the
// before/after images, and outputs frames to docs/demo-frames/ for manual GIF assembly.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import { detect } from "../src/detect/regions.js";
import type { PairRecord } from "../src/eval/types.js";

const DATA_DIR = join(import.meta.dirname, "..", "data");
const OUT_DIR = join(import.meta.dirname, "..", "docs", "demo-frames");

interface AnnotatedFrame {
  pairId: string;
  title: string;
  beforePath: string;
  afterPath: string;
  regions: Array<{ x: number; y: number; w: number; h: number }>;
  changed: boolean;
}

// Draw a bounding box on a PNG buffer
function drawBox(
  png: PNG,
  x: number,
  y: number,
  w: number,
  h: number,
  color: { r: number; g: number; b: number },
  thickness: number = 2,
) {
  for (let t = 0; t < thickness; t++) {
    // Top & bottom
    for (let i = x; i < x + w; i++) {
      if (i >= 0 && i < png.width) {
        setPixel(png, i, y + t, color);
        setPixel(png, i, y + h - 1 - t, color);
      }
    }
    // Left & right
    for (let j = y; j < y + h; j++) {
      if (j >= 0 && j < png.height) {
        setPixel(png, x + t, j, color);
        setPixel(png, x + w - 1 - t, j, color);
      }
    }
  }
}

function setPixel(png: PNG, x: number, y: number, color: { r: number; g: number; b: number }) {
  if (x < 0 || x >= png.width || y < 0 || y >= png.height) return;
  const idx = (png.width * y + x) << 2;
  png.data[idx] = color.r;
  png.data[idx + 1] = color.g;
  png.data[idx + 2] = color.b;
  png.data[idx + 3] = 255;
}

// Add text label at top-left with 5x7 bitmap font
function drawLabel(png: PNG, text: string, bgColor: { r: number; g: number; b: number }) {
  const padding = 8;
  const charHeight = 7;
  const charSpacing = 6;
  const textWidth = text.length * charSpacing + padding * 2;
  const textHeight = charHeight + padding * 2;

  // Background rect
  for (let y = 0; y < textHeight; y++) {
    for (let x = 0; x < textWidth; x++) {
      setPixel(png, x, y, bgColor);
    }
  }

  // Simple 5x7 bitmap font for uppercase letters
  const font: Record<string, number[]> = {
    'B': [0x7E, 0x49, 0x49, 0x49, 0x36], // 01111110, 01001001, ...
    'E': [0x7F, 0x49, 0x49, 0x49, 0x41],
    'F': [0x7F, 0x09, 0x09, 0x09, 0x01],
    'O': [0x3E, 0x41, 0x41, 0x41, 0x3E],
    'R': [0x7F, 0x09, 0x19, 0x29, 0x46],
    'A': [0x7E, 0x09, 0x09, 0x09, 0x7E],
    'T': [0x01, 0x01, 0x7F, 0x01, 0x01],
    'C': [0x3E, 0x41, 0x41, 0x41, 0x22],
    'H': [0x7F, 0x08, 0x08, 0x08, 0x7F],
    'N': [0x7F, 0x04, 0x08, 0x10, 0x7F],
    'G': [0x3E, 0x41, 0x49, 0x49, 0x3A],
    'D': [0x7F, 0x41, 0x41, 0x22, 0x1C],
    ' ': [0x00, 0x00, 0x00, 0x00, 0x00],
    '(': [0x00, 0x1C, 0x22, 0x41, 0x00],
    ')': [0x00, 0x41, 0x22, 0x1C, 0x00],
  };

  // Draw text
  const textColor = { r: 255, g: 255, b: 255 };
  for (let i = 0; i < text.length; i++) {
    const char = text[i].toUpperCase();
    const glyph = font[char] || font[' '];
    for (let col = 0; col < 5; col++) {
      const byte = glyph[col];
      for (let row = 0; row < 7; row++) {
        if (byte & (1 << row)) {
          setPixel(png, padding + i * charSpacing + col, padding + row, textColor);
        }
      }
    }
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const datasetJson = await readFile(join(DATA_DIR, "dataset.json"), "utf8");
  const pairs: PairRecord[] = JSON.parse(datasetJson);

  // Pick 5 representative pairs: 1 no-change, 4 changed (spatial, color, element-add, text)
  const selectedIds = [
    "card-list-none",
    "card-list-spatial-shift-large",
    "form-color-change-large",
    "card-list-element-add",
    "navbar-text-change-different",
  ];

  const frames: AnnotatedFrame[] = [];

  for (const id of selectedIds) {
    const pair = pairs.find((p) => p.id === id);
    if (!pair) {
      console.warn(`Skipping missing pair: ${id}`);
      continue;
    }

    const beforeBuf = await readFile(join(DATA_DIR, pair.before));
    const afterBuf = await readFile(join(DATA_DIR, pair.after));
    const detection = detect(pair.domBefore, pair.domAfter, beforeBuf, afterBuf);

    frames.push({
      pairId: pair.id,
      title: `${pair.kind} (${pair.magnitude})`,
      beforePath: pair.before,
      afterPath: pair.after,
      regions: detection.regions.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
      changed: detection.changed,
    });

    // Annotate before
    const beforePng = PNG.sync.read(beforeBuf);
    drawLabel(beforePng, "BEFORE", { r: 37, g: 99, b: 235 }); // blue bg
    const beforeOut = PNG.sync.write(beforePng);
    await writeFile(join(OUT_DIR, `${pair.id}-before.png`), beforeOut);

    // Annotate after (with bounding boxes if changed)
    const afterPng = PNG.sync.read(afterBuf);
    drawLabel(afterPng, detection.changed ? "AFTER (CHANGED)" : "AFTER (NO CHANGE)", {
      r: detection.changed ? 220 : 34,
      g: detection.changed ? 38 : 197,
      b: detection.changed ? 38 : 94,
    });

    if (detection.changed) {
      for (const reg of detection.regions) {
        drawBox(afterPng, reg.x, reg.y, reg.w, reg.h, { r: 220, g: 38, b: 38 }, 3);
      }
    }
    const afterOut = PNG.sync.write(afterPng);
    await writeFile(join(OUT_DIR, `${pair.id}-after.png`), afterOut);

    console.log(
      `✓ ${pair.id}: ${detection.changed ? `${detection.regions.length} region(s)` : "no change"}`,
    );
  }

  console.log(`\n${frames.length} frame pairs written to ${OUT_DIR}`);
  console.log(
    "To create GIF: use ImageMagick or online tool to combine *-before.png and *-after.png frames with ~1s delay per pair.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
