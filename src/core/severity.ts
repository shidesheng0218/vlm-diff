// Deterministic severity classification — zero tokens, fully explainable.
// The point: a CI gate needs to know whether a change is worth blocking on,
// not just that something changed. Rules are deliberately simple and ordered
// (first match wins), computed from the change kind, geometry delta, and the
// change's before/after values.

import type { ChangeKind } from "../classify/vlm-classify.js";
import type { FieldChange, RectDelta } from "../detect/dom-diff.js";

export type Severity = "breaking" | "moderate" | "cosmetic";

const ORDER: Record<Severity, number> = { cosmetic: 0, moderate: 1, breaking: 2 };

export interface SeverityInput {
  changeType?: ChangeKind | string;
  /** region size in px */
  w: number;
  h: number;
  rectDelta?: RectDelta;
  values?: Record<string, FieldChange>;
}

/** numeric/currency-looking text ("$48,210", "12.4%", "1,234") — data, not copy */
const NUMERIC_RE = /^[$€£¥]?\s*-?[\d,]+(?:\.\d+)?\s*%?$/;

/** px of translation that counts as a deliberate layout move */
const LARGE_SHIFT_PX = 24;
/** relative size delta (per axis) that counts as a real resize */
const LARGE_RESIZE_FRACTION = 0.15;

export function severityOfRegion(input: SeverityInput): Severity {
  const { changeType, w, h, rectDelta, values } = input;

  // Structural lifecycle changes are always breaking: the page shape changed.
  if (changeType === "element-remove" || changeType === "element-add") return "breaking";

  // Data-bearing text changes (prices, counts, percentages) are breaking —
  // a wrong number is a wrong answer, not a cosmetic tweak.
  if (changeType === "text-change" && values?.text) {
    const { before, after } = values.text;
    if (NUMERIC_RE.test(before.trim()) || NUMERIC_RE.test(after.trim())) return "breaking";
    return "moderate";
  }

  if (changeType === "spatial-shift" && rectDelta) {
    return Math.abs(rectDelta.dx) + Math.abs(rectDelta.dy) >= LARGE_SHIFT_PX ? "moderate" : "cosmetic";
  }

  if (changeType === "size-change" && rectDelta) {
    const bw = Math.max(1, w - Math.abs(rectDelta.dw));
    const bh = Math.max(1, h - Math.abs(rectDelta.dh));
    const rel = Math.max(Math.abs(rectDelta.dw) / bw, Math.abs(rectDelta.dh) / bh);
    return rel >= LARGE_RESIZE_FRACTION ? "moderate" : "cosmetic";
  }

  // colors, style tweaks, misc: cosmetic by default
  return "cosmetic";
}

/** Pair-level severity = the most severe region's severity. */
export function pairSeverity(severities: Severity[]): Severity | undefined {
  if (severities.length === 0) return undefined;
  return severities.reduce((a, b) => (ORDER[b] > ORDER[a] ? b : a));
}
