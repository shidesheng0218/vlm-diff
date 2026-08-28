// MVP validation: runs fullPipeline on a representative 33-pair subset to
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
import { runFullPipeline, runRawPairToVlm, runTieredPipeline, type BaselineResult } from "./baselines.js";
import { summarize } from "./metrics.js";
import type { PairRecord } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const RESULTS_DIR = join(__dirname, "..", "..", "results");

// 33 pairs: the original 15 (kept for cross-run comparability) + 18 more
// covering the 3 new fixtures (table/modal/dashboard), the new mutation
// variants, and all 6 no-change pairs. Stratified: 11 subtle/boundary,
// 16 clear, 6 no-change.
const MVP_IDS = [
  // ── original 15 ──
  "card-list-color-change-small",
  "form-color-change-small",
  "navbar-color-change-small",
  "card-list-text-change-similar",
  "form-text-change-similar",
  "card-list-spatial-shift-large",
  "form-element-add",
  "navbar-element-remove",
  "form-size-change-large",
  "card-list-style-change-radius",
  "card-list-none",
  "form-none",
  "navbar-none",
  "navbar-size-change-small",
  "form-style-change-weight",
  // ── new fixtures: subtle + clear + one add/remove each ──
  "table-color-change-small",
  "table-text-change-similar",
  "table-element-add",
  "table-spatial-shift-tiny",
  "modal-color-change-small",
  "modal-text-change-similar",
  "modal-element-remove",
  "modal-size-change-small",
  "dashboard-color-change-small",
  "dashboard-text-change-number",
  "dashboard-element-add",
  "dashboard-spatial-shift-tiny",
  // ── new mutation variants across old + new fixtures ──
  "card-list-spatial-shift-tiny",
  "form-color-change-text",
  "navbar-style-change-shadow",
  "table-style-change-opacity",
  "modal-color-change-border",
  "dashboard-size-change-shrink",
  // ── remaining no-change ──
  "table-none",
  "modal-none",
  "dashboard-none",
];

// Pricing per million tokens (input/output), USD — used only for the cost
// line in the report. Add/adjust entries as needed.
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  anthropic: { input: 1.0, output: 5.0 }, // Haiku 4.5 list price
  moonshot: { input: 0.6, output: 2.5 }, // Kimi K3 — verify against current Moonshot pricing
  dashscope: { input: 0.6, output: 2.5 }, // Kimi K3 hosted on DashScope — same ballpark as Moonshot direct
  opencode: { input: 3.0, output: 15.0 }, // Kimi K3 via OpenCode Zen — verify at opencode.ai/docs/zen
};

