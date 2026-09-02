#!/usr/bin/env tsx
/**
 * Offline statistical layer over existing MVP/judge reports: Clopper-Pearson
 * confidence intervals on every rate, McNemar exact tests between arms, and
 * seeded bootstrap CIs on judge score differences. Zero API calls.
 *
 * Works retroactively on v0.1 reports and v0.2 reports alike.
 *
 * Usage:
 *   npm run stats:report
 *   npx tsx scripts/stats-report.ts results/mvp-report.json [results/judge-report.json]
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { clopperPearson, mcnemarExact, bootstrapMeanCi, type ConfidenceInterval } from "../src/eval/stats.js";

interface PerPair {
  id: string;
  predictedChanged: boolean;
  predictedChangeType: string | null;
}

interface MvpReport {
  model: string;
  n: number;
  baselines: Record<string, { perPair: PerPair[] }>;
}

interface JudgePair {
  id: string;
  tieredScores: { accuracy: number; specificity: number; readability: number };
  vlmScores: { accuracy: number; specificity: number; readability: number };
  winner: "tiered" | "vlm" | "tie";
}

interface JudgeReport {
  judge: string;
  vlmDescriptionsBy: string;
  perPair: JudgePair[];
}

interface DatasetPair {
  id: string;
  kind: string;
}

interface RateWithCi {
  k: number;
  n: number;
  rate: number;
  ci95: ConfidenceInterval;
}

function rate(k: number, n: number): RateWithCi {
  return { k, n, rate: n > 0 ? k / n : 0, ci95: clopperPearson(k, n) };
}

function fmt(r: RateWithCi): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  return `${pct(r.rate)} [${pct(r.ci95.lower)}, ${pct(r.ci95.upper)}] (n=${r.n})`;
}

/** Per-pair correctness of one arm against dataset ground truth. */
function correctness(perPair: PerPair[], byId: Map<string, DatasetPair>) {
  const detection = new Map<string, boolean>(); // changed pair → detected?
  const typeOk = new Map<string, boolean>(); // changed pair → type exact match?
  const fp = new Map<string, boolean>(); // none pair → falsely flagged?
  for (const r of perPair) {
    const gt = byId.get(r.id);
    if (!gt) continue;
    if (gt.kind === "none") {
      fp.set(r.id, r.predictedChanged);
    } else {
      detection.set(r.id, r.predictedChanged);
      typeOk.set(r.id, r.predictedChanged && r.predictedChangeType === gt.kind);
    }
  }
  return { detection, typeOk, fp };
}

function armRates(c: ReturnType<typeof correctness>) {
  const detected = [...c.detection.values()].filter(Boolean).length;
  const fpCount = [...c.fp.values()].filter(Boolean).length;
  const typeCorrect = [...c.typeOk.values()].filter(Boolean).length;
  return {
    recall: rate(detected, c.detection.size),
    falsePositive: rate(fpCount, c.fp.size),
    typeAccuracy: rate(typeCorrect, c.typeOk.size),
  };
}

