// The HTML report: verdict block, priorities, finding cards, the icon sprite, theming, the CSP hash and the structure a
// browser sees. The demo capture gives the realistic content; a small run covers the edge cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { CSS, logo, renderHtml, SCRIPT, scriptCspSource } from "../src/report.js";
import { computeMetrics } from "../src/metrics.js";
import { runSummary, trend } from "../src/history.js";
import { brandCss } from "../src/whitelabel.js";

const capture = JSON.parse(readFileSync(new URL("./fixtures/demo-capture.json", import.meta.url), "utf8"));
const demo = { title: "ai tag debugger report: localhost", site: "localhost", generatedAt: "2026-10-19 06:39 UTC", findings: capture.findings, explained: null, runs: capture.runs, plan: capture.config.plan, lang: "en", consentScenarios: capture.consentScenarios };
const render = (props = {}) => renderHtml({ ...demo, ...props });

test("the verdict block states the verdict and a headline without a model, and the AI headline stays secondary", () => {
  const html = render();
  // The inspector design moved the verdict into the Summary section's scorecard; the page's one h1 names the site.
  const verdict = html.slice(html.indexOf('id="summary"'), html.indexOf('id="findings"'));
  assert.match(html, /<h1 class="sr">Tracking audit of localhost<\/h1>/);
  // The status word and the first sentence are the CLI's and the Markdown title's (verdictHeadline), now as the
  // scorecard's verdict word and its headline line.
  assert.match(verdict, /<p class="sc-verdict sev-broken"><svg[^>]*><use href="#sev-broken"\/><\/svg>Fail<\/p>\n<p class="sc-head">Purchase tracking is broken on mobile\.<\/p>/);
  // The count-and-owner sentence became the status chips (counts) and the Findings owner filter (owner split): the
  // design keeps the verdict to one sentence (SPEC 2.1).
  assert.match(verdict, /<b>2<\/b> Broken<\/a>/);
  assert.match(verdict, /<b>1<\/b> Risk<\/a>/);
  const findings = html.slice(html.indexOf('id="findings"'), html.indexOf('id="journeys"'));
  assert.match(findings, /data-filter="owner=developer"[^>]*><span class="dot"><\/span>Developer<span class="n">2<\/span>/);
  assert.match(findings, /data-filter="owner=gtm"[^>]*><span class="dot"><\/span>Tag Manager<span class="n">2<\/span>/);
  // Five status chips with a shape glyph each, linking into Findings filtered by severity; a zero count is not a link.
  for (const s of ["broken", "risk", "warning", "info", "ok"]) assert.match(verdict, new RegExp(`(?:<a class="chip chip-sev ${s} lg" href="#findings\\?sev=${s}">|<span class="chip chip-sev ${s} lg zero" aria-disabled="true">)<svg class="ic"[^>]*><use href="#sev-${s}"/></svg>`));
  assert.match(verdict, /<span class="chip chip-sev info lg zero" aria-disabled="true">/);
  // The Vendors card names the platforms checked with their icons (a chip per platform since the inspector design).
  assert.match(verdict, /<a class="lbl" href="#inventory">Platforms checked<svg[^>]*>.*?<\/a><span class="val"><span class="chips"><span class="chip chip-plat ga4"[^>]*><svg class="ic" width="13" height="13" aria-hidden="true"><use href="#p-ga4"\/><\/svg>GA4/);
  assert.doesNotMatch(verdict, /AI summary/);
  const withAi = render({ explained: { summary: { headline: "Mobile purchases send no revenue.", points: [{ severity: "broken", text: "Revenue is **0**." }], also_check: [] }, explanations: [] } });
  const aiVerdict = withAi.slice(withAi.indexOf('id="summary"'), withAi.indexOf('id="findings"'));
  assert.match(aiVerdict, /Fail<\/p>\n<p class="sc-head">Purchase tracking is broken on mobile\.<\/p>/);
  assert.match(aiVerdict, /<p class="sc-ai muted"[^>]*><span class="ai-l">AI summary<\/span> Mobile purchases send no revenue\.<\/p>/);
  // The AI headline comes after the product's own verdict.
  assert.ok(aiVerdict.indexOf("sc-head") < aiVerdict.indexOf("sc-ai"));
  // The Summary keeps the AI's headline only; its points sit in the Findings section's AI summary card.
  assert.match(withAi, /Revenue is <strong>0<\/strong>\./);
  // The same verdict in Turkish, and a passing run reads as a result.
  assert.match(render({ lang: "tr" }), /Kaldı<\/p>\n<p class="sc-head">Purchase izlemesi bozuk \(mobile\)\.<\/p>/);
  const pass = render({ findings: capture.findings.filter((f) => f.severity === "ok"), consentScenarios: null });
  assert.match(pass, /Pass<\/p>\n<p class="sc-head">All 11 planned events fired correctly on 4 journeys\.<\/p>/);
  assert.match(pass, /What was checked/);
  // Metrics given by the caller are used as they are.
  const metrics = computeMetrics({ plan: demo.plan, runs: demo.runs, findings: demo.findings, consentScenarios: demo.consentScenarios });
  assert.equal(render({ metrics }), html);
});

