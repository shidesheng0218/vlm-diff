// Generates the README demo GIF showing the detection pipeline on a few
// representative pairs. Reads dataset.json, runs Stage 1 detection, overlays
// bounding boxes on the before/after images, and assembles the frames into
// docs/pipeline-demo.gif — fully self-contained (pure-JS gifenc), so the
// asset is reproducible from a clean checkout.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import gifencPkg from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifencPkg;
import { detect } from "../src/detect/regions.js";
import { drawBox, drawLabel } from "../src/report/overlay-png.js";
import type { PairRecord } from "../src/eval/types.js";

const DATA_DIR = join(import.meta.dirname, "..", "data");
const OUT_DIR = join(import.meta.dirname, "..", "docs", "demo-frames");
const GIF_PATH = join(import.meta.dirname, "..", "docs", "pipeline-demo.gif");

interface AnnotatedFrame {
  pairId: string;
  title: string;
  beforePath: string;
  afterPath: string;
  regions: Array<{ x: number; y: number; w: number; h: number }>;
  changed: boolean;
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
  const gifFrames: PNG[] = []; // raw decoded frames, in display order

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
    gifFrames.push(beforePng);

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
    gifFrames.push(afterPng);

    console.log(
      `✓ ${pair.id}: ${detection.changed ? `${detection.regions.length} region(s)` : "no change"}`,
    );
  }

  // Assemble the GIF in-process (pure JS — no ImageMagick / no manual step).
  if (gifFrames.length > 0) {
    const { width, height } = gifFrames[0];
    const gif = GIFEncoder();
    gifFrames.forEach((frame, i) => {
      if (frame.width !== width || frame.height !== height) {
        throw new Error(`frame ${i} size mismatch: ${frame.width}×${frame.height} vs ${width}×${height}`);
      }
      // quantize per frame (256-color palette is plenty for these flat UI shots)
      const palette = quantize(frame.data, 256);
      const indexed = applyPalette(frame.data, palette);
      // hold the final frame a bit longer so the loop reads naturally
      gif.writeFrame(indexed, width, height, { palette, delay: i === gifFrames.length - 1 ? 2000 : 900 });
    });
    gif.finish();
    await writeFile(GIF_PATH, gif.bytes());
    console.log(`\n${frames.length} frame pairs → ${GIF_PATH} (${gifFrames.length} frames, ${(gif.bytes().byteLength / 1024).toFixed(0)} KB)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
