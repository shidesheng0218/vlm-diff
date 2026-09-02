// Deterministic-first tiered descriptions. The DOM diff already knows most
// of the answer: a backgroundColor delta renders as "blue → red" from a
// template with zero VLM tokens. This module decides, per candidate region,
// whether the DOM evidence fully explains the change (Tier A: deterministic
// description) or the region has no DOM evidence at all (Tier B: escalate to
// VLM classification with a DOM hint).
//
// The only escalation trigger is a pixel-only region (no DOM signal — e.g. a
// canvas repaint). Geometry changes are always deterministic: a position
// delta renders as "moved 28px right" regardless of WHY it moved, and the
// batch describer uses root-cause attribution (does any sibling region carry
// a non-geometry change?) to word reflow followers differently from primary
// moves. On DOM-observable regressions this makes descriptions ~100%
// deterministic; the escalation path exists for the real-world cases the
// synthetic dataset doesn't contain.

import type { CandidateRegion } from "../detect/regions.js";
import type { ChangeKind } from "../classify/vlm-classify.js";
import { describeColorValue } from "./color.js";

export type Route = "deterministic" | "vlm";

export interface RegionDescription {
  route: Route;
  /** set only for deterministic descriptions (Tier A) */
  changeType?: ChangeKind;
  description?: string;
  /** deterministic descriptions are ground truth by construction */
  confidence?: number;
  /** for escalated regions: why the VLM is needed (for reports/debugging) */
  reason?: string;
  /**
   * true when this region carries the pair's non-geometry change (text,
   * color, style, lifecycle) or an unexplained pixel-only repaint; false for
   * geometry-only reflow followers. Pair-level type should prefer root causes.
   */
  rootCause?: boolean;
}

const GEOMETRY_FIELDS = new Set(["position", "size"]);

function isGeometryOnly(region: CandidateRegion): boolean {
  const fields = region.domChangedFields ?? [];
  return fields.length > 0 && fields.every((f) => GEOMETRY_FIELDS.has(f));
}

/**
 * Route one candidate region. Escalation is conservative by design: only
 * regions with no DOM evidence go to the VLM.
 */
export function routeRegion(region: CandidateRegion): Route {
  if (region.source === "pixel") {
    return "vlm"; // no DOM signal — nothing to describe deterministically
  }
  return "deterministic";
}

function idLabel(region: CandidateRegion): string {
  return region.domId ? ` (#${region.domId})` : "";
}

const FONT_WEIGHT_NAMES: Record<string, string> = {
  "100": "thin",
  "200": "extra-light",
  "300": "light",
  "400": "normal",
  "500": "medium",
  "600": "semibold",
  "700": "bold",
  "800": "extra-bold",
  "900": "black",
};

function fontWeightLabel(v: string): string {
  return FONT_WEIGHT_NAMES[v] ?? v;
}

function borderStylePart(border: string): string {
  // computed border looks like "2px solid rgb(37, 99, 235)"
  return border.replace(/rgba?\([^)]*\)/g, (m) => describeColorValue(m));
}

/** Signed direction words for a position delta. */
function movementText(dx: number, dy: number): string {
  const parts: string[] = [];
  if (Math.abs(dx) >= 1) parts.push(`${Math.abs(Math.round(dx))}px ${dx > 0 ? "right" : "left"}`);
  if (Math.abs(dy) >= 1) parts.push(`${Math.abs(Math.round(dy))}px ${dy > 0 ? "down" : "up"}`);
  return parts.length > 0 ? parts.join(", ") : "sub-pixel jitter";
}

function resizeText(d: { dx: number; dy: number; dw: number; dh: number }, afterW: number, afterH: number): string {
  const beforeW = afterW - d.dw;
  const beforeH = afterH - d.dh;
  const pct = beforeW > 0 ? Math.round((d.dw / beforeW) * 100) : null;
  const pctText = pct !== null ? ` (${pct >= 0 ? "+" : ""}${pct}%)` : "";
  return `resized by ${d.dw >= 0 ? "+" : ""}${Math.round(d.dw)}×${d.dh >= 0 ? "+" : ""}${Math.round(d.dh)}px${pctText} (from ${Math.round(beforeW)}×${Math.round(beforeH)})`;
}

const NUMERIC_RE = /^[$€£¥]?\s*-?[\d,]+(?:\.\d+)?\s*%?$/;

/** Combined move+resize regions need a type even though the dataset never
 *  produces them directly — pick the dominant magnitude. */
function dominantGeometryType(region: CandidateRegion): ChangeKind {
  const d = region.rectDelta;
  if (!d) return "other";
  const posMag = Math.abs(d.dx) + Math.abs(d.dy);
  const sizeMag = Math.abs(d.dw) + Math.abs(d.dh);
  return posMag >= sizeMag ? "spatial-shift" : "size-change";
}

/**
 * Tier A: generate the changeType + description purely from the DOM diff.
 * `rootCausePresent` marks pairs where another region carries the non-geometry
 * change (text/color/style/lifecycle/size) that explains this region's pure
 * position shift — a reflow follower rather than a deliberate move.
 */
