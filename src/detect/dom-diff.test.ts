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

test("diffDom: style change carries before/after values", () => {
  const a = [node({})];
  const b = [node({ style: { ...node().style, backgroundColor: "rgb(220,38,38)" } })];
  const changes = diffDom(a, b);
  assert.deepEqual(changes[0].values, {
    backgroundColor: { before: "rgb(255,255,255)", after: "rgb(220,38,38)" },
  });
});

test("diffDom: text change carries before/after values", () => {
  const a = [node({ text: "Project Falcon" })];
  const b = [node({ text: "Project Falcan" })];
  const changes = diffDom(a, b);
  assert.deepEqual(changes[0].values, { text: { before: "Project Falcon", after: "Project Falcan" } });
});

test("diffDom: added node carries the new text as after value", () => {
  const a: DomNode[] = [];
  const b = [node({ path: "DIV:1", text: "New card" })];
  const changes = diffDom(a, b);
  assert.deepEqual(changes[0].values, { text: { before: "", after: "New card" } });
});

test("diffDom: rect-only change carries no values", () => {
  const a = [node({ rect: { x: 10, y: 10, w: 100, h: 20 } })];
  const b = [node({ rect: { x: 16, y: 10, w: 100, h: 20 } })];
  const changes = diffDom(a, b);
  assert.equal(changes[0].values, undefined);
});

// ── v0.3 fuzzy matching: reorder/insert robustness ──

test("diffDom: reordering id'd siblings yields position changes, no phantom add/remove", () => {
  // card-1 and card-3 swap positions in the grid
  const item = (id: string, path: string, x: number) =>
    node({ id, path, rect: { x, y: 0, w: 100, h: 20 } });
  const before = [item("c1", "DIV:0/DIV:0", 0), item("c2", "DIV:0/DIV:1", 110), item("c3", "DIV:0/DIV:2", 220)];
  const after = [item("c3", "DIV:0/DIV:0", 0), item("c2", "DIV:0/DIV:1", 110), item("c1", "DIV:0/DIV:2", 220)];
  const changes = diffDom(before, after);
  // only the two moved cards, as position changes — no add/remove, no text/style noise
  assert.equal(changes.length, 2);
  assert.ok(changes.every((c) => c.changedFields.every((f) => f === "position")));
  assert.deepEqual(new Set(changes.map((c) => c.id)), new Set(["c1", "c3"]));
});

test("diffDom: reordering identical-looking siblings with unique text matches by signature", () => {
  // no ids — matched on tag|className|text
  const item = (path: string, x: number, text: string) =>
    node({ id: "", path, rect: { x, y: 0, w: 100, h: 20 }, text });
  const before = [item("DIV:0/LI:0", 0, "Alpha"), item("DIV:0/LI:1", 110, "Beta")];
  const after = [item("DIV:0/LI:0", 0, "Beta"), item("DIV:0/LI:1", 110, "Alpha")];
  const changes = diffDom(before, after);
  assert.equal(changes.length, 2);
  assert.ok(changes.every((c) => c.changedFields.includes("position")));
  assert.ok(!changes.some((c) => c.changedFields.includes("text")));
});

test("diffDom: head insert shifts followers as position changes, one added node only", () => {
  const item = (id: string, path: string, y: number) =>
    node({ id, path, rect: { x: 0, y, w: 100, h: 20 } });
  const before = [item("b", "UL:0/LI:0", 0), item("c", "UL:0/LI:1", 22)];
  const after = [item("a", "UL:0/LI:0", 0), item("b", "UL:0/LI:1", 22), item("c", "UL:0/LI:2", 44)];
  const changes = diffDom(before, after);
  const added = changes.filter((c) => c.changedFields.includes("added"));
  assert.equal(added.length, 1);
  assert.equal(added[0].id, "a");
  // b and c moved down — no phantom removes
  assert.ok(!changes.some((c) => c.changedFields.includes("removed")));
  assert.ok(changes.filter((c) => c.changedFields.includes("position")).length === 2);
});

test("diffDom: reordering truly identical items is a no-op", () => {
  const item = (path: string) => node({ id: "", path, className: "card", text: "" });
  const before = [item("DIV:0/DIV:0"), item("DIV:0/DIV:1")];
  const after = [item("DIV:0/DIV:0"), item("DIV:0/DIV:1")];
  assert.deepEqual(diffDom(before, after), []);
});

test("diffDom: content change on a reordered item is attributed to that item", () => {
  const item = (id: string, path: string, x: number, text: string) =>
    node({ id, path, rect: { x, y: 0, w: 100, h: 20 }, text });
  const before = [item("c1", "DIV:0/DIV:0", 0, "Alpha"), item("c2", "DIV:0/DIV:1", 110, "Beta")];
  const after = [item("c2", "DIV:0/DIV:0", 0, "Beta"), item("c1", "DIV:0/DIV:1", 110, "Alpha v2")];
  const changes = diffDom(before, after);
  const textChange = changes.find((c) => c.changedFields.includes("text"));
  assert.ok(textChange);
  assert.equal(textChange.id, "c1"); // the change follows the element, not the slot
  assert.deepEqual(textChange.values?.text, { before: "Alpha", after: "Alpha v2" });
});
