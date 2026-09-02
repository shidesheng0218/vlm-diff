#!/usr/bin/env tsx
/**
 * Demo: generate three demo pairs (color change, text change, no-change)
 * into data/demo/, using the real DOM snapshot format (src/snapshot/capture.ts).
 * Run: npm run demo:generate   →   npm run demo:detect
 */

import { chromium } from "playwright";
import fs from "fs/promises";
import path from "path";
import { snapshotDom } from "../src/snapshot/capture.js";

const DEMO_DIR = path.join(process.cwd(), "data", "demo");

interface DemoDef {
  prefix: string;
  label: string;
  html: string;
  groundTruth: { kind: string; description: string; rectSelector: string | null };
  mutate: (page: import("playwright").Page) => Promise<void>;
}

const DEMOS: DemoDef[] = [
  {
    prefix: "color-change",
    label: "Color change (button)",
    html: `<!DOCTYPE html><html><head><style>
      body { margin: 0; padding: 40px; font-family: system-ui, sans-serif; background: #f3f4f6; }
      .button { background: #2563eb; color: white; padding: 12px 24px; border: none; border-radius: 8px; font-size: 16px; }
      .container { background: white; padding: 32px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    </style></head><body>
      <div class="container">
        <h2>UI Component Test</h2>
        <p>Check if visual changes are detected correctly.</p>
        <button class="button" id="test-button">Submit Form</button>
      </div>
    </body></html>`,
    groundTruth: {
      kind: "color-change",
      description: "Button background changed from blue (#2563eb) to red (#dc2626)",
      rectSelector: "#test-button",
    },
    mutate: async (page) => {
      // string expression: tsx injects a __name helper into function literals
      // that does not exist in the page context
      await page.evaluate("document.querySelector('#test-button').style.backgroundColor = '#dc2626'");
    },
  },
  {
    prefix: "text-change",
    label: "Text change",
    html: `<!DOCTYPE html><html><head><style>
      body { margin: 0; padding: 40px; font-family: system-ui, sans-serif; background: #f3f4f6; }
      .card { background: white; padding: 24px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); max-width: 400px; }
      h3 { margin: 0 0 8px 0; color: #111827; }
      p { margin: 0; color: #6b7280; line-height: 1.6; }
    </style></head><body>
      <div class="card">
        <h3 id="title">Product Update</h3>
        <p id="description">We've shipped 3 new features this week.</p>
      </div>
    </body></html>`,
    groundTruth: {
      kind: "text-change",
      description: 'Paragraph text changed to "New version 2.0 is now available for download."',
      rectSelector: "#description",
    },
    mutate: async (page) => {
      await page.evaluate(
        "document.querySelector('#description').textContent = 'New version 2.0 is now available for download.'",
      );
    },
  },
  {
    prefix: "no-change",
    label: "No change (anti-aliasing test)",
    html: `<!DOCTYPE html><html><head><style>
      body { margin: 0; padding: 40px; font-family: system-ui, sans-serif; background: #f3f4f6; }
      .banner { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 32px; border-radius: 12px; }
      h2 { margin: 0 0 8px 0; }
      p { margin: 0; opacity: 0.9; }
    </style></head><body>
      <div class="banner">
        <h2>Welcome Back!</h2>
        <p>Your dashboard is ready to view.</p>
      </div>
    </body></html>`,
    groundTruth: {
      kind: "no-change",
      description: "Identical DOM, any pixel differences are anti-aliasing noise",
      rectSelector: null,
    },
    mutate: async (page) => {
      await page.waitForTimeout(50); // re-render only
    },
  },
];

async function main() {
  console.log("🚀 Generating demo screenshots (real pipeline formats)\n");
  await fs.mkdir(DEMO_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 960, height: 500 } });

  for (const demo of DEMOS) {
    console.log(`📸 ${demo.label}`);
    await page.setContent(demo.html);
    await page.waitForTimeout(100);

    const domBefore = await snapshotDom(page);
    await page.screenshot({ path: path.join(DEMO_DIR, `${demo.prefix}-before.png`) });

    await demo.mutate(page);
    await page.waitForTimeout(100);

    const domAfter = await snapshotDom(page);
    await page.screenshot({ path: path.join(DEMO_DIR, `${demo.prefix}-after.png`) });

    await fs.writeFile(path.join(DEMO_DIR, `${demo.prefix}-before-dom.json`), domBefore);
    await fs.writeFile(path.join(DEMO_DIR, `${demo.prefix}-after-dom.json`), domAfter);

    const rect = demo.groundTruth.rectSelector
      ? await page.evaluate(
          `(sel) => {
            const r = document.querySelector(sel).getBoundingClientRect();
            return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
          }`,
          demo.groundTruth.rectSelector,
        )
      : null;
    await fs.writeFile(
      path.join(DEMO_DIR, `${demo.prefix}-ground-truth.json`),
      JSON.stringify({ kind: demo.groundTruth.kind, description: demo.groundTruth.description, rect }, null, 2),
    );
    console.log(`  ✓ ${demo.prefix}-{before,after}.png + DOM snapshots\n`);
  }

  await browser.close();
  console.log("✅ Demo generation complete!");
  console.log(`📁 Output directory: ${DEMO_DIR}`);
  console.log("\n▶️  Next step: npm run demo:detect");
}

main().catch(console.error);
