import { test } from "node:test";
import assert from "node:assert/strict";
import { diffDom, type DomNode } from "./dom-diff.js";

function node(overrides: Partial<DomNode> = {}): DomNode {
  return {
    path: "DIV:0",
    tag: "DIV",
    id: "x",
    className: "",
    text: "",
    rect: { x: 0, y: 0, w: 100, h: 20 },
    style: { color: "rgb(0,0,0)", backgroundColor: "rgb(255,255,255)", fontWeight: "400", borderRadius: "0px", opacity: "1", boxShadow: "none", border: "0px none rgb(0,0,0)" },
    ...overrides,
  };
}

test("diffDom: identical snapshots produce no changes", () => {
  const a = [node()];
  const b = [node()];
  assert.deepEqual(diffDom(a, b), []);
});

test("diffDom: sub-pixel rect jitter is ignored", () => {
  const a = [node({ rect: { x: 10, y: 10, w: 100, h: 20 } })];
  const b = [node({ rect: { x: 10.4, y: 10, w: 100, h: 20 } })];
  assert.deepEqual(diffDom(a, b), []);
});

test("diffDom: rect shift beyond tolerance is reported as position with delta", () => {
  const a = [node({ rect: { x: 10, y: 10, w: 100, h: 20 } })];
  const b = [node({ rect: { x: 16, y: 10, w: 100, h: 20 } })];
  const changes = diffDom(a, b);
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].changedFields, ["position"]);
  assert.deepEqual(changes[0].rectDelta, { dx: 6, dy: 0, dw: 0, dh: 0 });
});

test("diffDom: size-only rect change is reported as size with delta", () => {
  const a = [node({ rect: { x: 10, y: 10, w: 100, h: 20 } })];
  const b = [node({ rect: { x: 10, y: 10, w: 120, h: 24 } })];
  const changes = diffDom(a, b);
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].changedFields, ["size"]);
  assert.deepEqual(changes[0].rectDelta, { dx: 0, dy: 0, dw: 20, dh: 4 });
});

test("diffDom: move + resize reports both position and size", () => {
  const a = [node({ rect: { x: 10, y: 10, w: 100, h: 20 } })];
  const b = [node({ rect: { x: 15, y: 12, w: 90, h: 20 } })];
  const changes = diffDom(a, b);
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].changedFields, ["position", "size"]);
});

test("diffDom: text change is reported", () => {
  const a = [node({ text: "hello" })];
  const b = [node({ text: "world" })];
  const changes = diffDom(a, b);
  assert.deepEqual(changes[0].changedFields, ["text"]);
});

test("diffDom: color change is reported", () => {
  const a = [node({})];
  const b = [node({ style: { ...node().style, backgroundColor: "rgb(220,38,38)" } })];
  const changes = diffDom(a, b);
  assert.deepEqual(changes[0].changedFields, ["backgroundColor"]);
});

test("diffDom: added node is reported", () => {
  const a: DomNode[] = [];
  const b = [node({ path: "DIV:1" })];
  const changes = diffDom(a, b);
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].changedFields, ["added"]);
});

test("diffDom: removed node is reported", () => {
  const a = [node({ path: "DIV:1" })];
  const b: DomNode[] = [];
  const changes = diffDom(a, b);
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].changedFields, ["removed"]);
});

test("diffDom: multiple field changes on one node are all reported", () => {
  const a = [node({ text: "hello", rect: { x: 0, y: 0, w: 100, h: 20 } })];
  const b = [node({ text: "world", rect: { x: 20, y: 0, w: 100, h: 20 } })];
  const changes = diffDom(a, b);
  assert.equal(changes.length, 1);
  assert.deepEqual(new Set(changes[0].changedFields), new Set(["position", "text"]));
});
