// Per-model USD pricing, in dollars per 1M tokens. These defaults are
// approximate and were accurate at time of writing — provider pricing
// changes independently of this repo, so treat cost figures as directional,
// not billing-accurate. Override via PRICING_OVERRIDES_JSON (a JSON object
// keyed by model name) if your rates differ.

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

export const PRICING_TABLE: Record<string, ModelPricing> = {
  "claude-sonnet-5": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-opus-4.8": { inputPerMillion: 15, outputPerMillion: 75 },
  "claude-haiku-4.5": { inputPerMillion: 0.8, outputPerMillion: 4 },
  "gpt-5": { inputPerMillion: 5, outputPerMillion: 15 },
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  // Kimi K3 — Moonshot direct and DashScope-hosted share the same ballpark.
  // Verify against current vendor pricing before treating costs as exact.
  "kimi-k3": { inputPerMillion: 0.6, outputPerMillion: 2.5 },
  "kimi/kimi-k3": { inputPerMillion: 0.6, outputPerMillion: 2.5 },
  // Verify against current DashScope pricing.
  "qwen3.8-max": { inputPerMillion: 1.2, outputPerMillion: 6 },
};

function loadOverrides(): Record<string, ModelPricing> {
  const raw = process.env.PRICING_OVERRIDES_JSON;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    console.warn("[cost] PRICING_OVERRIDES_JSON is not valid JSON — ignoring overrides");
    return {};
  }
}

const warnedModels = new Set<string>();

/** Returns 0 for unknown models and warns once per model, so silently-wrong
 *  cost columns can't sneak into a report. */
export function estimateCostUsd(model: string, usage: { inputTokens: number; outputTokens: number }): number {
  const pricing = loadOverrides()[model] ?? PRICING_TABLE[model];
  if (!pricing) {
    if (!warnedModels.has(model)) {
      warnedModels.add(model);
      console.warn(`[cost] no pricing known for model "${model}" — cost reported as $0 (set PRICING_OVERRIDES_JSON to fix)`);
    }
    return 0;
  }
  return (
    (usage.inputTokens / 1_000_000) * pricing.inputPerMillion +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMillion
  );
}
