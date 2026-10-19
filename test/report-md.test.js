// The Markdown report as docs/design/md-report-spec.md describes it: a verdict first, the priorities
// by owner, at most five full finding blocks, the consent table with a reason per cell, what passed,
// the journeys with their flagged steps, and the whole thing inside its line and byte budget.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LANGUAGES } from "../src/i18n.js";
import { computeMetrics } from "../src/metrics.js";
import { renderMarkdown, verdictHeadline } from "../src/report.js";

const capture = JSON.parse(readFileSync(new URL("./fixtures/demo-capture.json", import.meta.url), "utf8"));
const demo = { title: "AI Tag Debugger report: localhost", site: "localhost", generatedAt: "2026-10-19 06:39 UTC", findings: capture.findings, explained: null, runs: capture.runs, plan: capture.config.plan, consentScenarios: capture.consentScenarios, changes: { previous: null } };
const metrics = computeMetrics({ plan: capture.config.plan, runs: capture.runs, findings: capture.findings, consentScenarios: capture.consentScenarios });
const sections = (md) => md.split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3));
const section = (md, name) => md.slice(md.indexOf(`## ${name}`), md.indexOf("\n## ", md.indexOf(`## ${name}`) + 1) > 0 ? md.indexOf("\n## ", md.indexOf(`## ${name}`) + 1) : undefined);

