import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MUTATIONS, type Mutation } from "./mutations.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures");
const OUT_DIR = join(__dirname, "..", "..", "data");

const FIXTURES = ["card-list.html", "form.html", "navbar.html"];
const VIEWPORT = { width: 960, height: 500 };

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

// Serializes a snapshot of tag/id/class/rect/computed-style for every element,
// used by the DOM-diff detector in src/detect/dom-diff.ts.
async function snapshotDom(page: import("playwright").Page): Promise<string> {
  const snapshot = await page.evaluate(() => {
    const nodes: Array<{
      path: string;
      tag: string;
      id: string;
      className: string;
      text: string;
      rect: { x: number; y: number; w: number; h: number };
      style: { color: string; backgroundColor: string; fontWeight: string; borderRadius: string };
    }> = [];

    function pathFor(el: Element, root: Element): string {
      const parts: string[] = [];
      let cur: Element | null = el;
      while (cur && cur !== root) {
        const parent: Element | null = cur.parentElement;
        const idx = parent ? Array.from(parent.children).indexOf(cur) : 0;
        parts.unshift(`${cur.tagName}:${idx}`);
        cur = parent;
      }
      return parts.join(">");
    }

    const root = document.body;
    root.querySelectorAll("*").forEach((el) => {
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      nodes.push({
        path: pathFor(el, root),
        tag: el.tagName,
        id: el.id,
        className: el.className,
        text:
          el.tagName === "INPUT" || el.tagName === "TEXTAREA"
            ? (el as HTMLInputElement).value
            : el.children.length === 0
              ? (el.textContent ?? "").trim()
              : "",
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        style: {
          color: cs.color,
          backgroundColor: cs.backgroundColor,
          fontWeight: cs.fontWeight,
          borderRadius: cs.borderRadius,
        },
      });
    });
    return JSON.stringify(nodes);
  });
  return snapshot;
}

async function renderPair(
  browser: import("playwright").Browser,
  fixturePath: string,
  mutation: Mutation,
  pairId: string,
): Promise<PairRecord> {
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.goto(`file://${fixturePath}`);
  await page.waitForTimeout(50);

  const beforePng = await page.screenshot();
  const domBefore = await snapshotDom(page);

  // element-remove deletes the container's last child; its rect must be
  // captured before the mutation runs, since the element won't exist after.
  const preRemoveRect =
    mutation.kind === "element-remove" && mutation.selector
      ? await lastChildRect(page, mutation.selector)
      : undefined;

  if (mutation.selector) {
    await page.evaluate(
      ({ selector, fnSrc }) => {
        // eslint-disable-next-line no-eval
        const fn = new Function("selector", `return (${fnSrc})(selector)`);
        fn(selector);
      },
      { selector: mutation.selector, fnSrc: mutation.apply.toString() },
    );
  } else if (mutation.kind === "none") {
    // no-op: re-screenshot the identical page to capture render-timing noise
    await page.waitForTimeout(20);
  }

  const afterPng = await page.screenshot();
  const domAfter = await snapshotDom(page);

  const groundTruthRect = await resolveGroundTruthRect(page, mutation, preRemoveRect);
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
    selector: mutation.selector,
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

/** Rect of a container's last child, read BEFORE element-remove deletes it (the node won't exist afterward). */
async function lastChildRect(
  page: import("playwright").Page,
  containerSelector: string,
): Promise<{ x: number; y: number; w: number; h: number } | undefined> {
  return page.evaluate((sel) => {
    const container = document.querySelector(sel);
    const child = container?.children[container.children.length - 1];
    if (!child) return undefined;
    const r = child.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }, containerSelector);
}

/** Rect of a container's newly appended last child, read AFTER element-add clones it in. */
async function newLastChildRect(
  page: import("playwright").Page,
  containerSelector: string,
): Promise<{ x: number; y: number; w: number; h: number } | undefined> {
  return lastChildRect(page, containerSelector);
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
  preRemoveRect: { x: number; y: number; w: number; h: number } | undefined,
): Promise<{ x: number; y: number; w: number; h: number } | undefined> {
  if (!mutation.selector) return undefined;
  if (mutation.kind === "element-remove") return preRemoveRect;
  if (mutation.kind === "element-add") return newLastChildRect(page, mutation.selector);
  return boundingBoxOf(page, mutation.selector);
}

async function main() {
  await mkdir(join(OUT_DIR, "images"), { recursive: true });
  const browser = await chromium.launch();
  const records: PairRecord[] = [];

  for (const fixture of FIXTURES) {
    const fixturePath = join(FIXTURES_DIR, fixture);
    for (const mutation of MUTATIONS) {
      const pairId = `${fixture.replace(".html", "")}-${mutation.id}`;
      const record = await renderPair(browser, fixturePath, mutation, pairId);
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
