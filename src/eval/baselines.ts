// The three conditions being compared, per the plan's scientific core:
//   (a) rawPairToVlm    — full before/after images straight to the VLM, ask "what changed"
//   (b) pixelDiffOnly   — perceptual diff candidate regions, no DOM signal, no VLM
//   (c) fullPipeline    — DOM diff + pixel diff fusion (with no-change suppression) -> VLM classify

import { readFile } from "node:fs/promises";
import type { Provider } from "../provider/types.js";
import { imageBlock, textBlock } from "../provider/types.js";
import { detect, type DetectionResult } from "../detect/regions.js";
import { diffImages, groupRegions } from "../detect/perceptual-diff.js";
import { classifyRegion, classifyRegionCached, cropRegion } from "../classify/vlm-classify.js";
import type { ChangeKind, Classification, DomHint } from "../classify/vlm-classify.js";
import type { CacheStore } from "../cache/store.js";
import type { PairRecord } from "./types.js";
// re-exported for callers that only need the record shape from this module
export type { PairRecord };

export interface BaselineResult {
  pairId: string;
  baseline: "rawPairToVlm" | "pixelDiffOnly" | "fullPipeline";
  predictedChanged: boolean;
  predictedRegions: Array<{ x: number; y: number; w: number; h: number }>;
  predictedChangeType?: ChangeKind;
  description?: string;
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

export async function runFullPipeline(
  provider: Provider,
  pair: PairRecord,
  dataDir: string,
  cache?: CacheStore,
  /** pass the DOM diff's changedFields to the classifier as a text hint (default on) */
  useDomHint: boolean = true,
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

  // Classify the largest candidate region (the prototype scores one
  // classification per pair; multi-region pairs are out of scope here).
  const primary = detection.regions.reduce((a, b) => (a.w * a.h > b.w * b.h ? a : b));
  const beforeCrop = cropRegion(before, primary);
  const afterCrop = cropRegion(after, primary);
  const hint: DomHint | undefined =
    useDomHint && primary.domChangedFields && primary.domChangedFields.length > 0
      ? { fields: primary.domChangedFields, id: primary.domId }
      : undefined;
  const classification: Classification & { cached?: boolean } = cache
    ? await classifyRegionCached(provider, cache, beforeCrop, afterCrop, hint)
    : await classifyRegion(provider, beforeCrop, afterCrop, hint);

  return {
    pairId: pair.id,
    baseline: "fullPipeline",
    predictedChanged: true,
    predictedRegions: detection.regions.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
    predictedChangeType: classification.changeType,
    description: classification.description,
    inputTokens: classification.usage.inputTokens,
    outputTokens: classification.usage.outputTokens,
    cached: classification.cached,
  };
}
