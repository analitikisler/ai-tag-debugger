import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { checkRun } from "../src/checks.js";
import {
  CONVERSION_EVENTS, SCORE_WEIGHTS, computeMetrics, consentCompliance, conversionIntegrity, findingsBy, journeyFunnel,
  planCoverage, platformParity, prioritiesByOwner, qualityScore, timing, verdict,
} from "../src/metrics.js";

// The demo shop walked twice in two viewports: every planned event fires, but the mobile checkout
// sends its purchases without value and currency, GA4 add_to_cart fires twice, and Meta's PageView
// fires before consent and after "reject all" on the start page.
const demo = JSON.parse(await readFile(new URL("./fixtures/demo-capture.json", import.meta.url), "utf8"));
const capture = { plan: demo.config.plan, runs: demo.runs, findings: demo.findings, consentScenarios: demo.consentScenarios };

// Small hand-built runs for the edge cases.
const hit = (platform, name, step, params = {}, extra = {}) => ({ platform, name, step, params, url: "https://x/", t: 1000 + step * 100 + 10, ...extra });
const steps = (labels) => labels.map((label, index) => ({ index, label, t: 1000 + index * 100, action: index ? "click" : undefined, pagePath: `https://shop/${index}` }));
const run = (journeyId, hits, extra = {}) => ({
  journeyId, viewport: "desktop", completed: true, note: "done", startedAt: 1000, providers: ["ga4", "meta"], consentStep: null, rejectStep: null,
  steps: steps(["start", "Open the shop", "Add to cart", "Place the order"]), dataLayerLog: [], cookieLog: [], hits, ...extra,
});
const plan = {
  consent_mode: true,
  events: [
    { platform: "ga4", name: "add_to_cart", journeys: ["checkout"], required_params: ["currency", "value"] },
    { platform: "ga4", name: "purchase", journeys: ["checkout"], required_params: ["transaction_id", "value", "currency", "items"] },
    { platform: "meta", name: "Purchase", journeys: ["checkout"], required_params: ["value", "currency"] },
    { platform: "ga4", name: "sign_up", journeys: ["signup"] },
  ],
};
const good = { value: "50", currency: "EUR", transaction_id: "T1", items: "idA~nmA~pr50~qt1" };

test("verdict: the demo fails on its two broken purchases and counts distinct problems", () => {
  const v = verdict(capture);
  assert.equal(v.status, "fail");
  assert.equal(v.headline, "fail_broken");
  assert.deepEqual(v.counts, { broken: 2, risk: 1, warning: 1, info: 0, ok: 4 });
  assert.deepEqual(v.journeys, { total: 4, completed: 4, incomplete: 0 });
  assert.equal(v.problems, 4);
});

test("verdict: incomplete journeys fail, risks and warnings ask for attention, a clean run passes, nothing tested is not a pass", () => {
  const clean = run("checkout", [hit("ga4", "purchase", 3, good)]);
  const findings = checkRun({ events: [] }, clean);
  assert.equal(verdict({ findings, runs: [clean] }).status, "pass");
  const stopped = run("checkout", [], { completed: false, note: "button not found" });
  assert.equal(verdict({ findings: checkRun({ events: [] }, stopped), runs: [stopped] }).headline, "fail_incomplete");
  // Without the runs, the journey_incomplete finding alone says so.
  assert.equal(verdict({ findings: checkRun({ events: [] }, stopped) }).headline, "fail_incomplete");
  const dup = run("checkout", [hit("ga4", "purchase", 3, good), hit("ga4", "purchase", 3, good)]);
  assert.deepEqual(verdict({ findings: checkRun({ events: [] }, dup), runs: [dup] }), { status: "attention", headline: "attention_warning", counts: { broken: 0, risk: 0, warning: 1, info: 0, ok: 0 }, journeys: { total: 1, completed: 1, incomplete: 0 }, problems: 1 });
  const early = run("checkout", [hit("meta", "PageView", 1)]);
  assert.equal(verdict({ findings: checkRun({ events: [] }, early), runs: [early] }).headline, "attention_risk");
  assert.equal(verdict({}).headline, "attention_nothing_tested");
  assert.equal(verdict({ findings: [], runs: [run("checkout", [])] }).headline, "attention_no_hits");
});

