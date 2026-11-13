#!/usr/bin/env node
// VLM-Diff MCP server — gives coding agents a visual-regression sense.
//
// Tools:
//   diff_screenshots  diff two screenshots (optionally with DOM snapshots)
//                     through the tiered pipeline and return descriptions
//   snapshot_url      capture a DOM snapshot + screenshot of a URL for later diffing
//
// Wire it up (Claude Code):
//   claude mcp add vlm-diff -- node /path/to/dist/mcp/server.js
// or any MCP-compatible client over stdio.

import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { diffPair, type DiffVerdict } from "../core/diff.js";
import { createProvider, PRESETS } from "../provider/factory.js";
import { FileCacheStore } from "../cache/store.js";
import { loadDotEnv } from "../cli/env.js";
import { annotatePng } from "../report/overlay-png.js";
import { existingBaselinePages, runBaseline, runCheck } from "../cli/baseline.js";
import { runAudit } from "../cli/audit.js";
import { runWhy } from "../cli/why.js";
import type { ParsedArgs } from "../cli/args.js";

function formatVerdict(verdict: DiffVerdict): string {
  const lines: string[] = [];
  lines.push(verdict.changed ? "CHANGE DETECTED" : "No meaningful change");
  lines.push(
    `mode: ${verdict.visualOnly ? "visual-only (pixel-driven)" : "DOM + pixel (tiered)"} · ` +
      `pixel delta: ${(verdict.pixelChangedFraction * 100).toFixed(2)}% (${verdict.pixelChangedCount}px)`,
  );
  if (verdict.summary) lines.push(`summary: ${verdict.summary}`);
  if (verdict.changeType) lines.push(`change type: ${verdict.changeType}`);
  if (verdict.severity) lines.push(`severity: ${verdict.severity}`);
  verdict.regions.forEach((r, i) => {
    const pending = r.route === "vlm" && !r.changeType ? " [pending VLM]" : "";
    const sev = r.severity ? ` · ${r.severity}` : "";
    lines.push(`${i + 1}. (${r.x},${r.y} ${r.w}×${r.h}) [${r.source} → ${r.route}] ${r.changeType ?? "?"}${sev}${pending}`);
    if (r.description) lines.push(`   ${r.description}`);
    const fields = r.evidence?.domChangedFields;
    if (fields && fields.length > 0) {
      lines.push(`   evidence: DOM ${fields.join(", ")}`);
    } else if (r.evidence?.escalationReason) {
      lines.push(`   evidence: ${r.evidence.escalationReason}`);
    }
    if (r.a11yImpact) lines.push(`   a11y impact: ${r.a11yImpact}`);
  });
  if (verdict.pendingEscalations > 0) {
    lines.push(`note: ${verdict.pendingEscalations} region(s) need a VLM — set an API key for the server to resolve them`);
  }
  lines.push("", "machine-readable:", JSON.stringify(verdict));
  return lines.join("\n");
}

function tryProvider(providerName?: string, modelName?: string) {
  try {
    // the MCP server's VLM calls are the same high-volume per-region
    // classification as the CLI's — route them through the cheap tier too
    return createProvider({ provider: providerName, model: modelName, tier: "cheap" });
  } catch {
    return undefined; // no key configured — escalated regions stay pending
  }
}

const verdictOutputShape = {
  changed: z.boolean(),
  visualOnly: z.boolean(),
  pixelChangedCount: z.number(),
  pixelChangedFraction: z.number(),
  changeType: z.string().optional(),
  summary: z.string().optional(),
  severity: z.string().optional(),
  pendingEscalations: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
};

