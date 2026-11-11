// The Çini · Mercan kit in cini/ and its inlined copy in src/cini.js: the report and plan.html carry the kit's sheets and
// fonts unchanged, so a page needs nothing next to it, and the retired brand colours and fonts stay out of what ships.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { render, SHEETS, stripComments } from "../scripts/cini.js";
import { KIT_CSS, KIT_COLORS, KIT_VERSION } from "../src/cini.js";
import { CSS } from "../src/html/css.js";
import { renderPlanHtml } from "../src/plan-html.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const kit = path.join(root, "cini");

test("the committed src/cini.js is the script's output for cini/, so the report never drifts from the kit", () => {
  assert.equal(readFileSync(path.join(root, "src", "cini.js"), "utf8"), render(kit), "src/cini.js differs: run node scripts/cini.js");
  assert.equal(KIT_VERSION, readFileSync(path.join(kit, "VERSION"), "utf8").trim());
});

test("the kit's sheets are inlined in order, their rules unchanged and their comments (which name the maker) left out, with its two fonts as data URIs and nothing else to fetch", () => {
  const tokens = stripComments(readFileSync(path.join(kit, "tokens.css"), "utf8"));
  const cini = stripComments(readFileSync(path.join(kit, "cini.css"), "utf8"));
  assert.deepEqual(SHEETS, ["tokens.css", "fonts.css", "cini.css"]);
  assert.ok(KIT_CSS.startsWith(tokens));
  assert.ok(KIT_CSS.endsWith(cini));
  assert.doesNotMatch(KIT_CSS, /\/\*|analitik/i);
  const fonts = [...KIT_CSS.matchAll(/url\("data:font\/woff2;base64,([^"]+)"\)/g)].map((x) => x[1]);
  assert.deepEqual(fonts, ["gabarito.woff2", "azeret-mono.woff2"].map((f) => readFileSync(path.join(kit, "fonts", f)).toString("base64")));
  // Every url() is a data URI: the two fonts and the missing-data hatch.
  assert.deepEqual([...KIT_CSS.matchAll(/url\(("?)([a-z]+):/g)].map((x) => x[2]), ["data", "data", "data"]);
  assert.equal(KIT_COLORS.light.accent, JSON.parse(readFileSync(path.join(kit, "tokens.json"), "utf8")).light["--color-accent"]);
});

test("the report's own stylesheet names no colour: every colour is a kit role", () => {
  assert.doesNotMatch(CSS, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(CSS, /\brgba?\(|\bhsla?\(/i);
});

test("nothing that ships names a retired colour or font", () => {
  // Tally blue, Pen and plate (signal blue, ochre), Overt blue, the old aitd orange, Tally's navy page and Google Sans.
  const retired = /1161bb|1259b1|2335c8|e2b04a|2f5cf6|d9531e|f4f6fa|071529|google sans/i;
  const files = [...readdirSync(path.join(root, "src")).map((f) => `src/${f}`), ...readdirSync(path.join(root, "src", "html")).map((f) => `src/html/${f}`)].filter((f) => f.endsWith(".js"));
  for (const f of files) assert.doesNotMatch(readFileSync(path.join(root, f), "utf8"), retired, f);
  assert.doesNotMatch(renderPlanHtml({ site: "example.com", events: [] }), retired);
});

test("plan.html carries the kit, its favicons and the Pano band above the footer", () => {
  const html = renderPlanHtml({ site: "example.com", events: [] });
  assert.ok(html.includes(KIT_CSS));
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" media="\(prefers-color-scheme: dark\)" href="data:image\/svg\+xml;base64,/);
  assert.match(html, /<div class="pano tool-footer__band f-band" aria-hidden="true"><svg [^>]*aria-hidden="true">.*<\/svg><\/div>\n<footer class="footer">/s);
  assert.doesNotMatch(renderPlanHtml({ site: "example.com", events: [] }, { branding: false }), /class="pano/);
});
