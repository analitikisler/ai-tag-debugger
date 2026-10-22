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

// WCAG relative luminance and contrast ratio, so the link colour is checked instead of guessed.
const luminance = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a, b) => {
  const [h, l] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (h + 0.05) / (l + 0.05);
};
const MIN_TEXT_CONTRAST = 4.5;
// The card surfaces of visual-system.md §1 (Tally's surface), which the link colour must read on.
const LIGHT_CARD = "#ffffff";
const DARK_CARD = "#0e1e34";
// The dark tint is the brand colour laid on that navy card, as the default --accent-bg is.
const DARK_CARD_RGB = [14, 30, 52];

/** The colour mixed step by step towards `toward` until it reads at 4.5:1 on `surface`; the input when it already does. */
function readable(hex, toward, surface) {
  let c = hex;
  for (let i = 0; i < 20 && contrast(c, surface) < MIN_TEXT_CONTRAST; i++) c = mix(c, toward, 0.1);
  return c;
}

/**
 * CSS that recolors the report's accent: the active tab rule, focus rings, links and the step plates (visual-system.md §9).
 * The light theme gets a link colour darkened until it reads on a white card, the dark theme one lightened until it
 * reads on the dark card, so a pale brand colour never gives unreadable links. The dark set is written under both dark
 * selectors the report uses, so a forced light theme on a dark OS keeps the light accent.
 */
export function brandCss(color) {
  if (!color) return "";
  const black = [0, 0, 0], white = [255, 255, 255];
  const light = `--accent:${color};--accent-fg:${readable(mix(color, black, 0.2), black, LIGHT_CARD)};--accent-bg:${mix(color, white, 0.9)}`;
  const dark = `--accent:${mix(color, white, 0.2)};--accent-fg:${readable(mix(color, white, 0.5), white, DARK_CARD)};--accent-bg:${mix(color, DARK_CARD_RGB, 0.75)}`;
  return `:root{${light}}@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${dark}}}:root[data-theme="dark"]{${dark}}`;
}

// A forwarded PDF loses its file name, so every page carries the document title and the page number (Chromium fills the spans).
const PDF_FOOTER = '<div style="width:100%;font:9px system-ui,sans-serif;color:#4b5567;padding:0 10mm;display:flex;justify-content:space-between"><span class="title"></span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>';

/** Prints an HTML report to a PDF with Chromium. The print styles stack every tab and open every details, so the PDF holds the whole report. */
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
    await page.pdf({ path: pdfPath, format: "A4", printBackground: true, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: PDF_FOOTER, margin: { top: "14mm", bottom: "16mm", left: "10mm", right: "10mm" } });
  } finally {
    await browser.close();
  }
}