test("qualityScore: 100 minus the weighted distinct problems, doubled on conversion events, floored at 0", () => {
  const s = qualityScore(capture);
  // Two broken purchases (15 x 2 each), one risk (10) and one warning (5): 100 - 75.
  assert.equal(s.score, 25);
  assert.equal(s.lost, 75);
  assert.deepEqual(s.deductions.map((d) => [d.check, d.event, d.points, d.conversion, d.owner, d.where]), [
    ["missing_params", "purchase", 30, true, "developer", 1],
    ["missing_params", "Purchase", 30, true, "developer", 1],
    ["before_consent", "PageView", 10, false, "gtm", 4],
    ["duplicate", "add_to_cart", 5, false, "gtm", 4],
  ]);
  assert.equal(SCORE_WEIGHTS.severity.broken * SCORE_WEIGHTS.conversion, 30);
  assert.ok(CONVERSION_EVENTS.has("purchase"));
  // The same problem on two viewports is one deduction, so more viewports never lower the score by themselves.
  const once = qualityScore({ findings: capture.findings.filter((f) => f.viewport === "desktop"), runs: capture.runs });
  assert.equal(once.deductions.find((d) => d.check === "duplicate").points, 5);
  assert.equal(qualityScore({}).score, null);
  const many = Array.from({ length: 10 }, (_, i) => ({ severity: "broken", check: "missing_event", journey: "j", viewport: "desktop", platform: "ga4", event: `e${i}`, detail: `missing e${i}` }));
  assert.equal(qualityScore({ findings: many, runs: [] }).score, 0);
  // An unfinished journey costs its own weight, not the warning's.
  const stopped = run("checkout", [], { completed: false });
  assert.equal(qualityScore({ findings: checkRun({ events: [] }, stopped), runs: [stopped] }).score, 100 - SCORE_WEIGHTS.check.journey_incomplete);
});

test("planCoverage: buckets with shares of the checkable events, overall and per platform; null without a plan", () => {
  const c = planCoverage(capture);
  assert.equal(c.planned, 11);
  assert.equal(c.checkable, 11);
  assert.deepEqual(c.counts, { implemented: 9, missing: 0, missing_params: 2, wrong_values: 0, unplanned: 0, not_checked: 0 });
  assert.deepEqual(c.percent, { implemented: 82, missing: 0, missing_params: 18, wrong_values: 0 });
  assert.deepEqual(c.platforms.meta.counts, { implemented: 3, missing: 0, missing_params: 1, wrong_values: 0, unplanned: 0, not_checked: 0 });
  assert.equal(c.platforms.meta.percent.implemented, 75);
  assert.equal(c.events.find((e) => e.event === "purchase").bucket, "missing_params");
  assert.equal(planCoverage({ plan: null, runs: capture.runs, findings: capture.findings }), null);
  assert.equal(planCoverage({ plan: { events: [] }, runs: [], findings: [] }), null);
});

test("planCoverage: not checked and unplanned events are counted but kept out of the shares", () => {
  const r = run("checkout", [hit("ga4", "purchase", 3, good), hit("ga4", "scroll", 1)]);
  const c = planCoverage({ plan, runs: [r], findings: checkRun(plan, r) });
  assert.deepEqual(c.counts, { implemented: 1, missing: 2, missing_params: 0, wrong_values: 0, unplanned: 1, not_checked: 1 });
  assert.equal(c.planned, 4);
  assert.equal(c.checkable, 3);
  assert.equal(c.percent.implemented, 33);
  assert.equal(c.platforms.ga4.counts.not_checked, 1);
  assert.equal(c.platforms.ga4.percent.implemented, 50);
});

test("journeyFunnel: expected events in plan order with where they first fired, counts and parameter state", () => {
  const f = journeyFunnel(capture);
  assert.equal(f.length, 4);
  const mobile = f.find((r) => r.journey === "checkout" && r.viewport === "mobile");
  assert.equal(mobile.source, "plan");
  assert.deepEqual([mobile.expected, mobile.observed, mobile.ok, mobile.percent, mobile.firstMissing], [11, 11, 9, 100, null]);
  assert.deepEqual(mobile.events.map((e) => e.event), ["page_view", "view_item_list", "view_item", "add_to_cart", "view_cart", "begin_checkout", "purchase", "PageView", "AddToCart", "InitiateCheckout", "Purchase"]);
  const purchase = mobile.events.find((e) => e.event === "purchase");
  assert.deepEqual(purchase, { platform: "ga4", event: "purchase", conversion: true, observed: true, count: 1, step: 11, stepLabel: "Place the order", page: "http://localhost:4321/thanks.html", required: ["transaction_id", "currency", "value", "items"], missingParams: ["currency", "value"], paramsOk: false, status: "missing_params" });
  const cart = mobile.events.find((e) => e.event === "add_to_cart");
  assert.deepEqual([cart.count, cart.step, cart.stepLabel, cart.status], [2, 4, "Add to cart", "ok"]);
  const desktop = f.find((r) => r.journey === "checkout" && r.viewport === "desktop");
  assert.equal(desktop.ok, 11);
});

