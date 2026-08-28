#!/usr/bin/env tsx
/**
 * Offline router replay: run the deterministic detection + tiered router over
 * the full dataset with ZERO API calls, and report:
 *   - escalation rate per mutation kind (which change types the VLM is needed for)
 *   - pair-level escalation rate
 *   - region-weighted token savings vs an always-classify pipeline
 *
 * Run: npm run replay:router
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { detect } from "../src/detect/regions.js";
import { describeRegion, describeRegions } from "../src/describe/describe.js";

const DATA_DIR = path.join(process.cwd(), "data");
const RESULTS_DIR = path.join(process.cwd(), "results");

interface KindStats {
  pairs: number;
  regions: number;
  deterministic: number;
  vlm: number;
  pairsNeedingVlm: number;
}

async function main() {
  const dataset: Array<{
    id: string;
    kind: string;
    before: string;
    after: string;
    domBefore: string;
    domAfter: string;
  }> = JSON.parse(await readFile(path.join(DATA_DIR, "dataset.json"), "utf8"));

  console.log(`Router replay over ${dataset.length} pairs (0 API calls)\n`);

  const byKind = new Map<string, KindStats>();
  const escalatedPairs: Array<{ id: string; kind: string; reasons: string[] }> = [];
  let totalRegions = 0;
  let totalDeterministic = 0;
  let changedPairs = 0;
  let pairsNeedingVlm = 0;
  // offline pair-level type scoring: root-cause-first vs largest-region-first
  let rootFirstCorrect = 0;
  let largestFirstCorrect = 0;

  for (const pair of dataset) {
    const stats = getStats(byKind, pair.kind);
    stats.pairs++;

    const before = await readFile(path.join(DATA_DIR, pair.before));
    const after = await readFile(path.join(DATA_DIR, pair.after));
    const detection = detect(pair.domBefore, pair.domAfter, before, after);

    if (!detection.changed || detection.regions.length === 0) continue; // no-change pair, suppressed

    changedPairs++;
    const domRegionCount = detection.regions.filter((r) => r.source !== "pixel").length;
    const reasons: string[] = [];

    for (const region of detection.regions) {
      stats.regions++;
      totalRegions++;
      const d = describeRegion(region, domRegionCount);
      if (d.route === "deterministic") {
        stats.deterministic++;
        totalDeterministic++;
      } else {
        stats.vlm++;
        reasons.push(d.reason ?? "escalated");
      }
    }

    if (reasons.length > 0) {
      stats.pairsNeedingVlm++;
      pairsNeedingVlm++;
      escalatedPairs.push({ id: pair.id, kind: pair.kind, reasons });
    }

    // offline pair-level type check (deterministic regions only; escalated
    // regions fall back to "other" here, which real runs resolve via VLM)
    const descriptions = describeRegions(detection.regions);
    const scored = detection.regions.map((r, i) => ({ r, d: descriptions[i] }));
    const rootFirst = [...scored]
      .sort((a, b) => Number(b.d.rootCause ?? false) - Number(a.d.rootCause ?? false))[0];
    const largestFirst = [...scored].sort(
      (a, b) => b.r.w * b.r.h - a.r.w * a.r.h,
    )[0];
    if (rootFirst.d.changeType === pair.kind) rootFirstCorrect++;
    if (largestFirst.d.changeType === pair.kind) largestFirstCorrect++;
  }

  const kinds = [...byKind.entries()].sort((a, b) => b[1].regions - a[1].regions);
  console.log("kind                       regions  deterministic  vlm  escalation");
  console.log("─".repeat(66));
  for (const [kind, s] of kinds) {
    const esc = s.regions > 0 ? ((s.vlm / s.regions) * 100).toFixed(0).padStart(3) : "  0";
    console.log(
      `${kind.padEnd(24)} ${String(s.regions).padStart(7)}  ${String(s.deterministic).padStart(13)}  ${String(s.vlm).padStart(3)}  ${esc}%`,
    );
  }

  const regionEscalation = totalRegions > 0 ? (totalRegions - totalDeterministic) / totalRegions : 0;
  console.log("─".repeat(66));
  console.log(`changed pairs:            ${changedPairs}`);
  console.log(`pairs needing VLM:        ${pairsNeedingVlm} (${((pairsNeedingVlm / changedPairs) * 100).toFixed(1)}%)`);
  console.log(`total regions:            ${totalRegions}`);
  console.log(`deterministic regions:    ${totalDeterministic} (${((totalDeterministic / totalRegions) * 100).toFixed(1)}%)`);
  console.log(`region escalation rate:   ${(regionEscalation * 100).toFixed(1)}%`);
  console.log(`region-weighted savings vs always-classify: ${(100 - regionEscalation * 100).toFixed(1)}%`);
  console.log(`offline pair-level type accuracy (root-cause-first):    ${((rootFirstCorrect / changedPairs) * 100).toFixed(1)}% (${rootFirstCorrect}/${changedPairs})`);
  console.log(`offline pair-level type accuracy (largest-first):      ${((largestFirstCorrect / changedPairs) * 100).toFixed(1)}% (${largestFirstCorrect}/${changedPairs})`);

  if (escalatedPairs.length > 0) {
    console.log("\nEscalated pairs (for debugging the router):");
    for (const p of escalatedPairs) {
      console.log(`  ${p.id} [${p.kind}]: ${p.reasons[0]}`);
    }
  }

  await mkdir(RESULTS_DIR, { recursive: true });
  const outPath = path.join(RESULTS_DIR, "router-replay.json");
  await writeFile(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        n: dataset.length,
        changedPairs,
        totalRegions,
        deterministicRegions: totalDeterministic,
        vlmRegions: totalRegions - totalDeterministic,
        regionEscalationRate: Math.round(regionEscalation * 10000) / 10000,
        pairsNeedingVlm,
        byKind: Object.fromEntries(kinds),
        escalatedPairs,
      },
      null,
      2,
    ),
  );
  console.log(`\nReport: ${outPath}`);
}

function getStats(map: Map<string, KindStats>, kind: string): KindStats {
  let s = map.get(kind);
  if (!s) {
    s = { pairs: 0, regions: 0, deterministic: 0, vlm: 0, pairsNeedingVlm: 0 };
    map.set(kind, s);
  }
  return s;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
