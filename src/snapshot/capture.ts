// DOM snapshot capture, shared by dataset generation, the CLI `snapshot`
// command, and the MCP server. The snapshot shape (a plain JSON array of
// DomNodes) is the contract consumed by src/detect/dom-diff.ts.
//
// The capture body is a plain-JS string expression (not a function literal):
// tsx/esbuild inject a `__name` helper into function expressions that does
// not exist inside the browser page context.

import type { Page } from "playwright";

const SNAPSHOT_EXPRESSION = `(() => {
  const nodes = [];

  function pathFor(el, root) {
    const parts = [];
    let cur = el;
    while (cur && cur !== root) {
      const parent = cur.parentElement;
      const idx = parent ? Array.from(parent.children).indexOf(cur) : 0;
      parts.unshift(cur.tagName + ":" + idx);
      cur = parent;
    }
    return parts.join(">");
  }

  const root = document.body;
  root.querySelectorAll("*").forEach((el) => {
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    // SVG elements expose className as an SVGAnimatedString, not a string
    const cn = el.className;
    nodes.push({
      path: pathFor(el, root),
      tag: el.tagName,
      id: el.id,
      className: typeof cn === "string" ? cn : ((cn && cn.baseVal) || ""),
      text:
        el.tagName === "INPUT" || el.tagName === "TEXTAREA"
          ? el.value
          : el.children.length === 0
            ? (el.textContent || "").trim()
            : "",
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
      style: {
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        fontWeight: cs.fontWeight,
        borderRadius: cs.borderRadius,
        opacity: cs.opacity,
        boxShadow: cs.boxShadow,
        border: cs.border,
      },
    });
  });
  return JSON.stringify(nodes);
})()`;

/**
 * Serialize tag/id/class/rect/computed-style for every element under <body>.
 * Rects are viewport-relative and rounded to whole pixels (the detector's
 * tolerance absorbs the jitter).
 */
export async function snapshotDom(page: Page): Promise<string> {
  return page.evaluate(SNAPSHOT_EXPRESSION);
}
