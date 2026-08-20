import { test } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { classifyDetectedRegions, MAX_REGIONS_TO_CLASSIFY } from "./baselines.js";
import { scriptedProvider } from "../test-utils.js";
import { MemoryCacheStore } from "../cache/store.js";
import type { CandidateRegion } from "../detect/regions.js";

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

function region(x: number, y: number, w: number, h: number, extra?: Partial<CandidateRegion>): CandidateRegion {
  return { x, y, w, h, source: "dom", ...extra };
}

const okTurn = (type: string) => ({
  text: `{"changeType":"${type}","description":"d","confidence":0.9}`,
});

test("classifyDetectedRegions: classifies every region, largest first, and sums usage", async () => {
  const provider = scriptedProvider([okTurn("color-change"), okTurn("text-change"), okTurn("spatial-shift")]);
  const before = solidPng(200, 200, [255, 255, 255]);
  const after = solidPng(200, 200, [200, 200, 200]);
  const regions = [
    region(10, 10, 5, 5), // smallest
    region(50, 50, 40, 40), // largest
    region(120, 120, 10, 10),
  ];

  const results = await classifyDetectedRegions(provider, undefined, before, after, regions, true);

  assert.equal(results.length, 3);
  assert.equal(provider.calls.length, 3);
  // largest region classified first
  assert.deepEqual(results[0].region, { x: 50, y: 50, w: 40, h: 40 });
  assert.equal(results[0].changeType, "color-change");
  assert.equal(results[2].changeType, "spatial-shift");
  // scriptedProvider bills 10 in / 5 out per call
  const inputSum = results.reduce((s, r) => s + r.usage.inputTokens, 0);
  assert.equal(inputSum, 30);
});

test("classifyDetectedRegions: respects the maxRegions cap", async () => {
  const provider = scriptedProvider([okTurn("color-change"), okTurn("color-change")]);
  const before = solidPng(200, 200, [255, 255, 255]);
  const after = solidPng(200, 200, [200, 200, 200]);
  const regions = [
    region(0, 0, 50, 50),
    region(60, 60, 40, 40),
    region(120, 120, 30, 30),
    region(160, 0, 20, 20),
  ];

  const results = await classifyDetectedRegions(provider, undefined, before, after, regions, true, 2);

  assert.equal(results.length, 2);
  assert.equal(provider.calls.length, 2);
  assert.deepEqual(results[0].region, { x: 0, y: 0, w: 50, h: 50 });
  assert.deepEqual(results[1].region, { x: 60, y: 60, w: 40, h: 40 });
});

test("classifyDetectedRegions: each region's DOM fields become its own hint", async () => {
  const provider = scriptedProvider([okTurn("color-change"), okTurn("style-change")]);
  const before = solidPng(200, 200, [255, 255, 255]);
  const after = solidPng(200, 200, [200, 200, 200]);
  const regions = [
    region(10, 10, 40, 40, { domChangedFields: ["backgroundColor"], domId: "btn" }),
    region(80, 80, 30, 30, { domChangedFields: ["borderRadius"], domId: "card" }),
  ];

  await classifyDetectedRegions(provider, undefined, before, after, regions, true);

  assert.equal(provider.systems.length, 2);
  assert.match(provider.systems[0], /backgroundColor/);
  assert.match(provider.systems[0], /#btn/);
  assert.match(provider.systems[1], /borderRadius/);
  assert.match(provider.systems[1], /#card/);
});

test("classifyDetectedRegions: useDomHint=false drops hints even when fields exist", async () => {
  const provider = scriptedProvider([okTurn("color-change")]);
  const before = solidPng(100, 100, [255, 255, 255]);
  const after = solidPng(100, 100, [200, 200, 200]);
  const regions = [region(10, 10, 20, 20, { domChangedFields: ["backgroundColor"] })];

  await classifyDetectedRegions(provider, undefined, before, after, regions, false);

  assert.doesNotMatch(provider.systems[0], /ground truth/);
});

test("classifyDetectedRegions: cache hits zero out usage on the second run", async () => {
  const provider = scriptedProvider([okTurn("color-change"), okTurn("text-change")]);
  const cache = new MemoryCacheStore();
  const before = solidPng(200, 200, [255, 255, 255]);
  const after = solidPng(200, 200, [200, 200, 200]);
  const regions = [region(10, 10, 40, 40), region(80, 80, 20, 20)];

  const first = await classifyDetectedRegions(provider, cache, before, after, regions, true);
  assert.equal(provider.calls.length, 2);
  assert.ok(first.every((r) => r.cached === false));

  const second = await classifyDetectedRegions(provider, cache, before, after, regions, true);
  assert.equal(provider.calls.length, 2); // no new calls
  assert.ok(second.every((r) => r.cached === true));
  assert.equal(second.reduce((s, r) => s + r.usage.inputTokens, 0), 0);
});

test("MAX_REGIONS_TO_CLASSIFY covers the whole dataset's max region count", async () => {
  // the dataset tops out at 6 regions per pair (element-remove in card-list)
  assert.ok(MAX_REGIONS_TO_CLASSIFY >= 6);
});
