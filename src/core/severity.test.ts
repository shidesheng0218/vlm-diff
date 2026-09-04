import { test } from "node:test";
import assert from "node:assert/strict";
import { severityOfRegion, pairSeverity } from "./severity.js";

const base = { w: 100, h: 40 };

test("element-remove and element-add are breaking", () => {
  assert.equal(severityOfRegion({ ...base, changeType: "element-remove" }), "breaking");
  assert.equal(severityOfRegion({ ...base, changeType: "element-add" }), "breaking");
});

test("numeric/price text changes are breaking, copy changes are moderate", () => {
  assert.equal(
    severityOfRegion({ ...base, changeType: "text-change", values: { text: { before: "$48,210", after: "$52,980" } } }),
    "breaking",
  );
  assert.equal(
    severityOfRegion({ ...base, changeType: "text-change", values: { text: { before: "Project Falcon", after: "Project Falcan" } } }),
    "moderate",
  );
});

test("large translations are moderate, small ones cosmetic", () => {
  assert.equal(
    severityOfRegion({ ...base, changeType: "spatial-shift", rectDelta: { dx: 28, dy: 0, dw: 0, dh: 0 } }),
    "moderate",
  );
  assert.equal(
    severityOfRegion({ ...base, changeType: "spatial-shift", rectDelta: { dx: 3, dy: 0, dw: 0, dh: 0 } }),
    "cosmetic",
  );
});

test("big resizes are moderate, subtle ones cosmetic", () => {
  assert.equal(
    severityOfRegion({ ...base, changeType: "size-change", rectDelta: { dx: 0, dy: 0, dw: 40, dh: 0 } }),
    "moderate", // 40/60 ≈ 67%
  );
  assert.equal(
    severityOfRegion({ ...base, changeType: "size-change", rectDelta: { dx: 0, dy: 0, dw: 2, dh: 0 } }),
    "cosmetic",
  );
});

test("color and style changes default to cosmetic", () => {
  assert.equal(severityOfRegion({ ...base, changeType: "color-change" }), "cosmetic");
  assert.equal(severityOfRegion({ ...base, changeType: "style-change" }), "cosmetic");
});

test("pairSeverity takes the max; empty is undefined", () => {
  assert.equal(pairSeverity(["cosmetic", "moderate", "cosmetic"]), "moderate");
  assert.equal(pairSeverity(["cosmetic", "breaking"]), "breaking");
  assert.equal(pairSeverity([]), undefined);
});
