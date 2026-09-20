// Deterministic accessibility signals — a visual-regression first: WCAG
// contrast math over the DOM's computed colors, plus alt/aria removals.
// Pure functions, zero tokens, fully explainable. Visual-diff tools compare
// pixels; this compares what the change does to a screen reader / low-vision
// user, computed from values the DOM diff already carries.

import { parseColor } from "../describe/color.js";
import type { FieldChange } from "../detect/dom-diff.js";

export interface A11yNote {
  kind: "contrast" | "alt-removed" | "aria-label-removed";
  detail: string;
}

/** WCAG 2.1 relative luminance of an sRGB channel value. */
function channelLuminance(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  return 0.2126 * channelLuminance(rgb.r) + 0.7152 * channelLuminance(rgb.g) + 0.0722 * channelLuminance(rgb.b);
}

/** WCAG contrast ratio (1–21). */
export function contrastRatio(a: string, b: string): number | undefined {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return undefined;
  const l1 = relativeLuminance(ca);
  const l2 = relativeLuminance(cb);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG 2.1 AA thresholds: 4.5 for normal text, 3.0 for large text. */
export const CONTRAST_AA_NORMAL = 4.5;

/**
 * Assess a changed region for accessibility impact. Uses only values the DOM
 * diff already recorded. Conservative: contrast is only computed when BOTH
 * the text color and its background are known on both sides (both changed),
 * otherwise we don't guess.
 */
export function assessRegionA11y(
  changedFields: string[],
  values: Record<string, FieldChange>,
): A11yNote | undefined {
  // alt / aria-label removed entirely
  const alt = values["attr:alt"];
  if (alt && alt.before !== "" && alt.after === "") {
    return { kind: "alt-removed", detail: `alt text removed (was "${alt.before}")` };
  }
  const aria = values["attr:aria-label"];
  if (aria && aria.before !== "" && aria.after === "") {
    return { kind: "aria-label-removed", detail: `aria-label removed (was "${aria.before}")` };
  }

  // contrast: only when text color AND background both changed on both sides
  const color = values["color"];
  const bg = values["backgroundColor"];
  if (color && bg) {
    const beforeRatio = contrastRatio(color.before, bg.before);
    const afterRatio = contrastRatio(color.after, bg.after);
    if (beforeRatio !== undefined && afterRatio !== undefined && afterRatio < CONTRAST_AA_NORMAL && afterRatio < beforeRatio) {
      return {
        kind: "contrast",
        detail: `contrast dropped ${beforeRatio.toFixed(1)}:1 → ${afterRatio.toFixed(1)}:1 (below WCAG AA ${CONTRAST_AA_NORMAL}:1)`,
      };
    }
  }
  return undefined;
}
