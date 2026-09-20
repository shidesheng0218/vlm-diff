import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPendingReview, approvePages } from "./review.js";

async function projectWithReviewState(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "vlm-diff-review-"));
  await mkdir(join(root, ".vlm-diff", "current"), { recursive: true });
  await mkdir(join(root, ".vlm-diff", "baseline"), { recursive: true });
  await writeFile(
    join(root, ".vlm-diff", "current", "last-check.json"),
    JSON.stringify({
      at: "t",
      pages: [
        { name: "home", url: "u1", changed: true, changeType: "color-change", severity: "cosmetic", summary: "s", regions: 1, evidence: "backgroundColor", a11yImpact: null },
        { name: "about", url: "u2", changed: false, changeType: null, severity: null, summary: null, regions: 0, evidence: null, a11yImpact: null },
      ],
    }),
  );
  await writeFile(join(root, ".vlm-diff", "current", "home.png"), Buffer.from("new"));
  await writeFile(join(root, ".vlm-diff", "current", "home.dom.json"), "[]");
  await writeFile(join(root, ".vlm-diff", "baseline", "home.png"), Buffer.from("old"));
  return root;
}

test("loadPendingReview: only changed pages are reviewable", async () => {
  const root = await projectWithReviewState();
  try {
    const pending = await loadPendingReview(root);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].name, "home");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approvePages: promotes current captures into the baseline", async () => {
  const root = await projectWithReviewState();
  try {
    await approvePages(root, ["home"]);
    const baselinePng = await readFile(join(root, ".vlm-diff", "baseline", "home.png"));
    assert.equal(baselinePng.toString(), "new");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadPendingReview: missing last-check.json surfaces a clean error path", async () => {
  const root = await mkdtemp(join(tmpdir(), "vlm-diff-review-"));
  try {
    await assert.rejects(() => loadPendingReview(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
