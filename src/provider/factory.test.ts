import { test } from "node:test";
import assert from "node:assert/strict";
import { createJudgeProvider, createProvider } from "./factory.js";

const ANTHROPIC_KEY = "ANTHROPIC_API_KEY";
const OPENAI_KEY = "OPENAI_API_KEY";

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("createJudgeProvider: picks an independent vendor when both keys are set", () => {
  withEnv({ [ANTHROPIC_KEY]: "sk-ant-test", [OPENAI_KEY]: "sk-oai-test" }, () => {
    const primary = createProvider({ provider: "anthropic" });
    const judge = createJudgeProvider(primary);
    assert.equal(judge.name, "openai");
    assert.notEqual(judge.name, primary.name);
  });
});

test("createJudgeProvider: falls back to the primary provider when no second key is set", () => {
  withEnv({ [ANTHROPIC_KEY]: "sk-ant-test", [OPENAI_KEY]: undefined }, () => {
    const primary = createProvider({ provider: "anthropic" });
    const judge = createJudgeProvider(primary);
    assert.equal(judge, primary);
  });
});

test("createJudgeProvider: an explicit provider choice overrides auto-detection", () => {
  withEnv({ [ANTHROPIC_KEY]: "sk-ant-test", [OPENAI_KEY]: "sk-oai-test" }, () => {
    const primary = createProvider({ provider: "anthropic" });
    const judge = createJudgeProvider(primary, { provider: "anthropic" });
    assert.equal(judge.name, "anthropic");
  });
});
