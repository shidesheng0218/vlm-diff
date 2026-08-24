// Transient-error retry for provider calls. DashScope/Moonshot/Anthropic all
// return 429 (or 5xx) under load; the eval scripts fire several calls in
// parallel (multi-region classification), so a naive single attempt dies
// mid-run and throws away the whole report. Exponential backoff with a small
// attempt budget keeps eval runs alive without masking real auth/quota errors.

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
}

function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === 429) return true;
  if (typeof status === "number" && status >= 500) return true;
  // network-level failures (no HTTP status at all)
  if (status === undefined && err instanceof Error && /fetch|network|ECONNRESET|ETIMEDOUT|socket/i.test(err.message)) return true;
  return false;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 8;
  const baseDelayMs = opts.baseDelayMs ?? 15000;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === maxAttempts) throw err;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      console.warn(`  [retry] attempt ${attempt}/${maxAttempts} failed (${(err as Error)?.message ?? err}); waiting ${delay / 1000}s`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}