test("journeyFunnel: a journey that stopped early shows the first missing event; presets fill in without a plan; no runs give an empty list", () => {
  const stopped = run("checkout", [hit("ga4", "add_to_cart", 2, { currency: "EUR", value: "50" })], { completed: false });
  const [f] = journeyFunnel({ plan, runs: [stopped] });
  assert.equal(f.completed, false);
  assert.equal(f.firstMissing, "purchase");
  assert.deepEqual(f.events.map((e) => [e.event, e.status]), [["add_to_cart", "ok"], ["purchase", "missing"], ["Purchase", "missing"]]);
  assert.equal(f.events[1].step, null);
  // A ready-made journey without a plan uses the preset's events; a Meta ViewContent counts as view_item.
  const preset = run("add_to_cart", [hit("ga4", "view_item", 1, { currency: "EUR", value: "5", items: "x" }), hit("meta", "AddToCart", 2)]);
  const [p] = journeyFunnel({ plan: null, runs: [preset] });
  assert.equal(p.source, "preset");
  assert.deepEqual(p.events.map((e) => [e.platform, e.event, e.observed]), [["ga4", "view_item", true], ["ga4", "add_to_cart", false], ["meta", "AddToCart", true]]);
  assert.equal(p.firstMissing, "add_to_cart");
  // Only providers the run checked are expected.
  const [q] = journeyFunnel({ plan: null, runs: [{ ...preset, providers: ["ga4"] }] });
  assert.deepEqual(q.events.map((e) => e.platform), ["ga4", "ga4"]);
  const [n] = journeyFunnel({ plan: null, runs: [run("custom", [])] });
  assert.deepEqual([n.source, n.expected, n.percent], ["none", 0, null]);
  assert.deepEqual(journeyFunnel({ plan, runs: [] }), []);
});

test("platformParity: pairs events across platforms by canonical name, flags count, value and currency differences, lists one-platform events", () => {
  const p = platformParity(capture);
  const desktop = p.find((r) => r.journey === "checkout" && r.viewport === "desktop");
  assert.deepEqual(desktop.shared.map((s) => [s.event, s.mismatch]), [["purchase", []], ["addtocart", ["count"]], ["begincheckout", []], ["pageview", []]]);
  assert.deepEqual(desktop.shared[0].platforms, { ga4: { names: ["purchase"], count: 1, value: 19.9, currency: "EUR" }, meta: { names: ["Purchase"], count: 1, value: 19.9, currency: "EUR" } });
  assert.deepEqual(desktop.onlyOn.map((o) => [o.platform, o.name]), [["ga4", "view_cart"], ["ga4", "view_item"], ["ga4", "view_item_list"]]);
  assert.equal(desktop.mismatches, 1);
  // The mobile purchases carry no value on either platform: nothing differs, so parity is quiet and conversionIntegrity speaks.
  const mobile = p.find((r) => r.journey === "checkout" && r.viewport === "mobile");
  assert.deepEqual(mobile.shared[0].mismatch, []);
});

test("platformParity: a different value or currency, or a value only one platform sent, is a mismatch", () => {
  const r = run("checkout", [hit("ga4", "purchase", 3, { value: "50", currency: "EUR" }), hit("meta", "Purchase", 3, { value: "45", currency: "usd" }), hit("ga4", "add_to_cart", 2, { value: "5" }), hit("meta", "AddToCart", 2)]);
  const [p] = platformParity({ runs: [r] });
  assert.deepEqual(p.shared.map((s) => [s.event, s.mismatch]), [["purchase", ["value", "currency"]], ["addtocart", ["value_missing"]]]);
  assert.equal(p.mismatches, 2);
  assert.deepEqual(platformParity({ runs: [] }), []);
  const [empty] = platformParity({ runs: [run("checkout", [])] });
  assert.deepEqual([empty.shared, empty.onlyOn, empty.mismatches], [[], [], 0]);
});

