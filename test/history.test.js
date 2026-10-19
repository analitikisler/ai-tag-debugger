import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { dateOfId, findingKey, findingTimeline, historyFile, historySummaryLines, journeyStability, loadHistory, runSummary, trend, updateHistoryIndex } from "../src/history.js";
import { findingKeys } from "../src/replay.js";
import { runsDir } from "../src/workspace.js";

const SITE = "https://www.demo-shop.test";
const ID = ["2026-10-01_0900", "2026-10-02_0900", "2026-10-03_0900", "2026-10-04_0900", "2026-10-05_0900", "2026-10-06_0900", "2026-10-07_0900"];

// The sample run's shapes, trimmed: four journeys (browse and checkout on desktop and mobile), the
// problems the demo shop has, and the config fields a capture carries.
const where = [["browse", "desktop"], ["browse", "mobile"], ["checkout", "desktop"], ["checkout", "mobile"]];
const finding = (journey, viewport, severity, check, platform, event, detail) => ({ journey, viewport, severity, check, platform, event, step: "Open http://localhost:4321/", detail });
const beforeConsent = () => where.map(([j, v]) => finding(j, v, "risk", "before_consent", "meta", "PageView", 'meta "PageView" fired before the visitor accepted cookies.'));
const duplicate = () => where.map(([j, v]) => finding(j, v, "warning", "duplicate", "ga4", "add_to_cart", '"add_to_cart" was sent 2 times by one action, which inflates counts and conversions.'));
const purchase = () => [
  finding("checkout", "mobile", "broken", "missing_params", "ga4", "purchase", "purchase is missing transaction_id."),
  finding("checkout", "mobile", "broken", "missing_params", "meta", "Purchase", "Purchase is missing value."),
];
const okRows = () => where.map(([j, v]) => finding(j, v, "ok", "campaign_params", undefined, undefined, "gclid survived the redirects."));
const hit = (name) => ({ platform: "ga4", delivery: "browser", name, id: "G-DEMO12345", params: { currency: "EUR" } });
const run = (journeyId, viewport, hits, completed = true) => ({
  journeyId, viewport, goal: "Accept cookies, open any product and add it to the cart.", hits: Array.from({ length: hits }, (_, i) => hit(`e${i}`)),
  steps: [{ index: 0, label: "start", t: 1792391939113 }, { index: 1, label: "Accept cookies", t: 1792391940000, pagePath: "/" }],
  consentStep: 2, rejectStep: null, cookieLog: [], dataLayerLog: [], network: [], providers: ["ga4", "meta"], skipped: {}, startedAt: 1792391938974, pageErrors: [], completed,
  note: completed ? "All scripted steps completed." : "Stopped: the checkout page did not load.", cookies: [],
});
const journeys = ({ checkoutMobile = true } = {}) => [run("browse", "desktop", 9), run("browse", "mobile", 9), run("checkout", "desktop", 20), run("checkout", "mobile", checkoutMobile ? 20 : 5, checkoutMobile)];
const capture = (findings, runs = journeys()) => ({ config: { site: "http://localhost:4321", viewports: ["desktop", "mobile"], providers: ["ga4", "google_ads", "meta", "tiktok"] }, runs, findings, explained: null });

/**
 * Six run folders plus a corrupt and a missing capture: the consent risk is open since the first run, the
 * duplicate flaps (gone in the second run, back in the third), the purchase problem is fixed in the fourth
 * (the third run's checkout did not finish, so it proves nothing) and the last run adds a new warning.
 */
async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "aitd-history-"));
  const save = async (id, body) => {
    const d = path.join(runsDir(dir, SITE), id);
    await mkdir(d, { recursive: true });
    if (body !== null) await writeFile(path.join(d, "capture.json"), typeof body === "string" ? body : JSON.stringify(body));
  };
  await save(ID[0], capture([...beforeConsent(), ...duplicate(), ...purchase(), ...okRows()]));
  await save(ID[1], capture([...beforeConsent(), ...purchase(), ...okRows()]));
  await save(ID[2], capture([...beforeConsent(), ...duplicate(), ...okRows()], journeys({ checkoutMobile: false })));
  await save(ID[3], capture([...beforeConsent(), ...duplicate(), ...okRows()]));
  await save(ID[4], "{ not json");
  await save(ID[5], null);
  await save(ID[6], capture([...beforeConsent(), ...duplicate(), finding("browse", "desktop", "warning", "cookie_without_consent", "tiktok", null, "A TikTok cookie was set before consent."), ...okRows()]));
  await mkdir(path.join(runsDir(dir, SITE), "notes"), { recursive: true });
  return dir;
}

