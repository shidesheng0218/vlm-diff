import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "./args.js";

test("parseArgs: value flags consume the next token", () => {
  const a = parseArgs(["diff", "before.png", "after.png", "--provider", "dashscope", "--model", "qwen3.8-max"]);
  assert.deepEqual(a.positional, ["diff", "before.png", "after.png"]);
  assert.equal(a.flags.get("provider"), "dashscope");
  assert.equal(a.flags.get("model"), "qwen3.8-max");
});

test("parseArgs: boolean flags never swallow the next positional", () => {
  // regression: --no-vlm before.png used to eat before.png as its "value"
  const a = parseArgs(["diff", "--no-vlm", "before.png", "after.png"]);
  assert.equal(a.flags.get("no-vlm"), true);
  assert.deepEqual(a.positional, ["diff", "before.png", "after.png"]);
});

test("parseArgs: --flag=value form", () => {
  const a = parseArgs(["diff", "a.png", "b.png", "--threshold=0.005", "--json"]);
  assert.equal(a.flags.get("threshold"), "0.005");
  assert.equal(a.flags.get("json"), true);
});

test("parseArgs: a flag before another flag stays boolean", () => {
  const a = parseArgs(["diff", "a.png", "b.png", "--json", "--no-cache"]);
  assert.equal(a.flags.get("json"), true);
  assert.equal(a.flags.get("no-cache"), true);
});
