import { test } from "node:test";
import assert from "node:assert/strict";
import { averageScore, judgeDescription, parseJudgeScore } from "./judge.js";
import { scriptedProvider } from "../test-utils.js";

test("parseJudgeScore: parses well-formed JSON and clamps to 1-5", () => {
  assert.equal(parseJudgeScore('{"score":4,"rationale":"close match"}').score, 4);
  assert.equal(parseJudgeScore('{"score":9,"rationale":"x"}').score, 5);
  assert.equal(parseJudgeScore('{"score":0,"rationale":"x"}').score, 1);
});

test("parseJudgeScore: falls back to score 1 on malformed output", () => {
  const result = parseJudgeScore("not json");
  assert.equal(result.score, 1);
});

test("judgeDescription: missing prediction scores 1 without calling the provider", async () => {
  const provider = scriptedProvider([{ text: "unused" }]);
  const result = await judgeDescription(provider, "button turned red", undefined);
  assert.equal(result.score, 1);
  assert.equal(provider.calls.length, 0);
});

test("judgeDescription: sends ground truth + predicted text and parses score", async () => {
  const provider = scriptedProvider([{ text: '{"score":5,"rationale":"exact match"}' }]);
  const result = await judgeDescription(provider, "button turned red", "the button changed color to red");
  assert.equal(result.score, 5);
  assert.equal(provider.calls.length, 1);
});

test("averageScore: computes mean across scores, 0 for empty list", () => {
  assert.equal(averageScore([]), 0);
  assert.equal(averageScore([{ score: 2, rationale: "" }, { score: 4, rationale: "" }]), 3);
});
