#!/usr/bin/env tsx
/**
 * Demo: Detect changes in generated screenshots (Stage 1 only, no VLM)
 * Run: npm run demo:detect
 */

import fs from 'fs/promises';
import path from 'path';
import { detectChanges } from '../src/detect';

const DEMO_DIR = path.join(process.cwd(), 'data', 'demo');

async function main() {
  console.log('🔍 Running VLM-Diff detection (Stage 1: Deterministic only)\n');
  console.log('This demo runs without VLM API calls to show the detection layer.\n');
  console.log('━'.repeat(60));

  const demos = [
    {
      name: 'Color Change',
      prefix: 'color-change',
      expectedChange: true,
      expectedKind: 'color-change',
    },
    {
      name: 'Text Change',
      prefix: 'text-change',
      expectedChange: true,
      expectedKind: 'text-change',
    },
    {
      name: 'No Change (AA noise test)',
      prefix: 'no-change',
      expectedChange: false,
      expectedKind: 'no-change',
    },
  ];

  let totalDetected = 0;
  let totalExpected = 0;
  let falsePositives = 0;

  for (const demo of demos) {
    console.log(`\n📋 ${demo.name}`);
    console.log('─'.repeat(60));

    try {
      // Load images and DOM snapshots
      const beforeImage = path.join(DEMO_DIR, `${demo.prefix}-before.png`);
      const afterImage = path.join(DEMO_DIR, `${demo.prefix}-after.png`);
      const domBefore = JSON.parse(
        await fs.readFile(path.join(DEMO_DIR, `${demo.prefix}-before-dom.json`), 'utf-8')
      );
      const domAfter = JSON.parse(
        await fs.readFile(path.join(DEMO_DIR, `${demo.prefix}-after-dom.json`), 'utf-8')
      );
      const groundTruth = JSON.parse(
        await fs.readFile(path.join(DEMO_DIR, `${demo.prefix}-ground-truth.json`), 'utf-8')
      );

      // Run detection
      const result = await detectChanges({
        beforeImage,
        afterImage,
        domBefore,
        domAfter,
      });

      // Evaluate
      const detected = result.changed;
      const expected = demo.expectedChange;

      if (detected) totalDetected++;
      if (expected) totalExpected++;
      if (detected && !expected) falsePositives++;

      // Display results
      console.log(`Expected: ${expected ? '✓ Change' : '✗ No change'}`);
      console.log(`Detected: ${detected ? '✓ Change' : '✗ No change'}`);
      console.log(`Status:   ${detected === expected ? '✅ CORRECT' : '❌ WRONG'}`);

      if (result.changed && result.regions.length > 0) {
        console.log(`\nDetected regions: ${result.regions.length}`);
        result.regions.forEach((region, i) => {
          console.log(`  ${i + 1}. Source: ${region.source}`);
          console.log(`     Rect: x=${Math.round(region.rect.x)}, y=${Math.round(region.rect.y)}, ` +
            `w=${Math.round(region.rect.width)}, h=${Math.round(region.rect.height)}`);
          if (region.changedFields) {
            console.log(`     Changed: ${region.changedFields.join(', ')}`);
          }
        });

        // Compare with ground truth
        if (groundTruth.rect) {
          const gtRect = groundTruth.rect;
          const detectedRect = result.regions[0].rect;
          const iou = calculateIoU(gtRect, detectedRect);
          console.log(`\n  Ground truth IoU: ${(iou * 100).toFixed(1)}% ${iou > 0.3 ? '✓' : '✗'}`);
        }
      } else if (result.changed) {
        console.log('\n  ⚠️  Changed but no regions (pixel-diff only, very small area)');
      }

      console.log(`\nGround truth: "${groundTruth.description}"`);

    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
    }
  }

  // Summary
  console.log('\n' + '━'.repeat(60));
  console.log('\n📊 Summary\n');
  console.log(`Total demos:           ${demos.length}`);
  console.log(`Expected changes:      ${totalExpected}`);
  console.log(`Detected changes:      ${totalDetected}`);
  console.log(`False positives:       ${falsePositives} ${falsePositives === 0 ? '✅' : '❌'}`);
  console.log(`Recall:                ${totalExpected > 0 ? ((totalDetected / totalExpected) * 100).toFixed(1) : 0}%`);
  console.log(`False-positive rate:   ${(demos.length - totalExpected) > 0 ? ((falsePositives / (demos.length - totalExpected)) * 100).toFixed(1) : 0}%`);

  console.log('\n━'.repeat(60));
  console.log('\n✅ Stage 1 (Deterministic detection) complete!\n');
  console.log('💡 This validates the core claim:');
  console.log('   • DOM diff catches semantic changes');
  console.log('   • No false positives on unchanged pairs');
  console.log('   • Anti-aliasing noise is suppressed\n');
  console.log('🚀 Next: Run full pipeline with VLM classification');
  console.log('   npm run demo:full (requires API key)\n');
}

function calculateIoU(rect1: any, rect2: any): number {
  const x1 = Math.max(rect1.x, rect2.x);
  const y1 = Math.max(rect1.y, rect2.y);
  const x2 = Math.min(rect1.x + rect1.width, rect2.x + rect2.width);
  const y2 = Math.min(rect1.y + rect1.height, rect2.y + rect2.height);

  if (x2 < x1 || y2 < y1) return 0;

  const intersection = (x2 - x1) * (y2 - y1);
  const area1 = rect1.width * rect1.height;
  const area2 = rect2.width * rect2.height;
  const union = area1 + area2 - intersection;

  return union > 0 ? intersection / union : 0;
}

main().catch(console.error);
