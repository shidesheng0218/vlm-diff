// Baseline management: the Percy-style workflow for a repo.
//   vlm-diff init [url]      → write .vlm-diff/config.json
//   vlm-diff baseline        → snapshot every configured page into .vlm-diff/baseline/
//   vlm-diff check           → re-capture, diff against baseline, report + exit code
//
// All files live under .vlm-diff/ so the state is version-controllable and
// the project root is anchored (see cli/project.ts).

import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { diffPair, type DiffVerdict } from "../core/diff.js";
import { cacheDir, projectFile } from "./project.js";
import { FileCacheStore } from "../cache/store.js";
import type { Provider } from "../provider/types.js";

export interface PageTarget {
  name: string;
  url: string;
}

export interface VlmDiffConfig {
  viewport: { width: number; height: number };
  pages: PageTarget[];
}

export interface PageCheckResult {
  name: string;
  url: string;
  verdict?: DiffVerdict;
  error?: string;
}

const DEFAULT_CONFIG: VlmDiffConfig = {
  viewport: { width: 960, height: 500 },
  pages: [{ name: "home", url: "http://localhost:3000/" }],
};

export async function runInit(root: string, seedUrl?: string): Promise<string> {
  const dir = projectFile(root);
  await mkdir(dir, { recursive: true });
  const configPath = projectFile(root, "config.json");
  const config: VlmDiffConfig = seedUrl ? { ...DEFAULT_CONFIG, pages: [{ name: "home", url: seedUrl }] } : DEFAULT_CONFIG;
  try {
    await access(configPath);
    return `${configPath} already exists — not overwritten`;
  } catch {
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
    return `wrote ${configPath} — edit "pages" to list the URLs to watch`;
  }
}

async function loadConfig(root: string): Promise<VlmDiffConfig> {
  const configPath = projectFile(root, "config.json");
  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as VlmDiffConfig;
  if (!Array.isArray(parsed.pages) || parsed.pages.length === 0) {
    throw new Error(`${configPath}: "pages" must be a non-empty array of { name, url }`);
  }
  return parsed;
}

interface CapturedPage {
  name: string;
  url: string;
  png: Buffer;
  dom: string;
}

async function capturePages(config: VlmDiffConfig): Promise<CapturedPage[]> {
  const { chromium } = await import("playwright");
  const { snapshotDom } = await import("../snapshot/capture.js");
  const browser = await chromium.launch();
  try {
    const out: CapturedPage[] = [];
    for (const target of config.pages) {
      const page = await browser.newPage({ viewport: config.viewport });
      await page.goto(target.url, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(100);
      const png = (await page.screenshot()) as Buffer;
      const dom = await snapshotDom(page);
      out.push({ name: target.name, url: target.url, png, dom });
      await page.close();
    }
    return out;
  } finally {
    await browser.close();
  }
}

export async function runBaseline(root: string): Promise<PageTarget[]> {
  const config = await loadConfig(root);
  const dir = projectFile(root, "baseline");
  await mkdir(dir, { recursive: true });
  const captured = await capturePages(config);
  for (const c of captured) {
    await writeFile(path.join(dir, `${c.name}.png`), c.png);
    await writeFile(path.join(dir, `${c.name}.dom.json`), c.dom);
  }
  return config.pages;
}

/**
 * Re-capture every configured page and diff against the stored baseline.
 * Exit semantics mirror `diff`: caller maps to 0 clean / 1 changed / 3 needs VLM.
 */
export async function runCheck(
  root: string,
  opts: { provider?: Provider; noVlm?: boolean } = {},
): Promise<PageCheckResult[]> {
  const config = await loadConfig(root);
  const dir = projectFile(root, "baseline");
  const captured = await capturePages(config);

  const results: PageCheckResult[] = [];
  for (const c of captured) {
    try {
      const basePng = await readFile(path.join(dir, `${c.name}.png`));
      const baseDom = await readFile(path.join(dir, `${c.name}.dom.json`), "utf8");
      const verdict = await diffPair(basePng, c.png, baseDom, c.dom, {
        provider: opts.noVlm ? undefined : opts.provider,
        cache: new FileCacheStore(cacheDir(root)),
      });
      results.push({ name: c.name, url: c.url, verdict });
    } catch (err) {
      results.push({
        name: c.name,
        url: c.url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

/** Aggregate exit code for `check`: 0 clean, 1 changes, 3 some page needs a VLM key. */
export function checkExitCode(results: PageCheckResult[]): number {
  let changed = false;
  let pending = false;
  for (const r of results) {
    if (r.error) return 2;
    if (r.verdict?.pendingEscalations) pending = true;
    if (r.verdict?.changed) changed = true;
  }
  if (pending) return 3;
  return changed ? 1 : 0;
}
