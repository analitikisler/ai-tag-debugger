// The Summary section of the new HTML report (src/html/summary.js): the scorecard (score ring, verdict, headline, cost
// lines), the five status chips and the six "about this run" cards, for the demo run, the run whose site never
// opened, both languages, a model's summary, the baseline's accepted line and an empty capture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { context } from "../src/html/shell.js";
import { render } from "../src/html/summary.js";
import { VERSION } from "../src/report-shared.js";
import { failedInput, reportInput } from "./helpers/demo-capture.js";

const summary = (input) => render(context(input));
const strip = (html) => html.replace(/<svg[^>]*>.*?<\/svg>/g, "");
const costs = (html) => [...html.matchAll(/<li class="sev-([a-z]+)"><a href="#([^"]+)">(?:<span class="pts">−(\d+)<\/span>)?<span class="what">(.*?)<\/span>/g)].map((x) => ({ sev: x[1], href: x[2], points: x[3] ? Number(x[3]) : null, what: x[4] }));
const chips = (html) => Object.fromEntries([...strip(html).matchAll(/<(a|span) class="chip chip-sev ([a-z]+) lg( zero)?"(?: href="([^"]+)")?(?: aria-disabled="true")?><b>(\d+)<\/b> ([^<]+)<\/\1>/g)].map((x) => [x[2], { count: Number(x[5]), word: x[6], href: x[4] ?? null, zero: Boolean(x[3]) }]));
const cardOf = (html, href) => strip(html).match(new RegExp(`<a class="lbl" href="#${href}">([^<]+)</a><span class="val">(.*?)</span>(?:<span class="sub">(.*?)</span>)?</div>`))?.slice(1);

test("the demo's scorecard shows the score, the verdict, the shared headline and one line per deduction group", () => {
  const html = summary(reportInput());
  assert.match(html, /^<section class="sec sm" id="summary" aria-labelledby="summary-h"><h2 id="summary-h">Summary<\/h2>/);
  assert.match(html, /<div class="scorecard band-fail"><div class="sc-ring" role="img" aria-label="Score 25 of 100, verdict Fail">/);
  assert.match(html, /<circle class="arc" cx="60" cy="60" r="52" pathLength="100" style="--score:25"\/><\/svg><span class="sc-num">25<\/span><span class="sc-of">\/100<\/span>/);
  // The verdict word and the headline are verdictHeadline's, as the CLI, the alerts and the Markdown title say them.
  assert.match(html, /<p class="sc-verdict sev-broken"><svg[^>]*><use href="#sev-broken"\/><\/svg>Fail<\/p>\n<p class="sc-head">Purchase tracking is broken on mobile\.<\/p>/);
  // GA4 purchase and Meta Purchase are one fix: 30 + 30 points, one line, linking the larger (first) card.
  assert.deepEqual(costs(html), [
    { sev: "broken", href: "f-ga4-purchase-missing_params", points: 60, what: "<code>purchase</code> sent without <code>value</code>, <code>currency</code>" },
    { sev: "risk", href: "f-meta-pageview-before_consent", points: 10, what: "<code>PageView</code> sent before consent" },
    { sev: "warning", href: "f-ga4-add_to_cart-duplicate", points: 5, what: "<code>add_to_cart</code> sent 2 times per click" },
  ]);
  const lines = strip(html);
  assert.match(lines, /<span class="pl"><span class="chip chip-plat ga4">GA4<\/span><span class="chip chip-plat meta">Meta<\/span><\/span><span class="sr"> · <\/span><span class="wh"><span class="chip chip-vp mobile">checkout · mobile<\/span><\/span>/);
  assert.match(lines, /<span class="wh"><span class="chip plain">4 runs<\/span><\/span>/);
  // No priorities, no what-works list, no trend, no changes, nothing collapsible, no model line without a model.
  assert.doesNotMatch(html, /<details|fixlist|oklist|id="trend"|id="changes"|sc-ai|accepted-line/);
});

test("the status chips count what Findings lists and link to its filter; a zero is muted and leads nowhere", () => {
  const ctx = context(reportInput());
  const c = chips(render(ctx));
  assert.deepEqual(Object.keys(c), ["broken", "risk", "warning", "info", "ok"]);
  assert.deepEqual(c.broken, { count: 2, word: "Broken", href: "#findings?sev=broken", zero: false });
  assert.equal(c.risk.href, "#findings?sev=risk");
  assert.equal(c.warning.count, 1);
  assert.deepEqual(c.info, { count: 0, word: "Info", href: null, zero: true });
  assert.deepEqual(c.ok, { count: 5, word: "OK", href: "#findings?sev=ok", zero: false });
  // The same numbers as the rail and Findings: failed = broken + risk + warning, Info = Unverified, OK = Passed.
  assert.equal(c.broken.count + c.risk.count + c.warning.count, ctx.tally.failed);
  assert.equal(c.ok.count, ctx.tally.passed);
  assert.match(render(ctx), /<div class="sc-chips chips" role="group" aria-label="Findings by severity">/);
});

test("the six cards say what was tested and how, each label linking to its section", () => {
  const html = summary(reportInput());
  assert.match(html, /<div class="grid sm-about" role="group" aria-label="About this run">/);
  assert.deepEqual([...html.matchAll(/<a class="lbl" href="#([a-z]+)">([^<]+)</g)].map((x) => `${x[1]}:${x[2]}`), ["inventory:Platforms checked", "journeys:Journeys", "coverage:Events checked", "consent:Consent", "run:AI", "run:Run"]);
  const [, vendors, vendorsSub] = cardOf(html, "inventory");
  assert.equal(vendorsSub, "2 of 4 seen");
  assert.match(vendors, /<span class="chip chip-plat ga4" title="seen">GA4<span class="sr"> \(seen\)<\/span><\/span><span class="chip chip-plat google_ads sm-unseen" title="not seen">Google Ads/);
  // The journeys matrix: one row per journey, one column per viewport, each cell linking its run.
  assert.deepEqual([...html.matchAll(/<td><a href="#(j\d)">/g)].map((x) => x[1]), ["j0", "j1", "j2", "j3"]);
  assert.match(html, /<th scope="row">checkout<\/th>/);
  assert.match(html, /<span class="sr">checkout · mobile: completed · 11 steps · 20 hits · 4 problems<\/span><\/a><\/td>/);
  assert.match(html, /<span class="sub">4 of 4 completed · 30 steps · 58 hits<\/span>/);
  assert.deepEqual(cardOf(html, "coverage").slice(1), ["11 <small>planned</small> · 11 <small>seen</small>", "82% with required parameters"]);
  assert.deepEqual(cardOf(html, "consent").slice(1), ['Default <span class="chip chip-consent denied">denied</span> <small>at 27–53 ms</small>', "Banner · 3 scenarios"]);
  assert.match(strip(html), /<a class="lbl" href="#run">AI<\/a><span class="val">Scripted, no model<\/span><span class="sub">Deterministic checks only<\/span>/);
  assert.match(strip(html), new RegExp(`<a class="lbl" href="#run">Run</a><span class="val">2026-10-19 09:13 <small>UTC</small></span><span class="sub">18\\.5 s · v${VERSION.replace(/\./g, "\\.")}</span>`));
  // Every table is named and every header cell has a scope.
  assert.equal((html.match(/<table/g) ?? []).length, (html.match(/<caption class="sr">/g) ?? []).length);
  assert.doesNotMatch(html, /<th(?![^>]*scope=)[ >]/);
});

test("the Summary reads in Turkish", () => {
  const html = summary(reportInput({ lang: "tr" }));
  assert.match(html, /<h2 id="summary-h">Özet<\/h2>/);
  assert.match(html, /aria-label="Puan 100 üzerinden 25, sonuç: Kaldı"/);
  assert.match(html, /<\/svg>Kaldı<\/p>\n<p class="sc-head">Purchase izlemesi bozuk \(mobile\)\.<\/p>/);
  assert.equal(costs(html)[0].what, "<code>purchase</code> içinde <code>value</code>, <code>currency</code> yok");
  assert.equal(costs(html)[2].what, "<code>add_to_cart</code> tıklama başına 2 kez gönderildi");
  assert.deepEqual(Object.values(chips(html)).map((c) => `${c.count} ${c.word}`), ["2 Bozuk", "1 Risk", "1 Uyarı", "0 Bilgi", "5 Sorunsuz"]);
  assert.match(html, /aria-label="Bu çalıştırma hakkında"/);
  assert.match(html, /<span class="sub">Görülen: 2 \/ 4<\/span>/);
  assert.match(html, /<span class="sub">4\/4 tamamlandı · 30 adım · 58 istek<\/span>/);
  assert.match(html, /%82 gerekli parametreleriyle/);
  assert.match(html, /Varsayılan <span class="chip chip-consent denied">denied<\/span> <small>27–53 ms&#39;de<\/small>|Varsayılan <span class="chip chip-consent denied">denied<\/span> <small>27–53 ms'de<\/small>/);
  assert.match(html, /Banner · 3 senaryo/);
  assert.match(html, /Betikle, model olmadan/);
  assert.match(html, /18\.5 sn · v/);
});

test("a run whose site never opened has no score, lines without points and the unverified events as Info", () => {
  const html = summary(failedInput());
  assert.match(html, /<div class="scorecard band-fail"><div class="sc-ring" role="img" aria-label="No score, verdict Fail"><svg[^>]*><circle class="trk" cx="60" cy="60" r="52"\/><\/svg><span class="sc-num sm-none">–<\/span><\/div>/);
  assert.doesNotMatch(html, /class="arc"|sc-of|class="pts"/);
  assert.match(html, /<p class="sc-head">The browse journey did not finish, so its events could not be checked\.<\/p>/);
  assert.match(html, /<ul class="sc-costs nopts">/);
  assert.deepEqual(costs(html).map((c) => [c.href, c.what]), [["f-site-journey_incomplete", "Journeys stopped at step 1"], ["f-site-consent_default_missing", "No Consent Mode default"]]);
  assert.deepEqual(Object.values(chips(html)).map((c) => [c.count, c.zero]), [[0, true], [1, false], [1, false], [11, false], [0, true]]);
  assert.equal(cardOf(html, "inventory")[2], "0 of 4 seen");
  assert.equal((html.match(/sm-unseen/g) ?? []).length, 4);
  assert.match(html, /<span class="sub">0 of 4 completed · stopped at step 1<\/span>/);
  assert.equal((html.match(/<span class="chip chip-run incomplete">/g) ?? []).length, 4);
  assert.deepEqual(cardOf(html, "consent").slice(1), ["No default seen", "Banner not reached"]);
  assert.match(html, /<span class="sub">1\.4 s · v/);
});

test("the ring is banded by score, the word by verdict, and the cost lines follow the score", () => {
  const input = reportInput();
  const withScore = (score, extra = []) => summary({ ...input, metrics: { ...input.metrics, score: { ...input.metrics.score, score, deductions: [...input.metrics.score.deductions, ...extra] } } });
  // 60 is amber, 95 green, though the verdict stays a fail in red.
  assert.match(withScore(60), /<div class="scorecard band-mid">.*\n<p class="sc-verdict sev-broken">/);
  const ninetyFive = withScore(95);
  assert.match(ninetyFive, /<div class="scorecard band-pass">/);
  // 90–99: only the largest group, with the rest counted on its line.
  assert.equal(costs(ninetyFive).length, 1);
  assert.match(ninetyFive, /<code>currency<\/code> <span class="muted">· 2 more<\/span><\/span>/);
  // More than three groups: two lines, then the rest summed and sent to Findings.
  const more = withScore(10, [
    { check: "after_reject", severity: "risk", platform: "meta", event: "PageView", points: 4 },
    { check: "missing_event", severity: "broken", platform: "ga4", event: "begin_checkout", points: 3 },
  ]);
  assert.deepEqual(costs(more).map((c) => [c.href, c.points, c.what]), [
    ["f-ga4-purchase-missing_params", 60, "<code>purchase</code> sent without <code>value</code>, <code>currency</code>"],
    ["f-meta-pageview-before_consent", 10, "<code>PageView</code> sent before consent"],
    ["findings", 12, "3 more in Findings"],
  ]);
  // A perfect run: green, a pass, the shared headline and no cost line.
  const pass = summary(reportInput({ findings: input.findings.filter((f) => f.severity === "ok"), metrics: undefined }));
  assert.match(pass, /<div class="scorecard band-pass">.*style="--score:100".*\n<p class="sc-verdict sev-ok"><svg[^>]*><use href="#sev-ok"\/><\/svg>Pass<\/p>\n<p class="sc-head">All 11 planned events fired correctly on 4 journeys\.<\/p>/);
  assert.doesNotMatch(pass, /sc-costs/);
});

test("the model's summary is one muted line under the headline, with only its bold and code marks as HTML", () => {
  const explained = { summary: { headline: "Mobile purchases send **0** revenue to `GA4` <b>now</b>.", points: [{ severity: "broken", text: "Revenue is **0**." }], also_check: ["Something else."] }, explanations: [] };
  const html = summary(reportInput({ ai: { name: "Anthropic", model: "claude-sonnet-4-5" }, explained }));
  assert.match(html, /<p class="sc-head">Purchase tracking is broken on mobile\.<\/p>\n<p class="sc-ai muted" title="Mobile purchases send \*\*0\*\* revenue to `GA4` &lt;b&gt;now&lt;\/b&gt;\."><span class="ai-l">AI summary<\/span> Mobile purchases send <strong>0<\/strong> revenue to <code>GA4<\/code> &lt;b&gt;now&lt;\/b&gt;\.<\/p>/);
  // One line: the points and the also-check list stay out of the Summary.
  assert.doesNotMatch(html, /Revenue is|Something else/);
  assert.match(strip(html), /<a class="lbl" href="#run">AI<\/a><span class="val">Anthropic <small>· claude-sonnet-4-5<\/small><\/span><span class="sub">Explains causes and fixes<\/span>/);
  // An older capture's plain-text summary, and Turkish.
  assert.match(summary(reportInput({ explained: { summary: "Plain text summary.", explanations: [] } })), /<span class="ai-l">AI summary<\/span> Plain text summary\.<\/p>/);
  assert.match(summary(reportInput({ lang: "tr", explained })), /<span class="ai-l">Yapay zekâ özeti<\/span>/);
});

test("the baseline's accepted line sits in the scorecard under the chips, and accepted rows cost nothing", () => {
  const input = reportInput();
  const findings = input.findings.map((f) => (f.check === "duplicate" ? { ...f, accepted: true } : f));
  const html = summary({ ...input, findings, metrics: undefined });
  assert.match(html, /<\/div>\n<p class="meta accepted-line">1 accepted finding from the baseline is not counted<\/p>\n<\/div>\n<div class="grid sm-about"/);
  assert.equal(chips(html).warning.count, 0);
  assert.ok(!costs(html).some((c) => c.href === "f-ga4-add_to_cart-duplicate"));
  assert.match(summary({ ...input, findings, metrics: undefined, lang: "tr" }), /<p class="meta accepted-line">Temel dosyada kabul edilen 1 bulgu sayılmadı<\/p>/);
});

test("an empty capture renders, metrics given or computed give the same bytes", () => {
  const empty = summary({ title: "t", generatedAt: "now", findings: [], explained: null, runs: [], lang: "en" });
  assert.match(empty, /<span class="sc-num sm-none">–<\/span>/);
  assert.match(empty, /No journey ran/);
  assert.match(empty, /<span class="sm-note">No measurement plan given<\/span>/);
  assert.match(empty, /<span class="val">now<\/span>/);
  const input = reportInput();
  assert.equal(summary(input), summary({ ...input, metrics: undefined }));
  assert.equal(summary(input), summary(reportInput()));
});
