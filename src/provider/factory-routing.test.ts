import { test } from "node:test";
import assert from "node:assert/strict";
import { createProvider } from "./factory.js";

test("factory: cheap tier defaults to the main model (no silent routing)", () => {
  const saved = process.env.MOONSHOT_API_KEY;
  process.env.MOONSHOT_API_KEY = "test-key";
  delete process.env.VLM_DIFF_CLASSIFY_MODEL;
  try {
    const p = createProvider({ provider: "moonshot", tier: "cheap" });
    assert.equal(p.model, "kimi-k3"); // moonshot's cheapModel IS the default
  } finally {
    if (saved === undefined) delete process.env.MOONSHOT_API_KEY;
    else process.env.MOONSHOT_API_KEY = saved;
  }
});

test("factory: VLM_DIFF_CLASSIFY_MODEL routes classification to a cheaper model", () => {
  const savedKey = process.env.ANTHROPIC_API_KEY;
  const savedRoute = process.env.VLM_DIFF_CLASSIFY_MODEL;
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.VLM_DIFF_CLASSIFY_MODEL = "claude-haiku-4.5";
  try {
    const cheap = createProvider({ provider: "anthropic", tier: "cheap" });
    const reasoning = createProvider({ provider: "anthropic" });
    assert.equal(cheap.model, "claude-haiku-4.5");
    assert.equal(reasoning.model, "claude-sonnet-5");
  } finally {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
    if (savedRoute === undefined) delete process.env.VLM_DIFF_CLASSIFY_MODEL;
    else process.env.VLM_DIFF_CLASSIFY_MODEL = savedRoute;
  }
});
