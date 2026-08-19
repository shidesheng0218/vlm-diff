// VLM classification stage. Given a candidate region (from detect/regions.ts),
// crop before/after around it and ask the model to classify + describe the
// change. The model never sees the full image pair concatenated — per
// VLM-SubtleBench, that hurt 9/10 categories — and never does localization;
// that's the deterministic layer's job.

import type { Provider } from "../provider/types.js";
import { imageBlock, textBlock } from "../provider/types.js";
import type { CandidateRegion } from "../detect/regions.js";
import { PNG } from "pngjs";
import type { CacheStore } from "../cache/store.js";
import { computeCacheKey } from "../cache/key.js";

export type ChangeKind =
  | "spatial-shift"
  | "color-change"
  | "size-change"
  | "text-change"
  | "element-add"
  | "element-remove"
  | "style-change"
  | "other";

export interface Classification {
  changeType: ChangeKind;
  description: string;
  confidence: number;
  usage: { inputTokens: number; outputTokens: number };
}

const CROP_PADDING = 16;

/** Crop a region (with padding) out of a full-frame PNG buffer. */
export function cropRegion(pngBuffer: Buffer, region: CandidateRegion): Buffer {
  const src = PNG.sync.read(pngBuffer);
  const x = Math.max(0, region.x - CROP_PADDING);
  const y = Math.max(0, region.y - CROP_PADDING);
  const w = Math.min(src.width - x, region.w + 2 * CROP_PADDING);
  const h = Math.min(src.height - y, region.h + 2 * CROP_PADDING);

  const out = new PNG({ width: w, height: h });
  PNG.bitblt(src, out, x, y, w, h, 0, 0);
  return PNG.sync.write(out);
}

const SYSTEM_PROMPT = `You are comparing a cropped "before" region and the corresponding cropped "after" region from a UI screenshot. A deterministic detector has already localized this region as containing a change (or borderline noise) — your job is ONLY to classify the type of change and describe it, not to search the rest of the image.

Respond with strict JSON only, no markdown fences:
{"changeType": "spatial-shift" | "color-change" | "size-change" | "text-change" | "element-add" | "element-remove" | "style-change" | "other", "description": "<one sentence>", "confidence": <0-1>}`;

/**
 * Ground-truth evidence from the DOM diff, passed to the classifier as a
 * text hint. Motivation: the 2026-08-19 MVP showed crop-then-classify loses
 * the reference frame needed for type judgments (border-radius needs other
 * corners, color shift needs other swatches) — but the DOM diff already
 * knows which computed properties changed, and telling the model costs
 * ~20 tokens.
 */
export interface DomHint {
  /** computed-property names that changed, e.g. ["borderRadius"], ["color","backgroundColor"] */
  fields: string[];
  /** element id when known */
  id?: string;
}

export function buildSystemPrompt(hint?: DomHint): string {
  if (!hint || hint.fields.length === 0) return SYSTEM_PROMPT;
  const target = hint.id ? ` (element #${hint.id})` : "";
  return `${SYSTEM_PROMPT}

Additional evidence from the deterministic DOM diff: the element in this region${target} changed these computed properties: ${hint.fields.join(", ")}. Treat this as a strong prior for changeType — the visual difference in the crop may be too subtle to see, but the DOM-level change is ground truth, not a guess.`;
}

export async function classifyRegion(
  provider: Provider,
  beforeCrop: Buffer,
  afterCrop: Buffer,
  hint?: DomHint,
): Promise<Classification> {
  const result = await provider.send(buildSystemPrompt(hint), [
    {
      role: "user",
      content: [
        textBlock("Before region:"),
        imageBlock(beforeCrop.toString("base64"), "image/png"),
        textBlock("After region:"),
        imageBlock(afterCrop.toString("base64"), "image/png"),
      ],
    },
  ]);

  return { ...parseClassification(result.text), usage: result.usage };
}

/**
 * classifyRegion wrapped with a content-addressed cache: identical
 * before/after crop pixels skip the VLM call entirely and return the
 * previously stored classification with zero token usage.
 */
export async function classifyRegionCached(
  provider: Provider,
  cache: CacheStore,
  beforeCrop: Buffer,
  afterCrop: Buffer,
  hint?: DomHint,
): Promise<Classification & { cached: boolean }> {
  const key = computeCacheKey(beforeCrop, afterCrop, hint ? JSON.stringify(hint) : undefined);
  const hit = await cache.get(key);
  if (hit) {
    return { ...hit.classification, usage: { inputTokens: 0, outputTokens: 0 }, cached: true };
  }

  const result = await classifyRegion(provider, beforeCrop, afterCrop, hint);
  await cache.set(key, { classification: result, cachedAt: new Date().toISOString() });
  return { ...result, cached: false };
}

export function parseClassification(text: string): Omit<Classification, "usage"> {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    return {
      changeType: parsed.changeType ?? "other",
      description: parsed.description ?? "",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    };
  } catch {
    return { changeType: "other", description: text.trim(), confidence: 0 };
  }
}
