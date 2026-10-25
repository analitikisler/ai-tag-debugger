import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadReportBrand, brandCss, brandTokens, contrast, writePdf } from "../src/whitelabel.js";
import { renderHtml, renderMarkdown } from "../src/report.js";
import { TOKENS } from "../src/html/css.js";
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

// The grounds the accent is drawn on, read from the report's own tokens so a change there is checked here too.
const themeBlocks = { light: TOKENS.split("@media")[0], dark: TOKENS.split(':root[data-theme="dark"]{')[1] };
const grounds = (theme) => Object.fromEntries(["card", "page", "card-2", "well"].map((n) => [n, themeBlocks[theme].match(new RegExp(`--${n}:(#[0-9a-f]{6})`))[1]]));

/** HSL hue in degrees, or null for a grey. */
function hue(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (d < 0.02) return null;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

// Awkward brand colours: very pale yellow and cyan, near-white, white, pure red, magenta, a dark navy and black.
const AWKWARD = ["#ffe066", "#fff7c2", "#a0f0ff", "#fafafa", "#ffffff", "#ff0000", "#ff00ff", "#0b1f3a", "#000000"];

for (const theme of ["light", "dark"]) {
  test(`white label, ${theme}: links read at 4.5:1 and marks at 3:1 on every ground and the tint, in the brand's hue`, () => {
    const on = { ...grounds(theme) };
    for (const color of [...AWKWARD, "#0a7d5a"]) {
      const t = brandTokens(color)[theme];
      for (const [name, ground] of Object.entries({ ...on, tint: t.bg })) {
        assert.ok(contrast(t.fg, ground) >= 4.5, `${color} ${theme}: link ${t.fg} on ${name} ${ground} is ${contrast(t.fg, ground).toFixed(2)}`);
        assert.ok(contrast(t.accent, ground) >= 3, `${color} ${theme}: mark ${t.accent} on ${name} ${ground} is ${contrast(t.accent, ground).toFixed(2)}`);
      }
      // The link and the marks get darker or lighter, never another colour: the hue moves by rounding only. (The tint is
      // the colour laid on the card, as every tint in the report is, so in dark mode it leans towards the navy.)
      for (const derived of [t.fg, t.accent]) {
        if (hue(color) === null || hue(derived) === null) continue;
        const drift = Math.abs(((hue(derived) - hue(color) + 540) % 360) - 180);
        assert.ok(drift <= 4, `${color} ${theme}: ${derived} moved the hue by ${drift.toFixed(1)} degrees`);
      }
    }
  });
}

test("white label: a pale brand colour gets darker light tokens, a dark one lighter dark tokens, and the CSS carries them", () => {
  const pale = brandTokens("#ffe066");
  // Before, the light link stopped at 4.5:1 on white and read at 4.39:1 on its own tint; the mark was the raw yellow.
  assert.notEqual(pale.light.fg, "#867636");
  assert.notEqual(pale.light.accent, "#ffe066");
  assert.ok(contrast(pale.light.fg, pale.light.bg) >= 4.5);
  const navy = brandTokens("#0b1f3a");
  assert.notEqual(navy.dark.accent, "#3c4c61", "the dark focus ring and tab rule are lifted off the navy card");
  for (const color of ["#ffe066", "#0b1f3a"]) {
    const { light, dark } = brandTokens(color);
    const set = (t) => `--accent:${t.accent};--accent-fg:${t.fg};--accent-bg:${t.bg}`;
    assert.equal(brandCss(color), `:root{${set(light)}}@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${set(dark)}}}:root[data-theme="dark"]{${set(dark)}}`);
  }
});

test("white label: a brand colour that already reads is left as it was", () => {
  assert.deepEqual(brandTokens("#0a7d5a"), {
    light: { accent: "#0a7d5a", fg: "#086448", bg: "#e7f2ef" },
    dark: { accent: "#3b977b", fg: "#85bead", bg: "#0d363e" },
  });
});

test("a white-labeled report swaps the logo and drops Analitik İşler but keeps a small ai tag debugger credit", () => {
  const brand = { name: "Acme <Co>", logo: "data:image/png;base64,AAAA", color: "#0a7d5a", pdf: false };
  const html = renderHtml({ ...base, brand });
  assert.match(html, /<img src="data:image\/png;base64,AAAA" alt="Acme &lt;Co&gt;"/);
  assert.match(html, /--accent:#0a7d5a/);
  assert.doesNotMatch(html, /analitikisler\.com|Analitik İşler/);
  assert.match(html, /class="byline"[^>]*><span>by<\/span>.*ai tag debugger/s);
  assert.match(html, /made with the open source/);
  const md = renderMarkdown({ ...base, brand });
  assert.match(md, /_Acme <Co> · Generated by ai tag debugger_/);
  assert.doesNotMatch(md, /analitikisler/);
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
