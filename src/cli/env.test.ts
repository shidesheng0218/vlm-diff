import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDotEnv } from "./env.js";

test("loadDotEnv: loads KEY=VALUE pairs without overriding the real environment", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vlm-diff-env-"));
  try {
    await writeFile(
      join(dir, ".env"),
      [
        "# comment line",
        "",
        "VLM_DIFF_TEST_NEW=hello",
        'VLM_DIFF_TEST_QUOTED="world wide"',
        "VLM_DIFF_TEST_EXISTING=from-dotenv",
      ].join("\n"),
    );
    process.env.VLM_DIFF_TEST_EXISTING = "real-env-wins";
    delete process.env.VLM_DIFF_TEST_NEW;
    delete process.env.VLM_DIFF_TEST_QUOTED;

    const loaded = loadDotEnv(dir);

    assert.equal(loaded, 2); // EXISTING already set → not loaded
    assert.equal(process.env.VLM_DIFF_TEST_NEW, "hello");
    assert.equal(process.env.VLM_DIFF_TEST_QUOTED, "world wide");
    assert.equal(process.env.VLM_DIFF_TEST_EXISTING, "real-env-wins");
  } finally {
    delete process.env.VLM_DIFF_TEST_NEW;
    delete process.env.VLM_DIFF_TEST_QUOTED;
    delete process.env.VLM_DIFF_TEST_EXISTING;
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadDotEnv: missing .env is a no-op", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vlm-diff-env-"));
  try {
    assert.equal(loadDotEnv(dir), 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
