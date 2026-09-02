// Color naming for deterministic descriptions. Computed styles arrive as
// rgb()/rgba() strings (getComputedStyle output), occasionally hex from
// author CSS before serialization. Maps to a small anchor palette via
// perceptually-weighted RGB distance — no dependency, good enough to say
// "blue → red" in a description.

interface Rgb {
  r: number;
  g: number;
  b: number;
  a?: number;
}

const ANCHORS: Array<[string, Rgb]> = [
  ["black", { r: 0, g: 0, b: 0 }],
  ["white", { r: 255, g: 255, b: 255 }],
  ["gray", { r: 128, g: 128, b: 128 }],
  ["light gray", { r: 211, g: 211, b: 211 }],
  ["dark gray", { r: 70, g: 70, b: 70 }],
  ["red", { r: 220, g: 38, b: 38 }],
  ["dark red", { r: 153, g: 27, b: 27 }],
  ["orange", { r: 249, g: 115, b: 22 }],
  ["yellow", { r: 250, g: 204, b: 21 }],
  ["green", { r: 22, g: 163, b: 74 }],
  ["dark green", { r: 21, g: 94, b: 63 }],
  ["cyan", { r: 6, g: 182, b: 212 }],
  // CSS lightblue: without this anchor, Tailwind blue-300 (#93c5fd) was
  // nearer to "light gray" than to "blue" and got misnamed (found by the
  // judge human-calibration pass)
  ["light blue", { r: 173, g: 216, b: 230 }],
  ["blue", { r: 37, g: 99, b: 235 }],
  ["navy", { r: 30, g: 58, b: 138 }],
  ["purple", { r: 147, g: 51, b: 234 }],
  ["pink", { r: 236, g: 72, b: 153 }],
  ["brown", { r: 180, g: 83, b: 9 }],
];

/** Parse "rgb(37, 99, 235)", "rgba(0, 0, 0, 0.5)", "#2563eb", "#369" into RGB. */
export function parseColor(value: string): Rgb | undefined {
  const v = value.trim().toLowerCase();
  const rgbMatch = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/);
  if (rgbMatch) {
    return {
      r: Number(rgbMatch[1]),
      g: Number(rgbMatch[2]),
      b: Number(rgbMatch[3]),
      ...(rgbMatch[4] !== undefined ? { a: Number(rgbMatch[4]) } : {}),
    };
  }
  const hexMatch = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hexMatch) {
    const h = hexMatch[1];
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
    };
  }
  return undefined;
}

/** Weighted RGB distance — the standard cheap perceptual approximation. */
function colorDistance(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return 2 * dr * dr + 4 * dg * dg + 3 * db * db;
}

/**
 * Nearest anchor name for a color value, or undefined for non-colors
 * ("none", keywords like "transparent"). Fully transparent values
 * (alpha ≈ 0) also return undefined — "transparent → blue" is more
 * accurate than naming the faded channel values.
 */
export function colorName(value: string): string | undefined {
  const rgb = parseColor(value);
  if (!rgb) return undefined;
  if (rgb.a !== undefined && rgb.a < 0.05) return undefined;
  let best: string | undefined;
  let bestDist = Infinity;
  for (const [name, anchor] of ANCHORS) {
    const d = colorDistance(rgb, anchor);
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  return best;
}

/**
 * Human-readable rendering of a computed color value for a description:
 * "blue (rgb(37, 99, 235))", or the raw value when no name fits.
 */
export function describeColorValue(value: string): string {
  const name = colorName(value);
  return name ? `${name} (${value})` : value;
}