test("consentCompliance: the demo's Meta pixel fires before consent and after reject, Consent Mode default is on time with v2 signals", () => {
  const c = consentCompliance(capture);
  assert.equal(c.status, "fail");
  assert.deepEqual({ ...c.consentMode, runs: undefined }, { expected: true, defaultPresent: true, defaultOnTime: true, v2Signals: { present: true, missing: [] }, runs: undefined });
  assert.equal(c.consentMode.runs.length, 4);
  assert.deepEqual({ ...c.consentMode.runs[0], ms: undefined }, { journey: "browse", viewport: "desktop", present: true, step: 1, stepLabel: "Open http://localhost:4321/", ms: undefined, beforeFirstGoogleHit: true, v2Signals: { present: true, missing: [] } });
  assert.ok(c.consentMode.runs[0].ms > 0 && c.consentMode.runs[0].ms < 1000);
  assert.deepEqual(c.platforms, [
    { platform: "ga4", ad: false, beforeConsent: 0, afterReject: 0, afterAnalyticsOnly: null, scenarios: { before: 2, accept: 2, reject: 2, analytics: null }, status: "pass" },
    { platform: "meta", ad: true, beforeConsent: 1, afterReject: 1, afterAnalyticsOnly: null, scenarios: { before: 1, accept: 1, reject: 1, analytics: null }, status: "fail" },
  ]);
  assert.deepEqual(c.scenarios, { cmp: "banner", states: { accept: true, reject: true, analytics: false }, problems: [{ platform: "meta", event: "PageView", state: "reject", count: 1 }] });
  assert.deepEqual(c.findings, ["before_consent"]);
});

test("consentCompliance: without scenarios the findings decide; a missing or late default is attention; nothing captured is unknown", () => {
  const withoutScenarios = consentCompliance({ ...capture, consentScenarios: null });
  assert.equal(withoutScenarios.scenarios, null);
  assert.equal(withoutScenarios.platforms.find((p) => p.platform === "meta").afterReject, 0);
  assert.equal(withoutScenarios.platforms.find((p) => p.platform === "meta").scenarios, null);
  assert.equal(withoutScenarios.status, "attention");
  // A GA4 hit before any consent default push, and no v2 signals: risks, not failures.
  const late = run("checkout", [hit("ga4", "page_view", 1, {}, { consent: { ad_storage: "granted", analytics_storage: "granted" } })], {
    consentStep: 2, dataLayerLog: [{ step: 1, t: 1200, value: ["consent", "default", { ad_storage: "denied", analytics_storage: "denied" }] }],
  });
  const c = consentCompliance({ plan, runs: [late], findings: checkRun(plan, late) });
  assert.equal(c.status, "attention");
  assert.deepEqual({ ...c.consentMode, runs: undefined }, { expected: true, defaultPresent: true, defaultOnTime: false, v2Signals: { present: false, missing: ["ad_user_data", "ad_personalization"] }, runs: undefined });
  assert.ok(c.findings.includes("consent_default_late") && c.findings.includes("consent_v2_missing"));
  // A tag that kept sending after "reject all" fails the platform and the whole.
  const rejected = run("decline", [hit("meta", "PageView", 1), hit("meta", "PageView", 2)], { rejectStep: 2, steps: steps(["start", "Open", "Reject cookies"]).map((s) => (s.index === 2 ? { ...s, rejectsConsent: true } : s)) });
  const r = consentCompliance({ plan: { events: [] }, runs: [rejected], findings: checkRun({ events: [] }, rejected) });
  assert.equal(r.status, "fail");
  assert.equal(r.platforms[0].afterReject, 1);
  assert.equal(r.consentMode.defaultPresent, false);
  assert.equal(consentCompliance({}).status, "unknown");
});

