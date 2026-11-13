import { test } from "node:test";
import assert from "node:assert/strict";
import { attachToMedia, mediaHintText } from "./media-attach.js";
import type { DomNode } from "./dom-diff.js";

function mediaNode(tag: string, id: string, x: number, y: number, w: number, h: number, path = "BODY:0>DIV:0"): DomNode {
  return {
    path, tag, id, className: "", text: "",
    rect: { x, y, w, h },
    style: { color: "", backgroundColor: "", fontWeight: "", borderRadius: "", opacity: "", boxShadow: "", border: "" },
  };
}

test("attachToMedia: a pixel region inside a canvas attaches to that canvas", () => {
  const canvas = mediaNode("CANVAS", "chart", 100, 100, 200, 80);
  const regions = [{ x: 120, y: 120, w: 30, h: 20 }]; // inside the canvas
  const { hosts, orphans } = attachToMedia(regions, [canvas]);
  assert.equal(hosts.length, 1);
  assert.equal(orphans.length, 0);
  assert.equal(hosts[0].id, "chart");
  assert.deepEqual(hosts[0].rect, { x: 100, y: 100, w: 200, h: 80 });
});

test("attachToMedia: fragments of one canvas merge into a single host", () => {
  const canvas = mediaNode("CANVAS", "chart", 100, 100, 200, 100);
  const regions = [
    { x: 110, y: 110, w: 20, h: 20 },
    { x: 250, y: 150, w: 30, h: 20 },
    { x: 140, y: 160, w: 15, h: 15 },
  ];
  const { hosts } = attachToMedia(regions, [canvas]);
  assert.equal(hosts.length, 1);
  assert.equal(hosts[0].mergedCount, 3);
});

test("attachToMedia: a region overlapping no media element is an orphan", () => {
  const canvas = mediaNode("CANVAS", "chart", 100, 100, 200, 80);
  const regions = [{ x: 500, y: 400, w: 30, h: 20 }]; // far away
  const { hosts, orphans } = attachToMedia(regions, [canvas]);
  assert.equal(hosts.length, 0);
  assert.equal(orphans.length, 1);
});

test("attachToMedia: larger overlap wins; tie goes to the smaller host", () => {
  const big = mediaNode("CANVAS", "big", 0, 0, 300, 300);
  const small = mediaNode("SVG", "icon", 100, 100, 40, 40, "BODY:0>DIV:1");
  // region pokes 10px past small's right edge (small spans x 100–140):
  // overlap small = 20×30 = 600, overlap big = 30×30 = 900 → big wins.
  const straddling = attachToMedia([{ x: 120, y: 110, w: 30, h: 30 }], [big, small]);
  assert.equal(straddling.hosts[0].id, "big");

  // fully inside small: overlap small = 20×20 = 400, big = 400 → tie → smaller wins.
  const inside = attachToMedia([{ x: 110, y: 110, w: 20, h: 20 }], [big, small]);
  assert.equal(inside.hosts[0].id, "icon");
});

test("attachToMedia: a region fully inside the smaller overlapping element picks it", () => {
  const big = mediaNode("CANVAS", "big", 0, 0, 300, 300);
  const small = mediaNode("SVG", "icon", 100, 100, 40, 40, "BODY:0>DIV:1");
  // fully inside small (100–140): overlap with small = 400, with big = 400 (tie).
  // Tie breaks to array order — document that, and prefer the *smaller* host on ties
  // so a small icon on a big canvas wins over the canvas.
  const regions = [{ x: 110, y: 110, w: 20, h: 20 }];
  const { hosts } = attachToMedia(regions, [small, big]); // smaller first
  assert.equal(hosts.length, 1);
  assert.equal(hosts[0].id, "icon");
});

test("attachToMedia: nearest heading is picked up as context", () => {
  const heading: DomNode = {
    path: "BODY:0>H2:0", tag: "H2", id: "", className: "", text: "Weekly builds",
    rect: { x: 0, y: 0, w: 100, h: 20 },
    style: { color: "", backgroundColor: "", fontWeight: "", borderRadius: "", opacity: "", boxShadow: "", border: "" },
  };
  const canvas = mediaNode("CANVAS", "chart", 0, 30, 200, 100, "BODY:0>CANVAS:0");
  const { hosts } = attachToMedia([{ x: 10, y: 40, w: 20, h: 20 }], [heading, canvas]);
  assert.equal(hosts[0].nearestHeading, "Weekly builds");
});

test("mediaHintText: includes kind, id, heading, and merged count", () => {
  const text = mediaHintText({
    rect: { x: 0, y: 0, w: 100, h: 50 },
    tag: "CANVAS",
    id: "chart",
    nearestHeading: "Weekly builds",
    mergedCount: 3,
  });
  assert.match(text, /canvas/);
  assert.match(text, /#chart/);
  assert.match(text, /Weekly builds/);
  assert.match(text, /3 pixel fragments/);
});

test("mediaHintText: minimal host produces a clean sentence", () => {
  const text = mediaHintText({ rect: { x: 0, y: 0, w: 10, h: 10 }, tag: "IMG", mergedCount: 1 });
  assert.match(text, /image/);
  assert.doesNotMatch(text, /#/);
  assert.doesNotMatch(text, /under the heading/);
});