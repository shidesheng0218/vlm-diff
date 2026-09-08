#!/usr/bin/env tsx
/**
 * Export free training labels for a future specialist classifier.
 *
 * The deterministic tier is a label factory: for every DOM-explained region
 * in the dataset it already knows the exact changeType and description, at
 * zero cost. For pixel-only regions, the v0.2 live run already paid for the
 * VLM's answers (results/mvp-report-qwen-v02.json). This script materializes
 * both into crops + a JSONL manifest — provider-agnostic training data.
 *
 * Usage: npx tsx scripts/export-training-data.ts
 * Output: data/training/crops/*.png + data/training/labels.jsonl
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { detect } from "../src/detect/regions.js";
import { describeRegions } from "../src/describe/describe.js";
import { cropRegion } from "../src/classify/vlm-classify.js";
import type { PairRecord } from "../src/eval/types.js";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "data", "training");
const CROPS_DIR = path.join(OUT_DIR, "crops");

interface LabelRow {
  id: string;
  pairId: string;
  pairKind: string;
  beforeCrop: string;
  afterCrop: string;
  changeType: string;
  description: string;
  /** where the label came from — deterministic template (free) or a named VLM */
  labelSource: "deterministic" | "vlm:qwen3.8-max";
  source: string; // region source: dom | pixel | dom+pixel
}

async function main() {
  const dataset: PairRecord[] = JSON.parse(await readFile(path.join(ROOT, "data", "dataset.json"), "utf8"));
  await mkdir(CROPS_DIR, { recursive: true });

  // VLM labels already paid for in the v0.2 live run (tiered arm classifications)
  interface MvpReport { baselines: Record<string, { perPair: Array<{ id: string; classifications?: Array<{ region: { x: number; y: number; w: number; h: number }; changeType: string; description: string }> }> }> }
  let vlmLabels = new Map<string, Array<{ changeType: string; description: string }>>();
  try {
    const mvp: MvpReport = JSON.parse(await readFile(path.join(ROOT, "results", "mvp-report-qwen-v02.json"), "utf8"));
    for (const p of mvp.baselines.tieredPipeline.perPair) {
      if (p.id.startsWith("media-") && p.classifications?.length) {
        vlmLabels.set(p.id, p.classifications.map((c) => ({ changeType: c.changeType, description: c.description })));
      }
    }
  } catch {
    console.warn("no mvp-report-qwen-v02.json — VLM labels for pixel-only pairs will be skipped");
  }

  const rows: LabelRow[] = [];
  let deterministicCount = 0;
  let vlmCount = 0;

  for (const pair of dataset) {
    if (pair.kind === "none") continue;
    const beforePng = await readFile(path.join(ROOT, "data", pair.before));
    const afterPng = await readFile(path.join(ROOT, "data", pair.after));
    const detection = detect(pair.domBefore, pair.domAfter, beforePng, afterPng);
    if (!detection.changed) continue;

    const descriptions = describeRegions(detection.regions);
    const vlmForPair = vlmLabels.get(pair.id);
    let vlmIdx = 0;

    for (let i = 0; i < detection.regions.length; i++) {
      const region = detection.regions[i];
      const d = descriptions[i];
      let changeType: string | undefined;
      let description: string | undefined;
      let labelSource: LabelRow["labelSource"];

      if (d.route === "deterministic" && d.changeType && d.description) {
        changeType = d.changeType;
        description = d.description;
        labelSource = "deterministic";
        deterministicCount++;
      } else if (vlmForPair && vlmIdx < vlmForPair.length) {
        // escalated region — use the VLM label paid for in the v0.2 run
        changeType = vlmForPair[vlmIdx].changeType;
        description = vlmForPair[vlmIdx].description;
        labelSource = "vlm:qwen3.8-max";
        vlmCount++;
        vlmIdx++;
      } else {
        continue; // no label available for this region
      }

      const id = `${pair.id}-r${i}`;
      const beforeCrop = cropRegion(beforePng, region);
      const afterCrop = cropRegion(afterPng, region);
      const beforeName = `${id}-before.png`;
      const afterName = `${id}-after.png`;
      await writeFile(path.join(CROPS_DIR, beforeName), beforeCrop);
      await writeFile(path.join(CROPS_DIR, afterName), afterCrop);

      rows.push({
        id,
        pairId: pair.id,
        pairKind: pair.kind,
        beforeCrop: `crops/${beforeName}`,
        afterCrop: `crops/${afterName}`,
        changeType,
        description,
        labelSource,
        source: region.source,
      });
    }
  }

  await writeFile(path.join(OUT_DIR, "labels.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const bySource = {
    deterministic: rows.filter((r) => r.labelSource === "deterministic").length,
    vlm: rows.filter((r) => r.labelSource.startsWith("vlm")).length,
  };
  const byKind: Record<string, number> = {};
  for (const r of rows) byKind[r.changeType] = (byKind[r.changeType] ?? 0) + 1;

  console.log(`Exported ${rows.length} labeled region pairs → ${OUT_DIR}`);
  console.log(`  deterministic (free): ${bySource.deterministic}   VLM (v0.2 run): ${bySource.vlm}`);
  console.log(`  by changeType: ${Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
