#!/usr/bin/env tsx
/**
 * Evaluate a candidate specialist classifier on the exported free labels.
 *
 * Each row in data/training/labels.jsonl is a (beforeCrop, afterCrop) pair
 * with a ground-truth changeType. The harness classifies it with the same
 * system prompt the pipeline uses (no DOM hint — the specialist must see
 * for itself) and scores exact-match changeType accuracy, per-kind and
 * overall. Every call goes through the instrumented provider, so the run's
 * cost is logged to .cache/cost-log.jsonl automatically.
 *
 * Usage:
 *   VLM_DIFF_EVAL_LIMIT=24 npx tsx scripts/eval-specialist.ts            # stratified sample
 *   VLM_DIFF_EVAL_PROVIDER=dashscope VLM_DIFF_EVAL_MODEL=qwen3.8-max npx tsx scripts/eval-specialist.ts
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { createProvider } from "../src/provider/factory.js";
import { classifyRegion } from "../src/classify/vlm-classify.js";
import { loadDotEnv } from "../src/cli/env.js";

interface LabelRow {
  id: string;
  pairId: string;
  pairKind: string;
  beforeCrop: string;
  afterCrop: string;
  changeType: string;
  description: string;
  labelSource: string;
}

/** Stratified sample: round-robin across changeTypes so small kinds still appear. */
function stratifiedSample(rows: LabelRow[], limit: number): LabelRow[] {
  const byKind = new Map<string, LabelRow[]>();
  for (const r of rows) {
    const list = byKind.get(r.changeType) ?? [];
    list.push(r);
    byKind.set(r.changeType, list);
  }
  const kinds = [...byKind.keys()].sort();
  const out: LabelRow[] = [];
  let i = 0;
  while (out.length < limit && out.length < rows.length) {
    const kind = kinds[i % kinds.length];
    const list = byKind.get(kind)!;
    const idx = Math.floor(i / kinds.length);
    if (idx < list.length) out.push(list[idx]);
    i++;
    if (kinds.every((k) => byKind.get(k)!.length <= Math.floor(i / kinds.length))) break;
  }
  return out;
}

async function main() {
  loadDotEnv();
  const rows: LabelRow[] = (await readFile(path.join("data", "training", "labels.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

  const limit = Number(process.env.VLM_DIFF_EVAL_LIMIT ?? 24);
  const sample = stratifiedSample(rows, limit);
  const provider = createProvider({
    provider: process.env.VLM_DIFF_EVAL_PROVIDER,
    model: process.env.VLM_DIFF_EVAL_MODEL,
  });

  console.log(`Specialist eval: ${sample.length} labeled crops, model=${provider.name}/${provider.model}\n`);

  let correct = 0;
  const byKind = new Map<string, { ok: number; n: number }>();
  const misses: Array<{ id: string; expected: string; got: string; desc: string }> = [];

  for (const row of sample) {
    const beforeCrop = await readFile(path.join("data", "training", row.beforeCrop));
    const afterCrop = await readFile(path.join("data", "training", row.afterCrop));
    let got = "error";
    let desc = "";
    try {
      const c = await classifyRegion(provider, beforeCrop, afterCrop);
      got = c.changeType;
      desc = c.description;
    } catch (err) {
      desc = err instanceof Error ? err.message : String(err);
    }
    const ok = got === row.changeType;
    if (ok) correct++;
    const k = byKind.get(row.changeType) ?? { ok: 0, n: 0 };
    k.n++;
    if (ok) k.ok++;
    byKind.set(row.changeType, k);
    if (!ok) misses.push({ id: row.id, expected: row.changeType, got, desc });
    console.log(`  ${ok ? "✓" : "✗"} ${row.id} [${row.changeType}]${ok ? "" : ` → ${got}`}`);
  }

  console.log(`\n=== Specialist eval summary (n=${sample.length}) ===`);
  console.log(`overall type accuracy: ${((correct / sample.length) * 100).toFixed(1)}% (${correct}/${sample.length})`);
  for (const [kind, s] of [...byKind.entries()].sort()) {
    console.log(`  ${kind.padEnd(16)} ${s.ok}/${s.n}`);
  }
  if (misses.length > 0) {
    console.log(`\nmisses:`);
    for (const m of misses.slice(0, 5)) console.log(`  ${m.id}: expected ${m.expected}, got ${m.got} — ${m.desc.slice(0, 80)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
