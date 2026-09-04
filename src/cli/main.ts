#!/usr/bin/env node
// vlm-diff CLI — diff any two screenshots with the tiered pipeline.
//
//   vlm-diff diff before.png after.png [--dom-before b.json --dom-after a.json] [options]
//   vlm-diff snapshot <url> --out-dom a.json [--out-png shot.png]
//
// Exit codes for `diff`: 0 = no change, 1 = change detected, 2 = error.

import { readFile } from "node:fs/promises";
import { loadDotEnv } from "./env.js";
import { parseArgs, type ParsedArgs } from "./args.js";
import { diffPair, type DiffVerdict } from "../core/diff.js";
import { createProvider, PRESETS } from "../provider/factory.js";
import { FileCacheStore } from "../cache/store.js";
import { cacheDir, findProjectRoot } from "./project.js";
import { runInit, runBaseline, runCheck, checkExitCode } from "./baseline.js";

function usage(): string {
  return `vlm-diff — deterministic-first UI screenshot diffing

Usage:
  vlm-diff diff <before.png> <after.png> [options]
  vlm-diff snapshot <url-or-file> --out-dom <file.json> [--out-png <file.png>] [options]
  vlm-diff init [url]       create .vlm-diff/config.json (optionally seeded with a page)
  vlm-diff baseline         snapshot every configured page into .vlm-diff/baseline/
  vlm-diff check            re-capture pages and diff against the baseline

diff options:
  --dom-before <file>     JSON DOM snapshot of the before frame (from \`vlm-diff snapshot\`)
  --dom-after <file>      JSON DOM snapshot of the after frame
  --provider <name>       ${Object.keys(PRESETS).join(" | ")} (default: auto-detect from API keys)
  --model <id>            model id override (default: provider preset)
  --threshold <fraction>  pixel-only escalation threshold, fraction of frame (default 0.002)
  --max-regions <n>       cap on regions to describe/classify (default 8)
  --no-cache              skip the classification cache (.cache/classifications)
  --no-vlm                detection only: never call a VLM API
  --json                  machine-readable single-line JSON output
  --report <file.html>    write a self-contained HTML report with annotated regions

snapshot options:
  --out-dom <file>        write the DOM snapshot JSON here (required)
  --out-png <file>        also save a full-page screenshot
  --width <px>            viewport width (default 960)
  --height <px>           viewport height (default 500)
  --wait-ms <ms>          settle time before capture (default 100)

Without DOM snapshots, diff degrades to pixel-only mode: significant pixel
deltas are escalated to the VLM. API keys are read from the environment or
a local .env file (ANTHROPIC_API_KEY, OPENAI_API_KEY, MOONSHOT_API_KEY,
DASHSCOPE_API_KEY, OPENCODE_API_KEY).

Exit codes (diff): 0 = no change, 1 = change detected, 2 = error,
  3 = change detected but needs a VLM API key to finish classifying.`;
}

async function runDiff(args: ParsedArgs): Promise<number> {
  const [beforePath, afterPath] = args.positional;
  if (!beforePath || !afterPath) {
    console.error("error: diff needs <before.png> <after.png>\n\n" + usage());
    return 2;
  }

  const json = args.flags.get("json") === true;
  const noVlm = args.flags.get("no-vlm") === true;
  const reportPath = args.flags.get("report");
  const beforePng = await readFile(beforePath);
  const afterPng = await readFile(afterPath);

  const domBefore = args.flags.get("dom-before");
  const domAfter = args.flags.get("dom-after");
  const domBeforeJson = typeof domBefore === "string" ? await readFile(domBefore, "utf8") : undefined;
  const domAfterJson = typeof domAfter === "string" ? await readFile(domAfter, "utf8") : undefined;

  const threshold = args.flags.get("threshold");
  const maxRegions = args.flags.get("max-regions");

  const verdict = await diffPair(beforePng, afterPng, domBeforeJson, domAfterJson, {
    pixelOnlyThreshold: typeof threshold === "string" ? Number(threshold) : undefined,
    maxRegions: typeof maxRegions === "string" ? Number(maxRegions) : undefined,
    cache: args.flags.get("no-cache") === true ? undefined : new FileCacheStore(cacheDir()),
    provider: noVlm ? undefined : tryCreateProvider(args, json),
  });

  if (typeof reportPath === "string") {
    const { generateVisualReport } = await import("../report/visual-report.js");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(reportPath, generateVisualReport({ beforePng, afterPng, verdict }));
    if (!json) console.log(`\n📄 report written to ${reportPath}`);
  }

  if (json) {
    console.log(JSON.stringify({ before: beforePath, after: afterPath, ...verdict }));
  } else {
    printHuman(verdict, Boolean(domBeforeJson && domAfterJson));
  }

  if (verdict.pendingEscalations > 0) {
    if (!json) {
      console.error(
        `\nnote: ${verdict.pendingEscalations} region(s) need VLM classification — set an API key (or pass --provider) to resolve them.`,
      );
    }
    // distinct exit code: a diff that *worked* but needs a key is not an error
    return 3;
  }
  return verdict.changed ? 1 : 0;
}

