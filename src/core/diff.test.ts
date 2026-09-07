import { test } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { diffPair } from "./diff.js";
import { scriptedProvider } from "../test-utils.js";
import type { DomNode } from "../detect/dom-diff.js";

function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const off = i * 4;
    png.data[off] = rgb[0];
    png.data[off + 1] = rgb[1];
    png.data[off + 2] = rgb[2];
    png.data[off + 3] = 255;
  }
  return PNG.sync.write(png);
}

function blockPng(width: number, height: number, block: { x: number; y: number; w: number; h: number }, rgb: [number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const off = (y * width + x) * 4;
      const inBlock = x >= block.x && x < block.x + block.w && y >= block.y && y < block.y + block.h;
      const [r, g, b] = inBlock ? rgb : [255, 255, 255];
      png.data[off] = r;
      png.data[off + 1] = g;
      png.data[off + 2] = b;
      png.data[off + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function buttonNode(overrides: Partial<DomNode> = {}): DomNode {
  return {
    path: "BUTTON:0",
    tag: "BUTTON",
    id: "btn",
    className: "",
    text: "Submit",
    rect: { x: 10, y: 10, w: 40, h: 40 },
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

test("diffPair: DOM-explained change is fully deterministic (zero provider calls)", async () => {
  const provider = scriptedProvider([{ text: "{}" }]);
  const domBefore = JSON.stringify([buttonNode()]);
  const domAfter = JSON.stringify([
    buttonNode({ style: { ...buttonNode().style, backgroundColor: "rgb(220, 38, 38)" } }),
  ]);
  const before = solidPng(200, 200, [255, 255, 255]);
  const after = blockPng(200, 200, { x: 10, y: 10, w: 40, h: 40 }, [220, 38, 38]);

  const verdict = await diffPair(before, after, domBefore, domAfter, { provider });

  assert.equal(provider.calls.length, 0);
  assert.equal(verdict.changed, true);
  assert.equal(verdict.changeType, "color-change");
  assert.match(verdict.summary!, /blue/);
  assert.equal(verdict.inputTokens, 0);
});

test("diffPair: pixel-only mode (no DOM) escalates and resolves via provider", async () => {
  const provider = scriptedProvider([{ text: '{"changeType":"color-change","description":"bars turned red","confidence":0.9}' }]);
  const before = solidPng(200, 200, [255, 255, 255]);
  const after = blockPng(200, 200, { x: 60, y: 60, w: 80, h: 80 }, [220, 38, 38]);

  const verdict = await diffPair(before, after, undefined, undefined, { provider });

  assert.equal(provider.calls.length, 1);
  assert.equal(verdict.changed, true);
  assert.equal(verdict.visualOnly, true);
  assert.equal(verdict.changeType, "color-change");
  assert.equal(verdict.summary, "bars turned red");
});

test("diffPair: visual-only pair flips to unchanged when the provider rules none", async () => {
  const provider = scriptedProvider([{ text: '{"changeType":"none","description":"no meaningful change","confidence":0.8}' }]);
  const before = solidPng(200, 200, [255, 255, 255]);
  const after = blockPng(200, 200, { x: 60, y: 60, w: 80, h: 80 }, [220, 38, 38]);

  const verdict = await diffPair(before, after, undefined, undefined, { provider });

  assert.equal(provider.calls.length, 1);
  assert.equal(verdict.changed, false);
  assert.equal(verdict.changeType, "none");
});

test("diffPair: without a provider, escalations stay pending", async () => {
  const before = solidPng(200, 200, [255, 255, 255]);
  const after = blockPng(200, 200, { x: 60, y: 60, w: 80, h: 80 }, [220, 38, 38]);

  const verdict = await diffPair(before, after);

  assert.equal(verdict.changed, true);
  assert.equal(verdict.pendingEscalations, verdict.regions.length);
  assert.ok(verdict.regions.every((r) => r.route === "vlm" && r.changeType === undefined));
});

test("diffPair: deterministic regions carry DOM evidence (provenance)", async () => {
  const provider = scriptedProvider([{ text: "{}" }]);
  const domBefore = JSON.stringify([buttonNode()]);
  const domAfter = JSON.stringify([
    buttonNode({ style: { ...buttonNode().style, backgroundColor: "rgb(220, 38, 38)" } }),
  ]);
  const before = solidPng(200, 200, [255, 255, 255]);
  const after = blockPng(200, 200, { x: 10, y: 10, w: 40, h: 40 }, [220, 38, 38]);

  const verdict = await diffPair(before, after, domBefore, domAfter, { provider });

  const region = verdict.regions[0];
  assert.deepEqual(region.evidence?.domChangedFields, ["backgroundColor"]);
  assert.equal(region.evidence?.domValues?.backgroundColor.before, "rgb(37, 99, 235)");
  assert.equal(region.evidence?.domValues?.backgroundColor.after, "rgb(220, 38, 38)");
});

test("diffPair: identical frames return unchanged with zero regions", async () => {
  const img = solidPng(200, 200, [255, 255, 255]);
  const dom = JSON.stringify([buttonNode()]);

  const verdict = await diffPair(img, img, dom, dom);

  assert.equal(verdict.changed, false);
  assert.equal(verdict.regions.length, 0);
  assert.equal(verdict.pixelChangedCount, 0);
});
