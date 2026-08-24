import { test } from "node:test";
import assert from "node:assert/strict";
import { withRetry } from "./retry.js";

function httpError(status: number, message = `HTTP ${status}`): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

test("withRetry: succeeds on first attempt without retrying", async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(calls, 1);
});

test("withRetry: retries on 429 and eventually succeeds", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw httpError(429, "engine overloaded");
      return "ok";
    },
    { baseDelayMs: 1 },
  );
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("withRetry: retries on 5xx", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      if (calls < 2) throw httpError(503);
      return "ok";
    },
    { baseDelayMs: 1 },
  );
  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

test("withRetry: does NOT retry auth errors (401/403)", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw httpError(401, "invalid api key");
      },
      { baseDelayMs: 1 },
    ),
    /invalid api key/,
  );
  assert.equal(calls, 1);
});

test("withRetry: gives up after maxAttempts", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw httpError(429);
      },
      { baseDelayMs: 1, maxAttempts: 3 },
    ),
    /HTTP 429/,
  );
  assert.equal(calls, 3);
});