const key = (severity, check, journey, viewport, platform, event) => [severity, check, journey, viewport, platform, event].join(" ");
const CONSENT = key("risk", "before_consent", "browse", "desktop", "meta", "PageView");
const DUP = key("warning", "duplicate", "checkout", "desktop", "ga4", "add_to_cart");
const PURCHASE = key("broken", "missing_params", "checkout", "mobile", "ga4", "purchase");
const NEW = key("warning", "cookie_without_consent", "browse", "desktop", "tiktok", "-");

test("the finding key is the one replay.js writes to site.json", () => {
  const findings = [...purchase(), ...duplicate(), ...okRows()];
  assert.deepEqual(findings.map(findingKey).sort(), findingKeys(findings));
  assert.equal(dateOfId("2026-10-01_0905"), "2026-10-01T09:05");
  assert.equal(dateOfId("2026-10-01_090530"), "2026-10-01T09:05");
  assert.equal(dateOfId("weird"), null);
});

test("a run summary keeps counts, journeys and problems and tolerates older shapes", () => {
  const s = runSummary(ID[0], capture([...beforeConsent(), ...duplicate(), ...purchase(), ...okRows()]));
  assert.equal(s.date, "2026-10-01T09:00");
  assert.deepEqual(s.counts, { broken: 2, risk: 1, warning: 1, info: 0, ok: 4 });
  assert.equal(s.findings.length, 10);
  assert.deepEqual(s.findings[0], { key: CONSENT, check: "before_consent", severity: "risk", platform: "meta", event: "PageView", journey: "browse", viewport: "desktop" });
  assert.deepEqual(s.journeys[3], { id: "checkout", viewport: "mobile", completed: true, hits: 20 });
  assert.equal(s.version, null);
  assert.equal(s.ai, null);
  assert.deepEqual(runSummary("x", {}), { id: "x", date: null, version: null, ai: null, journeys: [], counts: { broken: 0, risk: 0, warning: 0, info: 0, ok: 0 }, findings: [] });
  assert.deepEqual(runSummary("x", { findings: [{ severity: "odd" }, { severity: "broken" }], runs: [null, { viewport: "desktop" }] }).findings, []);
  assert.equal(runSummary("x", { version: "0.16.0", ai: { name: "p", model: "m" } }, { version: "0.9.0" }).version, "0.16.0");
  assert.equal(runSummary("x", {}, { version: "0.9.0", ai: { name: "p" } }).ai.name, "p");
});

test("loadHistory reads the newest runs oldest first and skips corrupt and missing captures", async () => {
  const dir = await fixture();
  const h = await loadHistory(dir, SITE);
  assert.deepEqual(h.map((r) => r.id), [ID[0], ID[1], ID[2], ID[3], ID[6]]);
  assert.equal(h[2].journeys.find((j) => j.id === "checkout" && j.viewport === "mobile").completed, false);
  // The limit counts folders, not readable runs: the newest three hold one capture.
  assert.deepEqual((await loadHistory(dir, SITE, { limit: 3 })).map((r) => r.id), [ID[6]]);
  assert.deepEqual((await loadHistory(dir, SITE, { limit: 4 })).map((r) => r.id), [ID[3], ID[6]]);
  assert.deepEqual(await loadHistory(dir, "https://nothing.test"), []);
  assert.deepEqual(await loadHistory(path.join(dir, "missing"), SITE), []);
});

test("the timeline tells open, fixed, flapping and new findings apart", async () => {
  const tl = findingTimeline(await loadHistory(await fixture(), SITE));
  const by = (k) => tl.find((e) => e.key === k);
  assert.equal(tl.length, 4 + 4 + 2 + 1);
  const consent = by(CONSENT);
  assert.deepEqual([consent.firstSeen, consent.lastSeen, consent.seenIn, consent.openNow, consent.openSince, consent.flapping, consent.fixedIn], [ID[0], ID[6], 5, true, ID[0], false, null]);
  const dup = by(DUP);
  assert.deepEqual([dup.firstSeen, dup.lastSeen, dup.seenIn, dup.openNow, dup.openSince, dup.flapping, dup.fixedIn], [ID[0], ID[6], 4, true, ID[2], true, null]);
  // The third run's checkout stopped early, so the purchase problem counts as fixed in the fourth run, not the third.
  const purchased = by(PURCHASE);
  assert.deepEqual([purchased.firstSeen, purchased.lastSeen, purchased.seenIn, purchased.openNow, purchased.openSince, purchased.flapping, purchased.fixedIn], [ID[0], ID[1], 2, false, null, false, ID[3]]);
  const fresh = by(NEW);
  assert.deepEqual([fresh.firstSeen, fresh.seenIn, fresh.openNow, fresh.openSince, fresh.event], [ID[6], 1, true, ID[6], null]);
  // Open ones first, the one open longest on top; fixed ones after.
  assert.deepEqual(tl.slice(0, 4).map((e) => e.check), ["before_consent", "before_consent", "before_consent", "before_consent"]);
  assert.deepEqual(tl.slice(4, 8).map((e) => e.check), ["duplicate", "duplicate", "duplicate", "duplicate"]);
  assert.equal(tl[8].key, NEW);
  assert.deepEqual(tl.slice(9).map((e) => e.openNow), [false, false]);
  assert.deepEqual(findingTimeline([]), []);
});