test("conversionIntegrity: one row per purchase with a pass or fail per property", () => {
  const c = conversionIntegrity(capture);
  assert.deepEqual([c.total, c.passed, c.percent], [4, 2, 50]);
  assert.deepEqual(c.rows.map((r) => [r.viewport, r.platform, r.pass, r.failed]), [
    ["desktop", "ga4", true, []], ["desktop", "meta", true, []], ["mobile", "ga4", false, ["value", "currency"]], ["mobile", "meta", false, ["value", "currency"]],
  ]);
  const [ga4] = c.rows;
  assert.deepEqual(ga4.checks, { value: "pass", currency: "pass", transactionId: "pass", items: "pass", duplicate: "pass", parity: "pass", eventId: null });
  assert.deepEqual([ga4.transactionId, ga4.value, ga4.currency, ga4.items, ga4.counterpart, ga4.page, ga4.stepLabel], ["T1792391957987", 19.9, "EUR", 1, "meta", "http://localhost:4321/thanks.html", "Place the order"]);
  // Meta has no standard order id or items, so those are not applicable rather than failed.
  assert.deepEqual(c.rows[1].checks, { value: "pass", currency: "pass", transactionId: null, items: null, duplicate: "pass", parity: "pass", eventId: null });
  // With no value on either side there is nothing to compare, so parity is null.
  assert.equal(c.rows[2].checks.parity, null);
});

test("conversionIntegrity: a zero value, a bad currency, empty items, a duplicate send, a platform mismatch and a missing event id all fail", () => {
  const r = run("checkout", [
    hit("ga4", "purchase", 3, { value: "0", currency: "eur", transaction_id: "T1", items: "[]" }),
    hit("ga4", "purchase", 3, { value: "0", currency: "eur", transaction_id: "T1", items: "[]" }),
    hit("meta", "Purchase", 3, { value: "49.9", currency: "EUR", order_id: "T1" }, { delivery: "server" }),
  ]);
  const c = conversionIntegrity({ runs: [r] });
  assert.equal(c.total, 3);
  assert.equal(c.passed, 0);
  assert.deepEqual(c.rows[0].checks, { value: "fail", currency: "fail", transactionId: "pass", items: "fail", duplicate: "fail", parity: "fail", eventId: "fail" });
  assert.deepEqual(c.rows[0].failed, ["value", "currency", "items", "duplicate", "parity", "eventId"]);
  assert.equal(c.rows[2].checks.parity, "fail");
  assert.equal(c.rows[2].counterpart, "ga4");
  // Two sends with the same event id are one event to the platform; a GA4 purchase without items loses the product reports.
  const ids = run("checkout", [hit("ga4", "purchase", 3, { value: "5", currency: "EUR", transaction_id: "T2" }, { eventId: "a" }), hit("ga4", "purchase", 3, { value: "5", currency: "EUR", transaction_id: "T2" }, { eventId: "a" })]);
  const d = conversionIntegrity({ runs: [ids] });
  assert.equal(d.rows[0].checks.duplicate, "pass");
  assert.equal(d.rows[0].checks.items, "fail");
  assert.equal(d.rows[0].checks.eventId, "pass");
  assert.equal(d.rows[0].checks.parity, null);
  const distinct = run("checkout", [hit("ga4", "purchase", 3, good, { eventId: "a" }), hit("ga4", "purchase", 3, good, { eventId: "b" })]);
  assert.equal(conversionIntegrity({ runs: [distinct] }).rows[0].checks.duplicate, "fail");
  assert.deepEqual(conversionIntegrity({ runs: [] }), { rows: [], total: 0, passed: 0, percent: null });
});

test("timing: run duration, per-step delay to the first hit, and the slowest hits", () => {
  const t = timing(capture);
  const browse = t[0];
  assert.deepEqual([browse.journey, browse.viewport, browse.durationMs], ["browse", "desktop", 2677]);
  assert.equal(browse.medianFirstHitMs, 74);
  const open = browse.steps[1];
  assert.deepEqual({ ...open, durationMs: undefined }, { index: 1, label: "Open http://localhost:4321/", action: "goto", page: "http://localhost:4321/", hits: 3, firstHitMs: 74, lastHitMs: 79, durationMs: undefined });
  assert.equal(open.durationMs, 1001);
  assert.equal(browse.steps[2].firstHitMs, null);
  assert.equal(browse.steps.at(-1).durationMs, null);
  assert.equal(browse.slowest.length, 5);
  assert.deepEqual(browse.slowest[0], { platform: "meta", event: "PageView", step: 3, stepLabel: "Open the first product", ms: 88 });
  assert.ok(browse.slowest.every((h, i, all) => !i || all[i - 1].ms >= h.ms));
  assert.equal(timing({ runs: capture.runs, slowest: 2 })[0].slowest.length, 2);
});

