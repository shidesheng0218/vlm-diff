// Media attachment: when a pixel-only region has no DOM signal of its own,
// attach it to the host media element (canvas / svg / img / video) it belongs
// to. The host's DOM node carries the id, the nearest heading, and the exact
// rect — so instead of cropping a bare pixel blob and asking the VLM "what
// changed in this 40×40 square", we crop the *element* and tell the VLM
// "the canvas chart under the heading 'Weekly builds' repainted".
//
// This is the fix for the known crop-context-loss failure mode: a bare pixel
// region has no reference frame, so the VLM can't tell a color change from a
// spatial shift from a new element. Attaching to the host element restores the
// frame AND collapses the pixel fragments of one canvas into a single call
// (a canvas repaint can scatter 6–10 pixel regions; the host is one element).

import type { DomNode } from "../detect/dom-diff.js";

/** A pixel region with no DOM signal of its own. */
export interface PixelRegionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MediaHost {
  /** the host element's bounding rect — the region to actually crop */
  rect: PixelRegionRect;
  tag: string;
  id?: string;
  /** nearest preceding heading text (context for the VLM) */
  nearestHeading?: string;
  /** the original pixel regions that merged into this host (for reporting) */
  mergedCount: number;
}

const MEDIA_TAGS = new Set(["CANVAS", "SVG", "IMG", "VIDEO", "IFRAME"]);

function rectsOverlap(a: PixelRegionRect, b: PixelRegionRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function overlapArea(a: PixelRegionRect, b: PixelRegionRect): number {
  const iw = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const ih = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return iw > 0 && ih > 0 ? iw * ih : 0;
}

/** Nearest heading (h1–h6) that appears before this node in document order. */
function nearestHeadingBefore(nodes: DomNode[], target: DomNode): string | undefined {
  const idx = nodes.indexOf(target);
  if (idx < 0) return undefined;
  for (let i = idx - 1; i >= 0; i--) {
    const n = nodes[i];
    if (/^H[1-6]$/.test(n.tag) && n.text.trim()) return n.text.trim();
  }
  return undefined;
}

/**
 * Attach pixel regions to their host media elements. Returns one MediaHost per
 * distinct host element, plus any pixel regions that didn't overlap any media
 * element (returned as host-less regions to be handled as before).
 */
export function attachToMedia(
  pixelRegions: PixelRegionRect[],
  domAfter: DomNode[],
): { hosts: MediaHost[]; orphans: PixelRegionRect[] } {
  const mediaNodes = domAfter.filter((n) => MEDIA_TAGS.has(n.tag));
  const hosts = new Map<DomNode, PixelRegionRect[]>();
  const orphans: PixelRegionRect[] = [];

  for (const pr of pixelRegions) {
    // the host is the media element with the largest overlap; on a tie, prefer
    // the smaller element (a small icon on a big canvas should attribute to the
    // icon, not the canvas)
    const host = mediaNodes
      .filter((m) => rectsOverlap(pr, m.rect))
      .sort((a, b) => {
        const overlapDiff = overlapArea(pr, b.rect) - overlapArea(pr, a.rect);
        if (overlapDiff !== 0) return overlapDiff;
        return a.rect.w * a.rect.h - b.rect.w * b.rect.h; // smaller element wins ties
      })[0];
    if (host) {
      const arr = hosts.get(host) ?? [];
      arr.push(pr);
      hosts.set(host, arr);
    } else {
      orphans.push(pr);
    }
  }

  const out: MediaHost[] = [];
  for (const [node, regions] of hosts) {
    out.push({
      rect: { x: node.rect.x, y: node.rect.y, w: node.rect.w, h: node.rect.h },
      tag: node.tag,
      ...(node.id ? { id: node.id } : {}),
      ...(nearestHeadingBefore(domAfter, node) ? { nearestHeading: nearestHeadingBefore(domAfter, node) } : {}),
      mergedCount: regions.length,
    });
  }
  return { hosts: out, orphans };
}

/**
 * Build the VLM hint text for an attached media host. The hint carries the
 * structural context the bare crop lacks: what kind of element this is and
 * where it sits on the page.
 */
export function mediaHintText(host: MediaHost): string {
  const kind =
    host.tag === "CANVAS" ? "canvas"
    : host.tag === "SVG" ? "SVG graphic"
    : host.tag === "IMG" ? "image"
    : host.tag === "VIDEO" ? "video"
    : "embedded frame";
  const idPart = host.id ? ` (#${host.id})` : "";
  const headingPart = host.nearestHeading ? `, under the heading "${host.nearestHeading}"` : "";
  const mergedPart = host.mergedCount > 1 ? ` (${host.mergedCount} pixel fragments of this one element)` : "";
  return `This region is a ${kind}${idPart}${headingPart}${mergedPart}. Its pixels changed but the DOM did not — classify what the visual change is.`;
}