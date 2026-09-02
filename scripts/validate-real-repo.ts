#!/usr/bin/env tsx
/**
 * Real-world validation: the paper's open question is whether the near-total
 * determinism measured on synthetic fixtures survives real pages ("escalation
 * circularity" — benchmark mutations are DOM-observable by construction).
 *
 * Given a git repo and two commits, this script checks each commit out into a
 * temp worktree, renders the requested pages with Playwright, runs the FULL
 * detection + tiered routing stack offline (zero API calls), and scores it
 * against git-diff ground truth (did the page or its local stylesheets
 * change between the commits?).
 *
 * Usage:
 *   npx tsx scripts/validate-real-repo.ts <repo-dir> <commitA> <commitB> <page.html> [more pages…]
 *
 * Appends outcomes to results/real-repo-validation.json.
 */

import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { detect } from "../src/detect/regions.js";
import { describeRegion } from "../src/describe/describe.js";
import { snapshotDom } from "../src/snapshot/capture.js";

const RESULTS_DIR = path.join(process.cwd(), "results");
const VIEWPORT = { width: 1280, height: 800 };

interface Outcome {
  repo: string;
  commitA: string;
  commitB: string;
  page: string;
  gitChanged: boolean;
  detectedChanged: boolean;
  visualOnly: boolean;
  pixelChangedFraction: number;
  regions: number;
  deterministicRegions: number;
  escalatedRegions: number;
  /**
   * TP/TN/FP as usual. "silent" = the source changed but zero pixels did
   * (e.g. a lang attribute) — a visual tool answering "no change" is RIGHT,
   * so this is reported separately from a true miss. "FN" = source changed,
   * pixels changed, but the pipeline suppressed the delta (noise floor).
   */
  verdict: "TP" | "FP" | "TN" | "FN" | "silent";
}

function git(repoDir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repoDir, ...args], { encoding: "utf8" }).trim();
}

function gitQuiet(repoDir: string, ...args: string[]): boolean {
  try {
    execFileSync("git", ["-C", repoDir, ...args], { stdio: "pipe" });
    return true;
  } catch {
    return false; // non-zero exit: differences exist
  }
}

/**
 * Local assets referenced by an HTML file — stylesheets and scripts. The
 * git-level ground truth must cover them too, or a JS-driven text change
 * would look like a tool false positive.
 */
