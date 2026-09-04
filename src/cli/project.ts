// Project-root anchoring: walk up from cwd looking for a `.vlm-diff/` dir
// (created by `vlm-diff init`) so cache and config resolve predictably no
// matter which subdirectory the command runs from. Falls back to cwd.

import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export function findProjectRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, ".vlm-diff"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start); // filesystem root: no anchor found
    dir = parent;
  }
}

export function cacheDir(root: string = findProjectRoot()): string {
  return join(root, ".cache", "classifications");
}

export function projectFile(root: string, ...parts: string[]): string {
  return join(root, ".vlm-diff", ...parts);
}

export function resolveIn(root: string, p: string): string {
  return isAbsolute(p) ? p : join(root, p);
}
