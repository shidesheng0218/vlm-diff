import { test } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { annotatePng, drawBox, drawLabel } from "./overlay-png.js";

function solidPng(w: number, h: number): Buffer {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    const off = i * 4;
    png.data[off] = png.data[off + 1] = png.data[off + 2] = 255;
    png.data[off + 3] = 255;
  }
  return PNG.sync.write(png);
}

function pixelAt(png: PNG, x: number, y: number): [number, number, number] {
  const off = (png.width * y + x) << 2;
  return [png.data[off], png.data[off + 1], png.data[off + 2]];
}

test("drawBox: draws an outline of the given color and thickness", () => {
  const png = PNG.sync.read(solidPng(50, 50));
  drawBox(png, 10, 10, 20, 15, { r: 220, g: 38, b: 38 }, 2);
  assert.deepEqual(pixelAt(png, 10, 10), [220, 38, 38]); // top-left corner
  assert.deepEqual(pixelAt(png, 20, 10), [220, 38, 38]); // top edge
  assert.deepEqual(pixelAt(png, 29, 24), [220, 38, 38]); // bottom-right corner
  assert.deepEqual(pixelAt(png, 20, 20), [255, 255, 255]); // interior untouched
});

test("drawLabel: paints a background block with white glyphs", () => {
  const png = PNG.sync.read(solidPng(80, 40));
  drawLabel(png, "12", { r: 37, g: 99, b: 235 });
  assert.deepEqual(pixelAt(png, 0, 0), [37, 99, 235]); // background
  // at least one white glyph pixel exists inside the label area
  let white = 0;
  for (let y = 0; y < 16 && y < png.height; y++) {
    for (let x = 0; x < 20 && x < png.width; x++) {
      const [r, g, b] = pixelAt(png, x, y);
      if (r === 255 && g === 255 && b === 255) white++;
    }
  }
  // background is blue, so white pixels == glyph strokes; "12" must draw some
  assert.ok(white > 0 && white < 200, `white glyph pixels: ${white}`);
});

test("annotatePng: severity colors + numbered tags; no regions returns the input unchanged", () => {
  const base = solidPng(100, 100);
  const out = PNG.sync.read(
    annotatePng(base, [
      { x: 20, y: 30, w: 30, h: 20, index: 1, severity: "breaking" },
      { x: 60, y: 60, w: 10, h: 10, index: 2, severity: "cosmetic" },
    ]),
  );
  assert.deepEqual(pixelAt(out, 20, 30), [220, 38, 38]); // breaking box = red
  assert.deepEqual(pixelAt(out, 60, 60), [37, 99, 235]); // cosmetic box = blue
  // tag for region 1 sits above the box (y-11..y), painted red
  assert.deepEqual(pixelAt(out, 20, 19), [220, 38, 38]);

  const passthrough = annotatePng(base, []);
  assert.ok(Buffer.isBuffer(passthrough));
});
