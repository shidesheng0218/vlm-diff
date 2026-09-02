import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJson } from "./json.js";

test("extractJson: parses plain JSON", () => {
  assert.deepEqual(extractJson('{"a": 1}'), { a: 1 });
});

test("extractJson: strips markdown fences", () => {
  assert.deepEqual(extractJson('```json\n{"a": 1}\n```'), { a: 1 });
});

test("extractJson: finds JSON embedded in prose", () => {
  assert.deepEqual(extractJson('Here you go: {"a": {"b": 2}} hope it helps'), { a: { b: 2 } });
});

test("extractJson: returns undefined for garbage", () => {
  assert.equal(extractJson("no json here"), undefined);
  assert.equal(extractJson('{"unclosed": '), undefined);
});
