// The new HTML report's shell (src/html/shell.js): the seven sections, the CSP hash of its script, the stylesheet's
// theme and data-URI rules, the white label, the baseline line and the ids the sections share.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { renderHtmlNext, context, SECTIONS } from "../src/html/shell.js";
import { CSS, brandCss } from "../src/html/css.js";
import { SCRIPT, scriptCspSource } from "../src/html/script.js";
import { hitAnchor, pageTitle, passedRows, stepTitle, sprite } from "../src/html/lib.js";
import { LANGUAGES } from "../src/i18n.js";
import { demoCapture, failedInput, reportInput } from "./helpers/demo-capture.js";

const render = (opts) => renderHtmlNext(reportInput(opts));
const sectionIds = (html) => [...html.matchAll(/<section class="sec[^"]*" id="([^"]+)" aria-labelledby="\1-h"><h2 id="\1-h">/g)].map((x) => x[1]);

test("the page has one main, one h1 and the seven sections in rail order, each with its h2", () => {
  const html = render();
  assert.equal((html.match(/<main id="main"[^>]*>/g) ?? []).length, 1);
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
  assert.deepEqual(SECTIONS, ["summary", "findings", "journeys", "consent", "coverage", "inventory", "run"]);
  assert.deepEqual(sectionIds(html), SECTIONS);
  assert.match(html, /<a class="skip" href="#main">Skip to the report<\/a>/);
  // The rail links every section, in order, with the shared tokens: 4 failed findings, 4 of 4 journeys, 82% coverage, 2 of 4 platforms seen.
  const rail = html.slice(html.indexOf('<nav class="rail"'), html.indexOf("</nav>"));
  assert.deepEqual([...rail.matchAll(/<a href="#([a-z]+)"/g)].map((x) => x[1]), SECTIONS);
  assert.match(rail, /aria-label="Findings · 4"/);
  assert.match(rail, /<span class="r-t" data-tone="broken">4<\/span>/);
  assert.match(rail, /<span class="r-t" data-tone="completed">4\/4<\/span>/);
  assert.match(rail, /<span class="r-t" data-tone="neutral">82%<\/span>/);
  assert.match(rail, /<span class="r-t" data-tone="neutral">2\/4<\/span>/);
  assert.match(html, /<a class="top-verdict v-fail" href="#summary" aria-label="Score 25 of 100, verdict Fail">/);
  // A section's own markup cannot repeat a section's id.
  for (const id of SECTIONS) assert.equal((html.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1, id);
});

test("the one inline script is allowed by its hash, holds no words, and is the same in every language", () => {
  const html = render();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]);
  assert.deepEqual(scripts, [SCRIPT]);
  const hash = `'sha256-${createHash("sha256").update(SCRIPT).digest("base64")}'`;
  assert.equal(scriptCspSource(), hash);
  assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src ${hash}">`));
  assert.doesNotMatch(SCRIPT, /"Clear"|\{n\} of \{m\}/);
  // The words the script shows come from <main>.
  assert.match(html, /<main id="main" tabindex="-1" data-clear-label="Clear" data-filter-count="\{n\} of \{m\}">/);
  const tr = render({ lang: "tr" });
  assert.match(tr, /data-clear-label="Temizle"/);
  assert.match(tr, /<span class="r-l">Bulgular<\/span>/);
  assert.ok(tr.includes(`<script>${SCRIPT}</script>`));
  assert.doesNotMatch(html, / on[a-z]+="/);
});

test("the stylesheet has both dark selectors, no data URI, and the white label's accent follows them", () => {
  assert.match(CSS, /@media \(prefers-color-scheme:dark\)\{:root:not\(\[data-theme="light"\]\)\{/);
  assert.match(CSS, /:root\[data-theme="dark"\]\{/);
  assert.doesNotMatch(CSS, /data:/);
  assert.doesNotMatch(render(), /url\("?data:/);
  const accent = brandCss("#0a7d5a");
  assert.match(accent, /^:root\{--accent:#0a7d5a;--accent-fg:#[0-9a-f]{6};--accent-bg:#[0-9a-f]{6}\}@media \(prefers-color-scheme:dark\)\{:root:not\(\[data-theme="light"\]\)\{--accent:/);
  assert.match(accent, /\}:root\[data-theme="dark"\]\{--accent:/);
  // Every --accent token brandCss sets exists in the stylesheet it overrides.
  for (const token of ["--accent:", "--accent-fg:", "--accent-bg:"]) assert.ok(CSS.includes(token), token);
});

test("the default report carries the Analitik İşler byline and credit", () => {
  const html = render();
  assert.match(html, /<a href="https:\/\/analitikisler\.com" class="byline"/);
  assert.match(html, /This report was made with the open source <a class="f-atd" href="https:\/\/github\.com\/analitikisler\/ai-tag-debugger"/);
  assert.match(html, /<link rel="icon" type="image\/png" href="data:image\/png;base64,/);
  assert.match(html, /· v\d+\.\d+\.\d+<\/span><\/p><\/footer>/);
  assert.doesNotMatch(html, /(src|srcset|href)="(?!data:|#|https:\/\/(analitikisler\.com|github\.com\/analitikisler\/ai-tag-debugger|tagassistant\.google\.com|support\.google\.com|www\.facebook\.com|chromewebstore\.google\.com|developers\.google\.com))/);
});

test("a white-labeled report swaps the logo and drops Analitik İşler but keeps a small AI Tag Debugger credit", () => {
  const brand = { name: "Acme <Co>", logo: "data:image/png;base64,AAAA", color: "#0a7d5a", pdf: false };
  const html = render({ brand });
  assert.match(html, /<img src="data:image\/png;base64,AAAA" alt="Acme &lt;Co&gt;"/);
  assert.match(html, /--accent:#0a7d5a/);
  assert.doesNotMatch(html, /analitikisler\.com|Analitik İşler/);
  assert.match(html, /class="byline"[^>]*><span>by<\/span>.*AI Tag Debugger/s);
  assert.match(html, /Acme &lt;Co&gt; · This report was made with the open source/);
  // A name alone shows as text; a colour alone keeps the default branding.
  assert.match(render({ brand: { name: "Acme", logo: null, color: null, pdf: false } }), /<span class="brand-name">Acme<\/span>/);
  const colour = render({ brand: { name: null, logo: null, color: "#0a7d5a", pdf: false } });
  assert.match(colour, /--accent:#0a7d5a/);
  assert.match(colour, /analitikisler\.com/);
});

test("branding false leaves out the Analitik İşler parts and keeps the product's name", () => {
  const plain = render({ branding: false });
  assert.doesNotMatch(plain, /analitikisler\.com|Analitik İşler/);
  assert.match(plain, /alt="AI Tag Debugger"/);
  assert.match(plain, /<footer class="footer"><p class="xs">AI Tag Debugger <span class="muted">/);
});

test("the Summary carries the accepted line when the baseline accepted a finding, and only then", () => {
  const { findings } = demoCapture();
  const accepted = findings.map((f) => (f.check === "duplicate" ? { ...f, accepted: true } : f));
  const ctx = context(reportInput({ findings: accepted }));
  assert.equal(ctx.accepted, 1);
  assert.equal(ctx.tally.failed, 3, "an accepted problem is not counted");
  const html = renderHtmlNext(reportInput({ findings: accepted }));
  const summary = html.slice(html.indexOf('id="summary"'), html.indexOf('id="findings"'));
  assert.match(summary, /<p class="meta accepted-line">1 accepted finding from the baseline is not counted<\/p>/);
  assert.doesNotMatch(render(), /accepted-line/);
});

test("the context gives every section the same rows, ids, counts and verdict", () => {
  const ctx = context(reportInput());
  for (const key of ["m", "lang", "title", "site", "generatedAt", "ai", "findings", "explained", "rows", "ids", "runs", "plan", "metrics", "counts", "consentScenarios", "planCheck", "changes", "planChanges", "trend", "against", "brand", "branding", "accepted", "verdict", "tally"]) assert.ok(key in ctx, key);
  assert.deepEqual([...ctx.ids.values()], ["f-ga4-purchase-missing_params", "f-meta-purchase-missing_params", "f-meta-pageview-before_consent", "f-ga4-add_to_cart-duplicate"]);
  assert.deepEqual(ctx.counts, { broken: 2, risk: 1, warning: 1, info: 0, ok: 4 });
  assert.equal(ctx.verdict.headline, "purchase tracking is broken on mobile");
  // Passed rows: the campaign check, plan coverage, the Consent Mode default and the two purchases that pass.
  assert.deepEqual(passedRows(ctx).map((p) => p.kind), ["campaign_params", "coverage", "consent_default", "conversion", "conversion"]);
  assert.equal(ctx.tally.passed, 5);
  assert.equal(passedRows(ctx)[0].row.where.length, 4);
  assert.equal(ctx.m, LANGUAGES.en);
  // The failed run: nothing completed, so no score; the rail reads 0/4.
  const failed = context(failedInput());
  assert.equal(failed.tally.completed, 0);
  assert.equal(failed.tally.score, null);
  const html = renderHtmlNext(failedInput());
  assert.deepEqual(sectionIds(html), SECTIONS);
  assert.match(html, /aria-label="No score, verdict Fail"><span class="sc-l">Score<\/span><b>–<\/b>/);
});

test("ids: a finding's place links to the hit that carried its event, and steps are named by page title", () => {
  const { runs } = reportInput();
  const ctx = context(reportInput());
  const purchase = ctx.rows.find((f) => ctx.ids.get(f) === "f-ga4-purchase-missing_params");
  assert.deepEqual(purchase.where.map((w) => hitAnchor(runs, purchase, w).id), ["j3-s11-h0"]);
  const consentRow = ctx.rows.find((f) => ctx.ids.get(f) === "f-meta-pageview-before_consent");
  assert.ok(consentRow.where.every((w) => /^j\d-s\d+(-h\d+)?$/.test(hitAnchor(runs, consentRow, w).id)));
  const run = runs[3];
  assert.equal(stepTitle(run, run.steps[1]), "Open Home");
  assert.equal(stepTitle(run, run.steps[11]), "Place the order");
  assert.equal(pageTitle(run, 11), pageTitle(run, 11).replace(/ · .*$/, ""));
  // The sprite keeps only what the page uses, with the new icons available.
  assert.match(sprite('<use href="#ui-desktop"/>'), /<symbol id="ui-desktop"/);
  assert.doesNotMatch(sprite('<use href="#ui-desktop"/>'), /ui-mobile/);
});

test("a report with no runs and no findings renders every section, as the PDF, GTM and changes tests need", () => {
  const html = renderHtmlNext({ title: "T", site: "example.com", generatedAt: "now", findings: [], explained: null, runs: [], lang: "en" });
  assert.deepEqual(sectionIds(html), SECTIONS);
  assert.match(html, /<h1 class="sr">Tracking audit of example\.com<\/h1>/);
});
