import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ART, IMAGES, render, symbolOf } from "../scripts/brand.js";
import { LOGOS, LOGO_ART } from "../src/brand.js";

// A logo file as the brand folder draws them: a title, then paths in the ink and the point of the theme.
const logoSvg = (ink, point, d = "M0 0H10V10Z") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10" width="20" height="10" role="img" aria-labelledby="t"><title id="t">x</title><path fill="${ink}" d="${d}"/><path fill="${point}" d="M15 0H20V5Z"/></svg>`;
const LIGHT = logoSvg("#17140F", "#C12D30"), DARK = logoSvg("#F1ECE2", "#FA6B6D");

/** A throwaway assets folder holding every file the script reads. */
function assets(skip = null) {
  const dir = mkdtempSync(path.join(tmpdir(), "aitd-brand-"));
  const files = { ...Object.fromEntries(Object.values(ART).flatMap((b) => [[`${b}-light.svg`, LIGHT], [`${b}-dark.svg`, DARK]])), ...Object.fromEntries(Object.values(IMAGES).map((f) => [f, `<svg>${f}</svg>`])) };
  for (const [file, text] of Object.entries(files)) {
    if (file === skip) continue;
    mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  }
  return dir;
}

test("a logo becomes a sprite symbol: the ink in currentColor, the point in --brand-point, and no id to clash with the page", () => {
  const { viewBox, art } = symbolOf(LIGHT, DARK, "x");
  assert.equal(viewBox, "0 0 20 10");
  assert.equal(art, '<path fill="currentColor" d="M0 0H10V10Z"/><path style="fill:var(--brand-point)" d="M15 0H20V5Z"/>');
  assert.doesNotMatch(art, /\bid=|<title|#[0-9A-F]{6}/i);
});

test("a colour outside the brand, a dark file with other shapes, or a missing file stops the script", () => {
  assert.throws(() => symbolOf(logoSvg("#FF6D33", "#C12D30"), DARK, "old"), /old: fill #FF6D33 is neither the ink #17140F nor the point #C12D30/);
  assert.throws(() => symbolOf(LIGHT, logoSvg("#F1ECE2", "#FA6B6D", "M1 1Z"), "x"), /the dark file draws other shapes/);
  const dir = assets("icons/favicon-ai-16.svg");
  try {
    assert.throws(() => render(dir), /icons\/favicon-ai-16\.svg for "favicon-light"\. Copy design\/13-ai-brand/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("src/brand.js evaluates to every symbol and image the script names", async () => {
  const dir = assets();
  try {
    const file = path.join(dir, "brand.mjs");
    writeFileSync(file, render(dir));
    const built = await import(file);
    assert.deepEqual(Object.keys(built.LOGO_ART), Object.keys(ART));
    assert.deepEqual(Object.keys(built.LOGOS), Object.keys(IMAGES));
    assert.equal(Buffer.from(built.LOGOS["favicon-dark"].split(",")[1], "base64").toString(), "<svg>icons/favicon-ai-16-ink.svg</svg>");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the committed src/brand.js is the script's output for brand/ai/assets, so the logos never drift from the brand folder", () => {
  const text = render(fileURLToPath(new URL("../brand/ai/assets", import.meta.url)));
  for (const [key, value] of Object.entries(LOGO_ART)) assert.ok(text.includes(`${JSON.stringify(key)}: ${JSON.stringify(value)},`), `${key} differs: run node scripts/brand.js`);
  for (const [key, value] of Object.entries(LOGOS)) assert.ok(text.includes(`${JSON.stringify(key)}: ${JSON.stringify(value)},`), `${key} differs: run node scripts/brand.js`);
  assert.deepEqual(Object.keys(LOGO_ART), Object.keys(ART));
});
