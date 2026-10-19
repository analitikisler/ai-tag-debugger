// The new report's Findings section (src/html/findings.js): the filter bar and its counts, the Failed, Unverified and
// Passed groups, the card ids the other sections link to, each tab's product data (evidence, GTM tags, fix, where,
// verify), accepted rows, the "Changed since last run" card and the failed run, in English and Turkish.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { render } from "../src/html/findings.js";
import { context, renderHtml } from "../src/html/shell.js";
import { demoCapture, failedInput, reportInput } from "./helpers/demo-capture.js";

const section = (input) => render(context(input));
const demo = section(reportInput());
/** The markup of one card or line row, from its opening tag to the next row. */
const rowOf = (html, id) => {
  const start = html.indexOf(` id="${id}"`);
  assert.ok(start > 0, id);
  const next = html.slice(start + 1).search(/<(details class="card|div class="card line) /);
  return next < 0 ? html.slice(start) : html.slice(start, start + 1 + next);
};
const DEMO_IDS = ["f-ga4-purchase-missing_params", "f-meta-purchase-missing_params", "f-meta-pageview-before_consent", "f-ga4-add_to_cart-duplicate"];

test("the section is the filter bar, then Failed and Passed, every card collapsed with the shared ids", () => {
  assert.match(demo, /^<section class="sec fnd" id="findings" aria-labelledby="findings-h"><h2 id="findings-h">Findings<\/h2>/);
  const ids = [...demo.matchAll(/<details class="card sev-([a-z]+)" id="([^"]+)"/g)].map((x) => x[2]);
  assert.deepEqual(ids, DEMO_IDS);
  assert.deepEqual([...context(reportInput()).ids.values()], ids, "the ids are the context's, in row order");
  assert.equal(new Set(ids).size, ids.length);
  // Attribute values are dropped first: a row's data-text may say "open".
  for (const tag of demo.match(/<details class="card[^>]*>/g)) assert.doesNotMatch(tag.replace(/"[^"]*"/g, '""'), /\sopen[\s>]/, "every card starts collapsed");
  assert.deepEqual([...demo.matchAll(/<div class="card line sev-ok" id="(f-ok-\d)"/g)].map((x) => x[1]), ["f-ok-1", "f-ok-2", "f-ok-3", "f-ok-4", "f-ok-5"]);
  // Group counts come from the tally the rail and the Summary read; no Unverified group without info rows.
  assert.match(demo, /<div class="group" id="f-failed" data-filter-group><h3><span class="chip lg chip-group failed"><b data-group-count>4<\/b> Failed<\/span><\/h3>/);
  assert.match(demo, /<details class="group" id="f-passed" data-filter-group><summary><h3><span class="chip lg chip-group passed"><b data-group-count>5<\/b> Passed<\/span><\/h3><\/summary>/);
  assert.doesNotMatch(demo, /f-unverified/);
  assert.ok(demo.indexOf('id="f-failed"') < demo.indexOf('id="f-passed"'));
  assert.match(demo, /<p class="fnd-empty muted" data-filter-empty hidden>.*No finding matches these filters\.<\/p>/);
  // Tabs inside [data-tabs], panels named for the no-JS layout, no focus order in the static HTML, every table named.
  assert.equal((demo.match(/role="tab"/g) ?? []).length, (demo.match(/role="tabpanel"/g) ?? []).length);
  assert.equal((demo.match(/<div class="tabs" data-tabs>/g) ?? []).length, 4);
  assert.doesNotMatch(demo, /tabindex|role="note"|<th>|<h5|<h6/);
  for (const t of demo.match(/<table[^>]*>/g)) assert.match(t, /aria-label="/);
});

test("the filter bar counts each chip alone, keeps zero severities disabled and shows n of m", () => {
  const bar = demo.slice(demo.indexOf('<div class="filterbar"'), demo.indexOf('<div class="fnd-list"'));
  assert.match(bar, /<div class="filterbar" data-filterbar="#f-list" role="group" aria-label="Filter findings">/);
  const chips = Object.fromEntries([...bar.matchAll(/data-filter="([a-z]+=[a-z0-9_-]+)"[^>]*>.*?<span class="n">(\d+)<\/span>/g)].map((x) => [x[1], +x[2]]));
  assert.deepEqual(chips, { "sev=broken": 2, "sev=risk": 1, "sev=warning": 1, "sev=info": 0, "sev=ok": 5, "owner=developer": 2, "owner=gtm": 2, "plat=ga4": 5, "plat=meta": 4, "journey=browse": 5, "journey=checkout": 9, "vp=desktop": 7, "vp=mobile": 7 });
  assert.match(bar, /data-filter="sev=info" aria-pressed="false" class="chip-sev info zero" disabled>/);
  assert.doesNotMatch(bar, /owner=marketing/, "an owner with nothing is not offered");
  assert.match(bar, /<label class="fb-search"><svg class="ic" width="14" height="14" aria-hidden="true"><use href="#ui-search"\/><\/svg><input type="search" data-filter-search placeholder="Search" aria-label="Search findings: event, parameter, page"><\/label>/);
  assert.match(bar, /<button type="button" class="fb-clear" data-filter-clear>Clear<\/button>/);
  assert.match(bar, /<input type="checkbox" class="fb-fold" aria-label="Filters" data-label="Filters" aria-controls="fb-groups">/);
  assert.match(bar, /<p data-filter-count aria-live="polite">9 of 9<\/p>/);
  // Rows carry space-separated tokens; a row on every run names both journeys and both viewports.
  assert.match(rowOf(demo, DEMO_IDS[0]), /data-sev="broken" data-owner="developer" data-plat="ga4" data-journey="checkout" data-vp="mobile" data-text="purchase was sent without value and currency /);
  assert.match(rowOf(demo, DEMO_IDS[2]), /data-sev="risk" data-owner="gtm" data-plat="meta" data-journey="browse checkout" data-vp="desktop mobile"/);
  assert.match(rowOf(demo, "f-ok-2"), /data-sev="ok" data-owner="" data-plat="ga4 meta" data-journey="browse checkout" data-vp="desktop mobile"/);
  assert.match(rowOf(demo, "f-ok-4"), /data-plat="ga4" data-journey="checkout" data-vp="desktop"/);
  for (const t of demo.matchAll(/data-text="([^"]*)"/g)) assert.equal(t[1], t[1].toLowerCase());
});

test("a failed card: one summary line, then evidence, fix, where and verify from the capture", () => {
  const card = rowOf(demo, "f-ga4-purchase-missing_params");
  const summary = card.slice(0, card.indexOf("</summary>"));
  assert.match(summary, /<span class="badge sev-broken"><svg[^>]*><use href="#sev-broken"\/><\/svg>Broken<\/span><span class="f-t"><code>purchase<\/code> was sent without <code>value<\/code> and <code>currency<\/code><\/span>/);
  assert.match(summary, /<span class="c-owner"><span class="chip chip-owner developer"><span class="dot"><\/span>Developer<\/span><\/span>/);
  assert.match(summary, /<span class="c-plat"><span class="chip chip-plat ga4"><svg[^>]*><use href="#p-ga4"\/><\/svg>GA4<\/span><\/span>/);
  assert.match(summary, /<span class="c-where"><span class="chip chip-vp mobile"><svg[^>]*><use href="#ui-mobile"\/><\/svg>checkout · mobile<\/span><\/span>/);
  assert.match(card, /data-print-open/);
  // The four tabs, Evidence selected, panels named <card id>-ev|fix|where|verify.
  assert.deepEqual([...card.matchAll(/role="tab" aria-controls="([^"]+)" aria-selected="(true|false)">([^<]+)/g)].map((x) => [x[1], x[2], x[3].trim()]), [
    ["f-ga4-purchase-missing_params-ev", "true", "Evidence"], ["f-ga4-purchase-missing_params-fix", "false", "Fix"], ["f-ga4-purchase-missing_params-where", "false", "Where"], ["f-ga4-purchase-missing_params-verify", "false", "How to verify"],
  ]);
  assert.match(card, /aria-selected="false">Where <span class="n">1<\/span><\/button>/);
  // Evidence: the consequence, the captured parameters and the plan's missing ones, the run where it was fine, the push.
  assert.match(card, /<p class="fnd-impact"><svg[^>]*><use href="#ui-impact"\/><\/svg><span>The event is counted but its required details are missing/);
  assert.match(card, /<th scope="row">transaction_id<\/th><td>T1792401171936<\/td>/);
  assert.match(card, /<th scope="row">currency<\/th><td><span class="chip chip-sev broken">missing<\/span><\/td><\/tr><tr><th scope="row">value<\/th><td><span class="chip chip-sev broken">missing<\/span><\/td>/);
  assert.match(card, /<a class="chip chip-sev ok" href="#j2"><svg[^>]*><use href="#sev-ok"\/><\/svg>Fine on checkout · desktop: 19\.9 EUR<\/a>/);
  assert.match(card, /<p class="fnd-line">The dataLayer push already lacks <code>value<\/code> and <code>currency<\/code>\.<\/p><details class="fnd-raw"><summary>dataLayer push<\/summary><pre>\{/);
  // Fix: the check's fix, the owner, and no model in this run.
  assert.match(card, /<p class="fnd-fix"><span>Add the missing parameters to the dataLayer push[^<]*<\/span><span class="chip chip-owner developer">/);
  assert.match(card, /<p class="fnd-ai muted">No model explanation in this run\.<\/p>/);
  assert.doesNotMatch(card, /--no-ai/);
  // Where: the run chip links the hit Journeys numbers, with the step, its title and page, then the replay recipe.
  assert.match(card, /<a class="chip chip-vp mobile" href="#j3-s11-h0"><svg[^>]*><use href="#ui-mobile"\/><\/svg>checkout · mobile<\/a><span class="fnd-step"><span class="muted">step 11 ·<\/span> Place the order <span class="muted">· <code>\/thanks\.html<\/code><\/span><\/span>/);
  assert.match(card, /<h4 class="fnd-h">Replay<\/h4><ol class="fnd-recipe"><li><code>goto \/<\/code><\/li><li><code>click #consent-accept<\/code><\/li>/);
  assert.equal((card.match(/<ol class="fnd-recipe">.*?<\/ol>/s)[0].match(/<li>/g) ?? []).length, 11);
  // Verify: at most three tools, each opening in a new tab and saying so.
  assert.match(card, /<a href="https:\/\/tagassistant\.google\.com\/" target="_blank" rel="noopener noreferrer">Tag Assistant<svg[^>]*><use href="#ui-external"\/><\/svg><span class="sr"> \(opens in a new tab\)<\/span><\/a>/);
  assert.match(card, /GA4 DebugView/);
});

test("other checks read their own evidence: the request and consent of a pixel, sends per action, the Reject all scenario", () => {
  const meta = rowOf(demo, "f-meta-pageview-before_consent");
  assert.match(meta, /<span class="f-t"><code>PageView<\/code> was sent before the consent choice<\/span>/);
  assert.match(meta, /<span class="chip plain" title="browse · desktop, browse · mobile, checkout · desktop, checkout · mobile">all 4 runs<\/span>/);
  assert.match(meta, /<th scope="row">Request<\/th><td><span class="mono">www\.facebook\.com\/tr\/<\/span> · \+\d+\.\d s<\/td>/);
  assert.match(meta, /<th scope="row">Consent<\/th><td><span class="chip chip-consent none">no signal<\/span>/);
  assert.match(meta, /<th scope="row">Reject all<\/th><td><span class="chip chip-sev risk">.*still sent<\/span> <a href="#consent-scenarios">Consent scenarios<\/a>/);
  // The check's full sentence stays in the card when the title is shorter.
  assert.match(meta, /<p class="fnd-detail">Meta <code>PageView<\/code> was sent before the visitor made a consent choice\./);
  assert.deepEqual([...meta.matchAll(/<a class="chip chip-vp [a-z]+" href="#(j\d-s\d+-h\d+)">/g)].map((x) => x[1]).length, 4);
  assert.match(meta, /Meta Test Events/);
  const dup = rowOf(demo, "f-ga4-add_to_cart-duplicate");
  assert.match(dup, /<code>add_to_cart<\/code> was sent 2 times per action/);
  assert.match(dup, /<th scope="row">GA4<\/th><td>2 times per action<\/td><\/tr><tr><th scope="row">Meta<\/th><td>1 time per action<\/td>/);
  assert.match(dup, /<span class="muted">step 4 ·<\/span> Add to cart/);
});

test("the model's explanation fills the impact and adds the cause and fix steps under Fix, with only ** and ` as HTML", () => {
  const explained = { summary: null, explanations: [{ finding: 0, impact: "No revenue for `purchase` <b>now</b>.", likely_cause: "The push lacks **2** fields.", fix_steps: ["Add `value`.", "[link](https://evil.example)"] }] };
  const card = rowOf(section(reportInput({ explained })), "f-ga4-purchase-missing_params");
  assert.match(card, /<p class="fnd-impact"><svg[^>]*><use href="#ui-impact"\/><\/svg><span>No revenue for <code>purchase<\/code> &lt;b&gt;now&lt;\/b&gt;\.<\/span><\/p>/);
  assert.match(card, /<div class="fnd-ai"><p class="fnd-ai-h"><svg[^>]*><use href="#ui-ai"\/><\/svg>The model&#39;s explanation<\/p><p><span class="muted">Likely cause:<\/span> The push lacks <strong>2<\/strong> fields\.<\/p><ol class="fix-steps"><li><span>Add <code>value<\/code>\.<\/span><\/li><li><span>\[link\]\(https:\/\/evil\.example\)<\/span><\/li><\/ol><\/div>/);
  assert.doesNotMatch(card, /No model explanation/);
  // An older explanation's single fix string is one step.
  const old = section(reportInput({ explained: { summary: "x", explanations: [{ finding: 0, likely_cause: "c", fix: "Do this." }] } }));
  assert.match(rowOf(old, "f-ga4-purchase-missing_params"), /<ol class="fix-steps"><li><span>Do this\.<\/span><\/li><\/ol>/);
});

test("an accepted row keeps its place with a muted Accepted badge and the baseline note; mixed places are not accepted", () => {
  const { findings } = demoCapture();
  const accepted = section(reportInput({ findings: findings.map((f) => (f.check === "duplicate" ? { ...f, accepted: true } : f)) }));
  const row = rowOf(accepted, "f-ga4-add_to_cart-duplicate");
  assert.match(row, / data-accepted>/);
  assert.match(row, /2 times per action <span class="badge">Accepted<\/span><\/span><span class="c-owner">/);
  assert.equal((accepted.match(/<span class="badge">Accepted<\/span><\/span>/g) ?? []).length, 1);
  assert.match(row, /<p class="note xs"><span class="badge"><svg[^>]*><use href="#sev-ok"\/><\/svg>Accepted<\/span> This finding is in the baseline/);
  // The group count is the tally's, which leaves accepted rows out; so do the chips and "n of m", as Summary and the rail do.
  assert.match(accepted, /<b data-group-count>3<\/b> Failed/);
  assert.match(accepted, /data-filter="sev=warning" aria-pressed="false" class="chip-sev warning">[^]*?<span class="n">0<\/span>/);
  assert.match(accepted, /data-filter="sev=broken" aria-pressed="false" class="chip-sev broken">[^]*?<span class="n">2<\/span>/);
  assert.match(accepted, /<p data-filter-count aria-live="polite">8 of 8<\/p>/);
  assert.doesNotMatch(demo, /Accepted|data-accepted/);
  let first = true;
  const mixed = section(reportInput({ findings: findings.map((f) => (f.check === "duplicate" && first ? ((first = false), { ...f, accepted: true }) : f)) }));
  assert.doesNotMatch(mixed, /Accepted/);
});

test("GTM tags and why each did or did not fire sit under Evidence; a step without a page reads as unknown", () => {
  const f = { journey: "checkout", viewport: "desktop", severity: "broken", check: "missing_event", platform: "tiktok", event: "purchase", step: "Pay", detail: 'TikTok "purchase" was not sent on this journey.' };
  const gtm = [
    { name: "TikTok purchase", paused: false, consent: [], triggers: [{ name: "CE - purchase", event: "purchase" }], blocking: [{ name: "Test orders" }], evaluation: { fired: false, why: 'blocked by exception trigger "Test orders"' } },
    { name: "Old tag", paused: true, consent: ["ad_storage"], triggers: [], blocking: [] },
  ];
  const input = { title: "t", generatedAt: "now", findings: [{ ...f, gtm }], explained: null, runs: [] };
  const html = section(input);
  assert.match(html, /class="xs gtm-why">Tag &quot;TikTok purchase&quot;: did not fire — blocked by exception trigger &quot;Test orders&quot;/);
  assert.match(html, /<h4 class="fnd-h"><svg[^>]*><use href="#ui-gtm"\/><\/svg>In your GTM container<\/h4><table class="fnd-kv gtm-tags" aria-label="In your GTM container">/);
  assert.match(html, /Fires on CE - purchase <span class="muted">\(purchase\)<\/span><div class="muted xs">Blocked by Test orders/);
  assert.match(html, /<th scope="row">Old tag<div class="muted xs">Paused · Needs consent: ad_storage<\/div><\/th><td><span class="chip chip-sev broken">No firing trigger<\/span>/);
  assert.match(html, /<th scope="row">TikTok request<\/th><td><span class="chip chip-sev broken">missing<\/span>/);
  assert.match(html, /<code>purchase<\/code> was not sent/);
  assert.match(section({ ...input, findings: [{ ...f, gtm: [] }] }), /No tag in the container export sends this event\./);
  assert.match(section({ ...input, lang: "tr" }), /&quot;TikTok purchase&quot; etiketi: tetiklenmedi — blocked by exception trigger/);
  // The page of a step the capture does not know.
  const run = { journeyId: "checkout", viewport: "desktop", startedAt: 0, completed: true, steps: [{ index: 0, label: "start", t: 0 }, { index: 1, label: "Pay", t: 1000 }], hits: [], dataLayerLog: [] };
  assert.match(section({ ...input, runs: [run] }), /<a class="chip chip-vp desktop" href="#j0-s1">.*<span class="muted">step 1 ·<\/span> Pay <span class="muted">· page: unknown<\/span>/);
});

test("Changed since last run is a collapsed card between the filter bar and the groups, only with a comparison", () => {
  const changes = { previous: "2026-10-18_0900", mode: "findings", fixed: [{ platform: "ga4", event: "view_item", check: "missing_params", detail: "gone" }], new: [{ platform: "ga4", event: "add_to_cart", check: "duplicate", detail: "twice" }], routes: [{ journeyId: "checkout", viewport: "mobile", before: ["Open"], after: ["Open", "Pay"] }] };
  const html = section(reportInput({ changes }));
  const card = html.slice(html.indexOf('id="changes"'), html.indexOf('<div class="fnd-list"'));
  assert.ok(html.indexOf('<div class="filterbar"') < html.indexOf('id="changes"'));
  assert.match(html, /<details class="card fnd-changes" id="changes"><summary><h3 class="t">Changed since last run<\/h3><span class="end muted">1 problem fixed, 1 new problem<\/span><\/summary>/);
  assert.match(card, /Compared with run 2026-10-18_0900, by health findings/);
  assert.match(card, /<span class="badge sev-ok">.*Fixed<\/span> GA4 view_item \(gone\)/);
  assert.match(card, /<span class="badge sev-broken">.*New<\/span> <a href="#f-ga4-add_to_cart-duplicate">GA4 add_to_cart \(twice\)<\/a>/);
  assert.match(card, /checkout \(mobile\): Open ⇒ Open → Pay/);
  assert.match(section(reportInput({ changes: { previous: null, mode: "findings", fixed: [], new: [], routes: [] } })), /<h3 class="t">Changed since last run<\/h3><\/summary><div class="body"><p class="muted">This is the first saved run for this site/);
  assert.doesNotMatch(demo, /id="changes"/);
  // With no runs, as test/changes.test.js renders it.
  const bare = section({ title: "t", generatedAt: "g", findings: [], explained: null, runs: [], changes: { ...changes, fixed: changes.fixed, new: changes.new } });
  assert.match(bare, /Changed since last run/);
  assert.match(bare, /1 problem fixed, 1 new problem/);
  assert.match(section({ ...reportInput({ changes, lang: "tr" }) }), /Son çalıştırmadan bu yana değişenler/);
});

test("the failed run: two Failed cards and eleven single-line Unverified rows linking to coverage, nothing Passed", () => {
  const html = section(failedInput());
  assert.deepEqual([...html.matchAll(/<details class="card sev-([a-z]+)" id="([^"]+)"/g)].map((x) => `${x[1]} ${x[2]}`), ["risk f-site-consent_default_missing", "warning f-site-journey_incomplete"]);
  assert.match(html, /<b data-group-count>2<\/b> Failed/);
  assert.match(html, /<details class="group" id="f-unverified" data-filter-group><summary><h3><span class="chip lg chip-group unverified"><b data-group-count>11<\/b> Unverified/);
  const lines = [...html.matchAll(/<div class="card line sev-info" id="([^"]+)"/g)].map((x) => x[1]);
  assert.equal(lines.length, 11);
  assert.ok(lines.every((id) => /^f-(ga4|meta)-[a-z_]+-missing_event$/.test(id)));
  assert.match(rowOf(html, "f-ga4-purchase-missing_event"), /<span class="f-t"><code>purchase<\/code> <span class="muted">· not reached<\/span><\/span>.*<span class="chip plain run-multi" title="checkout · desktop, checkout · mobile">.*checkout<\/span>.*<a class="go" href="#cov-ga4-purchase" aria-label="Show where">/s);
  assert.doesNotMatch(html, /id="f-passed"|f-ok-/);
  assert.match(html, /<p data-filter-count aria-live="polite">13 of 13<\/p>/);
  // A row without a platform has no platform token and no platform chip.
  const consent = rowOf(html, "f-site-consent_default_missing");
  assert.match(consent, /data-plat="" /);
  assert.match(consent, /<span class="f-t">No Consent Mode default was set<\/span>.*<span class="c-plat"><\/span>/);
  assert.match(consent, /<th scope="row">Consent Mode<\/th><td>default in 0 of 4 runs<\/td>/);
  const stop = rowOf(html, "f-site-journey_incomplete");
  assert.match(stop, /<span class="f-t">The journey stopped at step 1<\/span>/);
  assert.match(stop, /<th scope="row">Stopped at<\/th><td>step 1 · Open \/<\/td><\/tr><tr><th scope="row">Error<\/th><td><code>page\.goto: net::ERR_CONNECTION_REFUSED/);
  assert.match(stop, /<a class="chip chip-vp desktop" href="#j0">/);
});

test("nothing failed: the Failed group says so and the Passed group, open, is what was checked; an empty report renders", () => {
  const { findings } = demoCapture();
  const pass = section(reportInput({ findings: findings.filter((f) => f.severity === "ok") }));
  assert.match(pass, /<b data-group-count>0<\/b> Failed<\/span><\/h3><p class="fnd-none muted"><svg[^>]*><use href="#sev-ok"\/><\/svg>No problems found\.<\/p>/);
  assert.match(pass, /<details class="group" id="f-passed" data-filter-group open><summary><h3><span class="chip lg chip-group passed"><b data-group-count>5<\/b> What was checked<\/span>/);
  const empty = section({ title: "t", generatedAt: "now", findings: [], explained: null, runs: [] });
  assert.match(empty, /What was checked: Nothing was verified in this run\./);
  assert.match(empty, /<p data-filter-count aria-live="polite">0 of 0<\/p>/);
});

test("Turkish: every word of the section comes from the tr strings", () => {
  const tr = section(reportInput({ lang: "tr" }));
  assert.match(tr, /<h2 id="findings-h">Bulgular<\/h2>/);
  for (const word of ["Önem", "Sorumlu", "Yolculuk", "Görünüm", "Bulguları filtrele", "placeholder=\"Ara\"", "Temizle", "9 / 9 gösteriliyor", "Başarısız", "Geçti", "Kanıt", "Çözüm", "Nerede", "Nasıl doğrulanır", "Yazılımcı", "4 çalıştırmanın hepsi", "Yeniden oynatma", "işlem başına 2 kez", "Bu çalıştırmada model açıklaması yok.", "yeni sekmede açılır", "Bu filtrelere uyan bulgu yok."]) assert.ok(tr.includes(word), word);
  assert.match(tr, /<code>purchase<\/code> olayı <code>value<\/code> ve <code>currency<\/code> olmadan gönderildi/);
  assert.match(tr, /<code>PageView<\/code> onay seçiminden önce gönderildi/);
  for (const word of [">Failed<", ">Passed<", ">Evidence<", "How to verify", "Fine on", "Show where", "Replay", "per action", "No finding matches"]) assert.ok(!tr.includes(word), word);
  const failed = section(failedInput({ lang: "tr" }));
  assert.match(failed, /Doğrulanmadı/);
  assert.match(failed, /· ulaşılmadı/);
  assert.match(failed, /Yolculuk 1\. adımda durdu/);
});

test("in the page: the section measures at most 700 px with rows closed, filters work, a deep link opens its tab", async (t) => {
  let browser;
  try { browser = await chromium.launch(); } catch { return t.skip("Chromium is not installed"); }
  const dir = mkdtempSync(path.join(tmpdir(), "aitd-findings-"));
  try {
    const file = path.join(dir, "report.html");
    writeFileSync(file, renderHtml(reportInput()));
    const errors = [];
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`file://${file}#findings`);
    const closed = await page.evaluate(() => Math.round(document.querySelector("#findings").getBoundingClientRect().height));
    assert.ok(closed <= 700, `${closed} px`);
    await page.click('[data-filter="sev=ok"]');
    const ok = await page.evaluate(() => ({ count: document.querySelector("#findings p[data-filter-count]").textContent, passedOpen: document.querySelector("#f-passed").open, failedHidden: document.querySelector("#f-failed").hidden, hash: location.hash }));
    assert.deepEqual(ok, { count: "5 of 9", passedOpen: true, failedHidden: true, hash: "#findings?sev=ok" });
    await page.fill("[data-filter-search]", "no such thing");
    await page.waitForFunction(() => !document.querySelector("#findings [data-filter-empty]").hidden);
    await page.goto(`file://${file}#f-ga4-add_to_cart-duplicate-where`);
    await page.waitForTimeout(100);
    const deep = await page.evaluate(() => ({ open: document.querySelector("#f-ga4-add_to_cart-duplicate").open, panel: !document.querySelector("#f-ga4-add_to_cart-duplicate-where").hidden, ev: document.querySelector("#f-ga4-add_to_cart-duplicate-ev").hidden }));
    assert.deepEqual(deep, { open: true, panel: true, ev: true });
    const narrow = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await narrow.goto(`file://${file}#f-ga4-purchase-missing_params`);
    assert.equal(await narrow.evaluate(() => document.documentElement.scrollWidth), 390);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("in the page: a filter that matches only accepted rows shows them in an open group, and every count leaves them out", async (t) => {
  let browser;
  try { browser = await chromium.launch(); } catch { return t.skip("Chromium is not installed"); }
  const dir = mkdtempSync(path.join(tmpdir(), "aitd-findings-"));
  try {
    const file = path.join(dir, "report.html");
    const { findings } = demoCapture();
    writeFileSync(file, renderHtml(reportInput({ findings: findings.map((f) => (f.platform === "ga4" && f.check === "missing_params" ? { ...f, accepted: true } : f)) })));
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const state = () => page.evaluate(() => ({
      count: document.querySelector("#findings p[data-filter-count]").textContent,
      broken: document.querySelector('[data-filter="sev=broken"] .n').textContent,
      failedHidden: document.querySelector("#f-failed").hidden,
      groupCount: document.querySelector("#f-failed [data-group-count]").textContent,
      rowHidden: document.querySelector("#f-ga4-purchase-missing_params").hidden,
      empty: !document.querySelector("#findings [data-filter-empty]").hidden,
    }));
    await page.goto(`file://${file}#findings`);
    assert.deepEqual(await state(), { count: "8 of 8", broken: "1", failedHidden: false, groupCount: "3", rowHidden: false, empty: false });
    await page.goto(`file://${file}#findings?sev=broken&plat=ga4`);
    await page.waitForFunction(() => document.querySelector('[data-filter="plat=ga4"]').getAttribute("aria-pressed") === "true");
    assert.deepEqual(await state(), { count: "0 of 8", broken: "1", failedHidden: false, groupCount: "0", rowHidden: false, empty: false });
    await page.fill("[data-filter-search]", "no such thing");
    await page.waitForFunction(() => !document.querySelector("#findings [data-filter-empty]").hidden);
    assert.equal(await page.evaluate(() => document.querySelector("#f-failed").hidden), true);
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
