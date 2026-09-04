// Shared SVG overlay builder: draws numbered region boxes over an image.
// Used by both the CLI visual report (visual-report.ts) and the eval HTML
// report (generate.ts). viewBox scales with the <img> so boxes always land
// on the right pixels regardless of the display size.

export interface OverlayRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 1-based index label shown in the box corner */
  index: number;
  severity?: "breaking" | "moderate" | "cosmetic";
}

const SEVERITY_STROKE: Record<string, string> = {
  breaking: "#dc2626",
  moderate: "#f59e0b",
  cosmetic: "#2563eb",
};

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

/**
 * Inline SVG (position:absolute over the <img>) drawing every region as a
 * translucent box with a numbered corner tag. Colors encode severity.
 */
export function regionOverlaySvg(regions: OverlayRegion[], imgW: number, imgH: number): string {
  if (regions.length === 0) return "";
  const boxes = regions
    .map((r) => {
      const stroke = SEVERITY_STROKE[r.severity ?? "cosmetic"] ?? "#2563eb";
      const tagW = 18;
      const tagH = 14;
      const tagX = r.x;
      const tagY = Math.max(0, r.y - tagH);
      return `
    <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${stroke}" fill-opacity="0.12" stroke="${stroke}" stroke-width="2"/>
    <rect x="${tagX}" y="${tagY}" width="${tagW}" height="${tagH}" fill="${stroke}"/>
    <text x="${tagX + tagW / 2}" y="${tagY + tagH - 4}" text-anchor="middle" font-family="monospace" font-size="10" fill="#fff">${r.index}</text>`;
    })
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${esc(String(imgW))} ${esc(String(imgH))}" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%">${boxes}
</svg>`;
}