test("a finding without a journey (older captures) is gone when absent", () => {
  const h = [runSummary("2026-01-01_1000", { findings: [{ severity: "broken", check: "missing_event", event: "purchase" }] }), runSummary("2026-01-02_1000", { findings: [] })];
  const [e] = findingTimeline(h);
  assert.deepEqual([e.openNow, e.fixedIn, e.journey], [false, "2026-01-02_1000", null]);
});

test("the trend has a series per run and a direction from the complete runs", async () => {
  const t = trend(await loadHistory(await fixture(), SITE));
  assert.deepEqual(t.series.map((p) => [p.id, p.broken, p.risk, p.warning, p.score, p.complete]), [
    [ID[0], 2, 1, 1, 9, true],
    [ID[1], 2, 1, 0, 8, true],
    [ID[2], 0, 1, 1, 3, false],
    [ID[3], 0, 1, 1, 3, true],
    [ID[6], 0, 1, 2, 4, true],
  ]);
  assert.equal(t.series[0].date, "2026-10-01T09:00");
  assert.deepEqual([t.runs, t.first, t.last, t.direction], [5, ID[0], ID[6], "improving"]);
  // One entry per problem, with the journeys and viewports it is seen on.
  assert.deepEqual(t.openLongest.map((e) => [e.check, e.runsOpen, e.places.length]), [["before_consent", 5, 4], ["duplicate", 3, 4], ["cookie_without_consent", 1, 1]]);
  assert.deepEqual(t.openLongest[0].places[1], { journey: "browse", viewport: "mobile" });
  assert.deepEqual(t.fixedRecently.map((e) => e.key).sort(), [PURCHASE, key("broken", "missing_params", "checkout", "mobile", "meta", "Purchase")]);
  assert.deepEqual(t.newRecently.map((e) => e.key), [NEW]);
  assert.equal(t.flapping.length, 1);
  assert.deepEqual([t.flapping[0].runsOpen, t.flapping[0].places.length, t.flapping[0].openSince], [3, 4, ID[2]]);
});

