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
const demo = { title: "AI Tag Debugger report: localhost", site: "localhost", generatedAt: "2026-10-19 06:39 UTC", findings: capture.findings, explained: null, runs: capture.runs, plan: capture.config.plan, lang: "en", consentScenarios: capture.consentScenarios };
const render = (props = {}) => renderHtml({ ...demo, ...props });

test("the verdict block states the verdict and a headline without a model, and the AI headline stays secondary", () => {
  const html = render();
  const verdict = html.slice(html.indexOf('<section class="verdict"'), html.indexOf('<nav class="tabbar"'));
  assert.match(verdict, /<h1 id="site">localhost<\/h1>/);
  assert.match(verdict, /<p class="verdict-line">.*<strong>Broken\.<\/strong> 2 broken findings put wrong or missing numbers in front of the reports and the ad platforms\. 2 for the developer, 2 for Tag Manager\./);
  // Five tiles with a shape glyph each, then the run facts.
  for (const s of ["broken", "risk", "warning", "info", "ok"]) assert.match(verdict, new RegExp(`<li class="count sev-${s}[^"]*"><a href="#findings"><svg class="ic"[^>]*><use href="#sev-${s}"/></svg>`));
  assert.match(verdict, /<span class="k">Broken<\/span><span class="v">2<\/span>/);
  assert.match(verdict, /<dt>Platforms checked<\/dt><dd><span class="plats"><span class="plat"><svg class="ic" width="16" height="16" aria-hidden="true"><use href="#p-ga4"\/><\/svg><span>GA4<\/span><\/span>/);
  assert.doesNotMatch(verdict, /AI summary/);
  const withAi = render({ explained: { summary: { headline: "Mobile purchases send no revenue.", points: [{ severity: "broken", text: "Revenue is **0**." }], also_check: [] }, explanations: [] } });
  assert.match(withAi, /<strong>Broken\.<\/strong> 2 broken findings/);
  assert.match(withAi, /<span class="ai-l">AI summary<\/span> Mobile purchases send no revenue\./);
  assert.match(withAi, /Revenue is <strong>0<\/strong>\./);
  // The same verdict in Turkish, and a passing run reads as a result.
  assert.match(render({ lang: "tr" }), /<strong>Bozuk\.<\/strong> 2 bozuk bulgu/);
  const pass = render({ findings: capture.findings.filter((f) => f.severity === "ok"), consentScenarios: null });
  assert.match(pass, /<strong>Pass\.<\/strong> All planned events fired correctly on 4 journeys\. 11 of 11 planned events verified\./);
  assert.match(pass, /What was checked/);
  // Metrics given by the caller are used as they are.
  const metrics = computeMetrics({ plan: demo.plan, runs: demo.runs, findings: demo.findings, consentScenarios: demo.consentScenarios });
  assert.equal(render({ metrics }), html);
});

