import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findProjectRoot, cacheDir } from "./project.js";

test("findProjectRoot: anchors at the .vlm-diff dir, walking up", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vlm-diff-proj-"));
  try {
    await mkdir(join(dir, ".vlm-diff"), { recursive: true });
    const nested = join(dir, "a", "b");
    await mkdir(nested, { recursive: true });
    assert.equal(findProjectRoot(nested), dir);
    assert.equal(findProjectRoot(dir), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("findProjectRoot: falls back to the start dir when unanchored", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vlm-diff-proj-"));
  try {
    assert.equal(findProjectRoot(dir), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cacheDir: resolves under the project root", () => {
  assert.ok(cacheDir("/tmp/x").endsWith(join(".cache", "classifications")));
});
