// Transient-error retry for provider calls. DashScope/Moonshot/Anthropic all
// return 429 (or 5xx) under load; the eval scripts fire several calls in
// parallel (multi-region classification), so a naive single attempt dies
// mid-run and throws away the whole report. Exponential backoff with a small
// attempt budget keeps eval runs alive without masking real auth/quota errors.

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  /** exponential backoff cap (default 30s) */
  maxDelayMs?: number;
}

function envNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === 429) return true;
  if (typeof status === "number" && status >= 500) return true;
  // network-level failures and timeouts (no HTTP status at all)
  if (status === undefined && err instanceof Error && /fetch|network|ECONNRESET|ETIMEDOUT|socket|timed?\s?out/i.test(err.message)) return true;
  return false;
}

/** Reject if `p` doesn't settle within `ms`. Placed *inside* the retry layer
 *  so a hung API call becomes a retryable failure instead of a stalled run. */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  // v0.1 defaults (8 attempts, 15s base) could sleep ~3.4h in the worst case.
  // 5 attempts on a 5s base capped at 30s waits at most ~100s total, which
  // rides out provider overload spikes without stalling an eval run. Both are
  // overridable via VLM_DIFF_RETRY_ATTEMPTS / VLM_DIFF_RETRY_BASE_MS.
  const maxAttempts = opts.maxAttempts ?? envNumber("VLM_DIFF_RETRY_ATTEMPTS") ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? envNumber("VLM_DIFF_RETRY_BASE_MS") ?? 5000;
  const maxDelayMs = opts.maxDelayMs ?? 30000;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === maxAttempts) throw err;
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      console.warn(`  [retry] attempt ${attempt}/${maxAttempts} failed (${(err as Error)?.message ?? err}); waiting ${delay / 1000}s`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}
