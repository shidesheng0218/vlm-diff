// Statistical rigor for headline metrics. v0.1 reported point estimates only;
// with 6 no-change pairs a "0% false-positive rate" had a 95% CI upper bound
// near 39%. Everything here is dependency-free pure TS.
//
// - Clopper-Pearson exact CI for rates (recall, FP rate, type accuracy)
// - Wilson score CI (the usual alternative; included for cross-checks)
// - McNemar exact test for paired binary outcomes (two arms, same pairs)
// - Seeded bootstrap for mean score differences (judge comparisons)

export interface ConfidenceInterval {
  lower: number;
  upper: number;
  confidence: number;
}

// ── special functions ────────────────────────────────────────────────────────

/** Lanczos approximation of ln Γ(x). */
function logGamma(x: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = 0.99999999999980993;
  for (let i = 0; i < g.length; i++) a += g[i] / (x + i + 1);
  const t = x + g.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the regularized incomplete beta function (Lentz). */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-12;
  const FPMIN = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta function I_x(a, b). */
function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betaContinuedFraction(a, b, x)) / a;
  }
  return 1 - (bt * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Inverse of the regularized incomplete beta (beta quantile) via bisection. */
function betaQuantile(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0;
  let hi = 1;
  let x = 0.5;
  for (let i = 0; i < 100; i++) {
    x = (lo + hi) / 2;
    const fx = regularizedBeta(x, a, b);
    if (Math.abs(fx - p) < 1e-10) break;
    if (fx < p) lo = x;
    else hi = x;
  }
  return x;
}

// ── confidence intervals for rates ──────────────────────────────────────────

/**
 * Clopper-Pearson exact CI for k successes in n trials. Conservative by
 * construction — the right choice for headline claims ("0% FP" becomes
 * "[0%, 8.2%]" instead of a misleading point estimate).
 */
export function clopperPearson(k: number, n: number, confidence = 0.95): ConfidenceInterval {
  if (n === 0) return { lower: 0, upper: 1, confidence };
  const alpha = 1 - confidence;
  const lower = k === 0 ? 0 : betaQuantile(alpha / 2, k, n - k + 1);
  const upper = k === n ? 1 : betaQuantile(1 - alpha / 2, k + 1, n - k);
  return { lower, upper, confidence };
}

/** Wilson score CI — less conservative than Clopper-Pearson, good mid-n behavior. */
export function wilson(k: number, n: number, confidence = 0.95): ConfidenceInterval {
  if (n === 0) return { lower: 0, upper: 1, confidence };
  // z values for common confidence levels; otherwise fall back to 1.96
  const z = confidence === 0.99 ? 2.575829 : confidence === 0.9 ? 1.644854 : 1.959964;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return {
    lower: Math.max(0, (center - spread) / denom),
    upper: Math.min(1, (center + spread) / denom),
    confidence,
  };
}

// ── paired comparisons ───────────────────────────────────────────────────────

/** Sum of binomial coefficients C(n, i) for i = 0..k, computed iteratively. */
function binomialCdf(k: number, n: number, p = 0.5): number {
  if (k < 0) return 0;
  if (k >= n) return 1;
  let term = Math.pow(1 - p, n); // P(X = 0)
  let cdf = term;
  for (let i = 1; i <= k; i++) {
    term *= ((n - i + 1) / i) * (p / (1 - p));
    cdf += term;
  }
  return Math.min(1, cdf);
}

/**
 * McNemar exact test for paired binary outcomes: do two arms evaluated on the
 * SAME pairs differ in correctness? `discordant` = [arm A right & B wrong,
 * A wrong & B right]. Under H0 the discordants split 50/50.
 */
export function mcnemarExact(
  aRightBWrong: number,
  aWrongBRight: number,
): { b: number; c: number; n: number; pValue: number } {
  const b = aRightBWrong;
  const c = aWrongBRight;
  const n = b + c;
  if (n === 0) return { b, c, n, pValue: 1 };
  const k = Math.min(b, c);
  return { b, c, n, pValue: Math.min(1, 2 * binomialCdf(k, n)) };
}

// ── bootstrap ────────────────────────────────────────────────────────────────

/** Deterministic PRNG so bootstrap CIs are reproducible across runs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Percentile bootstrap CI for the mean of paired differences (e.g. judge
 * accuracy(tiered) − accuracy(vlm) per pair). Seeded → reproducible.
 */
export function bootstrapMeanCi(
  differences: number[],
  opts: { iterations?: number; confidence?: number; seed?: number } = {},
): ConfidenceInterval & { mean: number } {
  const { iterations = 10000, confidence = 0.95, seed = 42 } = opts;
  const n = differences.length;
  const mean = n > 0 ? differences.reduce((s, x) => s + x, 0) / n : 0;
  if (n === 0) return { mean: 0, lower: 0, upper: 0, confidence };
  if (n === 1) return { mean, lower: mean, upper: mean, confidence };

  const rng = mulberry32(seed);
  const means: number[] = [];
  for (let it = 0; it < iterations; it++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += differences[Math.floor(rng() * n)];
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  const alpha = 1 - confidence;
  const lo = means[Math.floor((alpha / 2) * iterations)];
  const hi = means[Math.min(means.length - 1, Math.ceil((1 - alpha / 2) * iterations) - 1)];
  return { mean, lower: lo, upper: hi, confidence };
}

// ── formatting helper ────────────────────────────────────────────────────────

/** "94.4% [82.1%, 99.1%]" for tables and reports. */
export function formatRateWithCi(k: number, n: number, confidence = 0.95): string {
  const ci = clopperPearson(k, n, confidence);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  return `${pct(n > 0 ? k / n : 0)} [${pct(ci.lower)}, ${pct(ci.upper)}]`;
}