async function main() {
  loadDotEnv();
  // version comes from package.json at runtime — a hardcoded string drifted
  // behind the real release before (0.5.0 vs 0.5.1)
  const pkg = createRequire(import.meta.url)("../../package.json") as { version: string };
  const server = new McpServer({ name: "vlm-diff", version: pkg.version });

  server.registerTool(
    "diff_screenshots",
    {
      title: "Diff two UI screenshots",
      description:
        "Diff two UI screenshots with deterministic-first visual regression analysis. " +
        "Regions explained by DOM snapshots are described at zero VLM cost; pixel-only " +
        "deltas (canvas repaints, image swaps) escalate to a VLM when an API key is configured. " +
        "Returns a text summary, the structured verdict (change type, severity, per-region " +
        "descriptions with DOM evidence), and the after frame annotated with numbered " +
        "severity-colored region boxes.",
      inputSchema: {
        before: z.string().describe("absolute path to the before PNG"),
        after: z.string().describe("absolute path to the after PNG"),
        dom_before: z.string().optional().describe("absolute path to the before DOM snapshot JSON (from snapshot_url)"),
        dom_after: z.string().optional().describe("absolute path to the after DOM snapshot JSON (from snapshot_url)"),
        provider: z.enum(Object.keys(PRESETS) as [string, ...string[]]).optional().describe("VLM provider override"),
        model: z.string().optional().describe("model id override"),
        include_images: z.boolean().optional().describe("return annotated frames as image blocks (default true)"),
      },
      outputSchema: verdictOutputShape,
    },
    async ({ before, after, dom_before, dom_after, provider, model, include_images }) => {
      const [beforePng, afterPng] = await Promise.all([readFile(before), readFile(after)]);
      const [domBeforeJson, domAfterJson] = await Promise.all([
        dom_before ? readFile(dom_before, "utf8") : Promise.resolve(undefined),
        dom_after ? readFile(dom_after, "utf8") : Promise.resolve(undefined),
      ]);
      const verdict = await diffPair(beforePng, afterPng, domBeforeJson, domAfterJson, {
        provider: tryProvider(provider, model),
        cache: new FileCacheStore(".cache/classifications"),
      });

      const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [
        { type: "text", text: formatVerdict(verdict) },
      ];
      if (include_images !== false) {
        // annotated after frame: the agent can SEE where the regions are
        const annotated = annotatePng(
          afterPng,
          verdict.regions.map((r, i) => ({ x: r.x, y: r.y, w: r.w, h: r.h, index: i + 1, severity: r.severity })),
        );
        content.push(
          { type: "image", data: annotated.toString("base64"), mimeType: "image/png" },
          { type: "image", data: beforePng.toString("base64"), mimeType: "image/png" },
        );
      }
      return { content, structuredContent: { ...verdict } };
    },
  );

  server.registerTool(
    "snapshot_url",
    {
      title: "Capture a DOM snapshot + screenshot of a URL",
      description:
        "Capture a DOM snapshot (JSON) and a screenshot (PNG) of a URL with headless Chromium. " +
        "Capture before and after a change, then pass both to diff_screenshots. " +
        "Returns the file paths to use for diffing plus the screenshot itself.",
      inputSchema: {
        url: z.string().describe("http(s):// URL or a local file path to render"),
        width: z.number().optional().describe("viewport width (default 960)"),
        height: z.number().optional().describe("viewport height (default 500)"),
        wait_ms: z.number().optional().describe("settle time before capture in ms (default 100)"),
      },
    },
    async ({ url, width, height, wait_ms }) => {
      const { chromium } = await import("playwright");
      const { snapshotDom } = await import("../snapshot/capture.js");
      const { writeFile } = await import("node:fs/promises");

      const target =
        url.startsWith("http://") || url.startsWith("https://") || url.startsWith("file://")
          ? url
          : `file://${url.startsWith("/") ? url : `${process.cwd()}/${url}`}`;

      const id = randomUUID().slice(0, 8);
      const domPath = join(tmpdir(), `vlm-diff-snapshot-${id}.dom.json`);
      const pngPath = join(tmpdir(), `vlm-diff-snapshot-${id}.png`);

      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({ viewport: { width: width ?? 960, height: height ?? 500 } });
        await page.goto(target, { waitUntil: "load", timeout: 30000 });
        await page.waitForTimeout(wait_ms ?? 100);
        const dom = await snapshotDom(page);
        const png = await page.screenshot();
        await writeFile(domPath, dom);
        await writeFile(pngPath, png);
        const elementCount = JSON.parse(dom).length;
        return {
          content: [
            {
              type: "text",
              text: `snapshot captured (${elementCount} DOM elements)\ndom_snapshot: ${domPath}\nscreenshot: ${pngPath}\n\nPass these paths to diff_screenshots (dom_before/dom_after + before/after).`,
            },
            { type: "image", data: (png as Buffer).toString("base64"), mimeType: "image/png" },
          ],
        };
      } finally {
        await browser.close();
      }
    },
  );

  // ── baseline_check: diff configured pages against the stored baseline ──────
  // The agent-facing "did my change break this page" call. Fails soft with a
  // next-step hint when no baseline exists yet (see baseline_seed).
  server.registerTool(
    "baseline_check",
    {
      title: "Diff pages against the stored baseline",
      description:
        "Re-capture the configured pages and diff each against its baseline. " +
        "Use `pages` to check only the page(s) you just changed. " +
        "If no baseline exists yet, call baseline_seed first.",
      inputSchema: {
        root: z.string().optional().describe("project root containing .vlm-diff/ (default: cwd)"),
        pages: z.array(z.string()).optional().describe("only check these page names (default: all)"),
        no_vlm: z.boolean().optional().describe("skip VLM escalation (default false)"),
      },
    },
    async ({ root, pages, no_vlm }) => {
      const projectRoot = root ?? process.cwd();
      const existing = await existingBaselinePages(projectRoot);
      if (existing.length === 0) {
        return {
          content: [{
            type: "text",
            text: "No baseline found. Call baseline_seed first to capture the current state as the golden reference, then re-run baseline_check.",
          }],
        };
      }

      const results = await runCheck(projectRoot, {
        provider: no_vlm ? undefined : tryProvider(),
        noVlm: no_vlm,
      });

      const filtered = pages?.length
        ? results.filter((r) => pages.includes(r.name) || pages.some((p) => r.name.startsWith(`${p}@`)))
        : results;

      const lines: string[] = [`baseline check: ${filtered.length} page(s)`];
      for (const r of filtered) {
        if (r.error) {
          lines.push(`  ✗ ${r.name}: error — ${r.error}`);
        } else if (r.verdict) {
          const v = r.verdict;
          const mark = v.changed ? "⚠️ " : "✓ ";
          lines.push(
            `  ${mark}${r.name}: ${v.changed ? `CHANGED (${v.changeType ?? "?"}${v.severity ? `, ${v.severity}` : ""})` : "unchanged"}` +
              (v.summary ? ` — ${v.summary}` : ""),
          );
        }
      }
      const changed = filtered.filter((r) => r.verdict?.changed).length;
      lines.push(`\n${changed} of ${filtered.length} page(s) changed.`);
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: {
          pages: filtered.map((r) => ({
            name: r.name, url: r.url, changed: r.verdict?.changed ?? null,
            changeType: r.verdict?.changeType ?? null, severity: r.verdict?.severity ?? null,
            summary: r.verdict?.summary ?? null, error: r.error ?? null,
          })),
        },
      };
    },
  );

  // ── baseline_seed: capture the current state as the golden baseline ────────
  server.registerTool(
    "baseline_seed",
    {
      title: "Capture current pages as the golden baseline",
      description:
        "Snapshot every configured page into .vlm-diff/baseline/. " +
        "Run once to establish the golden reference; baseline_check compares against it. " +
        "Overwrites an existing baseline only when force=true.",
      inputSchema: {
        root: z.string().optional().describe("project root containing .vlm-diff/ (default: cwd)"),
        force: z.boolean().optional().describe("overwrite an existing baseline (default false)"),
      },
    },
    async ({ root, force }) => {
      const projectRoot = root ?? process.cwd();
      const existing = await existingBaselinePages(projectRoot);
      if (existing.length > 0 && !force) {
        return {
          content: [{
            type: "text",
            text: `Baseline already exists (${existing.length} page(s): ${existing.join(", ")}). Call again with force=true to overwrite.`,
          }],
        };
      }
      const { pages, skipped } = await runBaseline(projectRoot, { force: force ?? false });
      return {
        content: [{
          type: "text",
          text: skipped
            ? "Baseline skipped (already exists; pass force=true to overwrite)."
            : `Baseline seeded: ${pages.length} page(s) captured (${pages.map((p) => p.name).join(", ")}). Run baseline_check after making changes.`,
        }],
        structuredContent: { seeded: !skipped, pages: pages.map((p) => p.name) },
      };
    },
  );

  // ── audit_url: zero-baseline layout + a11y check on a single page ──────────
  server.registerTool(
    "audit_url",
    {
      title: "Zero-baseline layout + accessibility audit",
      description:
        "Check a URL for layout defects (clipped content, collapsed elements, " +
        "unreachable/undersized controls) and accessibility issues — no baseline, " +
        "no prior run, no API key needed. Returns findings with severity.",
      inputSchema: {
        url: z.string().describe("http(s):// URL or local file path"),
        width: z.number().optional().describe("viewport width (default 1280)"),
        height: z.number().optional().describe("viewport height (default 800)"),
      },
    },
    async ({ url, width, height }) => {
      // runAudit is a CLI entry (ParsedArgs → console.log + exit code); build
      // the args shape it expects and capture stdout via a temp swap.
      const args: ParsedArgs = {
        positional: [],
        flags: new Map<string, string | boolean>([
          ["url", url],
          ["json", true],
          ...(width ? [["width", String(width)] as const] : []),
          ...(height ? [["height", String(height)] as const] : []),
        ]),
      };
      const logs: string[] = [];
      const orig = console.log;
      console.log = (...a: unknown[]) => logs.push(a.map(String).join(" "));
      try {
        await runAudit(args);
      } finally {
        console.log = orig;
      }
      const parsed = logs.length ? JSON.parse(logs[logs.length - 1]) : null;
      const findings = parsed?.findings ?? [];
      const lines = [
        findings.length === 0
          ? `✅ audit clean — ${url}`
          : `⚠️ ${findings.length} finding(s) in ${url}`,
        ...findings.slice(0, 12).map((f: any) => `  ${f.severity}  ${f.selector}  ${f.message}`),
      ];
      if (parsed?.diagnostics) {
        const d = parsed.diagnostics.summary;
        if (d.pageErrors + d.consoleErrors + d.failedRequests > 0) {
          lines.push(`diagnostics: ${d.pageErrors} exceptions, ${d.consoleErrors} console errors, ${d.failedRequests} failed requests`);
        }
      }
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: parsed,
      };
    },
  );

  // ── why_url: CSS cause attribution for a changed property ──────────────────
  server.registerTool(
    "why_url",
    {
      title: "Explain which CSS rule wins for an element property",
      description:
        "For a live page + element + CSS property, report which rule wins, its " +
        "specificity, and the losing contenders — 'diff says what changed, why says " +
        "which rule to edit'. Zero tokens, runs against the live page.",
      inputSchema: {
        url: z.string().describe("http(s):// URL or local file path"),
        selector: z.string().describe("CSS selector of the element"),
        property: z.string().describe("CSS property, kebab-case (e.g. background-color)"),
      },
    },
    async ({ url, selector, property }) => {
      const args: ParsedArgs = {
        positional: [url],
        flags: new Map<string, string | boolean>([["selector", selector], ["property", property], ["json", true]]),
      };
      const logs: string[] = [];
      const orig = console.log;
      console.log = (...a: unknown[]) => logs.push(a.map(String).join(" "));
      try {
        await runWhy(args);
      } finally {
        console.log = orig;
      }
      const parsed = logs.length ? JSON.parse(logs[logs.length - 1]) : null;
      const c = parsed?.cause;
      const text = c
        ? `${selector} · ${property} = ${parsed.computedValue}\nwinning rule: ${c.winning} ${c.specificity} → ${c.declaration}` +
          (c.flip ? `\nflip: ${c.flip}` : "") +
          (c.contenders?.length ? `\noverrode: ${c.contenders.map((x: any) => `${x.selector} (${x.declaration})`).join(", ")}` : "")
        : `${selector} · ${property}: no matching rule found (inline style or UA default)`;
      return {
        content: [{ type: "text", text }],
        structuredContent: parsed,
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[vlm-diff] MCP server running on stdio");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
