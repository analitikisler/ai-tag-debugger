#!/usr/bin/env node
// Writes src/brand.js from the brand assets, so a report stays one file that needs nothing next to it.
// Run it after brand/ai/ changes: node scripts/brand.js
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// brand/ai/BRAND.md §4: the light files draw the ink and the point in these two colours, and nothing else.
const INK = "#17140F";
const POINT = "#C12D30";

/**
 * Logos the report draws inline from its sprite: BRAND.md §4 has a logo on a product's own UI take the page's text colour,
 * with only the point red, which an <img> cannot do. The light file gives the shapes; its dark twin must draw the same ones.
 * Sizes follow BRAND.md: the lockup is 22 px in the top bar and 16 px in the white-label "by", which keeps its x-height (57%
 * of its height) above the 9 px minimum (§6); the mark alone is 24 px on phones, its minimum (§5); the master logo is
 * "by analitik işler" and the footer, never the name in type (§6, §8).
 */
export const ART = {
  "atd-lockup": "lockups/ai-tag-debugger",
  "mark": "mark/ai-mark",
  "master": "master/analitik-isler",
};

/**
 * Images embedded as data URIs. The favicon tiles carry their own ground, so they come as a light and a dark file: the tab
 * uses the light one, and the credit line, which is under the mark's 24 px minimum, shows the pair (§5, §7).
 */
export const IMAGES = {
  "favicon-light": "icons/favicon-ai-16.svg",
  "favicon-dark": "icons/favicon-ai-16-ink.svg",
};

function read(assets, file, key) {
  try {
    return readFileSync(path.join(assets, file), "utf8");
  } catch {
    throw new Error(`No ${path.join(assets, file)} for "${key}". Copy design/13-ai-brand from the analitikisler repo to brand/ai/ (see brand/README.md), or change scripts/brand.js if the asset was renamed.`);
  }
}

const shapes = (svg) => [...svg.matchAll(/<path\b([^>]*?)\/?>/g)].map((m) => ({ fill: m[1].match(/\bfill="([^"]+)"/)?.[1], d: m[1].match(/\bd="([^"]+)"/)?.[1], attrs: m[1] }));

/** The sprite symbol of a logo: its viewBox and its paths, the ink in currentColor and the point in --brand-point. */
export function symbolOf(light, dark, name) {
  const viewBox = light.match(/<svg\b[^>]*\bviewBox="([^"]+)"/)?.[1];
  if (!viewBox) throw new Error(`${name}: no viewBox.`);
  const own = shapes(light), twin = shapes(dark);
  if (!own.length) throw new Error(`${name}: no paths.`);
  if (own.length !== twin.length || own.some((s, i) => s.d !== twin[i].d)) throw new Error(`${name}: the dark file draws other shapes than the light one, so one symbol cannot stand for both.`);
  const art = own.map(({ fill, d, attrs }) => {
    if (/\b(?!fill=|d=)[a-z-]+=/i.test(attrs.replace(/\b(fill|d)="[^"]*"/g, ""))) throw new Error(`${name}: a path carries more than fill and d (${attrs.slice(0, 80)}).`);
    if (fill === INK) return `<path fill="currentColor" d="${d}"/>`;
    if (fill === POINT) return `<path style="fill:var(--brand-point)" d="${d}"/>`;
    throw new Error(`${name}: fill ${fill} is neither the ink ${INK} nor the point ${POINT} (BRAND.md §4).`);
  }).join("");
  return { viewBox, art };
}

/** The text of src/brand.js for an assets folder. Exported so the test can run it on a folder of its own. */
export function render(assets) {
  const art = Object.fromEntries(Object.entries(ART).map(([key, base]) => [key, symbolOf(read(assets, `${base}-light.svg`, key), read(assets, `${base}-dark.svg`, key), key)]));
  const images = Object.fromEntries(Object.entries(IMAGES).map(([key, file]) => [key, `data:image/svg+xml;base64,${Buffer.from(read(assets, file, key)).toString("base64")}`]));
  const from = [
    ...Object.entries(ART).map(([key, base]) => `//   ${key.padEnd(14)} brand/ai/assets/${base}-light.svg (and -dark.svg, checked to match)`),
    ...Object.entries(IMAGES).map(([key, file]) => `//   ${key.padEnd(14)} brand/ai/assets/${file}`),
  ].join("\n");
  const entries = (obj) => Object.entries(obj).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n");
  return `// The brand's logos for the HTML report, so a report is one file and needs nothing next to it.
// Written by node scripts/brand.js from brand/ai/assets/ (the brand guide is brand/ai/BRAND.md); edit the assets, not this file.
${from}

/** Sprite symbols: the ink is currentColor and the point is var(--brand-point), so a logo follows the page's colours. */
export const LOGO_ART = {
${entries(art)}
};

/** Images as data URIs (the report CSP allows img-src data:). */
export const LOGOS = {
${entries(images)}
};
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(fileURLToPath(import.meta.url), "../..");
  const out = path.join(root, "src", "brand.js");
  const text = render(path.join(root, "brand", "ai", "assets"));
  writeFileSync(out, text);
  console.log(`Wrote src/brand.js (${Math.round(text.length / 1024)} KB) from:\n${text.split("\n").filter((l) => l.startsWith("//   ")).join("\n")}`);
}