test("timing: runs without timestamps get null durations and no slowest list", () => {
  const bare = { journeyId: "j", viewport: "desktop", completed: true, steps: [{ index: 0, label: "start" }, { index: 1, label: "go" }], hits: [{ platform: "ga4", name: "page_view", step: 1, params: {} }] };
  const [t] = timing({ runs: [bare] });
  assert.deepEqual([t.durationMs, t.medianFirstHitMs, t.slowest], [null, null, []]);
  assert.deepEqual(t.steps[1], { index: 1, label: "go", action: null, page: null, hits: 1, durationMs: null, firstHitMs: null, lastHitMs: null });
  assert.deepEqual(timing({}), []);
});

test("findingsBy: problems counted by the page they happened on, by owner, platform and journey, worst first", () => {
  const w = findingsBy(capture);
  assert.deepEqual(w.byPage.map((g) => [g.key, g.total, g.counts.broken, g.counts.risk, g.counts.warning]), [
    ["http://localhost:4321/thanks.html", 2, 2, 0, 0], ["http://localhost:4321/", 4, 0, 4, 0], ["http://localhost:4321/product.html", 4, 0, 0, 4],
  ]);
  assert.deepEqual(w.byOwner.map((g) => [g.key, g.total]), [["developer", 2], ["gtm", 8]]);
  assert.deepEqual(w.byPlatform.map((g) => [g.key, g.counts.broken, g.counts.risk, g.counts.warning]), [["ga4", 1, 0, 4], ["meta", 1, 4, 0]]);
  assert.deepEqual(w.byJourney.map((g) => [g.key, g.total]), [["checkout", 6], ["browse", 4]]);
  assert.ok(w.byPage[0].findings.every((f) => f.check === "missing_params"));
  // Journey-wide findings (no step: the unfinished journey and the missing Consent Mode default) land under the null page.
  const stopped = run("checkout", [], { completed: false });
  const s = findingsBy({ findings: checkRun(plan, stopped), runs: [stopped] });
  assert.deepEqual(s.byPage.map((g) => [g.key, g.total]), [[null, 2]]);
  assert.deepEqual(s.byPage[0].findings.map((f) => f.check), ["consent_default_missing", "journey_incomplete"]);
  assert.deepEqual(findingsBy({}), { byPage: [], byOwner: [], byPlatform: [], byJourney: [] });
});

test("prioritiesByOwner: distinct problems per owner, ordered by the points they would recover, top three each", () => {
  const p = prioritiesByOwner(capture.findings);
  assert.deepEqual(p.map((g) => [g.owner, g.total, g.points]), [["developer", 2, 60], ["gtm", 2, 15]]);
  assert.deepEqual(p[0].top.map((f) => [f.severity, f.check, f.platform, f.event, f.points, f.conversion]), [["broken", "missing_params", "ga4", "purchase", 30, true], ["broken", "missing_params", "meta", "Purchase", 30, true]]);
  assert.deepEqual(p[0].counts, { broken: 2, risk: 0, warning: 0, info: 0, ok: 0 });
  assert.equal(p[1].top[0].where.length, 4);
  const many = Array.from({ length: 5 }, (_, i) => ({ severity: "warning", check: "duplicate", journey: "j", viewport: "desktop", platform: "ga4", event: `e${i}`, detail: `dup e${i}` }));
  assert.equal(prioritiesByOwner(many)[0].top.length, 3);
  assert.equal(prioritiesByOwner(many, { top: 5 })[0].top.length, 5);
  assert.deepEqual(prioritiesByOwner([]), []);
  assert.deepEqual(prioritiesByOwner([{ severity: "info", check: "server_side", journey: "j", viewport: "desktop", detail: "x" }]), []);
});

test("computeMetrics: every metric at once, also from an empty capture", () => {
  const m = computeMetrics(capture);
  assert.deepEqual(Object.keys(m), ["verdict", "score", "coverage", "funnel", "parity", "consent", "conversions", "timing", "where", "priorities"]);
  assert.equal(m.verdict.status, "fail");
  assert.equal(m.score.score, 25);
  assert.equal(m.coverage.percent.implemented, 82);
  const empty = computeMetrics({});
  assert.deepEqual([empty.verdict.headline, empty.score.score, empty.coverage, empty.funnel, empty.parity, empty.consent.status, empty.conversions.total, empty.timing, empty.priorities], ["attention_nothing_tested", null, null, [], [], "unknown", 0, [], []]);
});
