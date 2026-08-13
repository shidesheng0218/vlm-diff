import { test } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { diffImages, groupRegions } from "./perceptual-diff.js";

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

function withPatch(width: number, height: number, base: [number, number, number], patch: { x: number; y: number; w: number; h: number; rgb: [number, number, number] }): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const off = (y * width + x) * 4;
      const inPatch = x >= patch.x && x < patch.x + patch.w && y >= patch.y && y < patch.y + patch.h;
      const [r, g, b] = inPatch ? patch.rgb : base;
      png.data[off] = r;
      png.data[off + 1] = g;
      png.data[off + 2] = b;
      png.data[off + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

test("diffImages: identical images produce zero changed pixels", () => {
  const a = solidPng(50, 50, [255, 255, 255]);
  const b = solidPng(50, 50, [255, 255, 255]);
  const { changedCount } = diffImages(a, b);
  assert.equal(changedCount, 0);
});

test("diffImages + groupRegions: a localized color patch is detected as one region", () => {
  const a = solidPng(60, 60, [255, 255, 255]);
  const b = withPatch(60, 60, [255, 255, 255], { x: 10, y: 10, w: 20, h: 15, rgb: [220, 38, 38] });
  const { mask, width, height } = diffImages(a, b);
  const regions = groupRegions(mask, width, height);
  assert.equal(regions.length, 1);
  // bounding box should roughly cover the injected patch
  assert.ok(regions[0].x <= 10 && regions[0].x + regions[0].w >= 30);
  assert.ok(regions[0].y <= 10 && regions[0].y + regions[0].h >= 25);
});

test("groupRegions: sub-threshold noise is filtered out", () => {
  // a 2x2 speck on a 200x200 canvas is well under the 0.1% area filter
  const a = solidPng(200, 200, [255, 255, 255]);
  const b = withPatch(200, 200, [255, 255, 255], { x: 5, y: 5, w: 2, h: 2, rgb: [255, 254, 253] });
  const { mask, width, height } = diffImages(a, b);
  const regions = groupRegions(mask, width, height);
  assert.equal(regions.length, 0);
});

test("groupRegions: two well-separated patches are reported as two regions", () => {
  const png = new PNG({ width: 100, height: 100 });
  for (let i = 0; i < 100 * 100; i++) {
    const off = i * 4;
    png.data[off] = png.data[off + 1] = png.data[off + 2] = 255;
    png.data[off + 3] = 255;
  }
  const a = PNG.sync.write(png);

  const png2 = new PNG({ width: 100, height: 100 });
  for (let y = 0; y < 100; y++) {
    for (let x = 0; x < 100; x++) {
      const off = (y * 100 + x) * 4;
      const inA = x >= 5 && x < 20 && y >= 5 && y < 20;
      const inB = x >= 70 && x < 90 && y >= 70 && y < 90;
      const [r, g, b] = inA || inB ? [220, 38, 38] : [255, 255, 255];
      png2.data[off] = r;
      png2.data[off + 1] = g;
      png2.data[off + 2] = b;
      png2.data[off + 3] = 255;
    }
  }
  const bBuf = PNG.sync.write(png2);

  const { mask, width, height } = diffImages(a, bBuf);
  const regions = groupRegions(mask, width, height);
  assert.equal(regions.length, 2);
});
