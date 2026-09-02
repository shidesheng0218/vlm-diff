import { test } from "node:test";
import assert from "node:assert/strict";
import { clopperPearson, wilson, mcnemarExact, bootstrapMeanCi, formatRateWithCi } from "./stats.js";

test("clopperPearson: 0/6 reproduces the v0.1 FP weakness (~46% upper bound)", () => {
  const ci = clopperPearson(0, 6);
  assert.equal(ci.lower, 0);
  // exact: 1 - 0.025^(1/6) = 0.4593
  assert.ok(Math.abs(ci.upper - 0.4593) < 0.005, `upper was ${ci.upper}`);
});

test("clopperPearson: 0/42 tightens the FP bound to ~8.4%", () => {
  const ci = clopperPearson(0, 42);
  assert.ok(Math.abs(ci.upper - 0.0841) < 0.003, `upper was ${ci.upper}`);
});

test("clopperPearson: perfect 30/30 lower bound matches 0.025^(1/30)", () => {
  const ci = clopperPearson(30, 30);
  assert.equal(ci.upper, 1);
  assert.ok(Math.abs(ci.lower - 0.8843) < 0.005, `lower was ${ci.lower}`);
});

test("clopperPearson: bracketing — true rate sits inside for a mid case", () => {
  const ci = clopperPearson(14, 30);
  assert.ok(ci.lower < 14 / 30 && 14 / 30 < ci.upper);
  assert.ok(ci.lower > 0.2 && ci.upper < 0.75);
});

test("clopperPearson: empty denominator yields the vacuous [0, 1]", () => {
  assert.deepEqual(clopperPearson(0, 0), { lower: 0, upper: 1, confidence: 0.95 });
});

test("wilson: 14/30 lands in the expected range", () => {
  const ci = wilson(14, 30);
  assert.ok(ci.lower > 0.28 && ci.lower < 0.32, `lower was ${ci.lower}`);
  assert.ok(ci.upper > 0.62 && ci.upper < 0.66, `upper was ${ci.upper}`);
});

test("mcnemarExact: 14 vs 2 discordants is significant", () => {
  const r = mcnemarExact(14, 2);
  // exact two-sided: 2 * P(X <= 2), X ~ Bin(16, 0.5) = 2 * 137/65536
  assert.ok(Math.abs(r.pValue - 0.00418) < 0.0005, `p was ${r.pValue}`);
});

test("mcnemarExact: symmetric discordants are not significant", () => {
  const r = mcnemarExact(5, 5);
  assert.ok(r.pValue > 0.99);
});

test("mcnemarExact: zero discordants means identical arms", () => {
  assert.equal(mcnemarExact(0, 0).pValue, 1);
});

test("bootstrapMeanCi: degenerate inputs", () => {
  assert.deepEqual(bootstrapMeanCi([]), { mean: 0, lower: 0, upper: 0, confidence: 0.95 });
  const single = bootstrapMeanCi([0.7]);
  assert.equal(single.mean, 0.7);
  assert.equal(single.lower, 0.7);
});

test("bootstrapMeanCi: reproducible with the same seed, contains the sample mean", () => {
  const diffs = [0.2, -0.1, 0.4, 0.1, -0.2, 0.3, 0, 0.15, -0.05, 0.25];
  const a = bootstrapMeanCi(diffs, { seed: 7 });
  const b = bootstrapMeanCi(diffs, { seed: 7 });
  assert.deepEqual(a, b);
  assert.ok(a.lower <= a.mean && a.mean <= a.upper);
  const c = bootstrapMeanCi(diffs, { seed: 8 });
  // different seed → (almost surely) slightly different bounds
  assert.ok(c.lower !== a.lower || c.upper !== a.upper);
});

test("formatRateWithCi: produces point estimate + bracket", () => {
  const s = formatRateWithCi(0, 42);
  assert.match(s, /^0\.0% \[\d+\.\d+%, \d+\.\d+%\]$/);
});