function tryCreateProvider(args: ParsedArgs, json: boolean) {
  try {
    const provider = args.flags.get("provider");
    const model = args.flags.get("model");
    return createProvider({
      provider: typeof provider === "string" ? provider : undefined,
      model: typeof model === "string" ? model : undefined,
    });
  } catch (err) {
    if (!json) console.error(`note: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

function printHuman(v: DiffVerdict, hadDom: boolean) {
  console.log(v.changed ? "⚠️  CHANGE DETECTED" : "✅ No meaningful change");
  console.log(
    `   mode: ${hadDom ? "DOM + pixel (tiered)" : "pixel-only"}${v.visualOnly ? ", visual-only delta" : ""} · ` +
      `pixel delta: ${(v.pixelChangedFraction * 100).toFixed(2)}% (${v.pixelChangedCount}px)`,
  );
  if (v.summary) console.log(`   summary: ${v.summary}`);
  if (v.changeType) console.log(`   type: ${v.changeType}`);
  if (v.severity) console.log(`   severity: ${v.severity}${v.severity === "breaking" ? " ⛔" : ""}`);
  v.regions.forEach((r, i) => {
    const tokens = r.inputTokens + r.outputTokens > 0 ? ` · ${r.inputTokens}+${r.outputTokens} tok` : "";
    const pending = r.route === "vlm" && !r.changeType ? " · pending VLM" : "";
    const sev = r.severity && r.severity !== "cosmetic" ? ` · ${r.severity}` : "";
    console.log(
      `   ${i + 1}. [${r.source} → ${r.route}] (${r.x},${r.y} ${r.w}×${r.h}) ` +
        `${r.changeType ?? "?"}${sev}${tokens}${pending}`,
    );
    if (r.description) console.log(`      ${r.description}`);
  });
  if (v.inputTokens + v.outputTokens > 0) {
    console.log(`   tokens: ${v.inputTokens} in / ${v.outputTokens} out`);
  }
}

async function runSnapshot(args: ParsedArgs): Promise<number> {
  const [target] = args.positional;
  const outDom = args.flags.get("out-dom");
  if (!target || typeof outDom !== "string") {
    console.error("error: snapshot needs <url> and --out-dom <file>\n\n" + usage());
    return 2;
  }

  const width = Number(args.flags.get("width") ?? 960);
  const height = Number(args.flags.get("height") ?? 500);
  const waitMs = Number(args.flags.get("wait-ms") ?? 100);
  const outPng = args.flags.get("out-png");

  const { chromium } = await import("playwright");
  const { snapshotDom } = await import("../snapshot/capture.js");
  const { writeFile } = await import("node:fs/promises");

  const url = target.startsWith("http://") || target.startsWith("https://") || target.startsWith("file://")
    ? target
    : `file://${target.startsWith("/") ? target : `${process.cwd()}/${target}`}`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(waitMs);
    const dom = await snapshotDom(page);
    await writeFile(outDom, dom);
    console.log(`DOM snapshot: ${outDom} (${JSON.parse(dom).length} elements)`);
    if (typeof outPng === "string") {
      await page.screenshot({ path: outPng });
      console.log(`Screenshot:   ${outPng}`);
    }
    return 0;
  } finally {
    await browser.close();
  }
}

async function runInitCmd(args: ParsedArgs): Promise<number> {
  const seedUrl = args.positional[0];
  const msg = await runInit(process.cwd(), seedUrl);
  console.log(msg);
  console.log("next: vlm-diff baseline   (snapshot the configured pages)");
  return 0;
}

async function runBaselineCmd(): Promise<number> {
  const root = findProjectRoot();
  const pages = await runBaseline(root);
  console.log(`baseline written: ${pages.length} page(s) → ${root}/.vlm-diff/baseline/`);
  for (const p of pages) console.log(`  ${p.name}: ${p.url}`);
  return 0;
}

async function runCheckCmd(args: ParsedArgs): Promise<number> {
  const root = findProjectRoot();
  const noVlm = args.flags.get("no-vlm") === true;
  const results = await runCheck(root, { provider: noVlm ? undefined : tryCreateProvider(args, false), noVlm });
  let anyBreaking = false;
  for (const r of results) {
    if (r.error) {
      console.log(`  ✗ ${r.name}: ERROR ${r.error}`);
      continue;
    }
    const v = r.verdict!;
    const sev = v.severity ? ` · ${v.severity}` : "";
    if (v.changed) {
      anyBreaking = anyBreaking || v.severity === "breaking";
      console.log(`  ⚠ ${r.name}: ${v.changeType ?? "changed"}${sev} — ${v.summary ?? `${v.regions.length} region(s)`}`);
    } else {
      console.log(`  ✓ ${r.name}: no change`);
    }
  }
  const code = checkExitCode(results);
  if (code === 1 && anyBreaking) console.log("\n⛔ breaking changes detected");
  if (code === 3) console.log("\nnote: some pages need a VLM API key to finish classifying (exit 3)");
  return code;
}

async function main(): Promise<number> {
  loadDotEnv(findProjectRoot()); // load .env from the anchored project root, not cwd
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (!command || command === "help" || args.flags.get("help") === true) {
    console.log(usage());
    return command ? 0 : 2;
  }
  if (command === "diff") return runDiff(args);
  if (command === "snapshot") return runSnapshot(args);
  if (command === "init") return runInitCmd(args);
  if (command === "baseline") return runBaselineCmd();
  if (command === "check") return runCheckCmd(args);
  console.error(`unknown command: ${command}\n\n` + usage());
  return 2;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 2;
  });
