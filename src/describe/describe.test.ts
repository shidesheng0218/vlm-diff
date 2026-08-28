import { test } from "node:test";
import assert from "node:assert/strict";
import { routeRegion, describeDeterministic, describeRegion, describeRegions } from "./describe.js";
import type { CandidateRegion } from "../detect/regions.js";

function region(overrides: Partial<CandidateRegion> = {}): CandidateRegion {
  return {
    x: 10,
    y: 10,
    w: 100,
    h: 40,
    source: "dom+pixel",
    domChangedFields: ["backgroundColor"],
    domId: "btn",
    domValues: {
      backgroundColor: { before: "rgb(37, 99, 235)", after: "rgb(220, 38, 38)" },
    },
    ...overrides,
  };
}

// ── routing ──

test("route: fully-explained style change stays deterministic", () => {
  assert.equal(routeRegion(region(), 1), "deterministic");
});

test("route: pixel-only region escalates", () => {
  assert.equal(routeRegion(region({ source: "pixel", domChangedFields: undefined }), 0), "vlm");
});

test("route: lone position change stays deterministic", () => {
  assert.equal(
    routeRegion(region({ domChangedFields: ["position"], rectDelta: { dx: 6, dy: 0, dw: 0, dh: 0 } }), 1),
    "deterministic",
  );
});

test("route: position change in a cascade stays deterministic (follower wording)", () => {
  assert.equal(
    routeRegion(region({ domChangedFields: ["position"], rectDelta: { dx: 6, dy: 0, dw: 0, dh: 0 } }), 3),
    "deterministic",
  );
});

test("route: combined move+resize stays deterministic", () => {
  assert.equal(
    routeRegion(region({ domChangedFields: ["position", "size"], rectDelta: { dx: 5, dy: 2, dw: 10, dh: 4 } }), 1),
    "deterministic",
  );
});

// ── deterministic descriptions ──

test("describe: background color change names both colors", () => {
  const d = describeDeterministic(region());
  assert.equal(d.route, "deterministic");
  assert.equal(d.changeType, "color-change");
  assert.equal(
    d.description,
    "Element (#btn) background color changed from blue (rgb(37, 99, 235)) to red (rgb(220, 38, 38))",
  );
  assert.equal(d.confidence, 1);
});

test("describe: text color change", () => {
  const d = describeDeterministic(
    region({
      domChangedFields: ["color"],
      domValues: { color: { before: "rgb(17, 24, 39)", after: "rgb(220, 38, 38)" } },
    }),
  );
  assert.equal(d.changeType, "color-change");
  assert.equal(d.description, "Element (#btn) text color changed from black (rgb(17, 24, 39)) to red (rgb(220, 38, 38))");
});

test("describe: border change includes named color inside the border string", () => {
  const d = describeDeterministic(
    region({
      domChangedFields: ["border"],
      domValues: { border: { before: "0px none rgb(0, 0, 0)", after: "2px solid rgb(37, 99, 235)" } },
    }),
  );
  assert.equal(d.changeType, "color-change");
  assert.equal(
    d.description,
    'Element (#btn) border changed from "0px none black (rgb(0, 0, 0))" to "2px solid blue (rgb(37, 99, 235))"',
  );
});

test("describe: numeric text change uses value phrasing", () => {
  const d = describeDeterministic(
    region({
      domId: undefined,
      domChangedFields: ["text"],
      domValues: { text: { before: "$48,210", after: "$52,980" } },
    }),
  );
  assert.equal(d.changeType, "text-change");
  assert.equal(d.description, 'Value changed from "$48,210" to "$52,980"');
});

test("describe: wording text change", () => {
  const d = describeDeterministic(
    region({
      domId: undefined,
      domChangedFields: ["text"],
      domValues: { text: { before: "Project Falcon", after: "Project Falcan" } },
    }),
  );
  assert.equal(d.changeType, "text-change");
  assert.equal(d.description, 'Text changed from "Project Falcon" to "Project Falcan"');
});

test("describe: font weight change uses named weights", () => {
  const d = describeDeterministic(
    region({
      domChangedFields: ["fontWeight"],
      domValues: { fontWeight: { before: "700", after: "400" } },
    }),
  );
  assert.equal(d.changeType, "style-change");
  assert.equal(d.description, "Element (#btn) font weight changed from bold (700) to normal (400)");
});

test("describe: border radius change", () => {
  const d = describeDeterministic(
    region({
      domChangedFields: ["borderRadius"],
      domValues: { borderRadius: { before: "8px", after: "0px" } },
    }),
  );
  assert.equal(d.changeType, "style-change");
  assert.equal(d.description, "Element (#btn) border radius changed from 8px to 0px");
});

test("describe: box shadow added / removed / changed", () => {
  const added = describeDeterministic(
    region({
      domChangedFields: ["boxShadow"],
      domValues: { boxShadow: { before: "none", after: "rgba(37, 99, 235, 0.35) 0px 8px 24px" } },
    }),
  );
  assert.match(added.description!, /box shadow added/);

  const removed = describeDeterministic(
    region({
      domChangedFields: ["boxShadow"],
      domValues: { boxShadow: { before: "rgba(0, 0, 0, 0.1) 0px 1px 2px", after: "none" } },
    }),
  );
  assert.match(removed.description!, /box shadow removed/);

  const changed = describeDeterministic(
    region({
      domChangedFields: ["boxShadow"],
      domValues: { boxShadow: { before: "rgba(0, 0, 0, 0.1) 0px 1px 2px", after: "rgba(0, 0, 0, 0.2) 0px 2px 4px" } },
    }),
  );
  assert.match(changed.description!, /box shadow changed/);
});

