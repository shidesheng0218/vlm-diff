// Fuses DOM diff + perceptual diff into final candidate regions.
//
// Core design decision (see plan): if DOM diff reports zero changes, the pair
// is treated as unchanged regardless of what pixel diff says. This directly
// targets the no-change false-positive failure mode that pure pixel diff
// exhibits from anti-aliasing/render-timing noise.
//
// When DOM diff DOES report changes, its rects are the primary candidate
// regions (precise, attributable to a specific element/property). Pixel
// regions are used only as corroboration/expansion for changes that are
// visually significant but not captured by DOM diff (rare in this dataset,
// but matters for generality — e.g. a canvas repaint).

import { diffDom, parseSnapshot, type DomChange } from "./dom-diff.js";
import { diffImages, groupRegions, type PixelRegion } from "./perceptual-diff.js";

export interface CandidateRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  source: "dom" | "pixel" | "dom+pixel";
  domChangedFields?: string[];
  domId?: string;
}

export interface DetectionResult {
  changed: boolean;
  regions: CandidateRegion[];
  domChangeCount: number;
  pixelRegionCount: number;
}

function rectsOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function detect(
  domBeforeJson: string,
  domAfterJson: string,
  beforePng: Buffer,
  afterPng: Buffer,
): DetectionResult {
  const domChanges: DomChange[] = diffDom(parseSnapshot(domBeforeJson), parseSnapshot(domAfterJson));
  const { mask, width, height } = diffImages(beforePng, afterPng);
  const pixelRegions: PixelRegion[] = groupRegions(mask, width, height);

  // No-change suppression: DOM diff is the ground truth for "did anything
  // actually change in the page model." Pixel noise alone does not count.
  if (domChanges.length === 0) {
    return { changed: false, regions: [], domChangeCount: 0, pixelRegionCount: pixelRegions.length };
  }

  const regions: CandidateRegion[] = domChanges.map((dc) => {
    const corroborated = pixelRegions.some((pr) => rectsOverlap(dc.rect, pr));
    return {
      x: dc.rect.x,
      y: dc.rect.y,
      w: Math.max(dc.rect.w, 1),
      h: Math.max(dc.rect.h, 1),
      source: corroborated ? "dom+pixel" : "dom",
      domChangedFields: dc.changedFields,
      domId: dc.id,
    };
  });

  // Pixel regions with no corresponding DOM change (e.g. canvas/non-DOM
  // repaint) are added as pixel-only candidates.
  for (const pr of pixelRegions) {
    const alreadyCovered = domChanges.some((dc) => rectsOverlap(dc.rect, pr));
    if (!alreadyCovered) {
      regions.push({ x: pr.x, y: pr.y, w: pr.w, h: pr.h, source: "pixel" });
    }
  }

  return { changed: true, regions, domChangeCount: domChanges.length, pixelRegionCount: pixelRegions.length };
}
