// InstrumentedProvider: a transparent wrapper that turns "the model is a
// black box" into "every call is logged, capped, and budget-guarded".
//
// - logs every send() to an append-only JSONL cost log (src/cost/log.ts)
// - enforces an optional session budget (VLM_DIFF_BUDGET_USD): once the
//   accumulated estimated spend crosses it, further calls fail fast instead
//   of silently running up a bill
// - passes SendOpts (fn label, maxTokens) through to the inner provider

import type { Msg, Provider, SendOpts, TurnResult } from "./types.js";
import { estimateCostUsd } from "../cost/pricing.js";
import { appendCostLog } from "../cost/log.js";

export class InstrumentedProvider implements Provider {
  readonly name: string;
  readonly model: string;
  private spentUsd = 0;

  constructor(
    private readonly inner: Provider,
    private readonly opts: { logPath?: string; budgetUsd?: number } = {},
  ) {
    this.name = inner.name;
    this.model = inner.model;
  }

  /** estimated USD spent through this wrapper so far (session-scoped) */
  get sessionSpendUsd(): number {
    return this.spentUsd;
  }

  private budgetUsd(): number | undefined {
    if (this.opts.budgetUsd !== undefined) return this.opts.budgetUsd;
    const raw = process.env.VLM_DIFF_BUDGET_USD;
    return raw !== undefined && raw !== "" ? Number(raw) : undefined;
  }

  async send(system: string, messages: Msg[], opts?: SendOpts): Promise<TurnResult> {
    const budget = this.budgetUsd();
    if (budget !== undefined && this.spentUsd >= budget) {
      throw new Error(
        `Budget exceeded: $${this.spentUsd.toFixed(4)} already spent of the $${budget} budget (VLM_DIFF_BUDGET_USD). ` +
          `Raise the budget or rerun fewer pairs.`,
      );
    }

    const t0 = Date.now();
    const fn = opts?.fn ?? "send";
    try {
      const result = await this.inner.send(system, messages, opts);
      const costUsd = estimateCostUsd(this.model, result.usage);
      this.spentUsd += costUsd;
      await appendCostLog(
        {
          ts: new Date().toISOString(),
          fn,
          provider: this.name,
          model: this.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          latencyMs: Date.now() - t0,
          costUsd,
          ok: true,
        },
        this.opts.logPath,
      );
      return result;
    } catch (err) {
      await appendCostLog(
        {
          ts: new Date().toISOString(),
          fn,
          provider: this.name,
          model: this.model,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: Date.now() - t0,
          costUsd: 0,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        },
        this.opts.logPath,
      );
      throw err;
    }
  }
}
