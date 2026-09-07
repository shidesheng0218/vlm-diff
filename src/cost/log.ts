// Append-only cost log: every VLM call records function name, provider,
// model, tokens, latency, estimated USD cost, and success/failure. One JSON
// line per call, so `tail`, `jq`, or a spreadsheet can answer "what did this
// feature cost me last week?" without any infrastructure.

import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface CostLogEntry {
  ts: string;
  fn: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costUsd: number;
  ok: boolean;
  error?: string;
}

export function costLogPath(): string {
  return process.env.VLM_DIFF_COST_LOG_PATH ?? join(process.cwd(), ".cache", "cost-log.jsonl");
}

export async function appendCostLog(entry: CostLogEntry, path: string = costLogPath()): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    // logging must never break a diff run
  }
}
