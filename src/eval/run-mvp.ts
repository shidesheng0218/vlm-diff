// MVP validation: runs the four arms on a representative pair subset to
// verify the README's predicted metrics without the full-eval budget.
//
// Robustness (v0.2): per-pair errors are isolated (one failure no longer
// kills a multi-dollar run), and results are checkpointed to
// results/mvp-checkpoint[-tag].json after every pair. Re-run with
// VLM_DIFF_MVP_RESUME=1 to continue an interrupted run.
//
// Usage:
//   MOONSHOT_API_KEY=sk-... npm run eval:mvp                     # Kimi (default if only key set)
//   ANTHROPIC_API_KEY=sk-ant-... npm run eval:mvp                # Claude
//   VLM_DIFF_MVP_PROVIDER=moonshot VLM_DIFF_MVP_MODEL=kimi-k3 npm run eval:mvp

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createProvider } from "../provider/factory.js";
import { runFullPipeline, runRawPairToVlm, runTieredPipeline, type BaselineResult } from "./baselines.js";
import { summarize } from "./metrics.js";
import { estimateCostUsd } from "../cost/pricing.js";
import { loadDotEnv } from "../cli/env.js";
import type { PairRecord } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const RESULTS_DIR = join(__dirname, "..", "..", "results");

// 51 pairs: the original 15 (kept for cross-run comparability) + 15 covering
// the 3 new fixtures (table/modal/dashboard) and mutation variants + v0.2's
// 4 pixel-only media pairs (the tiered escalation path) + 17 no-change pairs
// deepened from 6 to shrink the false-positive CI. Stratified: subtle/boundary,
// clear, pixel-only, and no-change.
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
  // ── v0.2: pixel-only pairs (exercise VLM escalation end-to-end) ──
  "media-canvas-repaint-color",
  "media-canvas-repaint-shape",
  "media-svg-repaint-fill",
  "media-image-src-swap",
  // ── v0.2: deepened no-change denominator (CI on the FP rate) ──
  "card-list-none-b",
  "card-list-none-c",
  "card-list-none-d",
  "card-list-none-e",
  "card-list-none-f",
  "media-none",
  "media-none-b",
  "media-none-c",
  "media-none-d",
  "media-none-e",
  "media-none-f",
];

interface RunError {
  baseline: string;
  pairId: string;
  message: string;
}

interface Checkpoint {
  model: string;
  baselines: Record<string, BaselineResult[]>;
  errors: RunError[];
}