function mcnemarPaired(a: Map<string, boolean>, b: Map<string, boolean>) {
  let aRightBWrong = 0;
  let aWrongBRight = 0;
  for (const [id, aOk] of a) {
    const bOk = b.get(id);
    if (bOk === undefined) continue;
    if (aOk && !bOk) aRightBWrong++;
    if (!aOk && bOk) aWrongBRight++;
  }
  return mcnemarExact(aRightBWrong, aWrongBRight);
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

async function main() {
  const args = process.argv.slice(2);
  const mvpPath = args[0] ?? "results/mvp-report.json";
  const judgePath = args[1] ?? "results/judge-report.json";

  const report: MvpReport = JSON.parse(await readFile(mvpPath, "utf8"));
  const dataset: DatasetPair[] = JSON.parse(
    await readFile(path.join(process.cwd(), "data", "dataset.json"), "utf8"),
  );
  const byId = new Map(dataset.map((d) => [d.id, d]));

  const arms = Object.keys(report.baselines).filter((k) => report.baselines[k].perPair);
  const corr = new Map(arms.map((arm) => [arm, correctness(report.baselines[arm].perPair, byId)]));

  const out: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    mvpReport: mvpPath,
    model: report.model,
    rates: {} as Record<string, unknown>,
  };

  console.log(`Statistical report for ${mvpPath} (model ${report.model})\n`);
  console.log("Rates with 95% Clopper-Pearson exact confidence intervals:\n");

  for (const arm of arms) {
    const r = armRates(corr.get(arm)!);
    (out.rates as Record<string, unknown>)[arm] = r;
    console.log(`── ${arm}`);
    console.log(`   recall:      ${fmt(r.recall)}`);
    console.log(`   FP (none):   ${fmt(r.falsePositive)}`);
    console.log(`   type acc:    ${fmt(r.typeAccuracy)}`);
  }

  // Paired significance between arms on identical pair sets
  const comparisons: Array<{ label: string; arms: [string, string]; field: "detection" | "typeOk"; test: ReturnType<typeof mcnemarExact> }> = [];
  const pairArms = (label: string, a: string, b: string, field: "detection" | "typeOk") => {
    if (!corr.has(a) || !corr.has(b)) return;
    const test = mcnemarPaired(corr.get(a)![field], corr.get(b)![field]);
    comparisons.push({ label, arms: [a, b], field, test });
  };
  pairArms("detection recall", "tieredPipeline", "rawPairToVlm", "detection");
  pairArms("detection recall", "fullPipelineWithDomHint", "rawPairToVlm", "detection");
  pairArms("type accuracy", "tieredPipeline", "fullPipelineWithDomHint", "typeOk");
  pairArms("type accuracy", "fullPipelineWithDomHint", "fullPipelineNoHint", "typeOk");

  if (comparisons.length > 0) {
    console.log("\nMcNemar exact tests (paired, same pairs):\n");
    for (const c of comparisons) {
      const sig = c.test.pValue < 0.05 ? "significant" : "not significant";
      console.log(`── ${c.label}: ${c.arms[0]} vs ${c.arms[1]}`);
      console.log(`   discordants ${c.test.b}/${c.test.c} → p=${c.test.pValue.toFixed(4)} (${sig} at α=0.05)`);
    }
    out.mcnemar = comparisons;
  }

  // Judge bootstrap (optional; only attached when the judge report scored
  // this model's descriptions, so stats files don't cross wires)
  try {
    const judge: JudgeReport = JSON.parse(await readFile(judgePath, "utf8"));
    if (judge.vlmDescriptionsBy !== report.model) {
      console.log(`\n(judge report scores ${judge.vlmDescriptionsBy}, not ${report.model} — skipping bootstrap)`);
    } else {
      const dims = ["accuracy", "specificity", "readability"] as const;
      const bootstrap: Record<string, unknown> = { judge: judge.judge, vlmDescriptionsBy: judge.vlmDescriptionsBy, dims: {} };
      console.log(`\nBootstrap CIs on judge score differences (tiered − vlm, judge=${judge.judge}):\n`);
      for (const d of dims) {
        const diffs = judge.perPair.map((p) => p.tieredScores[d] - p.vlmScores[d]);
        const b = bootstrapMeanCi(diffs);
        (bootstrap.dims as Record<string, unknown>)[d] = b;
        const direction = b.upper <= 0 ? "vlm favored" : b.lower >= 0 ? "tiered favored" : "indistinguishable";
        console.log(`── ${d}: mean Δ ${b.mean >= 0 ? "+" : ""}${b.mean.toFixed(2)} [${b.lower.toFixed(2)}, ${b.upper.toFixed(2)}] → ${direction}`);
      }
      out.judgeBootstrap = bootstrap;
    }
  } catch {
    console.log(`\n(no readable judge report at ${judgePath} — skipping bootstrap)`);
  }

  await mkdir("results", { recursive: true });
  // mvp-report[-tag].json → stats-report[-tag].json
  const outPath = path.join(
    path.dirname(mvpPath),
    path.basename(mvpPath).replace(/^mvp-report/, "stats-report"),
  );
  await writeFile(outPath, JSON.stringify(out, null, 2));
  console.log(`\nReport: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
