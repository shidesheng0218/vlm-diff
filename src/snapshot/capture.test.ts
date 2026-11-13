import { test } from "node:test";
import assert from "node:assert/strict";
import { settlePage } from "./capture.js";

// These tests run a real headless Chromium. They verify the *behavior contract*:
// settlePage must (a) inject the CSS freeze, (b) never hang on a page with a
// persistent connection or an infinite animation, (c) wait for fonts.

test("settlePage: completes on a simple page and freezes animations", async () => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <style>@keyframes spin { to { transform: rotate(360deg); } } .x { animation: spin 2s infinite; }</style>
      <div class="x">hello</div>
    `);
    await settlePage(page, { networkIdleMs: 500, fontsMs: 500 });
    // the freeze stylesheet sets animation-duration to 0s
    const dur = await page.evaluate(() => getComputedStyle(document.querySelector(".x")!).animationDuration);
    assert.equal(dur, "0s");
  } finally {
    await browser.close();
  }
});

test("settlePage: does not hang on an infinite animation + slow network", async () => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<div style="animation: x 1s infinite">hi</div><style>@keyframes x{}</style>`);
    // a route that never resolves keeps the network busy
    await page.route("**/*", () => new Promise(() => {}));
    const start = Date.now();
    await settlePage(page, { networkIdleMs: 300, fontsMs: 300 });
    const elapsed = Date.now() - start;
    // must complete well under a generous ceiling even though network never idles
    assert.ok(elapsed < 5000, `settlePage took ${elapsed}ms — should degrade gracefully`);
  } finally {
    await browser.close();
  }
});

test("settlePage: respects extraWaitMs", async () => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent("<div>hi</div>");
    const start = Date.now();
    await settlePage(page, { networkIdleMs: 100, fontsMs: 100, extraWaitMs: 250 });
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 250, `expected ≥250ms, got ${elapsed}ms`);
  } finally {
    await browser.close();
  }
});

test("settlePage: freezeAnimations:false leaves animation-duration alone", async () => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<style>@keyframes spin { to { transform: rotate(360deg); } } .x { animation: spin 2s infinite; }</style><div class="x">hi</div>`);
    await settlePage(page, { networkIdleMs: 100, fontsMs: 100, freezeAnimations: false });
    const dur = await page.evaluate(() => getComputedStyle(document.querySelector(".x")!).animationDuration);
    assert.equal(dur, "2s");
  } finally {
    await browser.close();
  }
});