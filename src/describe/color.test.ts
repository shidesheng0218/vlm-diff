import { test } from "node:test";
import assert from "node:assert/strict";
import { parseColor, colorName, describeColorValue } from "./color.js";

test("parseColor: rgb() string", () => {
  assert.deepEqual(parseColor("rgb(37, 99, 235)"), { r: 37, g: 99, b: 235 });
});

test("parseColor: rgba() string keeps alpha", () => {
  assert.deepEqual(parseColor("rgba(0, 0, 0, 0.5)"), { r: 0, g: 0, b: 0, a: 0.5 });
});

test("parseColor: 6-digit hex", () => {
  assert.deepEqual(parseColor("#2563eb"), { r: 37, g: 99, b: 235 });
});

test("parseColor: 3-digit hex", () => {
  assert.deepEqual(parseColor("#369"), { r: 51, g: 102, b: 153 });
});

test("parseColor: non-color values return undefined", () => {
  assert.equal(parseColor("none"), undefined);
  assert.equal(parseColor("transparent"), undefined);
  assert.equal(parseColor("2px solid"), undefined);
});

test("colorName: fixture accent blue maps to blue", () => {
  assert.equal(colorName("rgb(37, 99, 235)"), "blue");
});

test("colorName: danger red maps to red", () => {
  assert.equal(colorName("rgb(220, 38, 38)"), "red");
});

test("colorName: white and near-white surfaces map to white", () => {
  assert.equal(colorName("rgb(255, 255, 255)"), "white");
  assert.equal(colorName("rgb(249, 250, 251)"), "white");
});

test("colorName: black text maps to black", () => {
  assert.equal(colorName("rgb(17, 24, 39)"), "black");
});

test("colorName: transparent (alpha ~0) returns undefined", () => {
  assert.equal(colorName("rgba(0, 0, 0, 0)"), undefined);
});

test("colorName: non-color returns undefined", () => {
  assert.equal(colorName("none"), undefined);
});

test("describeColorValue: named color includes the raw value", () => {
  assert.equal(describeColorValue("rgb(37, 99, 235)"), "blue (rgb(37, 99, 235))");
});

test("describeColorValue: unnamed-ish value still maps to nearest anchor", () => {
  assert.equal(describeColorValue("rgb(123, 45, 67)"), "dark red (rgb(123, 45, 67))");
});