test("describe: opacity change", () => {
  const d = describeDeterministic(
    region({
      domChangedFields: ["opacity"],
      domValues: { opacity: { before: "1", after: "0.5" } },
    }),
  );
  assert.equal(d.changeType, "style-change");
  assert.equal(d.description, "Element (#btn) opacity changed from 1 to 0.5");
});

test("describe: element add mentions new text content", () => {
  const d = describeDeterministic(
    region({
      domId: undefined,
      domChangedFields: ["added"],
      domValues: { text: { before: "", after: "Project Falcon" } },
    }),
  );
  assert.equal(d.changeType, "element-add");
  assert.equal(d.description, 'A new element was added to the layout with text "Project Falcon"');
});

test("describe: element remove mentions the previous content", () => {
  const d = describeDeterministic(
    region({
      domId: undefined,
      domChangedFields: ["removed"],
      domValues: { text: { before: "Deploy staging", after: "" } },
    }),
  );
  assert.equal(d.changeType, "element-remove");
  assert.equal(d.description, 'An element was removed from the layout (previously "Deploy staging")');
});

test("describe: pure horizontal shift with direction and magnitude", () => {
  const d = describeDeterministic(
    region({
      domChangedFields: ["position"],
      rectDelta: { dx: 28, dy: 0, dw: 0, dh: 0 },
      domValues: {},
    }),
  );
  assert.equal(d.changeType, "spatial-shift");
  assert.equal(d.description, "Element (#btn) moved 28px right");
});

test("describe: vertical shift", () => {
  const d = describeDeterministic(
    region({
      domId: undefined,
      domChangedFields: ["position"],
      rectDelta: { dx: 0, dy: -8, dw: 0, dh: 0 },
      domValues: {},
    }),
  );
  assert.equal(d.changeType, "spatial-shift");
  assert.equal(d.description, "Element moved 8px up");
});

test("describe: size change with percentage from before-dimensions", () => {
  const d = describeDeterministic(
    region({
      w: 324,
      h: 76,
      domChangedFields: ["size"],
      rectDelta: { dx: 0, dy: 0, dw: 84, dh: 20 },
      domValues: {},
    }),
  );
  assert.equal(d.changeType, "size-change");
  assert.equal(d.description, "Element (#btn) resized by +84×+20px (+35%) (from 240×56)");
});

test("describe: unexpected field combination degrades to VLM, not a crash", () => {
  const d = describeDeterministic(
    region({
      domChangedFields: [],
      domValues: {},
    }),
  );
  assert.equal(d.route, "vlm");
  assert.ok(d.reason);
});

// ── batch describer: root-cause attribution ──

test("describeRegions: reflow follower gets layout-shift wording", () => {
  const root = region({
    domId: "title",
    domChangedFields: ["text"],
    domValues: { text: { before: "Short", after: "A much longer label pushes things" } },
  });
  const follower = region({
    domId: "sibling",
    domChangedFields: ["position"],
    rectDelta: { dx: 0, dy: -24, dw: 0, dh: 0 },
    domValues: {},
  });
  const [dRoot, dFollower] = describeRegions([root, follower]);
  assert.equal(dRoot.changeType, "text-change");
  assert.equal(dFollower.route, "deterministic");
  assert.equal(dFollower.changeType, "spatial-shift");
  assert.equal(
    dFollower.description,
    "Element (#sibling) moved 24px up as part of a layout shift caused by a nearby change",
  );
});

test("describeRegions: primary move without root cause has no reflow wording", () => {
  const mover = region({
    domId: "card",
    domChangedFields: ["position"],
    rectDelta: { dx: 28, dy: 0, dw: 0, dh: 0 },
    domValues: {},
  });
  const pushed = region({
    domId: "next",
    domChangedFields: ["position"],
    rectDelta: { dx: 28, dy: 0, dw: 0, dh: 0 },
    domValues: {},
  });
  const [d] = describeRegions([mover, pushed]);
  // no non-geometry root cause in the pair → plain movement wording
  assert.equal(d.description, "Element (#card) moved 28px right");
  assert.equal(d.changeType, "spatial-shift");
});

test("describeRegions: combined move+resize picks the dominant axis", () => {
  const moveDominant = describeRegions([
    region({ domId: undefined, domChangedFields: ["position", "size"], rectDelta: { dx: 12, dy: 0, dw: 3, dh: 0 }, domValues: {} }),
  ])[0];
  assert.equal(moveDominant.changeType, "spatial-shift");
  assert.equal(
    moveDominant.description,
    "Element moved 12px right and resized by +3×+0px (+3%) (from 97×40)",
  );

  const sizeDominant = describeRegions([
    region({ domId: undefined, domChangedFields: ["position", "size"], rectDelta: { dx: 2, dy: 0, dw: 40, dh: 12 }, domValues: {} }),
  ])[0];
  assert.equal(sizeDominant.changeType, "size-change");
});

// ── describeRegion (router + describer composed) ──

test("describeRegion: deterministic path composes", () => {
  const d = describeRegion(region(), 1);
  assert.equal(d.route, "deterministic");
  assert.equal(d.changeType, "color-change");
});

test("describeRegion: escalation carries a reason", () => {
  const d = describeRegion(region({ source: "pixel", domChangedFields: undefined }), 0);
  assert.equal(d.route, "vlm");
  assert.match(d.reason!, /pixel-only/);
});
