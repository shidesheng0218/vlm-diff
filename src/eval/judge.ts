// LLM-judge for description quality. Scores a predicted description against
// the ground-truth mutation description on a 1-5 scale. Per the plan, this
// score is meant to be calibrated against a human-labeled subset (~20%)
// before being trusted — this module only produces the raw judge score.

import type { Provider } from "../provider/types.js";
import { textBlock } from "../provider/types.js";

export interface JudgeScore {
  score: number; // 1-5
  rationale: string;
}

const JUDGE_SYSTEM = `You are grading how well a predicted description of a UI change matches the ground-truth description of what actually changed. Score 1 (completely wrong or missing) to 5 (accurately captures the same change, wording may differ).

Respond with strict JSON only, no markdown fences:
{"score": <1-5 integer>, "rationale": "<one sentence>"}`;

export async function judgeDescription(
  provider: Provider,
  groundTruth: string,
  predicted: string | undefined,
): Promise<JudgeScore> {
  if (!predicted) return { score: 1, rationale: "no description produced" };

  const result = await provider.send(JUDGE_SYSTEM, [
    {
      role: "user",
      content: [textBlock(`Ground truth: ${groundTruth}\nPredicted: ${predicted}`)],
    },
  ]);

  return parseJudgeScore(result.text);
}

export function parseJudgeScore(text: string): JudgeScore {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    const score = typeof parsed.score === "number" ? Math.max(1, Math.min(5, Math.round(parsed.score))) : 1;
    return { score, rationale: parsed.rationale ?? "" };
  } catch {
    return { score: 1, rationale: `unparseable judge output: ${text.slice(0, 100)}` };
  }
}

export function averageScore(scores: JudgeScore[]): number {
  if (scores.length === 0) return 0;
  return scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
}
