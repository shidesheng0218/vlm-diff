#!/usr/bin/env tsx
/**
 * Human calibration of the LLM judge — the debt flagged in judge.ts since
 * v0.1 ("meant to be calibrated against a ~20% human-labeled subset before
 * being trusted"). Compares the blind judge's verdicts against human labels
 * for every judged pair.
 *
 * Modes:
 *   npx tsx scripts/judge-calibration.ts worksheet
 *     Print the labeling worksheet (ground truth + both candidate
 *     descriptions per pair, labels randomized like the judge saw them).
 *
 *   npx tsx scripts/judge-calibration.ts score
 *     Read human labels from data/judge-human-labels.json, compute
 *     judge-vs-human agreement, write results/judge-calibration.json.
 *
 * Label file format (data/judge-human-labels.json):
 *   { "<pairId>": { "tieredCorrect": true, "vlmCorrect": false, "note": "…" } }
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const RESULTS_DIR = path.join(process.cwd(), "results");
const DATA_DIR = path.join(process.cwd(), "data");
const LABELS_PATH = path.join(DATA_DIR, "judge-human-labels.json");

interface PerPair {
  id: string;
  description: string | null;
}

interface MvpReport {
  model: string;
  baselines: Record<string, { perPair: PerPair[] }>;
}

interface JudgePair {
  id: string;
  kind: string;
  tieredScores: { accuracy: number; specificity: number; readability: number };
  vlmScores: { accuracy: number; specificity: number; readability: number };
  winner: "tiered" | "vlm" | "tie";
}

interface JudgeReport {
  judge: string;
  vlmDescriptionsBy: string;
  reportJudged: string;
  perPair: JudgePair[];
}

interface HumanLabel {
  tieredCorrect: boolean;
  vlmCorrect: boolean;
  note?: string;
}

async function loadContext() {
  const judge: JudgeReport = JSON.parse(await readFile(path.join(RESULTS_DIR, "judge-report.json"), "utf8"));
  const mvp: MvpReport = JSON.parse(await readFile(judge.reportJudged, "utf8"));
  const dataset: Array<{ id: string; kind: string; description: string }> = JSON.parse(
    await readFile(path.join(DATA_DIR, "dataset.json"), "utf8"),
  );
  const gt = new Map(dataset.map((d) => [d.id, d]));
  const tiered = new Map(mvp.baselines.tieredPipeline.perPair.map((p) => [p.id, p.description]));
  const vlm = new Map(mvp.baselines.fullPipelineWithDomHint.perPair.map((p) => [p.id, p.description]));
  return { judge, gt, tiered, vlm };
}

async function worksheet() {
  const { judge, gt, tiered, vlm } = await loadContext();
  console.log(`# Judge calibration worksheet (${judge.perPair.length} pairs)\n`);
  console.log(`Judge: ${judge.judge} | descriptions by: ${judge.vlmDescriptionsBy}\n`);
  for (const p of judge.perPair) {
    const g = gt.get(p.id);
    console.log(`## ${p.id}  [${p.kind}]`);
    console.log(`Ground truth: ${g?.description ?? "(missing)"}\n`);
    console.log(`TIERED: ${tiered.get(p.id) ?? "(none)"}`);
    console.log(`VLM:    ${vlm.get(p.id) ?? "(none)"}`);
    console.log(`(judge verdict: ${p.winner}; scores tiered ${p.tieredScores.accuracy}/${p.tieredScores.specificity}/${p.tieredScores.readability} vs vlm ${p.vlmScores.accuracy}/${p.vlmScores.specificity}/${p.vlmScores.readability})\n`);
  }
  console.log(`\nLabel every pair into ${LABELS_PATH} as`);
  console.log(`{ "<pairId>": { "tieredCorrect": bool, "vlmCorrect": bool, "note": "…" } }`);
}

async function score() {
  const { judge, gt, tiered, vlm } = await loadContext();
  const labels: Record<string, HumanLabel> = JSON.parse(await readFile(LABELS_PATH, "utf8"));

  const missing = judge.perPair.filter((p) => !labels[p.id]).map((p) => p.id);
  if (missing.length > 0) {
    console.error(`Missing human labels for: ${missing.join(", ")}`);
    process.exit(1);
  }

  let judgeWinnerMatchesHuman = 0;
  let judgeAccuracyMatchesHuman = 0; // judge says tiered-more-accurate ⇔ human says tiered-correct > vlm-correct
  let tieredAccuracyAgreement = 0; // human tieredCorrect ⇔ judge tiered accuracy >= 4
  let vlmAccuracyAgreement = 0;
  const perPairOut: Array<Record<string, unknown>> = [];

  for (const p of judge.perPair) {
    const h = labels[p.id];
    // Human winner derived from correctness labels
    const humanWinner: "tiered" | "vlm" | "tie" =
      h.tieredCorrect === h.vlmCorrect ? "tie" : h.tieredCorrect ? "tiered" : "vlm";
    const winnerMatch = p.winner === humanWinner;
    if (winnerMatch) judgeWinnerMatchesHuman++;

    // accuracy-score agreement: threshold the judge's 1-5 accuracy at >=4 = "correct"
    const judgeTieredCorrect = p.tieredScores.accuracy >= 4;
    const judgeVlmCorrect = p.vlmScores.accuracy >= 4;
    if (judgeTieredCorrect === h.tieredCorrect) tieredAccuracyAgreement++;
    if (judgeVlmCorrect === h.vlmCorrect) vlmAccuracyAgreement++;
    const judgePrefersTieredAccuracy = p.tieredScores.accuracy > p.vlmScores.accuracy;
    const humanPrefersTieredAccuracy = h.tieredCorrect && !h.vlmCorrect;
    const judgePrefersVlmAccuracy = p.vlmScores.accuracy > p.tieredScores.accuracy;
    const humanPrefersVlmAccuracy = h.vlmCorrect && !h.tieredCorrect;
    const accuracyAligned =
      (judgePrefersTieredAccuracy && humanPrefersTieredAccuracy) ||
      (judgePrefersVlmAccuracy && humanPrefersVlmAccuracy) ||
      (p.tieredScores.accuracy === p.vlmScores.accuracy && h.tieredCorrect === h.vlmCorrect);
    if (accuracyAligned) judgeAccuracyMatchesHuman++;

    perPairOut.push({
      id: p.id,
      groundTruth: gt.get(p.id)?.description,
      tieredDescription: tiered.get(p.id),
      vlmDescription: vlm.get(p.id),
      judgeWinner: p.winner,
      humanWinner,
      winnerMatch,
      human: h,
      judgeScores: { tiered: p.tieredScores, vlm: p.vlmScores },
      note: h.note ?? null,
    });
  }

  const n = judge.perPair.length;
  const summary = {
    generatedAt: new Date().toISOString(),
    judge: judge.judge,
    vlmDescriptionsBy: judge.vlmDescriptionsBy,
    n,
    agreement: {
      winnerExact: { matches: judgeWinnerMatchesHuman, n, rate: judgeWinnerMatchesHuman / n },
      accuracyPreferenceAligned: { matches: judgeAccuracyMatchesHuman, n, rate: judgeAccuracyMatchesHuman / n },
      tieredCorrectThreshold4: { matches: tieredAccuracyAgreement, n, rate: tieredAccuracyAgreement / n },
      vlmCorrectThreshold4: { matches: vlmAccuracyAgreement, n, rate: vlmAccuracyAgreement / n },
    },
    perPair: perPairOut,
  };

  await mkdir(RESULTS_DIR, { recursive: true });
  const outPath = path.join(RESULTS_DIR, "judge-calibration.json");
  await writeFile(outPath, JSON.stringify(summary, null, 2));

  console.log(`Judge calibration (${n} pairs, judge=${judge.judge})\n`);
  console.log(`winner exact match:            ${judgeWinnerMatchesHuman}/${n} (${((judgeWinnerMatchesHuman / n) * 100).toFixed(1)}%)`);
  console.log(`accuracy preference aligned:   ${judgeAccuracyMatchesHuman}/${n} (${((judgeAccuracyMatchesHuman / n) * 100).toFixed(1)}%)`);
  console.log(`tiered correct @judge≥4:       ${tieredAccuracyAgreement}/${n} (${((tieredAccuracyAgreement / n) * 100).toFixed(1)}%)`);
  console.log(`vlm correct @judge≥4:          ${vlmAccuracyAgreement}/${n} (${((vlmAccuracyAgreement / n) * 100).toFixed(1)}%)`);
  console.log(`\nReport: ${outPath}`);
}

const mode = process.argv[2];
if (mode === "worksheet") worksheet().catch((e) => { console.error(e); process.exit(1); });
else if (mode === "score") score().catch((e) => { console.error(e); process.exit(1); });
else {
  console.log("Usage: tsx scripts/judge-calibration.ts worksheet | score");
  process.exit(2);
}
