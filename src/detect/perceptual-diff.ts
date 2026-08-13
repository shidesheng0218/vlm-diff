// Perceptual/structural pixel diff: pixelmatch with anti-aliasing detection,
// then connected-component grouping of the changed-pixel mask into candidate
// rectangular regions. This alone has a known high false-positive rate on
// no-change pairs (render-timing/AA noise) — see regions.ts for how DOM diff
// is used to suppress those.

import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export interface PixelRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  changedPixels: number;
}

const MIN_REGION_AREA_FRACTION = 0.001; // filter out sub-0.1%-of-frame noise

export function diffImages(beforePng: Buffer, afterPng: Buffer): { mask: Uint8Array; width: number; height: number; changedCount: number } {
  const before = PNG.sync.read(beforePng);
  const after = PNG.sync.read(afterPng);
  const { width, height } = before;
  const diff = new PNG({ width, height });

  const changedCount = pixelmatch(before.data, after.data, diff.data, width, height, {
    threshold: 0.15, // tolerance against anti-aliasing noise
    includeAA: false,
    diffMask: true, // only changed pixels get non-zero alpha; rest is transparent
  });

  // Build a boolean mask (1 = pixel differs) from the diff image's alpha/red channel.
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const off = i * 4;
    mask[i] = diff.data[off + 3] > 0 ? 1 : 0;
  }

  return { mask, width, height, changedCount };
}

/** Flood-fill connected components of the changed-pixel mask into candidate regions. */
export function groupRegions(mask: Uint8Array, width: number, height: number): PixelRegion[] {
  const visited = new Uint8Array(width * height);
  const regions: PixelRegion[] = [];
  const minArea = width * height * MIN_REGION_AREA_FRACTION;

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || visited[start] === 1) continue;

    // BFS flood fill
    const queue = [start];
    visited[start] = 1;
    let minX = width, maxX = 0, minY = height, maxY = 0, count = 0;

    while (queue.length > 0) {
      const idx = queue.pop()!;
      const x = idx % width;
      const y = Math.floor(idx / width);
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const neighbors = [idx - 1, idx + 1, idx - width, idx + width];
      for (const n of neighbors) {
        if (n < 0 || n >= mask.length) continue;
        // avoid wrapping across row boundaries for horizontal neighbors
        if ((n === idx - 1 || n === idx + 1) && Math.floor(n / width) !== y) continue;
        if (mask[n] === 1 && visited[n] === 0) {
          visited[n] = 1;
          queue.push(n);
        }
      }
    }

    const area = (maxX - minX + 1) * (maxY - minY + 1);
    if (area >= minArea) {
      regions.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, changedPixels: count });
    }
  }

  return mergeOverlapping(regions);
}

/** Merge regions whose bounding boxes overlap or sit within a small gap of each other. */
function mergeOverlapping(regions: PixelRegion[], gap = 8): PixelRegion[] {
  let merged = [...regions];
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        const a = merged[i], b = merged[j];
        const overlaps =
          a.x - gap < b.x + b.w && a.x + a.w + gap > b.x && a.y - gap < b.y + b.h && a.y + a.h + gap > b.y;
        if (overlaps) {
          const x = Math.min(a.x, b.x);
          const y = Math.min(a.y, b.y);
          const w = Math.max(a.x + a.w, b.x + b.w) - x;
          const h = Math.max(a.y + a.h, b.y + b.h) - y;
          merged.splice(j, 1);
          merged.splice(i, 1);
          merged.push({ x, y, w, h, changedPixels: a.changedPixels + b.changedPixels });
          changed = true;
          break outer;
        }
      }
    }
  }
  return merged;
}
