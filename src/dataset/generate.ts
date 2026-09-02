import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MUTATIONS, EXTRA_MUTATIONS, V02_MUTATIONS, isTargeted, type Mutation } from "./mutations.js";
import { snapshotDom } from "../snapshot/capture.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures");
const OUT_DIR = join(__dirname, "..", "..", "data");

const FIXTURES = ["card-list.html", "form.html", "navbar.html", "table.html", "modal.html", "dashboard.html", "media.html"];
const ALL_MUTATIONS: Mutation[] = [...MUTATIONS, ...EXTRA_MUTATIONS, ...V02_MUTATIONS];
const VIEWPORT = { width: 960, height: 500 };

/** The selector a mutation actually targets in a given fixture: `targets[fixture]` for targeted mutations, else the legacy blanket selector. */
function selectorFor(mutation: Mutation, fixture: string): string | undefined {
  return isTargeted(mutation) ? mutation.targets[fixture] : mutation.selector;
}

interface PairRecord {
  id: string;
  fixture: string;
  mutationId: string;
  kind: string;
  magnitude: string;
  selector?: string;
  description: string;
  before: string;
  after: string;
  domBefore: string;
  domAfter: string;
  /** union bounding box of the mutated selector's elements, post-mutation; undefined for "none" pairs */
  groundTruthRect?: { x: number; y: number; w: number; h: number };
}

async function renderPair(
  browser: import("playwright").Browser,
  fixturePath: string,
  mutation: Mutation,
  pairId: string,
  fixtureName: string,
): Promise<PairRecord | undefined> {
  const selector = selectorFor(mutation, fixtureName);
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.goto(`file://${fixturePath}`);
  await page.waitForTimeout(50);

  // Legacy blanket selectors only cover the fixtures they were written for;
  // skip instead of emitting a mislabeled unchanged pair.
  if (selector) {
    const matched = await page.evaluate((sel) => document.querySelectorAll(sel).length > 0, selector);
    if (!matched) {
      await page.close();
      return undefined;
    }
  }

  const beforePng = await page.screenshot();
  const domBefore = await snapshotDom(page);

  // element-remove deletes a child of the container; its rect must be captured
  // before the mutation runs, since the element won't exist after. Which child
  // (last vs first) depends on the mutation.
  const isRemoveFirst = mutation.kind === "element-remove" && mutation.id.includes("first");
  const preRemoveRect =
    mutation.kind === "element-remove" && selector
      ? await childRect(page, selector, isRemoveFirst ? "first" : "last")
      : undefined;

  if (selector) {
    await page.evaluate(
      ({ selector, fnSrc }) => {
        // eslint-disable-next-line no-eval
        const fn = new Function("selector", `return (${fnSrc})(selector)`);
        fn(selector);
      },
      { selector, fnSrc: mutation.apply.toString() },
    );
  } else if (mutation.kind === "none") {
    // no-op variants: re-render in place (settle) or full reload, both of
    // which capture the render-timing noise real CI re-captures exhibit.
    if (mutation.reload) {
      await page.reload();
    }
    await page.waitForTimeout(mutation.settleMs ?? 20);
  }

  const afterPng = await page.screenshot();
  const domAfter = await snapshotDom(page);

  const groundTruthRect = await resolveGroundTruthRect(page, mutation, selector, preRemoveRect);
  await page.close();

  const beforeName = `${pairId}-before.png`;
  const afterName = `${pairId}-after.png`;
  await writeFile(join(OUT_DIR, "images", beforeName), beforePng);
  await writeFile(join(OUT_DIR, "images", afterName), afterPng);

  return {
    id: pairId,
    fixture: fixturePath.split("/").pop()!,
    mutationId: mutation.id,
    kind: mutation.kind,
    magnitude: mutation.magnitude,
    selector,
    description: mutation.description,
    before: `images/${beforeName}`,
    after: `images/${afterName}`,
    domBefore,
    domAfter,
    groundTruthRect,
  };
}

/** Union bounding box (post-mutation) of every element matching selector, for scoring detection precision/recall. */
async function boundingBoxOf(
  page: import("playwright").Page,
  selector: string,
): Promise<{ x: number; y: number; w: number; h: number } | undefined> {
  return page.evaluate((sel) => {
    const els = Array.from(document.querySelectorAll(sel));
    if (els.length === 0) return undefined;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    }
    return { x: Math.round(minX), y: Math.round(minY), w: Math.round(maxX - minX), h: Math.round(maxY - minY) };
  }, selector);
}

/** Rect of a container's first or last child, read at the moment requested (before remove / after add). */
async function childRect(
  page: import("playwright").Page,
  containerSelector: string,
  which: "first" | "last",
): Promise<{ x: number; y: number; w: number; h: number } | undefined> {
  return page.evaluate(
    ({ sel, which }) => {
      const container = document.querySelector(sel);
      if (!container || container.children.length === 0) return undefined;
      const child = which === "first" ? container.children[0] : container.children[container.children.length - 1];
      const r = child.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    },
    { sel: containerSelector, which },
  );
}

/**
 * Ground-truth rect for scoring. element-add/element-remove get the rect of
 * the specific child that was inserted/deleted, not the whole container
 * (the previous implementation used the container bbox for both, which
 * over-counts unrelated siblings and dilutes precision scoring).
 */
async function resolveGroundTruthRect(
  page: import("playwright").Page,
  mutation: Mutation,
  selector: string | undefined,
  preRemoveRect: { x: number; y: number; w: number; h: number } | undefined,
): Promise<{ x: number; y: number; w: number; h: number } | undefined> {
  if (!selector) return undefined;
  if (mutation.kind === "element-remove") return preRemoveRect;
  if (mutation.kind === "element-add") return childRect(page, selector, "last");
  return boundingBoxOf(page, selector);
}

async function main() {
  await mkdir(join(OUT_DIR, "images"), { recursive: true });
  const browser = await chromium.launch();
  const records: PairRecord[] = [];

  for (const fixture of FIXTURES) {
    const fixturePath = join(FIXTURES_DIR, fixture);
    for (const mutation of ALL_MUTATIONS) {
      // targeted mutations only apply to fixtures they name a selector for;
      // none-kind mutations (empty targets) apply to every fixture — they
      // build the false-positive denominator and need maximum depth
      if (isTargeted(mutation) && mutation.kind !== "none" && !mutation.targets[fixture]) continue;
      const pairId = `${fixture.replace(".html", "")}-${mutation.id}`;
      const record = await renderPair(browser, fixturePath, mutation, pairId, fixture);
      if (!record) {
        console.log(`skipped  ${pairId} (selector matches nothing in ${fixture})`);
        continue;
      }
      records.push(record);
      console.log(`generated ${pairId}`);
    }
  }

  await browser.close();
  await writeFile(join(OUT_DIR, "dataset.json"), JSON.stringify(records, null, 2));
  console.log(`\n${records.length} pairs written to ${join(OUT_DIR, "dataset.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
