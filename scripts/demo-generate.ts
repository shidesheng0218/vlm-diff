#!/usr/bin/env tsx
/**
 * Demo: Generate test screenshots with mutations
 * Run: npm run demo:generate
 */

import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';

// Inline DOM serialization (extracted from src/dataset/generate.ts)
async function serializeDom(page: any) {
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
      return parts.join('>');
    }

    const root = document.body;
    const elements: any[] = [];
    root.querySelectorAll('*').forEach((el) => {
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      elements.push({
        path: pathFor(el, root),
        tag: el.tagName,
        id: el.id,
        className: el.className,
        text:
          el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
            ? (el as HTMLInputElement).value
            : el.children.length === 0
              ? (el.textContent ?? '').trim()
              : '',
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        style: {
          color: cs.color,
          backgroundColor: cs.backgroundColor,
          fontWeight: cs.fontWeight,
          borderRadius: cs.borderRadius,
        },
      });
    });
    return { elements };
  });
  return snapshot;
}

const DEMO_DIR = path.join(process.cwd(), 'data', 'demo');

async function main() {
  console.log('🚀 Generating demo screenshots...\n');

  // Ensure demo directory exists
  await fs.mkdir(DEMO_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 960, height: 500 } });

  // Demo 1: Color change (button blue → red)
  await generateColorChangeDemo(page);

  // Demo 2: Text change
  await generateTextChangeDemo(page);

  // Demo 3: No change (anti-aliasing noise test)
  await generateNoChangeDemo(page);

  await browser.close();

  console.log('\n✅ Demo generation complete!');
  console.log(`📁 Output directory: ${DEMO_DIR}`);
  console.log('\n▶️  Next step: npm run demo:detect');
}

async function generateColorChangeDemo(page: any) {
  console.log('📸 Demo 1: Color change (button)');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      margin: 0;
      padding: 40px;
      font-family: system-ui, sans-serif;
      background: #f3f4f6;
    }
    .button {
      background: #2563eb;
      color: white;
      padding: 12px 24px;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      cursor: pointer;
      transition: none;
    }
    .button.changed {
      background: #dc2626;
    }
    .container {
      background: white;
      padding: 32px;
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
  </style>
</head>
<body>
  <div class="container">
    <h2>UI Component Test</h2>
    <p>Check if visual changes are detected correctly.</p>
    <button class="button" id="test-button">Submit Form</button>
  </div>
</body>
</html>
  `;

  // Before state
  await page.setContent(html);
  await page.waitForTimeout(100);
  const domBefore = await page.evaluate(serializeDom);
  await page.screenshot({ path: path.join(DEMO_DIR, 'color-change-before.png') });

  // After state (change button color)
  await page.evaluate(() => {
    document.querySelector('#test-button')?.classList.add('changed');
  });
  await page.waitForTimeout(100);
  const domAfter = await page.evaluate(serializeDom);
  await page.screenshot({ path: path.join(DEMO_DIR, 'color-change-after.png') });

  // Save DOM snapshots
  await fs.writeFile(
    path.join(DEMO_DIR, 'color-change-before-dom.json'),
    JSON.stringify(domBefore, null, 2)
  );
  await fs.writeFile(
    path.join(DEMO_DIR, 'color-change-after-dom.json'),
    JSON.stringify(domAfter, null, 2)
  );

  // Save ground truth
  const groundTruth = {
    kind: 'color-change',
    description: 'Button background changed from blue (#2563eb) to red (#dc2626)',
    rect: await page.evaluate(() => {
      const btn = document.querySelector('#test-button');
      const rect = btn?.getBoundingClientRect();
      return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
    }),
  };
  await fs.writeFile(
    path.join(DEMO_DIR, 'color-change-ground-truth.json'),
    JSON.stringify(groundTruth, null, 2)
  );

  console.log('  ✓ color-change-before.png');
  console.log('  ✓ color-change-after.png');
  console.log('  ✓ DOM snapshots saved\n');
}

async function generateTextChangeDemo(page: any) {
  console.log('📸 Demo 2: Text change');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      margin: 0;
      padding: 40px;
      font-family: system-ui, sans-serif;
      background: #f3f4f6;
    }
    .card {
      background: white;
      padding: 24px;
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      max-width: 400px;
    }
    h3 { margin: 0 0 8px 0; color: #111827; }
    p { margin: 0; color: #6b7280; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <h3 id="title">Product Update</h3>
    <p id="description">We've shipped 3 new features this week.</p>
  </div>
</body>
</html>
  `;

  // Before state
  await page.setContent(html);
  await page.waitForTimeout(100);
  const domBefore = await page.evaluate(serializeDom);
  await page.screenshot({ path: path.join(DEMO_DIR, 'text-change-before.png') });

  // After state (change text)
  await page.evaluate(() => {
    const desc = document.querySelector('#description');
    if (desc) desc.textContent = 'New version 2.0 is now available for download.';
  });
  await page.waitForTimeout(100);
  const domAfter = await page.evaluate(serializeDom);
  await page.screenshot({ path: path.join(DEMO_DIR, 'text-change-after.png') });

  // Save DOM snapshots
  await fs.writeFile(
    path.join(DEMO_DIR, 'text-change-before-dom.json'),
    JSON.stringify(domBefore, null, 2)
  );
  await fs.writeFile(
    path.join(DEMO_DIR, 'text-change-after-dom.json'),
    JSON.stringify(domAfter, null, 2)
  );

  // Save ground truth
  const groundTruth = {
    kind: 'text-change',
    description: 'Paragraph text changed from "We\'ve shipped 3 new features" to "New version 2.0 is now available"',
    rect: await page.evaluate(() => {
      const p = document.querySelector('#description');
      const rect = p?.getBoundingClientRect();
      return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
    }),
  };
  await fs.writeFile(
    path.join(DEMO_DIR, 'text-change-ground-truth.json'),
    JSON.stringify(groundTruth, null, 2)
  );

  console.log('  ✓ text-change-before.png');
  console.log('  ✓ text-change-after.png');
  console.log('  ✓ DOM snapshots saved\n');
}