test("direction rules: flat under two runs, halves under six, last three against the three before", () => {
  const at = (id, broken, complete = true) => ({ id, date: null, version: null, ai: null, journeys: [{ id: "j", viewport: "desktop", completed: complete, hits: 1 }], counts: { broken, risk: 0, warning: 0, info: 0, ok: 0 }, findings: [] });
  const ids = (n) => Array.from({ length: n }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}_1000`);
  const series = (scores, flags = []) => scores.map((s, i) => at(ids(scores.length)[i], s, flags[i] ?? true));
  assert.equal(trend([]).direction, "flat");
  assert.equal(trend(series([5])).direction, "flat");
  assert.equal(trend(series([5, 2])).direction, "improving");
  assert.equal(trend(series([2, 5])).direction, "worsening");
  assert.equal(trend(series([3, 3, 3])).direction, "flat");
  // 1 1 1 | 1 1 9: the mean of the last three is higher.
  assert.equal(trend(series([1, 1, 1, 1, 1, 9])).direction, "worsening");
  // Eight runs: only the last six count, so a bad start does not make the site look better.
  assert.equal(trend(series([9, 9, 2, 2, 2, 2, 2, 2])).direction, "flat");
  // Incomplete runs are left out: a run that stopped early is not a fix.
  assert.equal(trend(series([5, 5, 0, 5], [true, true, false, true])).direction, "flat");
  assert.deepEqual(trend([]).openLongest, []);
});

test("journey stability counts completions, the last failure and the average hits", async () => {
  const s = journeyStability(await loadHistory(await fixture(), SITE));
  assert.deepEqual(s[0], { id: "checkout", viewport: "mobile", runs: 5, completed: 4, lastFailure: ID[2], completionRate: 0.8, avgHits: 17 });
  assert.deepEqual(s.slice(1).map((j) => [j.id, j.viewport, j.completionRate, j.lastFailure, j.avgHits]), [["browse", "desktop", 1, null, 9], ["browse", "mobile", 1, null, 9], ["checkout", "desktop", 1, null, 20]]);
  assert.deepEqual(journeyStability([]), []);
});

test("summary lines read well in English and Turkish", async () => {
  const h = await loadHistory(await fixture(), SITE);
  const t = trend(h);
  const en = historySummaryLines(t, "en", journeyStability(h));
  assert.deepEqual(en, [
    "Trend over 5 runs (2026-10-01 → 2026-10-07): improving. Now 0 broken · 1 risk · 2 warning; 3 runs ago 2 broken · 1 risk · 0 warning.",
    "Open longest: Meta PageView before_consent in 4 places since 2026-10-01 (5 runs); GA4 add_to_cart duplicate in 4 places since 2026-10-03 (3 runs); TikTok cookie_without_consent since 2026-10-07 (1 run).",
    "Flapping (seen, gone, back again): GA4 add_to_cart duplicate in 4 places in 4 of 5 runs.",
    "Journeys that do not finish every time: checkout (mobile) 80%.",
  ]);
  const tr = historySummaryLines(t, "tr");
  assert.match(tr[0], /^5 çalıştırmada eğilim \(2026-10-01 → 2026-10-07\): iyileşiyor\. Şimdi 0 bozuk · 1 risk · 2 uyarı; 3 çalıştırma önce 2 bozuk/);
  assert.match(tr[1], /^En uzun süredir açık: Meta PageView before_consent 4 yerde 2026-10-01 tarihinden beri \(5 çalıştırma\)/);
  assert.equal(tr.length, 3);
  assert.match(historySummaryLines(trend([]))[0], /No saved run/);
  assert.match(historySummaryLines(trend(h.slice(0, 1)))[0], /One saved run \(2026-10-01_0900\)/);
  assert.match(historySummaryLines(trend(h.slice(0, 2)))[0], /^Trend over 2 runs .*: improving\. Now 2 broken · 1 risk · 0 warning\.$/);
  assert.match(historySummaryLines(trend(h.slice(0, 1)), "de")[0], /One saved run/);
  assert.deepEqual(historySummaryLines(t, "de"), en.slice(0, 3));
});

test("the history index is written, used instead of the captures, and pruned", async () => {
  const dir = await fixture();
  const fromDisk = await loadHistory(dir, SITE);
  for (const r of fromDisk) {
    const capture = JSON.parse(await readFile(path.join(runsDir(dir, SITE), r.id, "capture.json"), "utf8"));
    const { file, runs } = await updateHistoryIndex(dir, SITE, { id: r.id, capture, version: "0.16.0", ai: { name: "demo", model: "m" } });
    assert.equal(file, historyFile(dir, SITE));
    assert.equal(runs, fromDisk.indexOf(r) + 1);
  }
  const index = JSON.parse(await readFile(historyFile(dir, SITE), "utf8"));
  assert.equal(index.version, 1);
  assert.deepEqual(index.runs.map((r) => r.id), fromDisk.map((r) => r.id));
  assert.equal(index.runs[0].version, "0.16.0");
  assert.ok(JSON.stringify(index).length < 20000, "the index stays small");
  // Once indexed, a run's capture is not read again: breaking the capture changes nothing.
  await writeFile(path.join(runsDir(dir, SITE), ID[0], "capture.json"), "{ broken");
  const fromIndex = await loadHistory(dir, SITE);
  assert.deepEqual(fromIndex.map((r) => ({ ...r, version: null, ai: null })), fromDisk);
  assert.equal(fromIndex[0].ai.name, "demo");
  // A run folder that was deleted leaves the index on the next update; one that is not indexed is still read from disk.
  await rm(path.join(runsDir(dir, SITE), ID[1]), { recursive: true });
  await updateHistoryIndex(dir, SITE, { id: ID[6], capture: capture([...beforeConsent()]) });
  const after = JSON.parse(await readFile(historyFile(dir, SITE), "utf8"));
  assert.deepEqual(after.runs.map((r) => r.id), [ID[0], ID[2], ID[3], ID[6]]);
  assert.equal(after.runs.at(-1).findings.length, 4);
  await writeFile(historyFile(dir, SITE), "not json either");
  assert.deepEqual((await loadHistory(dir, SITE)).map((r) => r.id), [ID[2], ID[3], ID[6]]);
  await updateHistoryIndex(dir, SITE, runSummary(ID[3], capture([])));
  assert.deepEqual(JSON.parse(await readFile(historyFile(dir, SITE), "utf8")).runs.map((r) => r.id), [ID[3]]);
});
