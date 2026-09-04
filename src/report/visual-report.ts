// Self-contained HTML report for a single CLI diff run (`vlm-diff diff
// --report out.html`): before/after images side by side, the after frame
// annotated with numbered region boxes, and a card per region. Zero external
// assets (images inlined as base64) so the file is shareable as-is.

import { PNG } from "pngjs";
import type { DiffVerdict } from "../core/diff.js";
import { regionOverlaySvg } from "./overlay.js";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

const SEV_STYLE: Record<string, string> = {
  breaking: "background:#fee2e2;color:#991b1b;",
  moderate: "background:#fef3c7;color:#92400e;",
  cosmetic: "background:#dbeafe;color:#1e40af;",
};

export interface VisualReportInput {
  beforePng: Buffer;
  afterPng: Buffer;
  verdict: DiffVerdict;
  /** provider label for the footer, when a VLM was involved */
  provider?: { name: string; model: string };
  generatedAt?: string;
}

export function generateVisualReport(input: VisualReportInput): string {
  const { beforePng, afterPng, verdict } = input;
  const beforeDims = PNG.sync.read(beforePng);
  const afterDims = PNG.sync.read(afterPng);

  const overlayRegions = verdict.regions.map((r, i) => ({
    x: r.x, y: r.y, w: r.w, h: r.h, index: i + 1, severity: r.severity,
  }));
  const overlay = regionOverlaySvg(overlayRegions, afterDims.width, afterDims.height);

  const verdictBanner = verdict.changed
    ? `<div class="banner banner-changed">⚠ Change detected${verdict.severity ? ` · <span class="sev" style="${SEV_STYLE[verdict.severity]}">${verdict.severity}</span>` : ""}</div>`
    : `<div class="banner banner-clean">✓ No meaningful change</div>`;

  const regionCards = verdict.regions
    .map((r, i) => {
      const sevBadge = r.severity ? `<span class="sev" style="${SEV_STYLE[r.severity]}">${r.severity}</span>` : "";
      const routeBadge = r.route === "deterministic"
        ? `<span class="badge badge-det">deterministic · 0 tokens</span>`
        : `<span class="badge badge-vlm">vlm${r.changeType ? "" : " · pending"}</span>`;
      return `
      <div class="region-card">
        <div class="region-head"><span class="num" style="background:${SEV_STYLE[r.severity ?? "cosmetic"].match(/color:([^;]+)/)?.[1] ?? "#2563eb"}">${i + 1}</span>
          <strong>${esc(r.changeType ?? "pending")}</strong> ${sevBadge} ${routeBadge}</div>
        ${r.description ? `<div class="desc">${esc(r.description)}</div>` : ""}
        <div class="meta">(${r.x},${r.y}) ${r.w}×${r.h} · ${r.source}${r.confidence !== undefined ? ` · conf ${r.confidence.toFixed(2)}` : ""}${r.inputTokens + r.outputTokens > 0 ? ` · ${r.inputTokens}+${r.outputTokens} tok` : ""}</div>
      </div>`;
    })
    .join("\n");

  const pending = verdict.pendingEscalations > 0
    ? `<div class="note">⚠ ${verdict.pendingEscalations} region(s) need a VLM API key to finish classifying (exit code 3).</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>VLM-Diff Report</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f5f7; margin: 0; padding: 32px; color: #1a1a1a; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #666; font-size: 13px; margin-bottom: 16px; }
  .banner { padding: 12px 16px; border-radius: 10px; font-weight: 600; margin-bottom: 16px; }
  .banner-changed { background: #fff7ed; color: #9a3412; border: 1px solid #fed7aa; }
  .banner-clean { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
  .frames { display: flex; gap: 16px; margin-bottom: 20px; }
  .frame { flex: 1; background: white; border-radius: 10px; padding: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
  .frame figure { margin: 0; }
  .frame .imgwrap { position: relative; }
  .frame img { width: 100%; display: block; border-radius: 6px; }
  .frame figcaption { text-align: center; font-size: 11px; color: #888; margin-top: 6px; }
  .stats { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; }
  .stat { background: white; border-radius: 10px; padding: 10px 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08); font-size: 13px; }
  .stat b { display: block; font-size: 18px; }
  .region-card { background: white; border-radius: 10px; padding: 12px 14px; box-shadow: 0 1px 3px rgba(0,0,0,.08); margin-bottom: 10px; }
  .region-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .num { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 5px; color: #fff; font-size: 11px; font-weight: 700; }
  .sev { font-size: 11px; padding: 2px 8px; border-radius: 6px; font-weight: 700; }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 6px; font-weight: 600; }
  .badge-det { background: #dbeafe; color: #1e40af; }
  .badge-vlm { background: #fef3c7; color: #92400e; }
  .desc { font-size: 13px; margin: 2px 0; }
  .meta { font-size: 11px; color: #888; }
  .note { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; padding: 10px 14px; border-radius: 10px; margin-bottom: 16px; font-size: 13px; }
  footer { color: #999; font-size: 11px; margin-top: 24px; }
</style>
</head>
<body>
  <h1>VLM-Diff Report</h1>
  <div class="sub">${esc(input.generatedAt ?? new Date().toISOString())}${input.provider ? ` · ${esc(input.provider.name)}/${esc(input.provider.model)}` : ""} · ${verdict.visualOnly ? "visual-only (pixel-driven)" : "DOM + pixel tiered"}</div>
  ${verdictBanner}
  ${pending}
  <div class="frames">
    <div class="frame"><figure><div class="imgwrap"><img src="data:image/png;base64,${beforePng.toString("base64")}" /></div><figcaption>before</figcaption></figure></div>
    <div class="frame"><figure><div class="imgwrap"><img src="data:image/png;base64,${afterPng.toString("base64")}" />${overlay}</div><figcaption>after (regions annotated)</figcaption></figure></div>
  </div>
  <div class="stats">
    <div class="stat"><b>${verdict.regions.length}</b>regions</div>
    <div class="stat"><b>${(verdict.pixelChangedFraction * 100).toFixed(2)}%</b>pixel delta</div>
    <div class="stat"><b>${verdict.inputTokens}+${verdict.outputTokens}</b>tokens in+out</div>
    <div class="stat"><b>${verdict.regions.filter((r) => r.route === "deterministic").length}</b>deterministic</div>
    <div class="stat"><b>${verdict.regions.filter((r) => r.route === "vlm").length}</b>via VLM</div>
  </div>
  ${regionCards}
  <footer>Generated by vlm-diff · deterministic-first UI diffing</footer>
</body>
</html>`;
}
