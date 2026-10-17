import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { browserEnv, installBrowser } from "./browser.js";

const LOGO_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml" };
const MAX_LOGO_BYTES = 512 * 1024;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Reads the "report" setting: { name?, logo?, color?, pdf? }. A logo file is embedded as a data URI, so the
 * report stays one file. Relative paths are read from the config file's folder.
 * @returns {Promise<{ name: string | null, logo: string | null, color: string | null, pdf: boolean } | null>} null when nothing is set
 */
export async function loadReportBrand(report, baseDir = process.cwd()) {
  if (report === undefined || report === null) return null;
  if (typeof report !== "object" || Array.isArray(report)) throw new Error('"report" must be an object, e.g. { "name": "Acme", "logo": "logo.png", "color": "#0a7d5a", "pdf": true }.');
  const { name = null, logo = null, color = null, pdf = false } = report;
  if (name !== null && (typeof name !== "string" || name.length > 80)) throw new Error('"report.name" must be a short text.');
  if (color !== null && (typeof color !== "string" || !HEX.test(color))) throw new Error('"report.color" must be a hex color like "#0a7d5a".');
  if (typeof pdf !== "boolean") throw new Error('"report.pdf" must be true or false.');
  let dataUri = null;
  if (logo !== null) {
    if (typeof logo !== "string") throw new Error('"report.logo" must be a file path.');
    const full = path.resolve(baseDir, logo);
    const type = LOGO_TYPES[path.extname(full).toLowerCase()];
    if (!type) throw new Error(`"report.logo" must be a ${Object.keys(LOGO_TYPES).join(", ")} file.`);
    let bytes;
    try { bytes = await readFile(full); } catch (err) { throw new Error(`Could not read the report logo ${full}: ${err.message}`); }
    if (bytes.length > MAX_LOGO_BYTES) throw new Error(`"report.logo" is ${Math.round(bytes.length / 1024)} KB; keep it under ${MAX_LOGO_BYTES / 1024} KB.`);
    dataUri = `data:${type};base64,${bytes.toString("base64")}`;
  }
  if (!name && !dataUri && !color && !pdf) return null;
  return { name: name || null, logo: dataUri, color: color ? normalizeHex(color) : null, pdf };
}

function normalizeHex(hex) {
  const h = hex.slice(1);
  return `#${(h.length === 3 ? [...h].map((c) => c + c).join("") : h).toLowerCase()}`;
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
const mix = (hex, other, amount) => toHex(rgb(hex).map((v, i) => v + (other[i] - v) * amount));

/** CSS that recolors the report's accent. The light theme gets a darker text color and a pale tint; the dark theme a lighter one. */
export function brandCss(color) {
  if (!color) return "";
  const black = [0, 0, 0], white = [255, 255, 255];
  const light = `--accent:${color};--accent-fg:${mix(color, black, 0.2)};--accent-bg:${mix(color, white, 0.9)}`;
  const dark = `--accent:${mix(color, white, 0.2)};--accent-fg:${mix(color, white, 0.5)};--accent-bg:${mix(color, [10, 14, 26], 0.75)}`;
  return `:root{${light}}@media (prefers-color-scheme:dark){:root{${dark}}}`;
}

/** Prints an HTML report to a PDF with Chromium. The print styles open every tab, so the PDF holds the whole report. */
export async function writePdf(htmlPath, pdfPath) {
  const launch = { headless: true, env: browserEnv() };
  let browser;
  try {
    browser = await chromium.launch(launch);
  } catch (err) {
    if (!/Executable doesn't exist|playwright install/i.test(String(err?.message))) throw err;
    await installBrowser();
    browser = await chromium.launch(launch);
  }
  try {
    // JavaScript is off: the report needs none, and the page is only ever our own file.
    const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: "light" });
    const page = await context.newPage();
    await page.goto(new URL(`file://${path.resolve(htmlPath)}`).href);
    await page.emulateMedia({ media: "print", colorScheme: "light" });
    await page.pdf({ path: pdfPath, format: "A4", printBackground: true, margin: { top: "14mm", bottom: "14mm", left: "10mm", right: "10mm" } });
  } finally {
    await browser.close();
  }
}
