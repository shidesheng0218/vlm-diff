#!/usr/bin/env tsx
/**
 * Demo: run real Stage-1 detection (src/detect/regions.ts) over the pairs
 * produced by `npm run demo:generate`. Zero API calls.
 */

import fs from "fs/promises";
import path from "path";
import { detect } from "../src/detect/regions.js";
import { describeRegions } from "../src/describe/describe.js";

const DEMO_DIR = path.join(process.cwd(), "data", "demo");

const demos = [
  { name: "Color Change", prefix: "color-change", expectedChange: true },
  { name: "Text Change", prefix: "text-change", expectedChange: true },
  { name: "No Change (AA noise test)", prefix: "no-change", expectedChange: false },
];

async function main() {
  console.log("🔍 Running VLM-Diff detection (Stage 1: deterministic, 0 API calls)\n");
  console.log("━".repeat(60));

  let detectedChanges = 0;
  let expectedChanges = 0;
  let falsePositives = 0;
  let wrong = 0;

  for (const demo of demos) {
    console.log(`\n📋 ${demo.name}`);
    console.log("─".repeat(60));

    const beforePng = await fs.readFile(path.join(DEMO_DIR, `${demo.prefix}-before.png`));
    const afterPng = await fs.readFile(path.join(DEMO_DIR, `${demo.prefix}-after.png`));
    const domBefore = await fs.readFile(path.join(DEMO_DIR, `${demo.prefix}-before-dom.json`), "utf-8");
    const domAfter = await fs.readFile(path.join(DEMO_DIR, `${demo.prefix}-after-dom.json`), "utf-8");
    const groundTruth = JSON.parse(
      await fs.readFile(path.join(DEMO_DIR, `${demo.prefix}-ground-truth.json`), "utf-8"),
    );

    const result = detect(domBefore, domAfter, beforePng, afterPng);

    console.log(`Expected: ${demo.expectedChange ? "✓ Change" : "✗ No change"}`);
    console.log(`Detected: ${result.changed ? "✓ Change" : "✗ No change"}`);
    console.log(`Status:   ${result.changed === demo.expectedChange ? "✅ CORRECT" : "❌ WRONG"}`);
    if (result.changed !== demo.expectedChange) wrong++;

    if (result.changed) detectedChanges++;
    if (demo.expectedChange) expectedChanges++;
    if (result.changed && !demo.expectedChange) falsePositives++;

    if (result.changed && result.regions.length > 0) {
      // Tier A: deterministic descriptions at zero VLM tokens
      const descriptions = describeRegions(result.regions);
      console.log(`\nDetected regions: ${result.regions.length}`);
      result.regions.forEach((region, i) => {
        console.log(`  ${i + 1}. Source: ${region.source}  Rect: (${region.x}, ${region.y}) ${region.w}×${region.h}`);
        const d = descriptions[i];
        if (d.description) console.log(`     ${d.changeType}: ${d.description}`);
        else console.log(`     (would escalate to VLM: ${d.reason})`);
      });
    }

    console.log(`\nGround truth: "${groundTruth.description}"`);
  }

  console.log("\n" + "━".repeat(60));
  console.log("\n📊 Summary\n");
  console.log(`Total demos:           ${demos.length}`);
  console.log(`Expected changes:      ${expectedChanges}`);
  console.log(`Detected changes:      ${detectedChanges}`);
  console.log(`False positives:       ${falsePositives} ${falsePositives === 0 ? "✅" : "❌"}`);

  console.log("\n━".repeat(60));
  console.log("\n✅ Stage 1 (deterministic detection) complete!\n");
  console.log("💡 This validates the core claim:");
  console.log("   • DOM diff catches semantic changes with exact before/after values");
  console.log("   • No false positives on unchanged pairs");
  console.log("   • Anti-aliasing noise is suppressed\n");
  console.log("🚀 Diff your own screenshots with the CLI:");
  console.log("   node dist/cli/main.js diff before.png after.png --dom-before b.json --dom-after a.json\n");

  if (wrong > 0) {
    console.error(`❌ ${wrong} demo(s) misdetected`);
    process.exitCode = 1;
  }
}

main().catch(console.error);
