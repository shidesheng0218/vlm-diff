#!/usr/bin/env tsx
/**
 * Quick demo: runs the REAL detection + deterministic description on
 * synthetic in-memory snapshots and PNGs. No screenshots, no API calls,
 * no Playwright — the smallest possible proof that the pipeline works.
 * Run: npm run demo:quick
 */

import { PNG } from "pngjs";
import { detect } from "../src/detect/regions.js";
import { describeRegions } from "../src/describe/describe.js";
import type { DomNode } from "../src/detect/dom-diff.js";

function png(width: number, height: number, draw: (x: number, y: number) => [number, number, number]): Buffer {
  const img = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const off = (y * width + x) * 4;
      const [r, g, b] = draw(x, y);
      img.data[off] = r;
      img.data[off + 1] = g;
      img.data[off + 2] = b;
      img.data[off + 3] = 255;
    }
  }
  return PNG.sync.write(img);
}

function node(id: string, overrides: Partial<DomNode> = {}): DomNode {
  return {
    path: `DIV:0>BUTTON:${id}`,
    tag: "BUTTON",
    id,
    className: "btn",
    text: "Submit",
    rect: { x: 40, y: 100, w: 120, h: 40 },
    style: {
      color: "rgb(255, 255, 255)",
      backgroundColor: "rgb(37, 99, 235)",
      fontWeight: "400",
      borderRadius: "8px",
      opacity: "1",
      boxShadow: "none",
      border: "0px none rgb(0, 0, 0)",
    },
    ...overrides,
  };
}

console.log("🔍 VLM-Diff Quick Demo (real algorithm, synthetic inputs, 0 API calls)\n");
console.log("━".repeat(60));

// ── Scenario 1: button turns blue → red (DOM-observable) ──
{
  const domBefore = JSON.stringify([node("submit-btn")]);
  const domAfter = JSON.stringify([
    node("submit-btn", { style: { ...node("submit-btn").style, backgroundColor: "rgb(220, 38, 38)" } }),
  ]);
  const before = png(200, 200, (x, y) => (x >= 40 && x < 160 && y >= 100 && y < 140 ? [37, 99, 235] : [243, 244, 246]));
  const after = png(200, 200, (x, y) => (x >= 40 && x < 160 && y >= 100 && y < 140 ? [220, 38, 38] : [243, 244, 246]));

  const result = detect(domBefore, domAfter, before, after);
  console.log("\n1️⃣  Button color change (blue → red)");
  console.log(`   changed: ${result.changed} · regions: ${result.regions.length}`);
  for (const [i, d] of describeRegions(result.regions).entries()) {
    console.log(`   → [${result.regions[i].source}] ${d.changeType}: ${d.description} (0 VLM tokens)`);
  }
}

// ── Scenario 2: identical re-render (AA-noise suppression) ──
{
  const dom = JSON.stringify([node("submit-btn")]);
  const img = png(200, 200, (x, y) => (x >= 40 && x < 160 && y >= 100 && y < 140 ? [37, 99, 235] : [243, 244, 246]));

  const result = detect(dom, dom, img, img);
  console.log("\n2️⃣  Identical re-render (noise suppression)");
  console.log(`   changed: ${result.changed} ${result.changed ? "❌" : "✅ (correctly suppressed)"}`);
}

// ── Scenario 3: canvas-style repaint, zero DOM signal (v0.2 visual-only path) ──
{
  const dom = JSON.stringify([node("submit-btn")]);
  const before = png(200, 200, () => [255, 255, 255]);
  const after = png(200, 200, (x, y) => (x >= 140 && x < 190 && y >= 20 && y < 70 ? [16, 185, 129] : [255, 255, 255]));

  const result = detect(dom, dom, before, after);
  console.log("\n3️⃣  Canvas-style repaint with zero DOM signal (v0.2 relaxed rule)");
  console.log(`   changed: ${result.changed} · visualOnly: ${result.visualOnly} · pixel delta: ${(result.pixelChangedFraction * 100).toFixed(2)}%`);
  console.log(`   → ${result.regions.length} pixel-only region(s) would escalate to the VLM tier`);
}

console.log("\n" + "━".repeat(60));
console.log("\n💡 The DOM diff supplies exact before/after values, so most changes are");
console.log("   described deterministically at 0 VLM tokens. Only pixel-only deltas");
console.log("   (canvas repaints, image swaps) escalate.\n");
console.log("🚀 Next: npm run demo:generate && npm run demo:detect  (real screenshots)");
