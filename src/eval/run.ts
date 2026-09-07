// Orchestrates the full comparison: runs all three baselines over the
// generated dataset, computes metrics, and writes a report to results/.
// Requires a real API key (ANTHROPIC_API_KEY or OPENAI_API_KEY) and burns
// real credits — this is the manual, explicitly-triggered evaluation script
// (not part of `npm test`), per the plan's cost-control section.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createJudgeProvider, createProvider } from "../provider/factory.js";
import { runFullPipeline, runPixelDiffOnly, runRawPairToVlm, runTieredPipeline, type BaselineResult } from "./baselines.js";
import { summarize } from "./metrics.js";
import { judgeDescription, averageScore, type JudgeScore } from "./judge.js";
import { FileCacheStore } from "../cache/store.js";
import { generateHtmlReport, computeReportSummary } from "../report/generate.js";
import { mapWithConcurrency } from "../util/pool.js";
import { loadDotEnv } from "../cli/env.js";
import type { PairRecord } from "./types.js";

/** Cap on parallel judge calls — unbounded Promise.all trips rate limits. */
const JUDGE_CONCURRENCY = 4;

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const RESULTS_DIR = join(__dirname, "..", "..", "results");
const CACHE_DIR = join(__dirname, "..", "..", ".cache", "classifications");

async function main() {
  loadDotEnv(); // .env support: keys may live in a gitignored file
  const datasetJson = await readFile(join(DATA_DIR, "dataset.json"), "utf8");
  const pairs: PairRecord[] = JSON.parse(datasetJson);
  const provider = createProvider();
  const classifyProvider = createProvider({ tier: "cheap" });
  const judgeProvider = createJudgeProvider(provider);
  const cacheEnabled = process.env.VLM_DIFF_NO_CACHE !== "1";
  const cache = cacheEnabled ? new FileCacheStore(CACHE_DIR) : undefined;

  console.log(`Loaded ${pairs.length} pairs. Running baselines with ${provider.name}/${provider.model}...`);
  if (classifyProvider.model !== provider.model) {
    console.log(`  [router] classification → ${classifyProvider.model}; raw + judge stay on ${provider.model}/${judgeProvider.model}`);
  }
  console.log(`Judging descriptions with ${judgeProvider.name}/${judgeProvider.model}...`);
  console.log(`Classification cache: ${cacheEnabled ? `enabled (${CACHE_DIR})` : "disabled"}\n`);

  const rawResults: BaselineResult[] = [];
  const pixelResults: BaselineResult[] = [];
  const pipelineResults: BaselineResult[] = [];
  const tieredResults: BaselineResult[] = [];
  const errors: Array<{ pairId: string; arm: string; message: string }> = [];

  // Per-arm error isolation: one failure no longer kills a multi-dollar run.
  async function tryRun(arm: string, pairId: string, fn: () => Promise<BaselineResult>): Promise<BaselineResult | undefined> {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ pairId, arm, message });
      console.log(`    ${arm} ERROR: ${message}`);
      return undefined;
    }
  }

  for (const pair of pairs) {
    console.log(`  ${pair.id}`);
    const raw = await tryRun("raw", pair.id, () => runRawPairToVlm(provider, pair, DATA_DIR));
    if (raw) rawResults.push(raw);
    pixelResults.push(await runPixelDiffOnly(pair, DATA_DIR)); // deterministic, cannot fail on API
    const pipeline = await tryRun("fullPipeline", pair.id, () => runFullPipeline(classifyProvider, pair, DATA_DIR, cache));
    if (pipeline) pipelineResults.push(pipeline);
    const tiered = await tryRun("tieredPipeline", pair.id, () => runTieredPipeline(classifyProvider, pair, DATA_DIR, cache));
    if (tiered) tieredResults.push(tiered);
  }

  const rawSummary = summarize(pairs, rawResults);
  const pixelSummary = summarize(pairs, pixelResults);
  const pipelineSummary = summarize(pairs, pipelineResults);
  const tieredSummary = summarize(pairs, tieredResults);

  // Description-quality judging, only for the baselines that produce
  // free-text descriptions (pixel-diff-only has none). Concurrency-capped.
  const byId = new Map(pairs.map((p) => [p.id, p]));
  async function judgeAll(results: BaselineResult[]): Promise<JudgeScore[]> {
    return mapWithConcurrency(results, JUDGE_CONCURRENCY, async (r) => {
      try {
        return await judgeDescription(judgeProvider, byId.get(r.pairId)!.description, r.description);
      } catch (err) {
        return { score: 1, rationale: `judge call failed: ${err instanceof Error ? err.message : err}` };
      }
    });
  }
  const rawJudgeScores = await judgeAll(rawResults);
  const pipelineJudgeScores = await judgeAll(pipelineResults);

  const costSummary = computeReportSummary({ pairs, results: pipelineResults, provider });

  const report = {
    generatedAt: new Date().toISOString(),
    provider: { name: provider.name, model: provider.model },
    judgeProvider: { name: judgeProvider.name, model: judgeProvider.model },
    n: pairs.length,
    baselines: {
      rawPairToVlm: { ...rawSummary, avgDescriptionScore: averageScore(rawJudgeScores) },
      pixelDiffOnly: pixelSummary,
      fullPipeline: { ...pipelineSummary, avgDescriptionScore: averageScore(pipelineJudgeScores) },
      tieredPipeline: tieredSummary,
    },
    ...(errors.length > 0 ? { errors } : {}),
    cost: {
      fullPipelineCacheHits: costSummary.cacheHits,
      fullPipelineCacheMisses: costSummary.cacheMisses,
      fullPipelineCostUsd: costSummary.totalCostUsd,
      fullPipelineSavedByCacheUsd: costSummary.savedCostUsd,
    },
  };

  await writeFile(join(RESULTS_DIR, "report.json"), JSON.stringify(report, null, 2));

  const html = await generateHtmlReport({ pairs, results: pipelineResults, provider }, DATA_DIR);
  await writeFile(join(RESULTS_DIR, "report.html"), html);

  console.log("\n=== Summary ===");
  console.log(JSON.stringify(report.baselines, null, 2));
  console.log(
    `\nfullPipeline cache: ${costSummary.cacheHits} hits / ${costSummary.cacheMisses} misses ` +
      `— $${costSummary.totalCostUsd.toFixed(4)} spent, ~$${costSummary.savedCostUsd.toFixed(4)} saved`,
  );
  console.log(`\nJSON report: ${join(RESULTS_DIR, "report.json")}`);
  console.log(`HTML report: ${join(RESULTS_DIR, "report.html")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
