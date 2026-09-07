import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existingBaselinePages, runBaseline } from "./baseline.js";

async function makeProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "vlm-diff-gate-"));
  await mkdir(join(root, ".vlm-diff", "baseline"), { recursive: true });
  await writeFile(
    join(root, ".vlm-diff", "config.json"),
    JSON.stringify({ viewport: { width: 960, height: 500 }, pages: [{ name: "home", url: "http://localhost:9/" }] }),
  );
  return root;
}

test("baseline gate: existing golden state refuses overwrite without force", async () => {
  const root = await makeProject();
  try {
    await writeFile(join(root, ".vlm-diff", "baseline", "home.png"), Buffer.from("fake-png"));
    assert.deepEqual(await existingBaselinePages(root), ["home"]);

    // runBaseline without force returns skipped BEFORE touching Playwright
    const result = await runBaseline(root, { force: false });
    assert.equal(result.skipped, true);
    assert.equal(result.pages.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("baseline gate: no existing baseline does not gate", async () => {
  const root = await makeProject();
  try {
    assert.deepEqual(await existingBaselinePages(root), []);
    // would proceed to capture — we only assert the gate is open, not the capture itself
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
