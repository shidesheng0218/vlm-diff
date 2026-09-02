// Cross-platform postbuild: copy dataset fixtures next to the compiled
// generate.js (replaces the Unix-only `mkdir -p && cp -r`).
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "dist", "dataset"), { recursive: true });
cpSync(join(root, "src", "dataset", "fixtures"), join(root, "dist", "dataset", "fixtures"), { recursive: true });