function describeOne(region: CandidateRegion, rootCausePresent: boolean): RegionDescription {
  const fields = region.domChangedFields ?? [];
  const values = region.domValues ?? {};
  const label = idLabel(region);
  const rootCause = !isGeometryOnly(region);
  const reflowSuffix = rootCausePresent && isGeometryOnly(region)
    ? " as part of a layout shift caused by a nearby change"
    : "";

  // ── lifecycle ──
  if (fields.includes("added")) {
    const text = values.text?.after;
    return {
      route: "deterministic",
      rootCause,
      changeType: "element-add",
      description: `A new element${label} was added to the layout${text ? ` with text "${text}"` : ""}`,
      confidence: 1,
    };
  }
  if (fields.includes("removed")) {
    const text = values.text?.before;
    return {
      route: "deterministic",
      rootCause,
      changeType: "element-remove",
      description: `An element${label} was removed from the layout${text ? ` (previously "${text}")` : ""}`,
      confidence: 1,
    };
  }

  // ── text ──
  if (fields.includes("text") && values.text) {
    const { before, after } = values.text;
    const numeric = NUMERIC_RE.test(before.trim()) && NUMERIC_RE.test(after.trim());
    return {
      route: "deterministic",
      rootCause,
      changeType: "text-change",
      description: numeric
        ? `Value changed from "${before}" to "${after}"`
        : `Text changed from "${before}" to "${after}"`,
      confidence: 1,
    };
  }

  // ── colors ──
  const colorParts: string[] = [];
  if (fields.includes("backgroundColor") && values.backgroundColor) {
    colorParts.push(
      `background color changed from ${describeColorValue(values.backgroundColor.before)} to ${describeColorValue(values.backgroundColor.after)}`,
    );
  }
  if (fields.includes("color") && values.color) {
    colorParts.push(
      `text color changed from ${describeColorValue(values.color.before)} to ${describeColorValue(values.color.after)}`,
    );
  }
  if (fields.includes("border") && values.border) {
    colorParts.push(`border changed from "${borderStylePart(values.border.before)}" to "${borderStylePart(values.border.after)}"`);
  }
  if (colorParts.length > 0) {
    return {
      route: "deterministic",
      rootCause,
      changeType: "color-change",
      description: `Element${label} ${colorParts.join("; ")}`,
      confidence: 1,
    };
  }

  // ── style properties ──
  const styleParts: string[] = [];
  if (fields.includes("fontWeight") && values.fontWeight) {
    styleParts.push(
      `font weight changed from ${fontWeightLabel(values.fontWeight.before)} (${values.fontWeight.before}) to ${fontWeightLabel(values.fontWeight.after)} (${values.fontWeight.after})`,
    );
  }
  if (fields.includes("borderRadius") && values.borderRadius) {
    styleParts.push(`border radius changed from ${values.borderRadius.before} to ${values.borderRadius.after}`);
  }
  if (fields.includes("boxShadow") && values.boxShadow) {
    const { before, after } = values.boxShadow;
    if (before === "none" && after !== "none") styleParts.push(`box shadow added (${after})`);
    else if (after === "none") styleParts.push("box shadow removed");
    else styleParts.push("box shadow changed");
  }
  if (fields.includes("opacity") && values.opacity) {
    styleParts.push(`opacity changed from ${values.opacity.before} to ${values.opacity.after}`);
  }
  if (styleParts.length > 0) {
    return {
      route: "deterministic",
      rootCause,
      changeType: "style-change",
      description: `Element${label} ${styleParts.join("; ")}`,
      confidence: 1,
    };
  }

  // ── geometry ──
  const d = region.rectDelta;
  if (d) {
    const hasPosition = fields.includes("position");
    const hasSize = fields.includes("size");
    if (hasPosition && hasSize) {
      return {
        route: "deterministic",
        changeType: dominantGeometryType(region),
        description: `Element${label} moved ${movementText(d.dx, d.dy)} and ${resizeText(d, region.w, region.h)}${reflowSuffix}`,
        confidence: 1,
      };
    }
    if (hasPosition) {
      return {
        route: "deterministic",
        changeType: "spatial-shift",
        description: `Element${label} moved ${movementText(d.dx, d.dy)}${reflowSuffix}`,
        confidence: 1,
      };
    }
    if (hasSize) {
      return {
        route: "deterministic",
        changeType: "size-change",
        description: `Element${label} ${resizeText(d, region.w, region.h)}${reflowSuffix}`,
        confidence: 1,
      };
    }
  }

  // Unreachable for well-formed detector output; kept as a safe fallback so
  // an unexpected field combination degrades to the VLM instead of crashing.
  return { route: "vlm", reason: "no deterministic template matched the changed fields", rootCause: true };
}

/**
 * Single-region Tier A description without pair context (no reflow-follower
 * wording). Exported for tests and callers that already know the region is
 * deterministic; production code should prefer describeRegions().
 */
export function describeDeterministic(region: CandidateRegion): RegionDescription {
  return describeOne(region, false);
}

/**
 * Batch describer with root-cause attribution: a geometry-only region in a
 * pair that also contains a non-geometry change (text, color, style,
 * lifecycle) is worded as a reflow follower rather than a deliberate move.
 */
export function describeRegions(regions: CandidateRegion[]): RegionDescription[] {
  const rootCausePresent = regions.some((r) => r.source !== "pixel" && !isGeometryOnly(r));
  return regions.map((r) => describeOne(r, rootCausePresent));
}

/**
 * Route + describe one region. Standalone form of describeRegions for
 * single-region use; caller must handle the "vlm" route.
 */
export function describeRegion(region: CandidateRegion): RegionDescription {
  if (routeRegion(region) === "deterministic") {
    return describeRegions([region])[0];
  }
  return {
    route: "vlm",
    reason: escalationReason(region),
    // a pixel-only repaint has no DOM explanation — treat it as its own root cause
    rootCause: region.source === "pixel",
  };
}

function escalationReason(region: CandidateRegion): string {
  if (region.source === "pixel") return "pixel-only region: no DOM signal";
  return "no deterministic template matched";
}