async function generateNoChangeDemo(page: any) {
  console.log('📸 Demo 3: No change (anti-aliasing test)');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      margin: 0;
      padding: 40px;
      font-family: system-ui, sans-serif;
      background: #f3f4f6;
    }
    .banner {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 32px;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    h2 { margin: 0 0 8px 0; }
    p { margin: 0; opacity: 0.9; }
  </style>
</head>
<body>
  <div class="banner">
    <h2>Welcome Back!</h2>
    <p>Your dashboard is ready to view.</p>
  </div>
</body>
</html>
  `;

  // Before state
  await page.setContent(html);
  await page.waitForTimeout(100);
  const domBefore = await page.evaluate(serializeDom);
  await page.screenshot({ path: path.join(DEMO_DIR, 'no-change-before.png') });

  // After state (re-screenshot with potential AA differences)
  await page.waitForTimeout(50);
  const domAfter = await page.evaluate(serializeDom);
  await page.screenshot({ path: path.join(DEMO_DIR, 'no-change-after.png') });

  // Save DOM snapshots
  await fs.writeFile(
    path.join(DEMO_DIR, 'no-change-before-dom.json'),
    JSON.stringify(domBefore, null, 2)
  );
  await fs.writeFile(
    path.join(DEMO_DIR, 'no-change-after-dom.json'),
    JSON.stringify(domAfter, null, 2)
  );

  // Save ground truth
  const groundTruth = {
    kind: 'no-change',
    description: 'Identical DOM, any pixel differences are anti-aliasing noise',
    rect: null,
  };
  await fs.writeFile(
    path.join(DEMO_DIR, 'no-change-ground-truth.json'),
    JSON.stringify(groundTruth, null, 2)
  );

  console.log('  ✓ no-change-before.png');
  console.log('  ✓ no-change-after.png');
  console.log('  ✓ DOM snapshots saved\n');
}

main().catch(console.error);
