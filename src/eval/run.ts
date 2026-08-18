// Orchestrates the full comparison: runs all three baselines over the
// generated dataset, computes metrics, and writes a report to results/.
// Requires a real API key (ANTHROPIC_API_KEY or OPENAI_API_KEY) and burns
// real credits — this is the manual, explicitly-triggered evaluation script
// (not part of `npm test`), per the plan's cost-control section.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createJudgeProvider, createProvider } from "../provider/factory.js";
import { runFullPipeline, runPixelDiffOnly, runRawPairToVlm, type BaselineResult } from "./baselines.js";
import { summarize } from "./metrics.js";
import { judgeDescription, averageScore } from "./judge.js";
import { FileCacheStore } from "../cache/store.js";
import { generateHtmlReport, computeReportSummary } from "../report/generate.js";
import type { PairRecord } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const RESULTS_DIR = join(__dirname, "..", "..", "results");
const CACHE_DIR = join(__dirname, "..", "..", ".cache", "classifications");

async function main() {
  const datasetJson = await readFile(join(DATA_DIR, "dataset.json"), "utf8");
  const pairs: PairRecord[] = JSON.parse(datasetJson);
  const provider = createProvider();
  const judgeProvider = createJudgeProvider(provider);
  const cacheEnabled = process.env.VLM_DIFF_NO_CACHE !== "1";
  const cache = cacheEnabled ? new FileCacheStore(CACHE_DIR) : undefined;

  console.log(`Loaded ${pairs.length} pairs. Running baselines with ${provider.name}/${provider.model}...`);
  console.log(`Judging descriptions with ${judgeProvider.name}/${judgeProvider.model}...`);
  console.log(`Classification cache: ${cacheEnabled ? `enabled (${CACHE_DIR})` : "disabled"}\n`);

  const rawResults: BaselineResult[] = [];
  const pixelResults: BaselineResult[] = [];
  const pipelineResults: BaselineResult[] = [];

  for (const pair of pairs) {
    console.log(`  ${pair.id}`);
    rawResults.push(await runRawPairToVlm(provider, pair, DATA_DIR));
    pixelResults.push(await runPixelDiffOnly(pair, DATA_DIR));
    pipelineResults.push(await runFullPipeline(provider, pair, DATA_DIR, cache));
  }

  const rawSummary = summarize(pairs, rawResults);
  const pixelSummary = summarize(pairs, pixelResults);
  const pipelineSummary = summarize(pairs, pipelineResults);

  // Description-quality judging, only for the two baselines that produce
  // free-text descriptions (pixel-diff-only has none).
  const byId = new Map(pairs.map((p) => [p.id, p]));
  const rawJudgeScores = await Promise.all(
    rawResults.map((r) => judgeDescription(judgeProvider, byId.get(r.pairId)!.description, r.description)),
  );
  const pipelineJudgeScores = await Promise.all(
    pipelineResults.map((r) => judgeDescription(judgeProvider, byId.get(r.pairId)!.description, r.description)),
  );

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
    },
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
