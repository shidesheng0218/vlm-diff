import { chromium } from "playwright";
import { join } from "node:path";

const pages = ["xhs-1-cover", "xhs-2-architecture", "xhs-3-data", "xhs-4-opensource"];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1080, height: 1440 },
  deviceScaleFactor: 2,
});

for (const name of pages) {
  const htmlPath = join(import.meta.dirname, "..", "docs", `${name}.html`);
  const outputPath = join(import.meta.dirname, "..", "docs", `${name}.png`);
  await page.goto(`file://${htmlPath}`);
  await page.screenshot({ path: outputPath, type: "png" });
  console.log(`✓ ${outputPath}`);
}

await browser.close();
