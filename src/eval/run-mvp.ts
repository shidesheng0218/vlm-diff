// MVP validation: runs fullPipeline on a representative 15-pair subset to
// verify the README's predicted metrics without the full-eval budget.
//
// Usage:
//   MOONSHOT_API_KEY=sk-... npm run eval:mvp                     # Kimi (default if only key set)
//   ANTHROPIC_API_KEY=sk-ant-... npm run eval:mvp                # Claude
//   VLM_DIFF_MVP_PROVIDER=moonshot VLM_DIFF_MVP_MODEL=kimi-k3 npm run eval:mvp

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createProvider } from "../provider/factory.js";
import { runFullPipeline } from "./baselines.js";
import { summarize } from "./metrics.js";
import type { PairRecord } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const RESULTS_DIR = join(__dirname, "..", "..", "results");

// 15 pairs: 5 boundary cases (subtle changes — hardest for classification),
// 5 clear changes (sanity check), 5 spread across fixtures/kinds, incl. all
// 3 no-change pairs to re-verify end-to-end false positives.
const MVP_IDS = [
  // Boundary: subtle changes (hardest)
  "card-list-color-change-small",
  "form-color-change-small",
  "navbar-color-change-small",
  "card-list-text-change-similar",
  "form-text-change-similar",
  // Clear changes (sanity)
  "card-list-spatial-shift-large",
  "form-element-add",
  "navbar-element-remove",
  "form-size-change-large",
  "card-list-style-change-radius",
  // No-change (false-positive check)
  "card-list-none",
  "form-none",
  "navbar-none",
  // Remaining coverage: one more per fixture with a kind not yet covered
  "navbar-size-change-small",
  "form-style-change-weight",
];

// Pricing per million tokens (input/output), USD — used only for the cost
// line in the report. Add/adjust entries as needed.
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  anthropic: { input: 1.0, output: 5.0 }, // Haiku 4.5 list price
  moonshot: { input: 0.6, output: 2.5 }, // Kimi K3 — verify against current Moonshot pricing
};

async function main() {
  const datasetJson = await readFile(join(DATA_DIR, "dataset.json"), "utf8");
  const allPairs: PairRecord[] = JSON.parse(datasetJson);

  const pairs = MVP_IDS.map((id) => {
    const p = allPairs.find((x) => x.id === id);
    if (!p) throw new Error(`MVP pair not found in dataset: ${id}`);
    return p;
  });

  const provider = createProvider({
    provider: process.env.VLM_DIFF_MVP_PROVIDER,
    model: process.env.VLM_DIFF_MVP_MODEL,
  });

  console.log(`MVP eval: ${pairs.length} pairs, model=${provider.model}\n`);

  const results = [];
  for (const pair of pairs) {
    process.stdout.write(`  ${pair.id} (${pair.kind})... `);
    const r = await runFullPipeline(provider, pair, DATA_DIR);
    results.push(r);
    const status =
      pair.kind === "none"
        ? r.predictedChanged ? "FALSE POSITIVE ✗" : "ok (unchanged)"
        : r.predictedChanged
          ? `detected, type=${r.predictedChangeType}${r.predictedChangeType === pair.kind ? " ✓" : ` (expected ${pair.kind}) ✗`}`
          : "MISSED ✗";
    console.log(status);
  }

  const summary = summarize(pairs, results);

  const totalInput = results.reduce((s, r) => s + r.inputTokens, 0);
  const totalOutput = results.reduce((s, r) => s + r.outputTokens, 0);
  const price = PRICE_PER_MTOK[provider.name] ?? { input: 0, output: 0 };
  const costUsd =
    (totalInput / 1_000_000) * price.input +
    (totalOutput / 1_000_000) * price.output;

  const report = {
    generatedAt: new Date().toISOString(),
    type: "mvp-validation",
    model: provider.model,
    n: pairs.length,
    pairIds: MVP_IDS,
    metrics: summary,
    tokens: { totalInput, totalOutput, avgInput: summary.avgInputTokens, avgOutput: summary.avgOutputTokens },
    costUsd: Math.round(costUsd * 10000) / 10000,
    // Per-pair detail for the README table
    perPair: results.map((r) => ({
      id: r.pairId,
      predictedChanged: r.predictedChanged,
      predictedChangeType: r.predictedChangeType ?? null,
      description: r.description ?? null,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
    })),
  };

  await mkdir(RESULTS_DIR, { recursive: true });
  const outPath = join(RESULTS_DIR, "mvp-report.json");
  await writeFile(outPath, JSON.stringify(report, null, 2));

  console.log("\n=== MVP Summary ===");
  console.log(`Recall (changed pairs):     ${(summary.recall * 100).toFixed(1)}%`);
  console.log(`FP rate (no-change pairs):  ${(summary.falsePositiveRateOnNoChange * 100).toFixed(1)}%`);
  console.log(`Classification accuracy:    ${(summary.changeTypeAccuracy * 100).toFixed(1)}%`);
  console.log(`Avg tokens/pair:            ${summary.avgInputTokens.toFixed(0)} in / ${summary.avgOutputTokens.toFixed(0)} out`);
  if (price.input > 0) {
    console.log(`Total cost:                 $${costUsd.toFixed(4)}`);
  } else {
    console.log(`Total cost:                 (no price table for ${provider.name} — ${totalInput} in / ${totalOutput} out tokens)`);
  }
  console.log(`\nReport: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
