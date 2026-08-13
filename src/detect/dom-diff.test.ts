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
    style: { color: "rgb(0,0,0)", backgroundColor: "rgb(255,255,255)", fontWeight: "400", borderRadius: "0px" },
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

test("diffDom: rect shift beyond tolerance is reported", () => {
  const a = [node({ rect: { x: 10, y: 10, w: 100, h: 20 } })];
  const b = [node({ rect: { x: 16, y: 10, w: 100, h: 20 } })];
  const changes = diffDom(a, b);
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].changedFields, ["rect"]);
});

test("diffDom: text change is reported", () => {
  const a = [node({ text: "hello" })];
  const b = [node({ text: "world" })];
  const changes = diffDom(a, b);
  assert.deepEqual(changes[0].changedFields, ["text"]);
});

test("diffDom: color change is reported", () => {
  const a = [node({ style: { color: "rgb(0,0,0)", backgroundColor: "rgb(255,255,255)", fontWeight: "400", borderRadius: "0px" } })];
  const b = [node({ style: { color: "rgb(0,0,0)", backgroundColor: "rgb(220,38,38)", fontWeight: "400", borderRadius: "0px" } })];
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
  assert.deepEqual(new Set(changes[0].changedFields), new Set(["rect", "text"]));
});
