import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateCostUsd } from "./pricing.js";

test("estimateCostUsd: computes cost for a known model", () => {
  const cost = estimateCostUsd("claude-sonnet-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 });
  assert.equal(cost, 3 + 15); // $3/M in + $15/M out
});

test("estimateCostUsd: unknown model returns 0", () => {
  assert.equal(estimateCostUsd("some-unreleased-model", { inputTokens: 1000, outputTokens: 1000 }), 0);
});

test("estimateCostUsd: zero usage returns 0", () => {
  assert.equal(estimateCostUsd("claude-sonnet-5", { inputTokens: 0, outputTokens: 0 }), 0);
});

test("estimateCostUsd: PRICING_OVERRIDES_JSON overrides the built-in table", () => {
  const prev = process.env.PRICING_OVERRIDES_JSON;
  process.env.PRICING_OVERRIDES_JSON = JSON.stringify({
    "claude-sonnet-5": { inputPerMillion: 1, outputPerMillion: 2 },
  });
  try {
    const cost = estimateCostUsd("claude-sonnet-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    assert.equal(cost, 3);
  } finally {
    if (prev === undefined) delete process.env.PRICING_OVERRIDES_JSON;
    else process.env.PRICING_OVERRIDES_JSON = prev;
  }
});
