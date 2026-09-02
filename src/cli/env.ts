// Minimal .env loader (no dependency). Reads .env from the working directory
// and sets keys that are not already present in process.env — the real
// environment always wins.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

export function loadDotEnv(cwd: string = process.cwd()): number {
  const file = path.join(cwd, ".env");
  if (!existsSync(file)) return 0;

  let loaded = 0;
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key !== "" && process.env[key] === undefined) {
      process.env[key] = value;
      loaded++;
    }
  }
  return loaded;
}