function linkedAssets(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)) {
    const href = m[0].match(/href=["']([^"']+)["']/i)?.[1];
    if (href && !href.startsWith("http") && !href.startsWith("//")) out.push(href.replace(/^\.\//, ""));
  }
  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
    const src = m[1];
    if (src && !src.startsWith("http") && !src.startsWith("//")) out.push(src.replace(/^\.\//, ""));
  }
  return out;
}

async function capturePage(browserDir: string, pagePath: string) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    const url = `file://${path.join(browserDir, pagePath)}`;
    await page.goto(url, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(150);
    const png = await page.screenshot({ fullPage: true });
    const dom = await snapshotDom(page);
    return { png: png as Buffer, dom };
  } finally {
    await browser.close();
  }
}

async function main() {
  const [repoDirRaw, commitA, commitB, ...pages] = process.argv.slice(2);
  if (!repoDirRaw || !commitA || !commitB || pages.length === 0) {
    console.log("Usage: tsx scripts/validate-real-repo.ts <repo-dir> <commitA> <commitB> <page.html> [more pages…]");
    process.exit(2);
  }
  const repoDir = path.resolve(repoDirRaw);
  if (!existsSync(path.join(repoDir, ".git")) && !repoDir.endsWith(".git")) {
    console.error(`Not a git repository: ${repoDir}`);
    process.exit(2);
  }

  const repoName = path.basename(repoDir);
  const shortA = git(repoDir, "rev-parse", "--short", commitA);
  const shortB = git(repoDir, "rev-parse", "--short", commitB);
  console.log(`Validating ${repoName}: ${shortA} → ${shortB} over ${pages.length} page(s)\n`);

  // Check out both commits into disposable worktrees
  const tmpRoot = path.join(process.cwd(), ".cache", "real-repos", `${repoName}-${shortA}-${shortB}`);
  const dirA = path.join(tmpRoot, "A");
  const dirB = path.join(tmpRoot, "B");
  await rm(tmpRoot, { recursive: true, force: true });
  await mkdir(tmpRoot, { recursive: true });
  git(repoDir, "worktree", "add", "--detach", dirA, commitA);
  git(repoDir, "worktree", "add", "--detach", dirB, commitB);

  const outcomes: Outcome[] = [];
  try {
    for (const pagePath of pages) {
      const existsA = existsSync(path.join(dirA, pagePath));
      const existsB = existsSync(path.join(dirB, pagePath));
      if (!existsA && !existsB) {
        console.log(`  ${pagePath}: missing in both commits, skipped`);
        continue;
      }

      // Ground truth: page file OR any locally-linked stylesheet/script changed
      const diffPaths = [pagePath];
      for (const dir of [dirA, dirB]) {
        const p = path.join(dir, pagePath);
        if (existsSync(p)) diffPaths.push(...linkedAssets(await readFile(p, "utf8")));
      }
      const uniquePaths = [...new Set(diffPaths)];
      const gitChanged = !gitQuiet(repoDir, "diff", "--quiet", commitA, commitB, "--", ...uniquePaths);

      let outcome: Outcome;
      if (!existsA || !existsB) {
        // page added/removed between commits: detection runs against white/blank vs content
        const capture = existsA ? await capturePage(dirA, pagePath) : await capturePage(dirB, pagePath);
        const blankDom = "[]";
        const detection = existsA
          ? detect(capture.dom, blankDom, capture.png, capture.png)
          : detect(blankDom, capture.dom, capture.png, capture.png);
        outcome = tally(repoName, shortA, shortB, pagePath, gitChanged, detection);
      } else {
        const capA = await capturePage(dirA, pagePath);
        const capB = await capturePage(dirB, pagePath);
        const detection = detect(capA.dom, capB.dom, capA.png, capB.png);
        outcome = tally(repoName, shortA, shortB, pagePath, gitChanged, detection);
      }
      outcomes.push(outcome);
      console.log(
        `  ${pagePath}: git=${outcome.gitChanged ? "CHANGED" : "same"} pipeline=${outcome.detectedChanged ? "CHANGED" : "same"} ` +
          `regions=${outcome.regions} (esc ${outcome.escalatedRegions}) → ${outcome.verdict}`,
      );
    }
  } finally {
    git(repoDir, "worktree", "remove", "--force", dirA);
    git(repoDir, "worktree", "remove", "--force", dirB);
    await rm(tmpRoot, { recursive: true, force: true });
  }

  // Summary
  const count = (v: Outcome["verdict"]) => outcomes.filter((o) => o.verdict === v).length;
  const tp = count("TP");
  const fp = count("FP");
  const tn = count("TN");
  const fn = count("FN");
  const silent = count("silent");
  const totalRegions = outcomes.reduce((s, o) => s + o.regions, 0);
  const escalated = outcomes.reduce((s, o) => s + o.escalatedRegions, 0);
  console.log(`\n=== Real-world summary (${repoName} ${shortA}→${shortB}) ===`);
  console.log(`confusion: TP=${tp} FP=${fp} TN=${tn} FN=${fn} silent=${silent}`);
  console.log(
    `real-page region escalation: ${totalRegions > 0 ? ((escalated / totalRegions) * 100).toFixed(1) : "n/a"}% (${escalated}/${totalRegions} regions needed the VLM)`,
  );
  if (silent > 0) {
    console.log(`(${silent} source-only change(s) with zero pixel delta were correctly reported as no visual change)`);
  }

  await mkdir(RESULTS_DIR, { recursive: true });
  const outPath = path.join(RESULTS_DIR, "real-repo-validation.json");
  let existing: { generatedAt?: string; runs?: unknown[] } = {};
  try {
    existing = JSON.parse(await readFile(outPath, "utf8"));
  } catch {
    /* first run */
  }
  existing.generatedAt = new Date().toISOString();
  existing.runs = [...(existing.runs ?? []), { repo: repoName, commitA: shortA, commitB: shortB, outcomes }];
  await writeFile(outPath, JSON.stringify(existing, null, 2));
  console.log(`\nReport: ${outPath}`);
}

function tally(
  repo: string,
  a: string,
  b: string,
  page: string,
  gitChanged: boolean,
  detection: ReturnType<typeof detect>,
): Outcome {
  let deterministic = 0;
  let escalated = 0;
  for (const region of detection.regions) {
    if (describeRegion(region).route === "deterministic") deterministic++;
    else escalated++;
  }
  let verdict: Outcome["verdict"];
  if (gitChanged) {
    if (detection.changed) verdict = "TP";
    else if (detection.pixelChangedCount === 0) verdict = "silent";
    else verdict = "FN";
  } else {
    verdict = detection.changed ? "FP" : "TN";
  }
  return {
    repo,
    commitA: a,
    commitB: b,
    page,
    gitChanged,
    detectedChanged: detection.changed,
    visualOnly: detection.visualOnly,
    pixelChangedFraction: detection.pixelChangedFraction,
    regions: detection.regions.length,
    deterministicRegions: deterministic,
    escalatedRegions: escalated,
    verdict,
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
