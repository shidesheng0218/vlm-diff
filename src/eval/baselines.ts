// The three conditions being compared, per the plan's scientific core:
//   (a) rawPairToVlm    — full before/after images straight to the VLM, ask "what changed"
//   (b) pixelDiffOnly   — perceptual diff candidate regions, no DOM signal, no VLM
//   (c) fullPipeline    — DOM diff + pixel diff fusion (with no-change suppression) -> VLM classify

import { readFile } from "node:fs/promises";
import type { Provider } from "../provider/types.js";
import { imageBlock, textBlock } from "../provider/types.js";
import { detect, type CandidateRegion, type DetectionResult } from "../detect/regions.js";
import { diffImages, groupRegions } from "../detect/perceptual-diff.js";
import { classifyRegion, classifyRegionCached, cropRegion } from "../classify/vlm-classify.js";
import type { ChangeKind, Classification, DomHint } from "../classify/vlm-classify.js";
import type { CacheStore } from "../cache/store.js";
import type { PairRecord } from "./types.js";
// re-exported for callers that only need the record shape from this module
export type { PairRecord };

export interface RegionClassification {
  region: { x: number; y: number; w: number; h: number };
  source: CandidateRegion["source"];
  changeType: ChangeKind;
  description: string;
  confidence: number;
  usage: { inputTokens: number; outputTokens: number };
  cached?: boolean;
}

export interface BaselineResult {
  pairId: string;
  baseline: "rawPairToVlm" | "pixelDiffOnly" | "fullPipeline";
  predictedChanged: boolean;
  predictedRegions: Array<{ x: number; y: number; w: number; h: number }>;
  /** pair-level change type = the largest region's classification (scoring continuity) */
  predictedChangeType?: ChangeKind;
  description?: string;
  /** per-region classifications, largest region first (fullPipeline only) */
  classifications?: RegionClassification[];
  inputTokens: number;
  outputTokens: number;
  cached?: boolean;
}

const RAW_PAIR_SYSTEM = `You are comparing a "before" and "after" screenshot of the same UI. Determine if anything changed, and if so, what and where.

Respond with strict JSON only, no markdown fences:
{"changed": true|false, "changeType": "spatial-shift" | "color-change" | "size-change" | "text-change" | "element-add" | "element-remove" | "style-change" | "other" | "none", "description": "<one sentence>", "region": {"x": <int>, "y": <int>, "w": <int>, "h": <int>} | null}`;

export async function runRawPairToVlm(provider: Provider, pair: PairRecord, dataDir: string): Promise<BaselineResult> {
  const before = await readFile(`${dataDir}/${pair.before}`);
  const after = await readFile(`${dataDir}/${pair.after}`);

  const result = await provider.send(RAW_PAIR_SYSTEM, [
    {
      role: "user",
      content: [
        textBlock("Before:"),
        imageBlock(before.toString("base64"), "image/png"),
        textBlock("After:"),
        imageBlock(after.toString("base64"), "image/png"),
      ],
    },
  ]);

  let changed = false;
  let changeType: ChangeKind | undefined;
  let description: string | undefined;
  let region: { x: number; y: number; w: number; h: number } | undefined;
  try {
    const cleaned = result.text.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
    const parsed = JSON.parse(cleaned);
    changed = !!parsed.changed;
    changeType = parsed.changeType;
    description = parsed.description;
    region = parsed.region ?? undefined;
  } catch {
    // unparseable response counts as "no detection" for scoring purposes
  }

  return {
    pairId: pair.id,
    baseline: "rawPairToVlm",
    predictedChanged: changed,
    predictedRegions: region ? [region] : [],
    predictedChangeType: changeType,
    description,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
  };
}

export async function runPixelDiffOnly(pair: PairRecord, dataDir: string): Promise<BaselineResult> {
  const before = await readFile(`${dataDir}/${pair.before}`);
  const after = await readFile(`${dataDir}/${pair.after}`);
  const { mask, width, height } = diffImages(before, after);
  const regions = groupRegions(mask, width, height);

  return {
    pairId: pair.id,
    baseline: "pixelDiffOnly",
    predictedChanged: regions.length > 0,
    predictedRegions: regions.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
    inputTokens: 0,
    outputTokens: 0,
  };
}

/** Upper bound on VLM calls per pair. Pathological pages can produce dozens
 *  of DOM changes; classify the largest regions first and stop here. */
export const MAX_REGIONS_TO_CLASSIFY = 8;

/**
 * Classify every detected region in parallel, largest first. Each region gets
 * its own crop and (when available) its own DOM-field hint, so a pair with
 * several changed elements produces one classification per element.
 */
export async function classifyDetectedRegions(
  provider: Provider,
  cache: CacheStore | undefined,
  before: Buffer,
  after: Buffer,
  regions: CandidateRegion[],
  useDomHint: boolean,
  maxRegions: number = MAX_REGIONS_TO_CLASSIFY,
): Promise<RegionClassification[]> {
  const sorted = [...regions].sort((a, b) => b.w * b.h - a.w * a.h).slice(0, maxRegions);
  return Promise.all(
    sorted.map(async (region) => {
      const hint: DomHint | undefined =
        useDomHint && region.domChangedFields && region.domChangedFields.length > 0
          ? { fields: region.domChangedFields, id: region.domId }
          : undefined;
      const c: Classification & { cached?: boolean } = cache
        ? await classifyRegionCached(provider, cache, cropRegion(before, region), cropRegion(after, region), hint)
        : await classifyRegion(provider, cropRegion(before, region), cropRegion(after, region), hint);
      return {
        region: { x: region.x, y: region.y, w: region.w, h: region.h },
        source: region.source,
        changeType: c.changeType,
        description: c.description,
        confidence: c.confidence,
        usage: c.usage,
        cached: c.cached,
      };
    }),
  );
}

export async function runFullPipeline(
  provider: Provider,
  pair: PairRecord,
  dataDir: string,
  cache?: CacheStore,
  /** pass each region's DOM changedFields to the classifier as a text hint (default on) */
  useDomHint: boolean = true,
  maxRegions: number = MAX_REGIONS_TO_CLASSIFY,
): Promise<BaselineResult> {
  const before = await readFile(`${dataDir}/${pair.before}`);
  const after = await readFile(`${dataDir}/${pair.after}`);
  const detection: DetectionResult = detect(pair.domBefore, pair.domAfter, before, after);

  if (!detection.changed || detection.regions.length === 0) {
    return {
      pairId: pair.id,
      baseline: "fullPipeline",
      predictedChanged: false,
      predictedRegions: [],
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  const classifications = await classifyDetectedRegions(
    provider, cache, before, after, detection.regions, useDomHint, maxRegions,
  );

  if (classifications.length === 0) {
    // regions were detected but the caller capped classification at zero
    return {
      pairId: pair.id,
      baseline: "fullPipeline",
      predictedChanged: true,
      predictedRegions: detection.regions.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
      classifications: [],
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  // Pair-level type/description come from the largest region, keeping MVP
  // scoring comparable across runs; per-region detail rides along in
  // `classifications`.
  const primary = classifications[0];

  return {
    pairId: pair.id,
    baseline: "fullPipeline",
    predictedChanged: true,
    predictedRegions: detection.regions.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
    predictedChangeType: primary.changeType,
    description: primary.description,
    classifications,
    inputTokens: classifications.reduce((s, c) => s + c.usage.inputTokens, 0),
    outputTokens: classifications.reduce((s, c) => s + c.usage.outputTokens, 0),
    cached: cache ? classifications.every((c) => c.cached === true) : undefined,
  };
}
