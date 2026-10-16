import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadReportBrand, brandCss, writePdf } from "../src/whitelabel.js";
import { renderHtml, renderMarkdown } from "../src/report.js";
import { chromium } from "playwright";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const base = { title: "T", site: "example.com", generatedAt: "2026-10-16 10:00 UTC", findings: [], explained: null, runs: [], lang: "en" };

test("no report setting means no white label", async () => {
  assert.equal(await loadReportBrand(undefined), null);
  assert.equal(await loadReportBrand({}), null);
});

test("the logo is embedded from the config folder and the color is normalized", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "aitd-wl-"));
  try {
    await writeFile(path.join(dir, "logo.png"), PNG);
    const brand = await loadReportBrand({ name: "Acme", logo: "logo.png", color: "#ABC", pdf: true }, dir);
    assert.match(brand.logo, /^data:image\/png;base64,/);
    assert.equal(brand.color, "#aabbcc");
    assert.equal(brand.pdf, true);
  } finally { await rm(dir, { recursive: true }); }
});

test("bad settings fail with a clear message", async () => {
  await assert.rejects(loadReportBrand({ color: "blue" }), /hex color/);
  await assert.rejects(loadReportBrand({ logo: "logo.exe" }), /must be a/);
  await assert.rejects(loadReportBrand({ logo: "missing.png" }, tmpdir()), /Could not read the report logo/);
  await assert.rejects(loadReportBrand({ pdf: "yes" }), /true or false/);
  await assert.rejects(loadReportBrand("x"), /must be an object/);
});

test("brandCss sets the accent for light and dark", () => {
  assert.equal(brandCss(null), "");
  const css = brandCss("#0a7d5a");
  assert.match(css, /:root\{--accent:#0a7d5a;/);
  assert.match(css, /prefers-color-scheme:dark/);
});

test("a white-labeled report swaps the logo and drops the product and Analitik İşler credit", () => {
  const brand = { name: "Acme <Co>", logo: "data:image/png;base64,AAAA", color: "#0a7d5a", pdf: false };
  const html = renderHtml({ ...base, brand });
  assert.match(html, /<img src="data:image\/png;base64,AAAA" alt="Acme &lt;Co&gt;"/);
  assert.match(html, /--accent:#0a7d5a/);
  assert.doesNotMatch(html, /analitikisler\.com|AI Tag Debugger/);
  assert.match(renderMarkdown({ ...base, brand }), /_Acme <Co>_/);
  assert.doesNotMatch(renderMarkdown({ ...base, brand }), /analitikisler/);
});

test("a color alone keeps the default branding", () => {
  const html = renderHtml({ ...base, brand: { name: null, logo: null, color: "#0a7d5a", pdf: false } });
  assert.match(html, /--accent:#0a7d5a/);
  assert.match(html, /analitikisler\.com/);
});

test("writePdf prints the report to a PDF", async (t) => {
  try { await (await chromium.launch()).close(); } catch { return t.skip("Chromium is not installed"); }
  const dir = await mkdtemp(path.join(tmpdir(), "aitd-pdf-"));
  try {
    await writeFile(path.join(dir, "report.html"), renderHtml(base));
    await writePdf(path.join(dir, "report.html"), path.join(dir, "report.pdf"));
    assert.equal((await readFile(path.join(dir, "report.pdf"))).subarray(0, 5).toString(), "%PDF-");
  } finally { await rm(dir, { recursive: true }); }
});
