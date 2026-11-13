// check 索引页 + JUnit 输出 — the collaboration surface for multi-page checks.
//
// Index page: when `vlm-diff check --report <dir>` writes one HTML per changed
// page, this writes dir/index.html so a human (or a PR comment link) lands on
// a summary, not a directory listing.
//
// JUnit: the same results emitted as JUnit XML so any CI (GitLab, Jenkins,
// CircleCI) that understands test reports can ingest a check run without a
// custom parser.

import type { PageCheckResult } from "../cli/baseline.js";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escapeXml(s: string): string {
  return escapeHtml(s).replace(/'/g, "&apos;");
}

const SEV_ORDER: Record<string, number> = { breaking: 0, moderate: 1, cosmetic: 2 };

/**
 * A self-contained index.html summarizing a multi-page check run.
 * Pure function of the results — no I/O, so it's trivially testable.
 */
export function generateCheckIndex(
  results: PageCheckResult[],
  opts: { reportDirName?: string; generatedAt?: string } = {},
): string {
  const changed = results.filter((r) => r.verdict?.changed);
  const errored = results.filter((r) => r.error);
  const clean = results.filter((r) => !r.error && !r.verdict?.changed);

  // most severe first, then clean pages
  const ranked = [...changed].sort((a, b) => {
    const sa = SEV_ORDER[a.verdict!.severity ?? "cosmetic"] ?? 3;
    const sb = SEV_ORDER[b.verdict!.severity ?? "cosmetic"] ?? 3;
    return sa - sb || a.name.localeCompare(b.name);
  });

  const rows = ranked.map((r) => {
    const v = r.verdict!;
    const sev = v.severity ?? "cosmetic";
    const link = `${encodeURIComponent(r.name)}.html`;
    return `
      <tr class="sev-${sev}">
        <td><span class="badge ${sev}">${sev}</span></td>
        <td><a href="${link}">${escapeHtml(r.name)}</a></td>
        <td>${escapeHtml(v.changeType ?? "changed")}</td>
        <td class="summary">${escapeHtml(v.summary ?? `${v.regions.length} region(s)`)}</td>
      </tr>`;
  });

  const cleanRows = clean.map((r) => `
      <tr class="clean"><td><span class="badge clean">clean</span></td><td>${escapeHtml(r.name)}</td><td colspan="2">no change</td></tr>`);

  const errRows = errored.map((r) => `
      <tr class="error"><td><span class="badge error">error</span></td><td>${escapeHtml(r.name)}</td><td colspan="2">${escapeHtml(r.error ?? "unknown")}</td></tr>`);

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>vlm-diff check report</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;margin:32px;color:#111827;max-width:1100px}
  h1{font-size:20px} .stats{display:flex;gap:12px;margin:16px 0 24px}
  .stat{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 18px}
  .stat b{font-size:22px;display:block}
  table{border-collapse:collapse;width:100%} th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px}
  .summary{color:#4b5563}
  .badge{padding:2px 10px;border-radius:10px;font-size:12px;font-weight:600}
  .badge.breaking{background:#fee2e2;color:#991b1b} .badge.moderate{background:#fef3c7;color:#92400e}
  .badge.cosmetic{background:#dbeafe;color:#1e40af} .badge.clean{background:#d1fae5;color:#065f46}
  .badge.error{background:#fee2e2;color:#7f1d1d}
  a{color:#2563eb;text-decoration:none} a:hover{text-decoration:underline}
</style></head><body>
<h1>vlm-diff check report</h1>
<div class="stats">
  <div class="stat"><b>${results.length}</b>pages</div>
  <div class="stat"><b>${changed.length}</b>changed</div>
  <div class="stat"><b>${clean.length}</b>clean</div>
  <div class="stat"><b>${errored.length}</b>errors</div>
</div>
<table>
  <thead><tr><th>severity</th><th>page</th><th>type</th><th>summary</th></tr></thead>
  <tbody>${rows.join("")}${errRows.join("")}${cleanRows.join("")}</tbody>
</table>
${opts.generatedAt ? `<p style="color:#9ca3af;font-size:12px;margin-top:24px">generated ${escapeHtml(opts.generatedAt)}</p>` : ""}
</body></html>`;
}

/**
 * JUnit XML: one testcase per page. Changed pages are failures (the CI gate
 * semantics), errors are errors, clean pages pass. This lets GitLab/Jenkins/
 * CircleCI render a check run with their built-in test-report UI.
 */
export function toJUnitXml(results: PageCheckResult[], suiteName = "vlm-diff check"): string {
  const tests = results.length;
  const failures = results.filter((r) => !r.error && r.verdict?.changed).length;
  const errors = results.filter((r) => r.error).length;

  const cases = results.map((r) => {
    if (r.error) {
      return `    <testcase name="${escapeXml(r.name)}" classname="vlm-diff"><error message="${escapeXml(r.error)}"/></testcase>`;
    }
    const v = r.verdict!;
    if (v.changed) {
      const msg = `${v.changeType ?? "changed"}${v.severity ? ` (${v.severity})` : ""}: ${v.summary ?? `${v.regions.length} region(s)`}`;
      return `    <testcase name="${escapeXml(r.name)}" classname="vlm-diff"><failure message="${escapeXml(msg)}"/></testcase>`;
    }
    return `    <testcase name="${escapeXml(r.name)}" classname="vlm-diff"/>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="${escapeXml(suiteName)}" tests="${tests}" failures="${failures}" errors="${errors}">
${cases.join("\n")}
</testsuite>`;
}