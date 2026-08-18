import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCacheKey } from "./key.js";

test("computeCacheKey: identical inputs produce the same key", () => {
  const before = Buffer.from([1, 2, 3]);
  const after = Buffer.from([4, 5, 6]);
  assert.equal(computeCacheKey(before, after), computeCacheKey(before, after));
});

test("computeCacheKey: different inputs produce different keys", () => {
  const before = Buffer.from([1, 2, 3]);
  const afterA = Buffer.from([4, 5, 6]);
  const afterB = Buffer.from([7, 8, 9]);
  assert.notEqual(computeCacheKey(before, afterA), computeCacheKey(before, afterB));
});

test("computeCacheKey: before/after are not commutative", () => {
  const a = Buffer.from([1, 2, 3]);
  const b = Buffer.from([4, 5, 6]);
  assert.notEqual(computeCacheKey(a, b), computeCacheKey(b, a));
});
