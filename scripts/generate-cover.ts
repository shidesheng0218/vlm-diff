import { chromium } from "playwright";
import { join } from "node:path";

const htmlPath = join(import.meta.dirname, "..", "docs", "cover.html");
const outputPath = join(import.meta.dirname, "..", "docs", "cover.png");

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 2, // 2x for retina
});

await page.goto(`file://${htmlPath}`);
await page.screenshot({ path: outputPath, type: "png" });
await browser.close();

console.log(`✓ Cover generated: ${outputPath}`);