async function main() {
  loadDotEnv(); // .env support: keys may live in a gitignored file, not just the environment
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

  // Model routing: high-volume per-region classification can run on a cheaper
  // tier (VLM_DIFF_CLASSIFY_MODEL or the preset's cheapModel); the full-image
  // raw arm stays on the reasoning tier. Identical models when nothing is
  // configured — routing is opt-in and never changes results silently.
  const reasoningProvider = createProvider({
    provider: process.env.VLM_DIFF_MVP_PROVIDER,
    model: process.env.VLM_DIFF_MVP_MODEL,
  });
  const classifyProvider = createProvider({
    provider: process.env.VLM_DIFF_MVP_PROVIDER,
    model: process.env.VLM_DIFF_MVP_MODEL,
    tier: "cheap",
  });
  const provider = reasoningProvider; // report identity
  if (classifyProvider.model !== reasoningProvider.model) {
    console.log(`  [router] classification → ${classifyProvider.model}; raw arm → ${reasoningProvider.model}\n`);
  }

  console.log(`MVP eval: ${pairs.length} pairs, model=${provider.model}\n`);

  const tag = process.env.VLM_DIFF_MVP_TAG ? `-${process.env.VLM_DIFF_MVP_TAG}` : "";
  const checkpointPath = join(RESULTS_DIR, `mvp-checkpoint${tag}.json`);
  await mkdir(RESULTS_DIR, { recursive: true });

  // Resume support: VLM_DIFF_MVP_RESUME=1 continues an interrupted run from
  // the checkpoint (only when the same model is being evaluated).
  let checkpoint: Checkpoint = { model: provider.model, baselines: {}, errors: [] };
  if (process.env.VLM_DIFF_MVP_RESUME === "1") {
    try {
      const saved: Checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
      if (saved.model === provider.model) {
        checkpoint = saved;
        const done = Object.values(saved.baselines).reduce((s, rs) => s + rs.length, 0);
        console.log(`Resuming from checkpoint: ${done} completed pair-runs, ${saved.errors.length} prior errors\n`);
      } else {
        console.log(`Checkpoint is for model ${saved.model}, not ${provider.model} — starting fresh\n`);
      }
    } catch {
      /* no checkpoint yet */
    }
  }

  async function saveCheckpoint() {
    await writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2));
  }

  async function runBaseline(
    label: string,
    baselineKey: string,
    run: (pair: PairRecord) => Promise<BaselineResult>,
  ): Promise<BaselineResult[]> {
    console.log(`--- ${label} ---`);
    const results: BaselineResult[] = checkpoint.baselines[baselineKey] ?? [];
    const doneIds = new Set(results.map((r) => r.pairId));
    for (const pair of pairs) {
      if (doneIds.has(pair.id)) {
        console.log(`  ${pair.id} (${pair.kind})... resumed`);
        continue;
      }
      process.stdout.write(`  ${pair.id} (${pair.kind})... `);
      try {
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
      } catch (err) {
        // Per-pair isolation: one failure must not kill a multi-dollar run.
        const message = err instanceof Error ? err.message : String(err);
        checkpoint.errors.push({ baseline: baselineKey, pairId: pair.id, message });
        console.log(`ERROR ✗ (${message})`);
      }
      checkpoint.baselines[baselineKey] = results;
      await saveCheckpoint();
    }
    console.log();
    return results;
  }

  const tieredResults = await runBaseline("tieredPipeline (deterministic-first)", "tieredPipeline", (p) => runTieredPipeline(classifyProvider, p, DATA_DIR, undefined));
  const pipelineHintResults = await runBaseline("fullPipeline + DOM hint", "fullPipelineWithDomHint", (p) => runFullPipeline(classifyProvider, p, DATA_DIR, undefined, true));
  const pipelineNoHintResults = await runBaseline("fullPipeline (no hint, ablation)", "fullPipelineNoHint", (p) => runFullPipeline(classifyProvider, p, DATA_DIR, undefined, false));
  const rawResults = await runBaseline("rawPairToVlm", "rawPairToVlm", (p) => runRawPairToVlm(reasoningProvider, p, DATA_DIR));

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
  const costUsd = estimateCostUsd(provider.model, { inputTokens: totalInput, outputTokens: totalOutput });

  const report = {
    generatedAt: new Date().toISOString(),
    type: "mvp-validation",
    model: provider.model,
    ...(classifyProvider.model !== provider.model ? { classifyModel: classifyProvider.model } : {}),
    n: pairs.length,
    pairIds: ids,
    ...(checkpoint.errors.length > 0 ? { errors: checkpoint.errors } : {}),
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

  // VLM_DIFF_MVP_TAG=glm-5.2 → results/mvp-report-glm-5.2.json (multi-model
  // replication runs must not overwrite each other; empty tag keeps the
  // original path for backwards compatibility)
  const outPath = join(RESULTS_DIR, `mvp-report${tag}.json`);
  await writeFile(outPath, JSON.stringify(report, null, 2));
  await rm(checkpointPath, { force: true });

  console.log("=== MVP Summary (tiered / pipeline+hint / pipeline-hint / raw) ===");
  console.log(`Recall:                    ${pct(tieredSummary.recall)} / ${pct(hintSummary.recall)} / ${pct(noHintSummary.recall)} / ${pct(rawSummary.recall)}`);
  console.log(`FP rate (no-change):       ${pct(tieredSummary.falsePositiveRateOnNoChange)} / ${pct(hintSummary.falsePositiveRateOnNoChange)} / ${pct(noHintSummary.falsePositiveRateOnNoChange)} / ${pct(rawSummary.falsePositiveRateOnNoChange)}`);
  console.log(`Classification accuracy:   ${pct(tieredSummary.changeTypeAccuracy)} / ${pct(hintSummary.changeTypeAccuracy)} / ${pct(noHintSummary.changeTypeAccuracy)} / ${pct(rawSummary.changeTypeAccuracy)}`);
  console.log(`Avg tokens/pair (in+out):  ${tieredSummary.avgInputTokens.toFixed(0)}+${tieredSummary.avgOutputTokens.toFixed(0)} / ${hintSummary.avgInputTokens.toFixed(0)}+${hintSummary.avgOutputTokens.toFixed(0)} / ${noHintSummary.avgInputTokens.toFixed(0)}+${noHintSummary.avgOutputTokens.toFixed(0)} / ${rawSummary.avgInputTokens.toFixed(0)}+${rawSummary.avgOutputTokens.toFixed(0)}`);
  console.log(`Tiered escalation rate:    ${pct(escalationRate)} (${tieredRegions.length - deterministicRegions}/${tieredRegions.length} regions via VLM; deterministic saved ${pct(tokenSavingsVsHint)} tokens vs pipeline+hint)`);
  if (costUsd > 0) {
    console.log(`Total cost:                $${costUsd.toFixed(4)}`);
  } else {
    console.log(`Total tokens:              ${totalInput} in / ${totalOutput} out`);
  }
  if (checkpoint.errors.length > 0) {
    console.log(`\n⚠️  ${checkpoint.errors.length} pair-run(s) failed and are excluded from metrics (see "errors" in the report).`);
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