async function main() {
  const datasetJson = await readFile(join(DATA_DIR, "dataset.json"), "utf8");
  const allPairs: PairRecord[] = JSON.parse(datasetJson);

  // VLM_DIFF_MVP_LIMIT=n runs only the first n pairs (cheap smoke test:
  // verify a model supports image input before paying for the full run)
  const limit = process.env.VLM_DIFF_MVP_LIMIT ? Number(process.env.VLM_DIFF_MVP_LIMIT) : undefined;
  const ids = limit ? MVP_IDS.slice(0, limit) : MVP_IDS;
  const pairs = ids.map((id) => {
    const p = allPairs.find((x) => x.id === id);
    if (!p) throw new Error(`MVP pair not found in dataset: ${id}`);
    return p;
  });

  const provider = createProvider({
    provider: process.env.VLM_DIFF_MVP_PROVIDER,
    model: process.env.VLM_DIFF_MVP_MODEL,
  });

  console.log(`MVP eval: ${pairs.length} pairs, model=${provider.model}\n`);

  async function runBaseline(
    label: string,
    run: (pair: PairRecord) => Promise<BaselineResult>,
  ): Promise<BaselineResult[]> {
    console.log(`--- ${label} ---`);
    const results: BaselineResult[] = [];
    for (const pair of pairs) {
      process.stdout.write(`  ${pair.id} (${pair.kind})... `);
      const r = await run(pair);
      results.push(r);
      const nRegions = r.classifications?.length ?? 0;
      const regionNote = nRegions > 1 ? ` [${nRegions} regions]` : "";
      const status =
        pair.kind === "none"
          ? r.predictedChanged ? "FALSE POSITIVE ✗" : "ok (unchanged)"
          : r.predictedChanged
            ? `detected, type=${r.predictedChangeType ?? "?"}${r.predictedChangeType === pair.kind ? " ✓" : ` (expected ${pair.kind}) ✗`}${regionNote}`
            : "MISSED ✗";
      console.log(status);
    }
    console.log();
    return results;
  }

  const tieredResults = await runBaseline("tieredPipeline (deterministic-first)", (p) => runTieredPipeline(provider, p, DATA_DIR, undefined));
  const pipelineHintResults = await runBaseline("fullPipeline + DOM hint", (p) => runFullPipeline(provider, p, DATA_DIR, undefined, true));
  const pipelineNoHintResults = await runBaseline("fullPipeline (no hint, ablation)", (p) => runFullPipeline(provider, p, DATA_DIR, undefined, false));
  const rawResults = await runBaseline("rawPairToVlm", (p) => runRawPairToVlm(provider, p, DATA_DIR));

  const tieredSummary = summarize(pairs, tieredResults);
  const hintSummary = summarize(pairs, pipelineHintResults);
  const noHintSummary = summarize(pairs, pipelineNoHintResults);
  const rawSummary = summarize(pairs, rawResults);

  // Tiered-arm cost story: what share of regions needed the VLM, and how
  // many tokens the deterministic tier saved vs the always-VLM hint arm.
  const tieredRegions = tieredResults.flatMap((r) => r.classifications ?? []);
  const deterministicRegions = tieredRegions.filter((c) => c.route === "deterministic").length;
  const escalationRate = tieredRegions.length > 0 ? (tieredRegions.length - deterministicRegions) / tieredRegions.length : 0;
  const tieredTokens = tieredResults.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0);
  const hintTokens = pipelineHintResults.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0);
  const tokenSavingsVsHint = hintTokens > 0 ? 1 - tieredTokens / hintTokens : 0;

  const allResults = [...tieredResults, ...pipelineHintResults, ...pipelineNoHintResults, ...rawResults];
  const totalInput = allResults.reduce((s, r) => s + r.inputTokens, 0);
  const totalOutput = allResults.reduce((s, r) => s + r.outputTokens, 0);
  const price = PRICE_PER_MTOK[provider.name] ?? { input: 0, output: 0 };
  const costUsd =
    (totalInput / 1_000_000) * price.input +
    (totalOutput / 1_000_000) * price.output;

  const report = {
    generatedAt: new Date().toISOString(),
    type: "mvp-validation",
    model: provider.model,
    n: pairs.length,
    pairIds: ids,
    baselines: {
      tieredPipeline: { metrics: tieredSummary, perPair: perPairDetail(tieredResults) },
      fullPipelineWithDomHint: { metrics: hintSummary, perPair: perPairDetail(pipelineHintResults) },
      fullPipelineNoHint: { metrics: noHintSummary, perPair: perPairDetail(pipelineNoHintResults) },
      rawPairToVlm: { metrics: rawSummary, perPair: perPairDetail(rawResults) },
    },
    tiered: {
      totalRegions: tieredRegions.length,
      deterministicRegions,
      vlmRegions: tieredRegions.length - deterministicRegions,
      escalationRate: Math.round(escalationRate * 10000) / 10000,
      tokenSavingsVsFullPipelineHint: Math.round(tokenSavingsVsHint * 10000) / 10000,
    },
    tokens: { totalInput, totalOutput },
    costUsd: Math.round(costUsd * 10000) / 10000,
  };

  await mkdir(RESULTS_DIR, { recursive: true });
  // VLM_DIFF_MVP_TAG=glm-5.2 → results/mvp-report-glm-5.2.json (multi-model
  // replication runs must not overwrite each other; empty tag keeps the
  // original path for backwards compatibility)
  const tag = process.env.VLM_DIFF_MVP_TAG ? `-${process.env.VLM_DIFF_MVP_TAG}` : "";
  const outPath = join(RESULTS_DIR, `mvp-report${tag}.json`);
  await writeFile(outPath, JSON.stringify(report, null, 2));

  console.log("=== MVP Summary (tiered / pipeline+hint / pipeline-hint / raw) ===");
  console.log(`Recall:                    ${pct(tieredSummary.recall)} / ${pct(hintSummary.recall)} / ${pct(noHintSummary.recall)} / ${pct(rawSummary.recall)}`);
  console.log(`FP rate (no-change):       ${pct(tieredSummary.falsePositiveRateOnNoChange)} / ${pct(hintSummary.falsePositiveRateOnNoChange)} / ${pct(noHintSummary.falsePositiveRateOnNoChange)} / ${pct(rawSummary.falsePositiveRateOnNoChange)}`);
  console.log(`Classification accuracy:   ${pct(tieredSummary.changeTypeAccuracy)} / ${pct(hintSummary.changeTypeAccuracy)} / ${pct(noHintSummary.changeTypeAccuracy)} / ${pct(rawSummary.changeTypeAccuracy)}`);
  console.log(`Avg tokens/pair (in+out):  ${tieredSummary.avgInputTokens.toFixed(0)}+${tieredSummary.avgOutputTokens.toFixed(0)} / ${hintSummary.avgInputTokens.toFixed(0)}+${hintSummary.avgOutputTokens.toFixed(0)} / ${noHintSummary.avgInputTokens.toFixed(0)}+${noHintSummary.avgOutputTokens.toFixed(0)} / ${rawSummary.avgInputTokens.toFixed(0)}+${rawSummary.avgOutputTokens.toFixed(0)}`);
  console.log(`Tiered escalation rate:    ${pct(escalationRate)} (${tieredRegions.length - deterministicRegions}/${tieredRegions.length} regions via VLM; deterministic saved ${pct(tokenSavingsVsHint)} tokens vs pipeline+hint)`);
  if (price.input > 0) {
    console.log(`Total cost:                $${costUsd.toFixed(4)}`);
  } else {
    console.log(`Total tokens:              ${totalInput} in / ${totalOutput} out`);
  }
  console.log(`\nReport: ${outPath}`);
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function perPairDetail(results: BaselineResult[]) {
  return results.map((r) => ({
    id: r.pairId,
    predictedChanged: r.predictedChanged,
    predictedChangeType: r.predictedChangeType ?? null,
    description: r.description ?? null,
    regionsClassified: r.classifications?.length ?? 0,
    classifications:
      r.classifications?.map((c) => ({
        region: c.region,
        source: c.source,
        route: c.route ?? null,
        changeType: c.changeType,
        description: c.description,
        confidence: c.confidence,
      })) ?? [],
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
  }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
