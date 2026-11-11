#!/usr/bin/env node
// Writes src/cini.js from cini/, the Çini · Mercan kit, so a report stays one file that needs nothing next to it: the
// kit's three stylesheets with its two fonts as data URIs, and its colour roles for what cannot read a CSS variable (the
// white label's contrast check, the PDF footer). Run it after cini/ is copied again from the kit: node scripts/cini.js
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The stylesheets, in the order the kit's README loads them. */
export const SHEETS = ["tokens.css", "fonts.css", "cini.css"];

function read(kit, file, encoding = "utf8") {
  try {
    return readFileSync(path.join(kit, file), encoding);
  } catch {
    throw new Error(`No ${path.join(kit, file)}. Copy the kit's dist/ to cini/ (see brand/README.md).`);
  }
}

/**
 * A sheet without its comments. They name Analitik İşler and analitikisler.com, which a white-labelled report must not
 * carry, and the page needs none of them; the rules are left exactly as the kit wrote them.
 */
export const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\n{2,}/g, "\n").trim();

/** fonts.css with each url("./fonts/x.woff2") replaced by the file as a data URI. */
export function inlineFonts(css, kit) {
  return css.replace(/url\("\.\/(fonts\/[\w.-]+\.woff2)"\)/g, (_, file) => `url("data:font/woff2;base64,${read(kit, file, null).toString("base64")}")`);
}

/** The text of src/cini.js for a kit folder. Exported so the test can run it on the repository's cini/. */
export function render(kit) {
  const css = SHEETS.map((file) => (file === "fonts.css" ? inlineFonts(stripComments(read(kit, file)), kit) : stripComments(read(kit, file)))).join("\n");
  if (/url\("\.\//.test(css)) throw new Error("A stylesheet in cini/ still points at a file next to it; the report cannot carry it.");
  const tokens = JSON.parse(read(kit, "tokens.json"));
  const colours = (theme) => Object.fromEntries(Object.entries(tokens[theme]).filter(([k]) => k.startsWith("--color-")).map(([k, v]) => [k.slice(8), v]));
  const version = read(kit, "VERSION").trim();
  return `// The Çini · Mercan kit for the HTML report and plan.html, so a page is one file and needs nothing next to it.
// Written by node scripts/cini.js from cini/ (${SHEETS.join(", ")}, fonts/, tokens.json); edit the kit, not this file.

/** ${version.replace(/\*\//g, "")} */
export const KIT_VERSION = ${JSON.stringify(version)};

/** tokens.css, fonts.css (Gabarito and Azeret Mono as data URIs) and cini.css, in that order, without their comments. */
export const KIT_CSS = ${JSON.stringify(css)};

/** The colour roles of tokens.json without their --color- prefix, for code that cannot read a CSS variable. */
export const KIT_COLORS = ${JSON.stringify({ light: colours("light"), dark: colours("dark") })};
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(fileURLToPath(import.meta.url), "../..");
  const text = render(path.join(root, "cini"));
  writeFileSync(path.join(root, "src", "cini.js"), text);
  console.log(`Wrote src/cini.js (${Math.round(text.length / 1024)} KB) from cini/.`);
}
