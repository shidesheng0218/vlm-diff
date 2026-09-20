import { test } from "node:test";
import assert from "node:assert/strict";
import { contrastRatio, assessRegionA11y, CONTRAST_AA_NORMAL } from "./a11y.js";

test("contrastRatio: black on white is 21:1, identical colors are 1:1", () => {
  assert.equal(contrastRatio("#000000", "#ffffff"), 21);
  assert.equal(contrastRatio("#3b82f6", "#3b82f6"), 1);
});

test("contrastRatio: light gray on white is a low ratio", () => {
  const r = contrastRatio("#d1d5db", "#ffffff")!;
  assert.ok(r > 1 && r < 2, `ratio was ${r}`);
  assert.ok(r < CONTRAST_AA_NORMAL);
});

test("contrastRatio: unparseable colors return undefined", () => {
  assert.equal(contrastRatio("none", "#fff"), undefined);
});

test("assessRegionA11y: contrast drop below AA fires a note", () => {
  const note = assessRegionA11y(["color"], {
    color: { before: "rgb(255,255,255)", after: "rgb(147,197,253)" }, // white → light blue
    backgroundColor: { before: "rgb(37,99,235)", after: "rgb(37,99,235)" }, // blue bg, unchanged (context)
  });
  assert.equal(note?.kind, "contrast");
  assert.match(note!.detail, /contrast dropped/);
});

test("assessRegionA11y: contrast improvement does not fire", () => {
  const note = assessRegionA11y(["color"], {
    color: { before: "rgb(147,197,253)", after: "rgb(255,255,255)" }, // improved
    backgroundColor: { before: "rgb(37,99,235)", after: "rgb(37,99,235)" },
  });
  assert.equal(note, undefined);
});

test("assessRegionA11y: alt removal fires, alt addition does not", () => {
  const removed = assessRegionA11y(["attr:alt"], { "attr:alt": { before: "owner avatar", after: "" } });
  assert.equal(removed?.kind, "alt-removed");
  const added = assessRegionA11y(["attr:alt"], { "attr:alt": { before: "", after: "owner avatar" } });
  assert.equal(added, undefined);
});

test("assessRegionA11y: aria-label removal fires", () => {
  const note = assessRegionA11y(["attr:aria-label"], { "attr:aria-label": { before: "Close dialog", after: "" } });
  assert.equal(note?.kind, "aria-label-removed");
});

test("assessRegionA11y: no a11y signal on ordinary changes", () => {
  assert.equal(assessRegionA11y(["fontWeight"], { fontWeight: { before: "700", after: "400" } }), undefined);
  assert.equal(assessRegionA11y([], {}), undefined);
});