test("priorities link to the finding cards, whose ids are stable and unique", () => {
  const html = render();
  // Finding rows are collapsed <details> cards since the inspector design.
  const ids = [...html.matchAll(/<details class="card sev-[a-z]+" id="([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(ids, ["f-ga4-purchase-missing_params", "f-meta-purchase-missing_params", "f-meta-pageview-before_consent", "f-ga4-add_to_cart-duplicate"]);
  const summary = html.slice(html.indexOf('id="summary"'), html.indexOf('id="findings"'));
  // The priorities list became the score's cost lines: one line per fix (GA4 and Meta purchase are one fix, −60),
  // each linking the card with the largest deduction, so every card is reached from the Summary or its group.
  const costs = summary.slice(summary.indexOf('<ul class="sc-costs">'), summary.indexOf("</ul>", summary.indexOf('<ul class="sc-costs">')));
  assert.deepEqual([...costs.matchAll(/<a href="#([^"]+)">/g)].map((x) => x[1]), ["f-ga4-purchase-missing_params", "f-meta-pageview-before_consent", "f-ga4-add_to_cart-duplicate"]);
  assert.match(costs, /<li class="sev-broken"><a href="#f-ga4-purchase-missing_params"><span class="pts">−60<\/span>.*?<use href="#p-ga4"\/>.*?<use href="#p-meta"\/>/);
  // Marketing has nothing to do in this run: the owner filter offers no Marketing chip.
  assert.doesNotMatch(html.slice(html.indexOf('id="findings"'), html.indexOf('id="journeys"')), /owner=marketing/);
  // The score card shows the score out of 100.
  assert.match(summary, /<span class="sc-num">25<\/span><span class="sc-of">\/100<\/span>/);
  // The Journeys card counts the grouped cards that point at each run (in the matrix cell's screen-reader text).
  assert.match(summary, /<a href="#j3">.*?<span class="sr">checkout · mobile: completed · 11 steps · 20 hits · 4 problems<\/span><\/a>/);
});

test("a finding card carries severity, owner, where with page, evidence with missing rows, fix and verify links", () => {
  const html = render();
  const card = html.slice(html.indexOf('id="f-ga4-purchase-missing_params"'), html.indexOf('id="f-meta-pageview-before_consent"'));
  // The title is the card's summary line now, not an h4.
  assert.match(card, /<span class="f-t"><code>purchase<\/code> was sent without <code>currency<\/code>, <code>value<\/code>\.<\/span>/);
  // Owner and place are chips on the summary line; "checkout · mobile only" is the one run chip.
  assert.match(card, /<span class="c-owner"><span class="chip chip-owner developer"><span class="dot"><\/span>Developer<\/span><\/span>/);
  assert.match(card, /<span class="c-where"><span class="chip chip-vp mobile"><svg[^>]*><use href="#ui-mobile"\/><\/svg>checkout · mobile<\/span><\/span>/);
  assert.match(card, /<span class="badge sev-broken"><svg[^>]*><use href="#sev-broken"\/><\/svg>Broken<\/span>/);
  // Where links the hit that carried the event (…-h0), not only its step.
  assert.match(card, /<a class="chip chip-vp mobile" href="#j3-s11-h0"><svg[^>]*><use href="#ui-mobile"\/><\/svg>checkout · mobile<\/a><span class="fnd-step"><span class="muted">step 11 ·<\/span> Place the order <span class="muted">· <code>\/thanks\.html<\/code><\/span><\/span>/);
  // "Also fine on" is a chip that links the run where the event was fine.
  assert.match(card, /<a class="chip chip-sev ok" href="#j2"><svg[^>]*><use href="#sev-ok"\/><\/svg>Fine on checkout · desktop/);
  // Evidence: the captured parameters, then the plan's required ones that are missing, marked as such.
  assert.match(card, /<th scope="row">transaction_id<\/th><td>T1792391968794<\/td>/);
  assert.match(card, /<th scope="row">currency<\/th><td><span class="chip chip-sev broken">missing<\/span><\/td><\/tr><tr><th scope="row">value<\/th><td><span class="chip chip-sev broken">missing<\/span><\/td>/);
  assert.match(card, /No model explanation in this run\./);
  assert.doesNotMatch(card, /--no-ai/);
  assert.match(card, /<a href="https:\/\/tagassistant\.google\.com\/" target="_blank" rel="noopener noreferrer">Tag Assistant<svg[^>]*><use href="#ui-external"\/><\/svg><span class="sr"> \(opens in a new tab\)<\/span><\/a>/);
  // A finding without captured evidence shows the hit it points at (times read "+0.2 s", as in Markdown and CSV).
  const meta = html.slice(html.indexOf('id="f-meta-pageview-before_consent"'), html.indexOf('id="f-ga4-add_to_cart-duplicate"'));
  assert.match(meta, /<th scope="row">Request<\/th><td><span class="mono">www\.facebook\.com\/tr\/<\/span> · \+0\.\d s<\/td>/);
  // "all 4 runs" is the place chip, naming the runs in its title.
  assert.match(meta, /<span class="chip plain" title="[^"]+">all 4 runs<\/span>/);
  // AI explanations fill impact, cause and fix; the consequence and fix texts from i18n are used when a language has them.
  const ai = render({ explained: { summary: null, explanations: [{ finding: 0, impact: "No revenue for `purchase`.", likely_cause: "The push lacks it.", fix_steps: ["Add `value`.", "Re-test."] }] } });
  // The impact strip leads the Evidence tab, with the impact icon in place of the "Impact" label.
  assert.match(ai, /<p class="fnd-impact"><svg[^>]*><use href="#ui-impact"\/><\/svg><span>No revenue for <code>purchase<\/code>\.<\/span><\/p>/);
  assert.match(ai, /<ol class="fix-steps"><li><span>Add <code>value<\/code>\.<\/span><\/li><li><span>Re-test\.<\/span><\/li><\/ol>/);
  // Every card starts collapsed (the design opens a card on a click or a deep link, none by default).
  const cards = [...html.matchAll(/<details class="card sev-[a-z]+" id="f-[^"]+"([^>]*)>/g)].map((x) => x[1].replace(/"[^"]*"/g, '""'));
  assert.equal(cards.length, 4);
  assert.deepEqual(cards.filter((attrs) => /\sopen(\s|$)/.test(attrs)), []);
});

test("an accepted finding is labelled, and a page the step does not know reads as unknown", () => {
  const f = { journey: "checkout", viewport: "desktop", severity: "broken", check: "missing_params", platform: "ga4", event: "add_to_cart", step: "Add to cart", detail: '"add_to_cart" was sent without "value".' };
  const run = { journeyId: "checkout", viewport: "desktop", startedAt: 0, completed: true, steps: [{ index: 0, label: "start", t: 0 }, { index: 1, label: "Add to cart", t: 1000 }], hits: [{ platform: "ga4", name: "add_to_cart", params: {}, url: "https://x/g/collect", step: 1, t: 1100 }], dataLayerLog: [] };
  const plain = renderHtml({ title: "t", generatedAt: "now", findings: [f], explained: null, runs: [run] });
  assert.doesNotMatch(plain, /Accepted/);
  assert.match(plain, /· page: unknown<\/span>/);
  const accepted = renderHtml({ title: "t", generatedAt: "now", findings: [{ ...f, accepted: true }], explained: null, runs: [run] });
  assert.match(accepted, /<span class="badge">Accepted<\/span><\/span>/);
  assert.match(accepted, /<p class="note xs"><span class="badge"><svg[^>]*><use href="#sev-ok"\/><\/svg>Accepted<\/span> This finding is in the baseline/);
  // Accepted in one place and not in another: the card is not accepted.
  const mixed = renderHtml({ title: "t", generatedAt: "now", findings: [{ ...f, accepted: true }, { ...f, viewport: "mobile" }], explained: null, runs: [run, { ...run, viewport: "mobile" }] });
  assert.doesNotMatch(mixed, /Accepted/);
});

test("platform icons are one inline sprite with <use>, with a letter fallback for unknown platforms, and the CSS has no data URIs", () => {
  const html = render();
  assert.equal((html.match(/<svg hidden style="display:none" aria-hidden="true"/g) ?? []).length, 1);
  const sprite = html.slice(html.indexOf("<svg hidden"), html.indexOf("</svg>", html.indexOf("<svg hidden")));
  for (const id of ["sev-broken", "sev-risk", "sev-warning", "sev-info", "sev-ok", "ui-chevron", "p-ga4", "p-meta", "p-google_ads", "p-tiktok"]) assert.match(sprite, new RegExp(`<symbol id="${id}"`));
  assert.doesNotMatch(sprite, /p-pinterest/, "only the platforms the page shows");
  assert.doesNotMatch(CSS, /data:image/);
  assert.doesNotMatch(CSS, /Google Sans/);
  assert.doesNotMatch(html, /url\("data:image\/svg/);
  const klaviyo = renderHtml({ title: "t", generatedAt: "now", findings: [], explained: null, runs: [{ journeyId: "j", viewport: "desktop", startedAt: 0, completed: true, steps: [{ index: 0, label: "start", t: 0 }, { index: 1, label: "Open", t: 1 }], hits: [{ platform: "klaviyo", name: "Viewed Product", params: {}, url: "https://a.klaviyo.com/x", step: 1, t: 2 }], dataLayerLog: [] }] });
  // Journeys draws a hit's platform at 14 px (the hit row's icon size), so the initials square is s14.
  assert.match(klaviyo, /<span class="plat-fb s14" aria-hidden="true">K<\/span><span>Klaviyo<\/span>/);
});

test("the theme has both dark selectors, logos follow the text colour, and brandCss follows the same selectors", () => {
  assert.match(CSS, /@media \(prefers-color-scheme:dark\)\{:root:not\(\[data-theme="light"\]\)\{/);
  assert.match(CSS, /:root\[data-theme="dark"\]\{/);
  assert.match(CSS, /--sev-risk:#9B3B9A/);
  // A brand logo is drawn from the sprite so its ink takes the text colour (BRAND.md §4); its width keeps the viewBox's proportions.
  assert.match(logo("atd-lockup", "ai tag debugger", 26, "logo-atd"), /^<svg class="logo logo-atd" width="189\.9" height="26" role="img" aria-label="ai tag debugger"><use href="#logo-atd-lockup"\/><\/svg>$/);
  assert.match(logo("mark", "", 24, "l-mark"), /^<svg class="logo l-mark" width="23\.9" height="24" aria-hidden="true"><use href="#logo-mark"\/><\/svg>$/);
  // An image logo, the favicon tile, still comes as its light and dark files.
  assert.match(logo("favicon", "", 16, "f-mark"), /^<span class="logo f-mark"><img class="l-light" src="data:[^"]+" alt="" height="16"><img class="l-dark" src="data:[^"]+" alt="" height="16"><\/span>$/);
  assert.match(CSS, /--brand-point:#C12D30;/);
  assert.match(CSS, /svg\.logo\{display:inline-block;flex:none;color:var\(--fg\)\}/);
  const css = brandCss("#0a7d5a");
  assert.match(css, /^:root\{--accent:#0a7d5a;--accent-fg:#[0-9a-f]{6};--accent-bg:#[0-9a-f]{6}\}@media \(prefers-color-scheme:dark\)\{:root:not\(\[data-theme="light"\]\)\{--accent:/);
  assert.match(css, /\}:root\[data-theme="dark"\]\{--accent:/);
  // A pale brand colour gets a link colour that still reads on the card.
  assert.match(brandCss("#ffe066"), /--accent-fg:#(?!ccb352)[0-9a-f]{6}/);
  const html = render({ brand: { name: "Acme", logo: null, color: "#ffe066", pdf: false } });
  assert.match(html, /<span class="brand-name">Acme<\/span>/);
  assert.match(html, /:root\[data-theme="dark"\]\{--accent:/);
});

test("the inline script is allowed by its hash in the page CSP and the MCP server's header, and nothing else runs", async () => {
  const html = render();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0], SCRIPT);
  const hash = `'sha256-${createHash("sha256").update(scripts[0]).digest("base64")}'`;
  assert.equal(scriptCspSource(), hash);
  assert.match(html, new RegExp(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src ${hash.replace(/[+/]/g, "\\$&")}">`));
  const mcp = readFileSync(new URL("../src/mcp.js", import.meta.url), "utf8");
  assert.match(mcp, /"Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src \$\{scriptCspSource\(\)\}`/);
  assert.doesNotMatch(html, / on[a-z]+="/);
  assert.doesNotMatch(html, /(src|srcset|href)="(?!data:|#|https:\/\/(analitikisler\.com|github\.com\/analitikisler\/ai-tag-debugger|tagassistant\.google\.com|support\.google\.com|www\.facebook\.com|chromewebstore\.google\.com|developers\.google\.com))/);
});

test("print rules stack the tabs and open the cards; tips take no focus; every table is named", () => {
  const html = render();
  // The rail and top bar replaced the tab bar: on paper they are hidden, every section shows and starts a page.
  assert.match(CSS, /@media print\{[\s\S]*\.top,\.rail,\.skip,\.sec-tools[^{]*\{display:none!important\}/);
  assert.match(CSS, /@media print\{[\s\S]*main>\.sec\[hidden\][^{]*\{display:block!important\}/);
  assert.match(CSS, /main>\.sec\+\.sec\{break-before:page\}/);
  // Cards start collapsed, so print opens the flagged ones by CSS alone (writePdf runs without JavaScript), and
  // every tab panel prints under its label.
  assert.match(CSS, /details\.card\[data-print-open\]::details-content\{content-visibility:visible;display:block\}/);
  assert.match(CSS, /\.tabs \[role=tabpanel\],\.tabs \[role=tabpanel\]\[hidden\]\{display:block\}/);
  assert.match(CSS, /\.chip,\.badge,\.n\{background:none!important;border:1px solid currentColor\}/);
  assert.doesNotMatch(html, /tabindex="0"/);
  assert.doesNotMatch(html, /role="note"/);
  for (const t of html.match(/<table[^>]*>(?:<caption)?/g)) assert.match(t, /aria-label=|<caption/, t);
  assert.ok(html.match(/<table[^>]*><caption class="sr">/g).length >= 5);
  assert.doesNotMatch(html, /<th>/, "every th has a scope");
});

test("the Trend card appears only with a history of at least two runs; a lone changes card stays otherwise", () => {
  const history = ["2026-10-01_0900", "2026-10-02_0900", "2026-10-03_0900"].map((id, i) => runSummary(id, { runs: capture.runs.map((r) => ({ ...r, completed: i === 1 ? r.viewport === "desktop" : true })), findings: i === 0 ? capture.findings.filter((f) => f.check !== "duplicate") : capture.findings }));
  const t = trend(history);
  const changes = { previous: "2026-10-02_0900", mode: "findings", fixed: [], new: [{ platform: "ga4", event: "add_to_cart", check: "duplicate", detail: "twice" }], routes: [] };
  const html = render({ trend: t, changes });
  // The trend is a collapsed card in the Run section; its title is the summary line.
  assert.match(html, /<details class="card" id="trend"><summary><span class="t">Trend<\/span>/);
  assert.match(html, /<svg class="spark" viewBox="0 0 280 64"[^>]*role="img" aria-label="Broken: 2, 2, 2; Risk: 1, 1, 1; Warning: 0, 1, 1">/);
  assert.match(html, /<circle class="sev-broken hollow"/);
  assert.match(html, /<strong>Getting worse<\/strong> <span class="muted">over 3 runs, 2026-10-01 to 2026-10-03<\/span>/);
  assert.match(html, /<strong>1 new problem<\/strong>/);
  // "Open longest" is an h3 under the Run section's h2 now.
  assert.match(html, /Open longest<\/h3><ul class="tr-list"><li><span class="badge sev-broken">.*<a href="#f-ga4-purchase-missing_params">/);
  assert.match(html, /open since 2026-10-01 · 3 runs · 1 place/);
  assert.doesNotMatch(render({ trend: trend(history.slice(0, 1)) }), /id="trend"/);
  assert.doesNotMatch(render(), /id="trend"/);
  // The changes card is the Findings section's collapsed card.
  const lone = render({ changes });
  assert.match(lone, /<details class="card fnd-changes" id="changes">/);
  assert.equal((lone.match(/id="changes"/g) ?? []).length, 1);
  // With a history the changes card stays in Findings and the Trend card links to it instead of embedding a copy:
  // one #changes anchor, the one the route line and the trend link to.
  assert.equal((html.match(/id="changes"/g) ?? []).length, 1);
  assert.match(html.slice(html.indexOf('id="findings"'), html.indexOf('id="journeys"')), /<details class="card fnd-changes" id="changes">/);
  assert.match(html.slice(html.indexOf('id="trend"')), /<a href="#changes"><strong>1 new problem<\/strong><\/a>/);
});

test("the Journeys, Consent and Scope sections carry the consent, funnel, parity, coverage and conversion tables", () => {
  const html = render();
  // Four tabs became seven sections: Consent is its own section, and Scope split into Coverage, Inventory and Run.
  const consent = html.slice(html.indexOf('id="consent"'), html.indexOf('id="coverage"'));
  assert.match(consent, /<td class="cs-bad">.*?<span class="badge sev-risk"><svg[^>]*><use href="#sev-risk"\/><\/svg>Sent<\/span><span class="sr"> problem: should not have been sent<\/span><a href="#f-meta-pageview-before_consent">Finding →<\/a><\/span><\/td>/);
  assert.match(consent, /<b class="num">1<\/b><span title="cookieless">.*?<\/span><span class="sr"> cookieless<\/span>/);
  assert.match(consent, /Default set \d+ ms into the first page, before the first Google hit · v2 signals present\./);
  assert.ok(consent.indexOf('id="consent-mode"') < consent.indexOf("Default set"), "the timing sentence sits in the Consent Mode card");
  const journeys = html.slice(html.indexOf('id="journeys"'), html.indexOf('id="consent"'));
  // The step row became the step list item and the step pane, with the label, path and action in its header.
  assert.match(journeys, /<li class="jr-st sev-broken" data-flagged="broken"><button type="button" data-select-target="#j3-s11"/);
  assert.match(journeys, /<article class="card jr-pane sev-broken" id="j3-s11" [^>]*data-flagged="broken"[^>]*>\n<header class="jr-ph"><h3 id="j3-s11-t"><span class="jr-n">11<\/span><span>Place the order<\/span><\/h3><span class="jr-ph-e"><span class="badge sev-broken">/);
  assert.match(journeys, /<p class="jr-ph-m"><span>\/thanks\.html<\/span><span>click<\/span>/);
  // Cards start collapsed: the flagged step is the selected pane, and its flagged hit prints open.
  assert.match(journeys, /id="j3-s11" [^>]*data-selected/);
  assert.match(journeys, /<details class="card jr-hit sev-broken" id="j3-s11-h0" data-flagged="broken" data-print-open>/);
  assert.match(journeys, /<span class="jr-plan-h">Expected vs observed<\/span><span class="jr-plan-t">.*?11 of 11 expected events fired, 9 with every required parameter\./);
  assert.match(journeys, /<a class="chip chip-sev broken" href="#j3-s11-h0" title="without currency, value">.*?<code>purchase<\/code><span class="sr"> without currency, value<\/span><\/a>/);
  const step4 = journeys.slice(journeys.indexOf('id="j3-s4"'), journeys.indexOf("</article>", journeys.indexOf('id="j3-s4"')));
  assert.match(step4, /<span class="jr-par-h">Platform parity<\/span>/);
  assert.match(step4, /<b>count differs<\/b>/);
  const coverage = html.slice(html.indexOf('id="coverage"'), html.indexOf('id="inventory"'));
  // "Coverage 9 of 11 (82%)" is the plan card's summary: a count chip and the percentage.
  assert.match(coverage, /<summary><span class="t">Measurement plan coverage<\/span><span class="chip chip-sev warning"><b>9<\/b> of 11<\/span><span class="chip plain mono"><b>82%<\/b><\/span>/);
  // The purchase row: the parameters it needs as code (missing ones marked), then –, ✓ and params cells with sr text.
  assert.match(coverage, /<code>purchase<\/code><\/span><\/th><td class="cv-needs"><code>transaction_id<\/code><code class="cv-miss">currency<\/code><code class="cv-miss">value<\/code><code>items<\/code><\/td><td class="cv-c muted">–<span class="sr"> not expected<\/span><\/td><td class="cv-c muted">.*<td class="cv-c"><span class="chip chip-sev ok cv-g"><svg[^>]*><use href="#sev-ok"\/><\/svg><span class="sr"> sent<\/span><\/span><\/td><td class="cv-c"><span class="chip chip-sev broken"><svg[^>]*><use href="#sev-broken"\/><\/svg>params<span class="sr"> without currency, value<\/span><\/span><\/td>/);
  assert.match(coverage, /<summary><span class="t">Conversion integrity<\/span>/);
  assert.match(coverage, /2 of 4 purchases pass every check\./);
  const inventory = html.slice(html.indexOf('id="inventory"'), html.indexOf('id="run"'));
  assert.match(inventory, /<span class="badge sev-info"><svg[^>]*><use href="#sev-info"\/><\/svg>Checked, not seen<\/span>/);
  assert.match(html.slice(html.indexOf('id="run"')), /<dt>Version<\/dt><dd><code>/);
});

test("in a browser the report has one h1, no heading skips, named tables, selected tabs and no horizontal scroll at 390px", async (t) => {
  let browser;
  try { browser = await chromium.launch(); } catch { return t.skip("Chromium is not installed"); }
  const dir = mkdtempSync(path.join(tmpdir(), "aitd-report-"));
  try {
    const file = path.join(dir, "report.html");
    writeFileSync(file, render());
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`file://${file}`);
    const visible = () => page.evaluate(() => [...document.querySelectorAll("main > .sec")].filter((s) => getComputedStyle(s).display !== "none").map((s) => s.id));
    // A hash change routes on the hashchange event, which can fire after goto() or a key press returns.
    const shown = (id) => page.waitForFunction((x) => !document.getElementById(x).hidden, id, { timeout: 5000 });
    const structure = await page.evaluate(() => {
      const hs = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => +h.tagName[1]);
      let prev = 0;
      const skips = hs.filter((l) => { const skip = l > prev + 1; prev = l; return skip; }).length;
      return {
        h1: hs.filter((l) => l === 1).length, skips,
        unnamedTables: [...document.querySelectorAll("table")].filter((x) => !(x.caption || x.hasAttribute("aria-label"))).length,
        current: [...document.querySelectorAll(".rail a[aria-current]")].map((a) => a.getAttribute("href")),
        skip: document.querySelector("a.skip").getAttribute("href"),
      };
    });
    assert.equal(structure.h1, 1);
    assert.equal(structure.skips, 0);
    assert.equal(structure.unnamedTables, 0);
    // The four top tabs became the rail's seven sections: one shows at a time, the Summary first, marked in the rail.
    assert.deepEqual(await visible(), ["summary"]);
    assert.deepEqual(structure.current, ["#summary"]);
    assert.equal(structure.skip, "#main");
    // A deep link opens its section, journey and step pane; another run's step switches the journey.
    await page.goto(`file://${file}#j3-s11`);
    await shown("journeys");
    assert.deepEqual(await visible(), ["journeys"]);
    assert.ok(await page.evaluate(() => {
      const run = document.querySelector("#j3"), pane = document.querySelector("#j3-s11");
      return !run.hidden && run.offsetParent !== null && !pane.hidden && pane.offsetParent !== null && document.querySelector('[data-select-target="#j3-s11"]').getAttribute("aria-current") === "true";
    }));
    await page.goto(`file://${file}#j2-s4`);
    await shown("j2");
    assert.ok(await page.evaluate(() => !document.querySelector("#j2").hidden && document.querySelector("#j3").hidden && document.querySelector("#j2-s4").offsetParent !== null && document.querySelector('[data-select-target="#j2-s4"]').getAttribute("aria-current") === "true"));
    // Arrow keys move between the tabs of a [data-tabs] box; the digits 1–7 move between the rail's sections.
    await page.goto(`file://${file}#j3-s11`);
    await shown("j3");
    await page.focus('#j3-s11 [role=tab][aria-controls="j3-s11-hits"]');
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-controls") + ":" + document.activeElement.getAttribute("aria-selected")), "j3-s11-dl:true");
    // [ folds the rail, also where [ is AltGr+8 (Turkish Q, German: Ctrl+Alt on Windows) or where the [ key types ğ;
    // a modifier that is not part of typing it, or focus in a text field, leaves the rail alone.
    const rail = () => page.evaluate(() => document.documentElement.getAttribute("data-rail"));
    const key = (init, target = "body") => page.evaluate(([i, sel]) => document.querySelector(sel).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...i })), [init, target]);
    const before = await rail();
    const flip = before === "collapsed" ? "expanded" : "collapsed";
    await key({ key: "[", code: "Digit8", ctrlKey: true, altKey: true });
    assert.equal(await rail(), flip, "AltGr+8");
    await key({ key: "ğ", code: "BracketLeft" });
    assert.equal(await rail(), before, "the [ key on Turkish Q");
    await key({ key: "[", code: "Digit5", altKey: true });
    assert.equal(await rail(), flip, "Option+5 on a Mac German layout");
    for (const init of [{ key: "[", code: "BracketLeft", metaKey: true }, { key: "[", code: "BracketLeft", ctrlKey: true }, { key: "ğ", code: "BracketLeft", altKey: true }]) {
      await key(init);
      assert.equal(await rail(), flip, JSON.stringify(init));
    }
    await key({ key: "[", code: "BracketLeft" }, "#findings [data-filter-search]");
    assert.equal(await rail(), flip, "typing [ in the search box");
    await key({ key: "[", code: "BracketLeft" });
    assert.equal(await rail(), before);
    await page.focus("#main");
    await page.keyboard.press("7");
    await shown("run");
    assert.deepEqual(await visible(), ["run"]);
    for (const hash of ["#summary", "#findings", "#journeys", "#consent", "#coverage", "#inventory", "#run"]) {
      await page.setViewportSize({ width: 390, height: 800 });
      await page.goto(`file://${file}${hash}`);
      await shown(hash.slice(1));
      const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      assert.ok(sw <= cw, `${hash} scrolls sideways at 390px: ${sw} > ${cw}`);
    }
    // Without JavaScript every section is visible with its heading.
    const noJs = await browser.newContext({ javaScriptEnabled: false });
    const plain = await noJs.newPage();
    await plain.goto(`file://${file}`);
    assert.equal(await plain.evaluate(() => [...document.querySelectorAll("main > .sec")].filter((p) => getComputedStyle(p).display !== "none" && getComputedStyle(p.querySelector("h2")).display !== "none").length), 7);
    await noJs.close();
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true });
  }
});
