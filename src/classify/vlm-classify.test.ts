import { test } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { classifyRegion, cropRegion, parseClassification } from "./vlm-classify.js";
import { scriptedProvider } from "../test-utils.js";

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

test("cropRegion: crops with padding, clamped to image bounds", () => {
  const src = solidPng(100, 100, [255, 255, 255]);
  const region = { x: 40, y: 40, w: 10, h: 10, source: "dom" as const };
  const crop = cropRegion(src, region);
  const decoded = PNG.sync.read(crop);
  // padding is 16px each side, so expect 10 + 2*16 = 42
  assert.equal(decoded.width, 42);
  assert.equal(decoded.height, 42);
});

test("cropRegion: clamps padding at image edges", () => {
  const src = solidPng(100, 100, [255, 255, 255]);
  const region = { x: 2, y: 2, w: 5, h: 5, source: "dom" as const };
  const crop = cropRegion(src, region);
  const decoded = PNG.sync.read(crop);
  // x clamps to 0, so width = 5 + 16 (only right padding fits fully, left clamped)
  assert.ok(decoded.width <= 5 + 2 * 16);
  assert.ok(decoded.width >= 5);
});

test("parseClassification: parses well-formed JSON", () => {
  const result = parseClassification('{"changeType":"color-change","description":"button turned red","confidence":0.9}');
  assert.equal(result.changeType, "color-change");
  assert.equal(result.description, "button turned red");
  assert.equal(result.confidence, 0.9);
});

test("parseClassification: strips markdown code fences", () => {
  const result = parseClassification('```json\n{"changeType":"text-change","description":"label changed","confidence":0.7}\n```');
  assert.equal(result.changeType, "text-change");
});

test("parseClassification: falls back to 'other' on malformed output", () => {
  const result = parseClassification("not json at all");
  assert.equal(result.changeType, "other");
  assert.equal(result.confidence, 0);
});

test("classifyRegion: sends before/after image blocks and parses response", async () => {
  const provider = scriptedProvider([
    { text: '{"changeType":"spatial-shift","description":"element moved right","confidence":0.85}' },
  ]);
  const before = solidPng(20, 20, [255, 255, 255]);
  const after = solidPng(20, 20, [255, 255, 255]);
  const result = await classifyRegion(provider, before, after);
  assert.equal(result.changeType, "spatial-shift");
  assert.equal(provider.calls.length, 1);
  const content = provider.calls[0][0].content;
  assert.equal(content.filter((b) => b.type === "image").length, 2);
});
