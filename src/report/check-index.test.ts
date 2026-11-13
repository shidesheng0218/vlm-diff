import { test } from "node:test";
import assert from "node:assert/strict";
import { generateCheckIndex, toJUnitXml } from "./check-index.js";
import type { PageCheckResult } from "../cli/baseline.js";

function page(name: string, opts: { changed?: boolean; changeType?: string; severity?: string; error?: string } = {}): PageCheckResult {
  if (opts.error) return { name, url: `http://x/${name}`, error: opts.error };
  return {
    name,
    url: `http://x/${name}`,
    verdict: {
      changed: opts.changed ?? false,
      visualOnly: false,
      pixelChangedCount: 0,
      pixelChangedFraction: 0,
      changeType: opts.changeType as any,
      summary: opts.changed ? `${opts.changeType ?? "change"} on ${name}` : undefined,
      severity: opts.severity as any,
      regions: [],
      pendingEscalations: 0,
      inputTokens: 0,
      outputTokens: 0,
    } as any,
  };
}

test("generateCheckIndex: changed pages are listed with severity, sorted breaking first", () => {
  const html = generateCheckIndex([
    page("home", { changed: true, changeType: "color-change", severity: "cosmetic" }),
    page("menu", { changed: true, changeType: "element-remove", severity: "breaking" }),
    page("about"),
  ]);
  const breakIdx = html.indexOf("menu");
  const cosmeticIdx = html.indexOf("home");
  assert.ok(breakIdx < cosmeticIdx, "breaking page should sort before cosmetic");
  assert.match(html, /3<\/b>pages/);
  assert.match(html, /2<\/b>changed/);
  assert.match(html, /1<\/b>clean/);
});

test("generateCheckIndex: clean run reports zero changed", () => {
  const html = generateCheckIndex([page("a"), page("b")]);
  assert.match(html, /0<\/b>changed/);
  assert.match(html, /2<\/b>clean/);
});

test("generateCheckIndex: errors are surfaced separately from changes", () => {
  const html = generateCheckIndex([page("x", { error: "capture failed" })]);
  assert.match(html, /error/);
  assert.match(html, /capture failed/);
});

test("generateCheckIndex: changed pages link to their per-page report", () => {
  const html = generateCheckIndex([page("home", { changed: true, changeType: "color-change" })]);
  assert.match(html, /href="home\.html"/);
});

test("toJUnitXml: changed pages are failures, errors are errors, clean pass", () => {
  const xml = toJUnitXml([
    page("good"),
    page("changed-page", { changed: true, changeType: "text-change", severity: "moderate" }),
    page("broken", { error: "timeout" }),
  ]);
  assert.match(xml, /tests="3"/);
  assert.match(xml, /failures="1"/);
  assert.match(xml, /errors="1"/);
  assert.match(xml, /<failure message="text-change \(moderate\)/);
  assert.match(xml, /<error message="timeout"\/>/);
  assert.match(xml, /<testcase name="good"[^>]*\/>/);
});

test("toJUnitXml: escapes XML special chars in page names and summaries", () => {
  const xml = toJUnitXml([page("a<b>&\"c", { changed: true, changeType: "color-change" })]);
  assert.ok(!xml.includes('name="a<b>"'), "raw < must be escaped");
  assert.match(xml, /a&lt;b&gt;/);
});

test("toJUnitXml: empty run produces a valid empty testsuite", () => {
  const xml = toJUnitXml([]);
  assert.match(xml, /tests="0"/);
  assert.match(xml, /<testsuite/);
});