import { test } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { detect } from "./regions.js";
import type { DomNode } from "./dom-diff.js";

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

function node(overrides: Partial<DomNode> = {}): DomNode {
  return {
    path: "DIV:0",
    tag: "DIV",
    id: "x",
    className: "",
    text: "",
    rect: { x: 10, y: 10, w: 20, h: 15 },
    style: { color: "rgb(0,0,0)", backgroundColor: "rgb(255,255,255)", fontWeight: "400", borderRadius: "0px" },
    ...overrides,
  };
}

test("detect: no DOM change suppresses pixel noise (no-change pair)", () => {
  // identical DOM, but images differ slightly (render-timing/AA noise)
  const before = [node()];
  const after = [node()];
  const beforePng = solidPng(60, 60, [255, 255, 255]);
  const afterPng = solidPng(60, 60, [254, 254, 254]); // subtle uniform noise, well over pixelmatch threshold potentially
  const result = detect(JSON.stringify(before), JSON.stringify(after), beforePng, afterPng);
  assert.equal(result.changed, false);
  assert.equal(result.regions.length, 0);
});

test("detect: DOM change produces a candidate region even without pixel corroboration", () => {
  const before = [node({ style: { color: "rgb(0,0,0)", backgroundColor: "rgb(255,255,255)", fontWeight: "400", borderRadius: "0px" } })];
  const after = [node({ style: { color: "rgb(0,0,0)", backgroundColor: "rgb(220,38,38)", fontWeight: "400", borderRadius: "0px" } })];
  const beforePng = solidPng(60, 60, [255, 255, 255]);
  const afterPng = solidPng(60, 60, [255, 255, 255]); // pixel diff sees nothing (contrived)
  const result = detect(JSON.stringify(before), JSON.stringify(after), beforePng, afterPng);
  assert.equal(result.changed, true);
  assert.equal(result.regions.length, 1);
  assert.equal(result.regions[0].source, "dom");
});

test("detect: DOM change corroborated by pixel diff is marked dom+pixel", () => {
  const before = [node({ rect: { x: 10, y: 10, w: 20, h: 15 } })];
  const after = [node({ rect: { x: 30, y: 10, w: 20, h: 15 } })];
  const beforePng = solidPng(80, 80, [255, 255, 255]);
  const afterPng = new PNG({ width: 80, height: 80 });
  for (let y = 0; y < 80; y++) {
    for (let x = 0; x < 80; x++) {
      const off = (y * 80 + x) * 4;
      const inRegion = x >= 30 && x < 50 && y >= 10 && y < 25;
      const [r, g, b] = inRegion ? [220, 38, 38] : [255, 255, 255];
      afterPng.data[off] = r;
      afterPng.data[off + 1] = g;
      afterPng.data[off + 2] = b;
      afterPng.data[off + 3] = 255;
    }
  }
  const result = detect(JSON.stringify(before), JSON.stringify(after), beforePng, PNG.sync.write(afterPng));
  assert.equal(result.changed, true);
  assert.ok(result.regions.some((r) => r.source === "dom+pixel"));
});

test("detect: rect changes carry position/size fields and the signed delta", () => {
  const before = [node({ rect: { x: 10, y: 10, w: 20, h: 15 } })];
  const after = [node({ rect: { x: 10, y: 10, w: 26, h: 15 } })]; // grew wider only
  const img = solidPng(60, 60, [255, 255, 255]);
  const result = detect(JSON.stringify(before), JSON.stringify(after), img, img);
  assert.equal(result.regions.length, 1);
  assert.deepEqual(result.regions[0].domChangedFields, ["size"]);
  assert.deepEqual(result.regions[0].rectDelta, { dx: 0, dy: 0, dw: 6, dh: 0 });
});

test("detect: removed element region uses the replacement's after-rect and keeps the original as counterpart", () => {
  // link-3 removed; link-2 (in after) sits where link-3 used to be
  const before = [
    node({ path: "A:0", id: "link-2", rect: { x: 10, y: 10, w: 20, h: 10 } }),
    node({ path: "A:1", id: "link-3", rect: { x: 40, y: 10, w: 15, h: 10 } }),
  ];
  const after = [
    node({ path: "A:0", id: "link-2", rect: { x: 35, y: 10, w: 20, h: 10 } }), // slid into link-3's area
  ];
  const img = solidPng(80, 40, [255, 255, 255]);
  const result = detect(JSON.stringify(before), JSON.stringify(after), img, img);
  const removed = result.regions.find((r) => r.domId === "link-3");
  assert.ok(removed, "expected a region for the removed element");
  assert.deepEqual(removed.domChangedFields, ["removed"]);
  // region rect = the replacement's after-rect (link-2 at 35,10), not the vacated 40,10
  assert.deepEqual({ x: removed.x, y: removed.y, w: removed.w, h: removed.h }, { x: 35, y: 10, w: 20, h: 10 });
  assert.deepEqual(removed.counterpartRect, { x: 40, y: 10, w: 15, h: 10 });
});
