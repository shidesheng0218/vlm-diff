import { test } from "node:test";
import assert from "node:assert/strict";
import { checkExitCode, type PageCheckResult } from "./baseline.js";
import type { DiffVerdict } from "../core/diff.js";

function verdict(overrides: Partial<DiffVerdict>): DiffVerdict {
  return {
    changed: false,
    visualOnly: false,
    pixelChangedCount: 0,
    pixelChangedFraction: 0,
    regions: [],
    pendingEscalations: 0,
    inputTokens: 0,
    outputTokens: 0,
    ...overrides,
  };
}

test("checkExitCode: all clean → 0", () => {
  const r: PageCheckResult[] = [{ name: "home", url: "u", verdict: verdict({ changed: false }) }];
  assert.equal(checkExitCode(r), 0);
});

test("checkExitCode: any change → 1", () => {
  const r: PageCheckResult[] = [{ name: "home", url: "u", verdict: verdict({ changed: true }) }];
  assert.equal(checkExitCode(r), 1);
});

test("checkExitCode: pending VLM beats change → 3", () => {
  const r: PageCheckResult[] = [
    { name: "home", url: "u", verdict: verdict({ changed: true }) },
    { name: "page2", url: "u2", verdict: verdict({ changed: false, pendingEscalations: 2 }) },
  ];
  assert.equal(checkExitCode(r), 3);
});

test("checkExitCode: a page error wins → 2", () => {
  const r: PageCheckResult[] = [
    { name: "home", url: "u", verdict: verdict({ changed: true }) },
    { name: "page2", url: "u2", error: "capture failed" },
  ];
  assert.equal(checkExitCode(r), 2);
});