test("the demo run opens with the verdict in the title, then meta, status, counts, and stays within the budget", () => {
  const md = renderMarkdown({ ...demo, metrics });
  const lines = md.split("\n");
  assert.equal(lines[0], "# localhost: purchase tracking is broken on mobile");
  assert.match(lines[2], /^Generated 2026-10-19 06:39 UTC · 4 journeys · 2 platforms seen \(GA4, Meta\) · ai-tag-debugger \d+\.\d+\.\d+ · \[HTML report\]\(report\.html\)$/);
  assert.equal(lines[3], "**Fail** · data quality score 25/100");
  assert.match(lines[4], /^\*\*2 broken · 1 risk · 1 warning · 0 info · 4 ok\*\* · This is the first saved run/);
  assert.ok(lines.length <= 120, `${lines.length} lines`);
  assert.ok(Buffer.byteLength(md) <= 8 * 1024, `${Buffer.byteLength(md)} bytes`);
  // The timeline is not in the file: no per-step headings, no dataLayer dump.
  assert.doesNotMatch(md, /^### \w+ \((desktop|mobile)\):/m);
  assert.doesNotMatch(md, /- dataLayer: `/);
  assert.match(md, /timeline\.csv/);
  assert.deepEqual(sections(md), ["Priorities", "Findings", "Consent", "What passed", "Journeys", "Not checked"]);
});

test("priorities are grouped by owner with the severity, the title and the place, and idle owners get one line", () => {
  const md = section(renderMarkdown({ ...demo, metrics }), "Priorities");
  assert.match(md, /### Developer\n1\. \*\*Broken\*\* `purchase` was sent without `currency`, `value` · checkout · mobile · step 11\n2\. \*\*Broken\*\* `Purchase` was sent without `value`, `currency` · checkout · mobile · step 11/);
  assert.match(md, /### Tag Manager\n1\. \*\*Risk\*\* meta `PageView` fired before the visitor accepted cookies · all 4 journeys · step 1\n2\. \*\*Warning\*\* `add_to_cart` was sent 2 times[^\n]* · all 4 journeys · step 4/);
  assert.match(md, /\nMarketing: nothing to do\.\n/);
  assert.ok(md.indexOf("### Developer") < md.indexOf("### Tag Manager"), "the owner with the most points to recover comes first");
});

test("a finding block has the fixed fields: where, evidence, also fine on, owner, verify and link", () => {
  const md = section(renderMarkdown({ ...demo, metrics }), "Findings");
  const block = md.slice(md.indexOf("### Broken: `purchase`"), md.indexOf("### Broken: `Purchase`"));
  assert.match(block, /^- Where: checkout · mobile · step 11 "Place the order" · \/thanks\.html · \+6\.7s$/m);
  assert.match(block, /^- Evidence: `\{"page_location":"http:\/\/localhost:4321\/thanks\.html"[^\n]*`$/m);
  assert.match(block, /^- Also fine on: checkout · desktop$/m);
  assert.match(block, /^- Owner: Developer$/m);
  assert.match(block, /^- How to verify: \[Tag Assistant\]\(https:\/\/tagassistant\.google\.com\/\), \[GA4 DebugView\]/m);
  assert.match(block, /^- Link: report\.html#f-ga4-purchase-missing_params$/m);
  assert.ok(block.trim().split("\n").length <= 10, "a block is at most ten lines");
  // A problem on every journey says so instead of listing four places.
  assert.match(md, /### Risk: meta `PageView` fired before the visitor accepted cookies\.\n- Where: all 4 journeys · step 1 "Open http:\/\/localhost:4321\/" · \/ · \+0\.1s/);
  // Without a consequence table there is no Impact line, and nothing tells the reader to re-run the tool.
  assert.doesNotMatch(md, /--no-ai/);
});

test("the consent section has the Consent Mode timing sentence and a reason in every scenario cell", () => {
  const md = section(renderMarkdown({ ...demo, metrics }), "Consent");
  assert.match(md, /^Consent Mode default set on 4 of 4 journeys, before the first Google hit; v2 signals present\.$/m);
  assert.match(md, /^\| GA4 `page_view` \| 1 · cookieless ✓ \| 1 ✓ \| 1 · cookieless ✓ \| – \|$/m);
  assert.match(md, /^\| Meta `PageView` \| 1 ✗ before consent \| 1 ✓ \| \*\*1\*\* ✗ should not send \| – \|$/m);
  assert.match(md, /^✓ allowed · ✗ should not have been sent/m);
});

test("what passed lists the ok checks, coverage, the purchases that pass and the cross-platform match", () => {
  const md = section(renderMarkdown({ ...demo, metrics }), "What passed");
  assert.match(md, /^- gclid, fbclid, utm_source, utm_medium, utm_campaign survived [^\n]* · all 4 journeys$/m);
  assert.match(md, /^- Plan coverage: 9 of 11 planned events implemented \(82%\)$/m);
  assert.match(md, /^- GA4 purchase value and currency: checkout · desktop \(19\.9 EUR, T1792391957987\)$/m);
  assert.match(md, /^- Purchase cross-platform match: GA4 & Meta agree on checkout · desktop$/m);
  // The mobile purchases carry no value on either platform; agreeing on nothing is not a match.
  assert.doesNotMatch(md, /agree on checkout · mobile/);
  assert.match(md, /^- Personal data: no plain-text email/m);
});

test("journeys are one table row each, flagged steps are grouped, and the not-checked list names the config keys", () => {
  const md = renderMarkdown({ ...demo, metrics });
  const journeys = section(md, "Journeys");
  assert.match(journeys, /^\| Journey \| Viewport \| Completed \| Steps \| Hits \| Findings \|$/m);
  assert.match(journeys, /^\| checkout \| mobile \| yes \| 11 \| 20 \| 4 \|$/m);
  assert.match(journeys, /^\| browse \| desktop \| yes \| 4 \| 9 \| 2 \|$/m);
  assert.match(journeys, /\*\*Flagged steps\*\*\n- checkout · mobile · step 11 "Place the order" · \/thanks\.html · \+6\.7s: GA4 `purchase`, Meta `Purchase`\n- all 4 journeys · step 1 [^\n]*: Meta `PageView`\n- all 4 journeys · step 4 "Add to cart" · \/product\.html · \+2\.6s: GA4 `add_to_cart`/);
  const notChecked = section(md, "Not checked");
  assert.match(notChecked, /^- GTM tag names: no container export given \(`gtm_container` in the config\)\.$/m);
  assert.match(notChecked, /^- Analytics-only consent: the banner has no such choice\.$/m);
  assert.match(notChecked, /^- Google Ads & TikTok were in scope but the site sent nothing to them\.$/m);
  assert.doesNotMatch(notChecked, /no measurement plan/);
  // Without a plan the first line says so, and the inventory is omitted when nothing was recorded.
  assert.match(renderMarkdown({ ...demo, plan: null, metrics: computeMetrics({ runs: capture.runs, findings: capture.findings }) }), /^- Planned events: no measurement plan given \(`plan` in the config\)\.$/m);
  assert.doesNotMatch(md, /## Tag inventory/);
});

test("metrics are computed when the caller passes none, and the trend section appears from two runs", () => {
  const plain = renderMarkdown(demo);
  assert.equal(plain.split("\n")[0], "# localhost: purchase tracking is broken on mobile");
  assert.doesNotMatch(plain, /## Trend/);
  const trend = {
    runs: 3, first: "2026-10-01_0900", last: "2026-10-19_0639", direction: "improving",
    series: [{ id: "2026-10-01_0900", broken: 2, risk: 1, warning: 1, score: 9, complete: true }, { id: "2026-10-02_0900", broken: 0, risk: 1, warning: 1, score: 3, complete: false }, { id: "2026-10-19_0639", broken: 0, risk: 1, warning: 0, score: 2, complete: true }],
    openLongest: [{ check: "before_consent", severity: "risk", platform: "meta", event: "PageView", openSince: "2026-10-01_0900", runsOpen: 3, places: [{ journey: "browse", viewport: "desktop" }, { journey: "checkout", viewport: "mobile" }] }],
    fixedRecently: [], newRecently: [], flapping: [],
  };
  const md = renderMarkdown({ ...demo, metrics, trend });
  assert.deepEqual(sections(md).slice(0, 2), ["Trend", "Priorities"]);
  assert.match(md, /## Trend\n\n`█·▃` Trend over 3 runs \(2026-10-01 → 2026-10-19\): improving\. Now 0 broken · 1 risk · 0 warning\.\nOpen longest: Meta PageView before_consent in 2 places since 2026-10-01 \(3 runs\)\./);
  assert.doesNotMatch(renderMarkdown({ ...demo, metrics, trend: { ...trend, runs: 1, series: trend.series.slice(0, 1) } }), /## Trend/);
});

test("the verdict headline follows the verdict key, with a fallback per key and the custom strings when they exist", () => {
  const run = (over) => ({ journeyId: "checkout", viewport: "desktop", completed: true, note: "done", startedAt: 0, steps: [{ index: 0, label: "start", t: 0 }, { index: 1, label: "Pay", t: 10 }], hits: [{ platform: "ga4", name: "purchase", params: {}, step: 1, t: 20 }], ...over });
  const broken = { journey: "checkout", viewport: "desktop", severity: "broken", check: "missing_params", platform: "ga4", event: "purchase", step: "Pay", detail: '"purchase" was sent without "value".' };
  const headline = (findings, runs, plan = null) => verdictHeadline({ findings, runs, metrics: computeMetrics({ plan, runs, findings }), lang: "en" });
  assert.deepEqual(headline([broken], [run()]), { status: "fail", statusText: "Fail", headline: "purchase tracking is broken", score: 70 });
  assert.equal(headline([broken], [run(), run({ viewport: "mobile" })]).headline, "purchase tracking is broken on desktop");
  assert.equal(headline([broken], [run(), run({ journeyId: "browse" })]).headline, "purchase tracking is broken on checkout");
  assert.equal(headline([], [run(), run({ journeyId: "browse", completed: false, note: "stuck" })]).headline, "the browse journey did not finish, so its events could not be checked");
  assert.equal(headline([{ ...broken, severity: "risk", check: "before_consent" }], [run()]).headline, "purchase tracking carries a consent or data risk");
  assert.equal(headline([{ ...broken, severity: "warning", check: "duplicate" }], [run()]).headline, "purchase tracking needs attention");
  assert.equal(headline([{ journey: "checkout", viewport: "desktop", severity: "risk", check: "consent_default_missing", detail: "x" }], [run()]).headline, "the consent default missing check carries a consent or data risk");
  assert.equal(headline([], [run({ hits: [] })]).headline, "no tracking hits were captured");
  assert.deepEqual(headline([], []), { status: "attention", statusText: "Needs attention", headline: "nothing was tested", score: null });
  assert.equal(headline([], [run()], { events: [{ platform: "ga4", name: "purchase" }] }).headline, "all 1 planned events fired correctly on 1 journey");
  assert.equal(headline([], [run()]).headline, "all checks passed on 1 journey");
  assert.equal(verdictHeadline({ findings: [broken], runs: [run()], metrics: computeMetrics({ runs: [run()], findings: [broken] }), lang: "tr" }).headline, "purchase izlemesi bozuk");
  // The verdict, consequence and fix tables are being written in parallel: a string or a function of the finding is used when present.
  const en = LANGUAGES.en;
  en.verdict = { headline: { fail_broken: ({ what, scope }) => `custom: ${what}${scope}` } };
  en.consequence = { missing_params: (f) => `${f.event} arrived without its value` };
  en.fix = { missing_params: "add the parameters to the push" };
  try {
    const md = renderMarkdown({ title: "t", site: "shop.test", generatedAt: "now", findings: [broken], explained: null, runs: [run(), run({ viewport: "mobile" })] });
    assert.equal(md.split("\n")[0], "# shop.test: custom: purchase tracking on desktop");
    assert.match(md, /\n- Impact: purchase arrived without its value\n/);
    assert.match(md, /\n- Fix: add the parameters to the push\n/);
  } finally {
    delete en.verdict;
    delete en.consequence;
    delete en.fix;
  }
});

test("more than five findings become one line each under Also, with the most severe and widespread first", () => {
  const base = { journey: "checkout", viewport: "desktop", step: "Pay", platform: "ga4" };
  const findings = [
    { ...base, severity: "warning", check: "duplicate", event: "view_item", detail: '"view_item" twice.' },
    { ...base, severity: "info", check: "unplanned_events", event: undefined, detail: "Unplanned: scroll." },
    { ...base, severity: "broken", check: "missing_params", event: "purchase", detail: '"purchase" without "value".' },
    { ...base, severity: "broken", check: "missing_event", event: "begin_checkout", detail: '"begin_checkout" never sent.' },
    { ...base, severity: "risk", check: "pii", event: "purchase", detail: "Email in plain text." },
    { ...base, severity: "warning", check: "purchase_items_empty", event: "purchase", detail: "No items." },
    { ...base, severity: "warning", check: "duplicate", event: "add_to_cart", detail: '"add_to_cart" twice.' },
    { ...base, viewport: "mobile", severity: "warning", check: "duplicate", event: "add_to_cart", detail: '"add_to_cart" twice.' },
  ];
  const run = (viewport) => ({ journeyId: "checkout", viewport, completed: true, note: "", startedAt: 0, steps: [{ index: 0, label: "start", t: 0 }, { index: 1, label: "Pay", t: 5 }], hits: [] });
  const md = renderMarkdown({ title: "t", generatedAt: "now", findings, explained: null, runs: [run("desktop"), run("mobile")] });
  const heads = md.split("\n").filter((l) => l.startsWith("### ") && !["### Developer", "### Tag Manager", "### Marketing"].includes(l));
  assert.deepEqual(heads, ["### Broken: `purchase` without `value`.", "### Broken: `begin_checkout` never sent.", "### Risk: Email in plain text.", "### Warning: `add_to_cart` twice.", "### Warning: `view_item` twice.", "### Also"]);
  assert.match(md, /### Also\n- \*\*Warning\*\* No items · checkout · desktop · step 1\n- \*\*Info\*\* Unplanned: scroll · checkout · desktop · step 1\n/);
  assert.match(md, /^\| checkout \| desktop \| yes \| 1 \| 0 \| 6 \|$/m);
});

test("the Turkish report has the same structure with Turkish headings and status", () => {
  const md = renderMarkdown({ ...demo, metrics, lang: "tr" });
  assert.equal(md.split("\n")[0], "# localhost: purchase izlemesi bozuk (mobile)");
  assert.match(md, /^\*\*Başarısız\*\* · veri kalitesi puanı 25\/100$/m);
  assert.deepEqual(sections(md), ["Öncelikler", "Bulgular", "Onay", "Sorunsuz olanlar", "Yolculuklar", "Kontrol edilmeyenler"]);
  assert.match(md, /^### Yazılımcı\n1\. \*\*Bozuk\*\* /m);
  assert.match(md, /\| Meta `PageView` \| 1 ✗ onaydan önce \| 1 ✓ \| \*\*1\*\* ✗ gönderilmemeliydi \| – \|/);
  assert.ok(md.split("\n").length <= 120);
});

test("changed since last run says what a fixed item was, what is new and what is still open, in six lines", () => {
  const changes = { previous: "2026-10-01_0900", mode: "findings", fixed: [{ check: "missing_event", platform: "ga4", event: "begin_checkout", severity: "broken", detail: '"begin_checkout" was never sent.' }], new: [{ check: "missing_params", platform: "ga4", event: "purchase", severity: "broken", detail: '"purchase" was sent without "currency", "value".' }], routes: [{ journeyId: "checkout", viewport: "mobile", before: ["/", "/cart"], after: ["/", "/shop", "/cart"] }] };
  const md = section(renderMarkdown({ ...demo, metrics, changes }), "Changed since last run");
  const lines = md.trim().split("\n");
  assert.equal(lines[2], "**1 problem fixed, 1 new problem** · Compared with run 2026-10-01_0900, by health findings");
  assert.equal(lines[4], "- Fixed: GA4 begin_checkout (was: `begin_checkout` was never sent.)");
  assert.equal(lines[5], "- New: GA4 purchase (`purchase` was sent without `currency`, `value`.)");
  assert.equal(lines[6], "- Still open: Meta `Purchase`, Meta `PageView`, GA4 `add_to_cart`");
  assert.match(lines[7], /^- The AI took a different route through the site than in the last run: checkout \(mobile\)$/);
  assert.ok(lines.length <= 8);
  assert.doesNotMatch(renderMarkdown({ ...demo, metrics, changes }), /first saved run/);
});