test("priorities link to the finding cards, whose ids are stable and unique", () => {
  const html = render();
  const ids = [...html.matchAll(/<li class="finding sev-[a-z]+" id="([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(ids, ["f-ga4-purchase-missing_params", "f-meta-purchase-missing_params", "f-meta-pageview-before_consent", "f-ga4-add_to_cart-duplicate"]);
  const overview = html.slice(html.indexOf('id="overview"'), html.indexOf('id="findings"'));
  for (const id of ids) assert.match(overview, new RegExp(`<ol class="fixlist">(?:(?!</ol>).)*<a href="#${id}">`, "s"));
  assert.match(overview, /Developer<\/span><span class="n">2<\/span>.*\+60 points when fixed/);
  assert.match(overview, /Nothing for Marketing in this run\./);
  // The score card names the deductions and links them too.
  assert.match(overview, /<span class="v">25<\/span><span class="muted">\/100<\/span>/);
  assert.match(overview, /<span class="num mono">−30<\/span><span><a href="#f-ga4-purchase-missing_params">/);
  // The journeys table counts the grouped cards that point at each run.
  assert.match(overview, /<td><a href="#j3">checkout<\/a><\/td><td>mobile<\/td><td class="num">11<\/td><td class="num">20<\/td><td class="num bad">.*4<\/td>/);
});

test("a finding card carries severity, owner, where with page, evidence with missing rows, fix and verify links", () => {
  const html = render();
  const card = html.slice(html.indexOf('id="f-ga4-purchase-missing_params"'), html.indexOf('id="f-meta-pageview-before_consent"'));
  assert.match(card, /<h4 class="ftitle"><code>purchase<\/code> was sent without <code>currency<\/code>, <code>value<\/code>\.<\/h4>/);
  assert.match(card, /<span class="chip owner">Developer<\/span><span>checkout · mobile only<\/span>/);
  assert.match(card, /<span class="badge sev-broken"><svg[^>]*><use href="#sev-broken"\/><\/svg>Broken<\/span>/);
  assert.match(card, /<a href="#j3-s11" class="chip"><span class="chip-step">11<\/span><span>checkout · mobile <span class="muted">· Place the order<\/span> <span class="muted">· <code>\/thanks\.html<\/code><\/span><\/span><\/a>/);
  assert.match(card, /Also fine on <a href="#j2">checkout · desktop<\/a>\./);
  // Evidence: the captured parameters, then the plan's required ones that are missing, marked as such.
  assert.match(card, /<th scope="row">transaction_id<\/th><td>T1792391968794<\/td>/);
  assert.match(card, /<th scope="row">currency<\/th><td><span class="missing">missing<\/span><\/td><\/tr><tr><th scope="row">value<\/th><td><span class="missing">missing<\/span><\/td>/);
  assert.match(card, /No model explanation in this run\./);
  assert.doesNotMatch(card, /--no-ai/);
  assert.match(card, /<a href="https:\/\/tagassistant\.google\.com\/" target="_blank" rel="noopener noreferrer">Tag Assistant<svg[^>]*><use href="#ui-external"\/><\/svg><span class="sr"> \(opens in a new tab\)<\/span><\/a>/);
  // A finding without captured evidence shows the hit it points at.
  const meta = html.slice(html.indexOf('id="f-meta-pageview-before_consent"'), html.indexOf('id="f-ga4-add_to_cart-duplicate"'));
  assert.match(meta, /<th scope="row">Request<\/th><td><span class="mono">www\.facebook\.com\/tr\/<\/span> · \+0\.\ds<\/td>/);
  assert.match(meta, /<span>all 4 runs<\/span>/);
  // AI explanations fill impact, cause and fix; the consequence and fix texts from i18n are used when a language has them.
  const ai = render({ explained: { summary: null, explanations: [{ finding: 0, impact: "No revenue for `purchase`.", likely_cause: "The push lacks it.", fix_steps: ["Add `value`.", "Re-test."] }] } });
  assert.match(ai, /<span class="impact-l">Impact<\/span>No revenue for <code>purchase<\/code>\./);
  assert.match(ai, /<ol class="fix-steps"><li><span>Add <code>value<\/code>\.<\/span><\/li><li><span>Re-test\.<\/span><\/li><\/ol>/);
  // The first card of each owner group is open.
  assert.deepEqual([...html.matchAll(/<li class="finding [^"]+" id="([^"]+)" data-sev="[a-z]+"><details open>/g)].map((x) => x[1]), ["f-ga4-purchase-missing_params", "f-meta-pageview-before_consent"]);
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
  assert.match(klaviyo, /<span class="plat-fb s16" aria-hidden="true">K<\/span><span>Klaviyo<\/span>/);
});

test("the theme has both dark selectors, the logos come as two images, and brandCss follows the same selectors", () => {
  assert.match(CSS, /@media \(prefers-color-scheme:dark\)\{:root:not\(\[data-theme="light"\]\)\{/);
  assert.match(CSS, /:root\[data-theme="dark"\]\{/);
  assert.match(CSS, /--sev-risk:#9B3B9A/);
  assert.match(logo("atd-lockup", "AI Tag Debugger", 26, "logo-atd"), /^<span class="logo logo-atd"><img class="l-light" src="data:[^"]+" alt="AI Tag Debugger" height="26"><img class="l-dark" src="data:[^"]+" alt="AI Tag Debugger" height="26"><\/span>$/);
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
  assert.match(CSS, /@media print\{[\s\S]*\.tabbar,\.jtabs,\.btn,\.skip,\.print-skip\{display:none!important\}/);
  assert.match(CSS, /\.panel\{break-before:page;padding:0\}/);
  assert.match(CSS, /\.badge,\.chip,\.missing,\.consent\{background:none!important;border:1px solid currentColor\}/);
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
  assert.match(html, /<div class="card" id="trend"><div class="card-h"><h3>Trend<\/h3>/);
  assert.match(html, /<svg class="spark" viewBox="0 0 280 64"[^>]*role="img" aria-label="Broken: 2, 2, 2; Risk: 1, 1, 1; Warning: 0, 1, 1">/);
  assert.match(html, /<circle class="sev-broken hollow"/);
  assert.match(html, /<strong>Getting worse<\/strong> <span class="muted">over 3 runs, 2026-10-01 to 2026-10-03<\/span>/);
  assert.match(html, /<strong>1 new problem<\/strong>/);
  assert.match(html, /Open longest<\/h4><ul class="changes"><li><span class="badge sev-broken">.*<a href="#f-ga4-purchase-missing_params">/);
  assert.match(html, /open since 2026-10-01 · 3 runs · 1 place/);
  assert.doesNotMatch(render({ trend: trend(history.slice(0, 1)) }), /id="trend"/);
  assert.doesNotMatch(render(), /id="trend"/);
  assert.match(render({ changes }), /<div class="card" id="changes">/);
  // With a history the diff lives inside the Trend card and keeps the #changes anchor the route line links to.
  assert.doesNotMatch(html, /<div class="card" id="changes">/);
  assert.match(html, /<div id="changes"><p class="xs"><strong>1 new problem<\/strong>/);
});

test("the Journeys and Scope panels carry the consent, funnel, parity, coverage and conversion tables", () => {
  const html = render();
  const journeys = html.slice(html.indexOf('id="journeys"'), html.indexOf('id="scope"'));
  assert.match(journeys, /<td class="num bad"><svg[^>]*><use href="#sev-broken"\/><\/svg> 1<span class="sr"> problem:<\/span> <span class="xs">should not have been sent <a href="#f-meta-pageview-before_consent">Finding →<\/a><\/span><\/td>/);
  assert.match(journeys, /<td class="num">1 <span class="muted xs">cookieless<\/span><\/td>/);
  assert.match(journeys, /Default set \d+ ms into the first page, before the first Google hit · v2 signals present\./);
  assert.match(journeys, /<tr id="j3-s11" class="srow flagged sev-broken has-d"><th scope="row"><span class="sidx">11<\/span><\/th><td class="slabel">Place the order<span class="sr"> \(has a broken finding\)<\/span><span class="smeta xs muted"><code>\/thanks\.html<\/code> · click<\/span><\/td>/);
  assert.match(journeys, /<tr class="drow sev-broken"><td colspan="5"><details open>/);
  assert.match(journeys, /<h4>Expected vs observed<\/h4><p class="card-d">11 of 11 expected events fired, 9 with every required parameter\./);
  assert.match(journeys, /<span class="x"><svg[^>]*><use href="#sev-broken"\/><\/svg> without currency, value<\/span>/);
  assert.match(journeys, /<h4>Platform parity<\/h4>/);
  assert.match(journeys, /count differs/);
  const scope = html.slice(html.indexOf('id="scope"'));
  assert.match(scope, /<p class="card-d">Coverage 9 of 11 \(82%\)<\/p>/);
  assert.match(scope, /<code>purchase<\/code><span class="muted xs"> · needs transaction_id, currency, value, items<\/span><\/td><td class="c o">–<span class="sr"> not expected<\/span><\/td><td class="c o">.*<td class="c y">✓<span class="sr"> sent<\/span><\/td><td class="c x"><svg[^>]*><use href="#sev-broken"\/><\/svg> params<span class="sr"> without currency, value<\/span><\/td>/);
  assert.match(scope, /<h3>Conversion integrity<\/h3><p class="card-d">2 of 4 purchases pass every check\./);
  assert.match(scope, /<span class="badge sev-info"><svg[^>]*><use href="#sev-info"\/><\/svg>Checked, not seen<\/span>/);
  assert.match(scope, /<dt>Version<\/dt><dd><code>/);
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
    const structure = await page.evaluate(() => {
      const hs = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => +h.tagName[1]);
      let prev = 0;
      const skips = hs.filter((l) => { const skip = l > prev + 1; prev = l; return skip; }).length;
      return {
        h1: hs.filter((l) => l === 1).length, skips,
        unnamedTables: [...document.querySelectorAll("table")].filter((x) => !(x.caption || x.hasAttribute("aria-label"))).length,
        tabs: [...document.querySelectorAll("[role=tab]")].map((x) => x.getAttribute("aria-selected")),
        active: document.querySelector("#overview").classList.contains("active"),
        skip: document.querySelector("a.skip").getAttribute("href"),
      };
    });
    assert.equal(structure.h1, 1);
    assert.equal(structure.skips, 0);
    assert.equal(structure.unnamedTables, 0);
    assert.deepEqual(structure.tabs, ["true", "false", "false", "false", "true", "false", "false", "false"]);
    assert.ok(structure.active && structure.skip === "#main");
    // A deep link opens its panel, journey and details; arrow keys move between tabs.
    await page.goto(`file://${file}#j3-s11`);
    assert.ok(await page.evaluate(() => document.querySelector("#journeys").classList.contains("active") && document.querySelector("#j3").classList.contains("active") && document.querySelector("#j3-s11 + tr.drow details").open));
    await page.focus("#tab-journeys");
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.evaluate(() => document.activeElement.id + ":" + document.querySelector("#tab-scope").getAttribute("aria-selected")), "tab-scope:true");
    for (const hash of ["", "#findings", "#journeys", "#scope"]) {
      await page.setViewportSize({ width: 390, height: 800 });
      await page.goto(`file://${file}${hash}`);
      const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      assert.ok(sw <= cw, `${hash || "overview"} scrolls sideways at 390px: ${sw} > ${cw}`);
    }
    // Without JavaScript every panel is visible with its heading.
    const noJs = await browser.newContext({ javaScriptEnabled: false });
    const plain = await noJs.newPage();
    await plain.goto(`file://${file}`);
    assert.equal(await plain.evaluate(() => [...document.querySelectorAll(".panel")].filter((p) => getComputedStyle(p).display !== "none" && getComputedStyle(p.querySelector("h2")).display !== "none").length), 4);
    await noJs.close();
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true });
  }
});
