// Reusable pair-diff orchestration for callers outside the eval harness:
// the CLI (`vlm-diff diff`) and the MCP server. The eval arms in
// src/eval/baselines.ts keep their own orchestration so historical numbers
// stay comparable; both paths share detect/describe/classify underneath.
//
// With DOM snapshots this runs the full tiered pipeline (DOM-explained
// regions described at zero tokens, pixel-only regions escalated). Without
// DOM snapshots it degrades to pixel-only mode: detection falls through the
// relaxed no-change rule and every significant region escalates to the VLM.

import { detect, DEFAULT_PIXEL_ONLY_THRESHOLD } from "../detect/regions.js";
import { describeRegions } from "../describe/describe.js";
import { classifyDetectedRegions, MAX_REGIONS_TO_CLASSIFY } from "../eval/baselines.js";
import type { CandidateRegion } from "../detect/regions.js";
import type { ChangeKind } from "../classify/vlm-classify.js";
import type { Provider } from "../provider/types.js";
import type { CacheStore } from "../cache/store.js";

export interface DiffOptions {
  /** provider for VLM escalation; without it escalated regions stay unresolved */
  provider?: Provider;
  cache?: CacheStore;
  pixelOnlyThreshold?: number;
  maxRegions?: number;
}

export interface RegionVerdict {
  x: number;
  y: number;
  w: number;
  h: number;
  source: CandidateRegion["source"];
  route: "deterministic" | "vlm";
  changeType?: ChangeKind;
  description?: string;
  confidence?: number;
  /** why the region needed the VLM (escalated regions only) */
  reason?: string;
  rootCause?: boolean;
  inputTokens: number;
  outputTokens: number;
  cached?: boolean;
}

export interface DiffVerdict {
  changed: boolean;
  /** DOM unchanged but the pixel delta crossed the threshold (or no DOM given) */
  visualOnly: boolean;
  pixelChangedCount: number;
  pixelChangedFraction: number;
  /** pair-level change type from the primary (root-cause-first) region */
  changeType?: ChangeKind;
  /** pair-level one-sentence summary */
  summary?: string;
  regions: RegionVerdict[];
  /** escalated regions left unresolved because no provider was supplied */
  pendingEscalations: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Diff one before/after pair. `domBeforeJson`/`domAfterJson` may be omitted
 * (pixel-only mode) or "[]"-shaped snapshot JSON from src/snapshot/capture.ts.
 */
export async function diffPair(
  beforePng: Buffer,
  afterPng: Buffer,
  domBeforeJson?: string,
  domAfterJson?: string,
  options: DiffOptions = {},
): Promise<DiffVerdict> {
  const detection = detect(
    domBeforeJson ?? "[]",
    domAfterJson ?? "[]",
    beforePng,
    afterPng,
    { pixelOnlyThreshold: options.pixelOnlyThreshold ?? DEFAULT_PIXEL_ONLY_THRESHOLD },
  );

  const audit = {
    pixelChangedCount: detection.pixelChangedCount,
    pixelChangedFraction: detection.pixelChangedFraction,
  };

  if (!detection.changed || detection.regions.length === 0) {
    return {
      changed: false,
      visualOnly: detection.visualOnly,
      ...audit,
      regions: [],
      pendingEscalations: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  const maxRegions = options.maxRegions ?? MAX_REGIONS_TO_CLASSIFY;
  const sorted = [...detection.regions].sort((a, b) => b.w * b.h - a.w * a.h).slice(0, maxRegions);

  const descriptions = describeRegions(sorted);
  const verdicts: RegionVerdict[] = [];
  const escalated: CandidateRegion[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const region = sorted[i];
    const d = descriptions[i];
    if (d.route === "deterministic") {
      verdicts.push({
        x: region.x, y: region.y, w: region.w, h: region.h,
        source: region.source,
        route: "deterministic",
        changeType: d.changeType,
        description: d.description,
        confidence: d.confidence,
        rootCause: d.rootCause,
        inputTokens: 0,
        outputTokens: 0,
      });
    } else {
      escalated.push(region);
    }
  }

  let pendingEscalations = 0;
  if (escalated.length > 0) {
    if (options.provider) {
      const classifications = await classifyDetectedRegions(
        options.provider, options.cache, beforePng, afterPng, escalated, true, maxRegions,
      );
      for (const c of classifications) {
        verdicts.push({
          x: c.region.x, y: c.region.y, w: c.region.w, h: c.region.h,
          source: c.source,
          route: "vlm",
          changeType: c.changeType,
          description: c.description,
          confidence: c.confidence,
          rootCause: true, // pixel-only repaints are their own root cause
          inputTokens: c.usage.inputTokens,
          outputTokens: c.usage.outputTokens,
          cached: c.cached,
        });
      }
    } else {
      pendingEscalations = escalated.length;
      for (const region of escalated) {
        verdicts.push({
          x: region.x, y: region.y, w: region.w, h: region.h,
          source: region.source,
          route: "vlm",
          reason: "pixel-only region: no DOM signal",
          rootCause: true,
          inputTokens: 0,
          outputTokens: 0,
        });
      }
    }
  }

  // pair-level verdict: root causes first, then largest region
  verdicts.sort((a, b) => {
    if ((b.rootCause ?? false) !== (a.rootCause ?? false)) return (b.rootCause ?? false) ? 1 : -1;
    return b.w * b.h - a.w * a.h;
  });

  // end-to-end no-change aggregation (see baselines.aggregateNone): a purely
  // pixel-driven pair whose every region the VLM calls "none" was noise, not
  // a change. Skipped while escalations are still pending.
  let changed = true;
  if (
    detection.visualOnly &&
    pendingEscalations === 0 &&
    verdicts.length > 0 &&
    verdicts.every((v) => v.changeType === "none")
  ) {
    changed = false;
  }

  const primary = verdicts[0];
  return {
    changed,
    visualOnly: detection.visualOnly,
    ...audit,
    changeType: primary.changeType,
    summary: primary.description,
    regions: verdicts,
    pendingEscalations,
    inputTokens: verdicts.reduce((s, v) => s + v.inputTokens, 0),
    outputTokens: verdicts.reduce((s, v) => s + v.outputTokens, 0),
  };
}
