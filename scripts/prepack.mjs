// Prepack: build fresh dist, then strip compiled test files so the published
// tarball ships runtime code only (tests live in the repo, not the package).
import { execFileSync } from "node:child_process";
import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

execFileSync("npm", ["run", "build"], { stdio: "inherit" });

let removed = 0;
function strip(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) strip(p);
    else if (entry.endsWith(".test.js")) {
      unlinkSync(p);
      removed++;
    }
  }
}
// fileURLToPath (not URL.pathname): the project path contains spaces/CJK
strip(fileURLToPath(new URL("../dist", import.meta.url)));
console.log(`prepack: removed ${removed} compiled test file(s) from dist`);
