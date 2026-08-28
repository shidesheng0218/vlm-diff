// Blind LLM-judge comparison of deterministic (template) vs VLM descriptions.
//
// Reads an existing MVP report (which carries per-pair descriptions for both
// the tieredPipeline and fullPipelineWithDomHint arms) plus the dataset ground
// truth, and asks a judge model — chosen to be from a DIFFERENT vendor than
// the model that generated the VLM descriptions — to score both candidates
// blind: labels are randomized per pair, and the judge is never told which
// arm produced which text.
//
// Usage:
//   npm run judge:mvp
//   JUDGE_REPORT=results/mvp-report.json VLM_DIFF_JUDGE_PROVIDER=dashscope \
//     VLM_DIFF_JUDGE_MODEL=qwen3.8-max npm run judge:mvp

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createProvider } from "../provider/factory.js";
import type { PairRecord } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const RESULTS_DIR = join(__dirname, "..", "..", "results");

const REPORT_PATH = process.env.JUDGE_REPORT ?? join(RESULTS_DIR, "mvp-report.json");

interface PerPair {
  id: string;
  predictedChangeType: string | null;
  description: string | null;
}

interface MvpReport {
  model: string;
  n: number;
  baselines: Record<string, { perPair: PerPair[] }>;
}

interface JudgeScores {
  accuracy: number;
  specificity: number;
  readability: number;
}

interface JudgeVerdict {
  A: JudgeScores;
  B: JudgeScores;
  winner: "A" | "B" | "tie";
}

const SYSTEM_PROMPT = `You are an expert evaluator for a UI visual-regression tool. Each candidate description summarizes the single most important change between two UI screenshots (before/after). You will be given the ground-truth change and two candidate descriptions, labeled A and B.

Score each candidate 1-5 (integers) on:
- "accuracy": does it correctly describe the actual change (right property, right direction, right values)?
- "specificity": does it pin down what changed and by how much (colors, pixel deltas, element identity)?
- "readability": concise and immediately useful to a developer triaging a regression.

Then pick a winner. Respond with strict JSON only, no markdown fences:
{"A": {"accuracy": 1-5, "specificity": 1-5, "readability": 1-5},
 "B": {"accuracy": 1-5, "specificity": 1-5, "readability": 1-5},
 "winner": "A" | "B" | "tie"}`;

function hashSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function parseVerdict(text: string): JudgeVerdict | undefined {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
  try {
    const j = JSON.parse(cleaned);
    if (j?.A && j?.B && ["A", "B", "tie"].includes(j.winner)) return j;
  } catch {
    /* fall through */
  }
  return undefined;
}

async function main() {
  const report: MvpReport = JSON.parse(await readFile(REPORT_PATH, "utf8"));
  const dataset: PairRecord[] = JSON.parse(await readFile(join(DATA_DIR, "dataset.json"), "utf8"));
  const byId = new Map(dataset.map((d) => [d.id, d]));

  const tiered = new Map(report.baselines.tieredPipeline.perPair.map((p) => [p.id, p]));
  const vlm = new Map(report.baselines.fullPipelineWithDomHint.perPair.map((p) => [p.id, p]));

  // Judge must differ from the model that wrote the VLM descriptions
  const judge = createProvider({
    provider: process.env.VLM_DIFF_JUDGE_PROVIDER,
    model: process.env.VLM_DIFF_JUDGE_MODEL,
  });

  console.log(`Blind judge: ${report.model}-generated VLM descriptions vs deterministic templates`);
  console.log(`Report: ${REPORT_PATH} | judge: ${judge.name}/${judge.model}\n`);

  interface PairOutcome {
    id: string;
    kind: string;
    tieredScores: JudgeScores;
    vlmScores: JudgeScores;
    winner: "tiered" | "vlm" | "tie";
  }
  const outcomes: PairOutcome[] = [];
  let parseFailures = 0;

  for (const [id, t] of tiered) {
    const v = vlm.get(id);
    const gt = byId.get(id);
    if (!v || !gt || !t.description || !v.description) continue;

    // Blind + order-randomized: arm→label assignment is seeded by pair id
    const tieredFirst = hashSeed(id) % 2 === 0;
    const labelFor = (desc: string) => (tieredFirst ? `A: ${desc}` : `B: ${desc}`);
    const user = [
      `Ground truth change (${gt.kind}): ${gt.description}`,
      ``,
      `Candidate ${labelFor(t.description)}`,
      `Candidate ${labelFor(v.description!)}`,
    ].join("\n");

    const result = await judge.send(SYSTEM_PROMPT, [
      { role: "user", content: [{ type: "text", text: user }] },
    ]);
    const verdict = parseVerdict(result.text);
    if (!verdict) {
      parseFailures++;
      console.log(`  ${id}: judge returned unparseable response, skipped`);
      continue;
    }
    const tieredScores = tieredFirst ? verdict.A : verdict.B;
    const vlmScores = tieredFirst ? verdict.B : verdict.A;
    const winner =
      verdict.winner === "tie" ? "tie" : verdict.winner === (tieredFirst ? "A" : "B") ? "tiered" : "vlm";
    outcomes.push({ id, kind: gt.kind, tieredScores, vlmScores, winner });
    console.log(`  ${id}: ${winner} (tiered ${tieredScores.accuracy}/${tieredScores.specificity}/${tieredScores.readability} vs vlm ${vlmScores.accuracy}/${vlmScores.specificity}/${vlmScores.readability})`);
  }

  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  const dims = ["accuracy", "specificity", "readability"] as const;
  const summary = {
    generatedAt: new Date().toISOString(),
    reportJudged: REPORT_PATH,
    vlmDescriptionsBy: report.model,
    judge: `${judge.name}/${judge.model}`,
    pairsJudged: outcomes.length,
    parseFailures,
    means: Object.fromEntries(
      dims.map((d) => [
        d,
        {
          tiered: Number(avg(outcomes.map((o) => o.tieredScores[d])).toFixed(2)),
          vlm: Number(avg(outcomes.map((o) => o.vlmScores[d])).toFixed(2)),
        },
      ]),
    ),
    winnerCounts: {
      tiered: outcomes.filter((o) => o.winner === "tiered").length,
      vlm: outcomes.filter((o) => o.winner === "vlm").length,
      tie: outcomes.filter((o) => o.winner === "tie").length,
    },
    perPair: outcomes,
  };

  await mkdir(RESULTS_DIR, { recursive: true });
  const outPath = join(RESULTS_DIR, "judge-report.json");
  await writeFile(outPath, JSON.stringify(summary, null, 2));

  console.log(`\n=== Blind Judge Summary (${outcomes.length} pairs, judge=${judge.model}) ===`);
  for (const d of dims) {
    const m = summary.means[d] as { tiered: number; vlm: number };
    console.log(`${d.padEnd(12)} tiered ${m.tiered} vs vlm ${m.vlm}`);
  }
  console.log(`winner       tiered ${summary.winnerCounts.tiered} / vlm ${summary.winnerCounts.vlm} / tie ${summary.winnerCounts.tie}`);
  console.log(`\nReport: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
