import { test } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { regionOverlaySvg } from "./overlay.js";
import { generateVisualReport } from "./visual-report.js";
import type { DiffVerdict } from "../core/diff.js";

test("regionOverlaySvg: draws a numbered box per region with severity colors", () => {
  const svg = regionOverlaySvg(
    [
      { x: 10, y: 20, w: 30, h: 40, index: 1, severity: "breaking" },
      { x: 50, y: 60, w: 10, h: 10, index: 2 },
    ],
    200,
    100,
  );
  assert.match(svg, /viewBox="0 0 200 100"/);
  assert.ok(svg.includes('x="10" y="20" width="30" height="40"'));
  assert.ok(svg.includes("#dc2626")); // breaking = red
  assert.ok(svg.includes(">1<") && svg.includes(">2<")); // numbered tags
});

test("regionOverlaySvg: empty region list returns empty string", () => {
  assert.equal(regionOverlaySvg([], 100, 100), "");
});

function solidPng(w: number, h: number): Buffer {
  const png = new PNG({ width: w, height: h });
  png.data.fill(255);
  return PNG.sync.write(png);
}

test("generateVisualReport: inlines images, draws overlay, lists region cards", () => {
  const verdict: DiffVerdict = {
    changed: true,
    visualOnly: false,
    pixelChangedCount: 500,
    pixelChangedFraction: 0.05,
    changeType: "color-change",
    summary: "Button background changed from blue to red",
    severity: "cosmetic",
    regions: [
      {
        x: 10, y: 10, w: 40, h: 20, source: "dom", route: "deterministic",
        changeType: "color-change", description: "Button background changed from blue to red",
        confidence: 1, severity: "cosmetic", inputTokens: 0, outputTokens: 0,
      },
    ],
    pendingEscalations: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  const html = generateVisualReport({ beforePng: solidPng(100, 100), afterPng: solidPng(100, 100), verdict });
  assert.ok(html.includes("data:image/png;base64,"));
  assert.ok(html.includes("<svg")); // overlay drawn
  assert.ok(html.includes("color-change"));
  assert.ok(html.includes("Button background changed from blue to red"));
  assert.ok(html.includes("Change detected"));
});
