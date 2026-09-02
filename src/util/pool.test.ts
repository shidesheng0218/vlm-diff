import { test } from "node:test";
import assert from "node:assert/strict";
import { mapWithConcurrency } from "./pool.js";

test("mapWithConcurrency: preserves input order", async () => {
  const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (x) => x * 10);
  assert.deepEqual(out, [10, 20, 30, 40, 50]);
});

test("mapWithConcurrency: never exceeds the concurrency cap", async () => {
  let running = 0;
  let peak = 0;
  await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
  });
  assert.ok(peak <= 3, `peak concurrency was ${peak}`);
  assert.ok(peak >= 2, `expected real parallelism, peak was ${peak}`);
});

test("mapWithConcurrency: handles empty input and limit > items", async () => {
  assert.deepEqual(await mapWithConcurrency([], 4, async (x: number) => x), []);
  assert.deepEqual(await mapWithConcurrency([1], 8, async (x) => x + 1), [2]);
});
