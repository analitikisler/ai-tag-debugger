// The Coverage, Inventory and Run sections of the new HTML report (src/html/scope.js), rendered from the demo run, the
// failed run and small inline runs: structure, ids, collapsed cards, the words the 0.17 report's tests asserted, and
// both languages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { context } from "../src/html/shell.js";
import { render } from "../src/html/scope.js";
import { checkRun, planCheck } from "../src/checks.js";
import { runSummary, trend } from "../src/history.js";
import { demoCapture, failedInput, reportInput } from "./helpers/demo-capture.js";

const scope = (input) => render(context(input));
const slice = (html, id) => {
  const start = html.indexOf(`<section class="sec" id="${id}"`);
  assert.ok(start >= 0, `section ${id}`);
  return html.slice(start, html.indexOf("</section>", start));
};
const empty = { title: "t", generatedAt: "now", findings: [], explained: null, runs: [] };

test("the three sections come in rail order, each with its h2, and every card starts collapsed", () => {
  const html = scope(reportInput());
  assert.deepEqual([...html.matchAll(/<section class="sec" id="([a-z]+)" aria-labelledby="\1-h"><h2 id="\1-h">([^<]+)<\/h2>/g)].map((x) => [x[1], x[2]]), [["coverage", "Coverage"], ["inventory", "Inventory"], ["run", "Run"]]);
  assert.doesNotMatch(html, /<details[^>]*\sopen/);
  assert.doesNotMatch(html, /tabindex="0"/);
  assert.doesNotMatch(html, /<th>/, "every th has a scope");
  for (const t of html.match(/<table[^>]*>(?:<caption)?/g)) assert.match(t, /<caption/, t);
  assert.equal((html.match(/<table[^>]*>/g) ?? []).length, (html.match(/<table[^>]*><caption class="sr">/g) ?? []).length);
  // Every tab sits in a [data-tabs] box, so the shell's reveal can select it.
  const tabs = (html.match(/role="tab"/g) ?? []).length;
  assert.equal(tabs, 3 * (html.match(/<div class="tabs" data-tabs>/g) ?? []).length);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  // The changes card is Findings'; the trend only links to it.
  assert.doesNotMatch(html, /id="changes"/);
});

test("Coverage: the plan card's summary carries the answer; its matrix has one row per planned event", () => {
  const html = slice(scope(reportInput()), "coverage");
  assert.match(html, /<details class="card" id="cov-plan"><summary><span class="t">Measurement plan coverage<\/span><span class="chip chip-sev warning"><b>9<\/b> of 11<\/span><span class="chip plain mono"><b>82%<\/b><\/span><span class="chip chip-sev broken">.*2 missing params<\/span>/);
  assert.match(html, /<span class="cv-bar" role="img" aria-label="9 complete, 2 with a missing parameter, 0 not sent">(<i class="(ok|params)"><\/i>){11}<\/span>/);
  assert.match(html, /<span class="chip chip-plat ga4">.*GA4 <b>6\/7<\/b><\/span>/);
  assert.equal((html.match(/<tr id="cov-/g) ?? []).length, 11);
  // The purchase row: not expected on browse, sent on checkout desktop, params missing on checkout mobile.
  const purchase = html.match(/<tr id="cov-ga4-purchase"[^>]*>.*?<\/tr>/)[0];
  assert.match(purchase, /data-plat="ga4" data-st="params" data-text="ga4 ga4 purchase transaction_id currency value items"/);
  assert.match(purchase, /<code>transaction_id<\/code><code class="cv-miss">currency<\/code><code class="cv-miss">value<\/code><code>items<\/code>/);
  assert.match(purchase, /<td class="cv-c muted">–<span class="sr"> not expected<\/span><\/td><td class="cv-c muted">–<span class="sr"> not expected<\/span><\/td><td class="cv-c"><span class="chip chip-sev ok cv-g">.*<span class="sr"> sent<\/span><\/span><\/td><td class="cv-c"><span class="chip chip-sev broken">.*params<span class="sr"> without currency, value<\/span><\/span><\/td><\/tr>/);
  // The filter bar drives #cov-rows; its search field carries the sprite's icon, not a data URI.
  assert.match(html, /<div class="filterbar" data-filterbar="#cov-rows"><span class="fl">Platform<\/span><button type="button" data-filter="plat=ga4" aria-pressed="false" class="chip-plat ga4">/);
  assert.match(html, /data-filter="st=params"/);
  assert.match(html, /<span class="cv-search"><svg[^>]*><use href="#ui-search"\/><\/svg><input type="search" data-filter-search placeholder="Search events" aria-label="Search events"><\/span>/);
  assert.match(html, /<th scope="col" class="cv-c"><a href="#j3" class="cv-run"><span class="chip chip-vp mobile">.*checkout<span class="sr"> · mobile<\/span><\/span><\/a><\/th>/);
  // Conversion integrity: two of four purchases pass.
  assert.match(html, /<details class="card" id="cov-conversion"><summary><span class="t">Conversion integrity<\/span><span class="chip chip-sev warning">.*<b>2<\/b> of 4 pass<\/span><span class="chip chip-sev broken">.*2 fail<\/span><\/summary>/);
  assert.match(html, /2 of 4 purchases pass every check\./);
  assert.match(html, /<th scope="col" class="cv-c">Not duplicated<\/th>/);
  assert.doesNotMatch(html, /id="plan-vs-site"/);
});

test("Coverage without a plan says so; a provider that was not checked is marked on its row", () => {
  assert.match(slice(scope({ ...reportInput(), plan: null, metrics: undefined }), "coverage"), /No measurement plan was given/);
  const plan = { events: [{ platform: "GA4", name: "add_to_cart" }, { platform: "tiktok", name: "AddToCart" }] };
  const run = { journeyId: "j", viewport: "desktop", completed: true, steps: [{ index: 0, label: "start" }, { index: 1, label: "go" }], dataLayerLog: [], providers: ["ga4"], hits: [{ platform: "ga4", name: "add_to_cart", step: 1, params: {}, url: "https://x/" }] };
  const html = slice(scope({ ...empty, runs: [run], plan }), "coverage");
  assert.match(html, /<tr id="cov-tiktok-addtocart" data-plat="tiktok" data-st="na"[^>]*><th scope="row"><span class="cv-ev">.*<code>AddToCart<\/code><span class="badge">not checked<\/span><\/span><\/th>/);
  assert.match(html, /<tr id="cov-ga4-add_to_cart" data-plat="ga4" data-st="ok"/);
});

test("Plan vs site appears only with a plan check, with its buckets and the plan's changes", () => {
  const plan = { events: [{ platform: "GA4", name: "add_to_cart", journeys: ["cart"], required_params: ["currency"] }, { platform: "ga4", name: "sign_up", journeys: ["signup"] }] };
  const runs = [{ journeyId: "cart", viewport: "desktop", completed: true, steps: [{ index: 0, label: "start" }, { index: 1, label: "go" }], consentStep: null, dataLayerLog: [], providers: ["ga4"], hits: [{ platform: "ga4", name: "add_to_cart", step: 1, params: {}, url: "https://x/" }] }];
  const findings = runs.flatMap((r) => checkRun(plan, r));
  const planChanges = { previous: "2026-10-01_0900", same: false, added: [{ platform: "ga4", event: "sign_up" }], removed: [], changed: [{ platform: "ga4", event: "add_to_cart", what: ["required parameters"] }] };
  const input = { ...empty, findings, runs, plan, against: "p1", planCheck: planCheck(plan, runs, findings), planChanges };
  const html = scope(input);
  const card = html.match(/<details class="card" id="plan-vs-site">.*?<\/details>/s)[0];
  assert.match(card, /<summary><span class="t">Plan vs\. site<\/span>/);
  assert.match(card, /Missing params <b>1<\/b>/);
  assert.match(card, /<strong>Coverage 0 of 1 \(0%\)/);
  assert.match(card, /<h3 class="pv-h">Plan changes<\/h3><p class="xs">Plan changed since 2026-10-01_0900: 1 added, 0 removed, 1 changed<\/p>/);
  assert.match(card, /<li>\+ GA4 sign_up<\/li><li>~ GA4 add_to_cart: required parameters<\/li>/);
  // Run names the plan it checked against, escaped, and links the change line to the card.
  assert.match(slice(scope({ ...input, against: "<x>" }), "run"), /Checked against plan &lt;x&gt;/);
  assert.match(slice(html, "run"), /<a href="#plan-vs-site">Plan changed since 2026-10-01_0900: 1 added, 0 removed, 1 changed<\/a>/);
  assert.doesNotMatch(scope({ ...input, planCheck: null }), /plan-vs-site/);
  assert.match(slice(scope({ ...empty, against: "2026-10-02_0900", planChanges }), "run"), /Plan changed since 2026-10-01_0900/);
});

test("Inventory: one line per platform checked or seen, seen ones open to hosts, pages and cookies", () => {
  const html = slice(scope(reportInput()), "inventory");
  assert.match(html, /<ul class="inv-rows" aria-label="Tag inventory">/);
  assert.deepEqual([...html.matchAll(/id="(inv-[a-z0-9_]+)" data-seen="(yes|no)"/g)].map((x) => `${x[1]}:${x[2]}`), ["inv-ga4:yes", "inv-google_ads:no", "inv-meta:yes", "inv-tiktok:no"]);
  assert.match(html, /<details class="card inv" id="inv-ga4" data-seen="yes"><summary><span class="chip chip-plat ga4">.*GA4<\/span><span class="chip chip-sev ok">.*Seen<\/span><span class="inv-m"><b>36<\/b> requests<\/span><span class="inv-m"><b>5<\/b> pages<\/span><span class="inv-m zero"><b>0<\/b> cookies<\/span><\/summary>/);
  assert.match(html, /<div class="card inv-line" id="inv-google_ads" data-seen="no">.*<span class="badge sev-info"><svg[^>]*><use href="#sev-info"\/><\/svg>Checked, not seen<\/span><\/div>/);
  assert.match(html, /<div role="tabpanel" id="inv-meta-hosts" data-label="Hosts"><ul class="inv-list"><li><code>www\.facebook\.com<\/code><span class="inv-n"><b>22<\/b> requests<\/span><span class="chip plain">Third party<\/span>/);
  assert.match(html, /Checked but never seen: Google Ads, TikTok\./);
  // No vendor name on a platform line.
  assert.doesNotMatch(html.match(/<summary>.*?<\/summary>/)[0], /Google Analytics/);
});

test("Inventory ties first-party hosts and cookies to their platform and counts out-of-scope vendors", () => {
  const call = (vendor, provider, url, pageUrl) => ({ vendor, provider, url, pageUrl, step: 1, t: 1, type: "image" });
  const run = {
    journeyId: "j", viewport: "desktop", completed: true, note: "", steps: [{ index: 0, label: "start", t: 0 }, { index: 1, label: "Home", t: 1 }],
    hits: [], dataLayerLog: [], startedAt: 0, providers: [], skipped: { 1: { "Microsoft Clarity": 3, DoubleClick: 1 } },
    network: [
      call("Meta", "meta", "https://www.facebook.com/tr/?ev=PageView", "https://www.shop.com.tr/"),
      call("Google Analytics (server-side)", "ga4", "https://metrics.shop.com.tr/g/collect?v=2", "https://www.shop.com.tr/"),
    ],
    cookieLog: [{ name: "_fbp", domain: ".shop.com.tr", step: 1 }, { name: "sessionid", domain: "www.shop.com.tr", step: 1 }],
  };
  const html = scope({ ...empty, runs: [run] });
  const inv = slice(html, "inventory");
  assert.match(inv, /Tag inventory/);
  assert.match(inv, /<code>metrics\.shop\.com\.tr<\/code><span class="inv-n"><b>1<\/b> request<\/span><span class="chip plain">First party<\/span>/);
  assert.match(inv, /<div role="tabpanel" id="inv-meta-cookies" data-label="Cookies"><ul class="inv-list"><li><code>_fbp<\/code><\/li><\/ul><\/div>/);
  assert.match(inv, /<span class="inv-m"><b>1<\/b> cookie<\/span>/);
  assert.match(inv, /Other cookies: <code>sessionid<\/code> <span class="muted">\(First party\)<\/span>/);
  assert.match(inv, /<details class="card inv" id="inv-out-of-scope"><summary><span class="t">Out of scope<\/span><span class="chip plain"><b>4<\/b> requests<\/span>/);
  assert.match(inv, /<li><span>Microsoft Clarity<\/span><span class="badge">Out of scope<\/span><span class="inv-n"><b>3<\/b> requests<\/span><\/li>/);
  assert.match(slice(html, "run"), /4 out-of-scope requests were skipped: Microsoft Clarity, DoubleClick\./);
  assert.match(slice(scope(empty), "inventory"), /No vendor requests were recorded\./);
});

test("Run: the facts grid, run chips with their durations, and the Timing card", () => {
  const html = slice(scope(reportInput()), "run");
  assert.match(html, /<dl class="run-facts"><div><dt>Site<\/dt><dd><span class="chip plain mono"><b>localhost<\/b><\/span><\/dd><\/div>/);
  assert.match(html, /<dt>Version<\/dt><dd><code>\d+\.\d+\.\d+/);
  assert.match(html, /<dt>AI<\/dt><dd><span class="chip plain">.*Off<\/span>/);
  assert.match(html, /<dt>Platforms<\/dt><dd><span class="chip chip-plat ga4">.*<span class="chip chip-plat google_ads">.*<span class="chip chip-plat meta">.*<span class="chip chip-plat tiktok">/);
  assert.match(html, /<dt>Plan<\/dt><dd><span class="chip plain">11 events<\/span><span class="chip plain">Consent Mode<\/span><\/dd>/);
  assert.match(html, /<dt>Consent<\/dt><dd><span class="chip plain">banner<\/span><span class="chip plain">3 scenarios<\/span><\/dd>/);
  assert.match(html, /<a href="#j3" class="chip chip-run completed">.*checkout .*mobile <b>6\.6 s<\/b><\/a><span class="xs muted">4 runs, all completed<\/span>/);
  assert.match(html, /<div class="wide"><dt>Files<\/dt><dd><code class="file">.*report\.md<\/code>/);
  assert.match(html, /<details class="card" id="run-timing"><summary><span class="t">Timing<\/span><span class="chip plain mono">.*<b>18\.5<\/b> s<\/span><span class="chip plain">first hit <b>50–63<\/b> ms<\/span><\/summary>/);
  assert.match(html, /<th scope="col" class="num">Median first hit<\/th>/);
  assert.doesNotMatch(html, /id="trend"/);
});

test("Run: the Trend card appears only with two or more saved runs and links the open problems to their cards", () => {
  const cap = demoCapture();
  const history = ["2026-10-01_0900", "2026-10-02_0900", "2026-10-03_0900"].map((id, i) => runSummary(id, { runs: cap.runs.map((r) => ({ ...r, completed: i === 1 ? r.viewport === "desktop" : true })), findings: i === 0 ? cap.findings.filter((f) => f.check !== "duplicate") : cap.findings }));
  const changes = { previous: "2026-10-02_0900", mode: "findings", fixed: [], new: [{ platform: "ga4", event: "add_to_cart", check: "duplicate", detail: "twice" }], routes: [] };
  const html = slice(scope(reportInput({ trend: trend(history), changes })), "run");
  assert.match(html, /<details class="card" id="trend"><summary><span class="t">Trend<\/span><span class="chip chip-sev broken">.*Getting worse<\/span><span class="xs muted">over 3 runs, 2026-10-01 to 2026-10-03<\/span><\/summary>/);
  assert.match(html, /<svg class="spark" viewBox="0 0 280 64"[^>]*role="img" aria-label="Broken: 2, 2, 2; Risk: 1, 1, 1; Warning: 0, 1, 1">/);
  assert.match(html, /<circle class="sev-broken hollow"/);
  assert.match(html, /<strong>Getting worse<\/strong> <span class="muted">over 3 runs, 2026-10-01 to 2026-10-03<\/span>/);
  assert.match(html, /<a href="#changes"><strong>1 new problem<\/strong><\/a>/);
  assert.match(html, /a journey did not finish/);
  assert.match(html, /<h3 class="tr-h">Open longest<\/h3><ul class="tr-list"><li><span class="badge sev-broken">.*<a href="#f-ga4-purchase-missing_params">/);
  assert.match(html, /open since 2026-10-01 · 3 runs · 1 place/);
  assert.doesNotMatch(scope(reportInput({ trend: trend(history.slice(0, 1)) })), /id="trend"/);
  // Every value from history.json and the timing goes through esc, numbers included.
  const t = trend(history);
  t.series = t.series.map((p) => ({ ...p, broken: "<b>2</b>", score: "<i>9</i>" }));
  const input = reportInput({ trend: t });
  input.metrics = { ...input.metrics, timing: input.metrics.timing.map((r) => ({ ...r, slowest: [{ ...r.slowest[0], step: "<u>4</u>" }] })) };
  const odd = slice(scope(input), "run");
  assert.doesNotMatch(odd, /<b>2<\/b>|<i>9<\/i>|<u>4<\/u>/);
  assert.match(odd, /&lt;b&gt;2&lt;\/b&gt;/);
  assert.match(odd, /&lt;i&gt;9&lt;\/i&gt;/);
  assert.match(odd, /&lt;u&gt;4&lt;\/u&gt;/);
});

test("the failed run and an empty report render every section", () => {
  const html = scope(failedInput());
  assert.match(slice(html, "coverage"), /<span class="chip chip-sev broken"><b>0<\/b> of 11<\/span>/);
  assert.match(slice(html, "coverage"), /11 not sent/);
  assert.doesNotMatch(html, /id="cov-conversion"/);
  assert.equal((slice(html, "inventory").match(/data-seen="no"/g) ?? []).length, 4);
  assert.equal((slice(html, "run").match(/class="chip chip-run incomplete"/g) ?? []).length, 4);
  assert.match(slice(html, "run"), /0 of 4 runs completed/);
  const none = scope(empty);
  for (const id of ["coverage", "inventory", "run"]) assert.ok(slice(none, id));
  assert.doesNotMatch(none, /id="run-timing"/);
});

test("Turkish: every word of the three sections comes from the tr strings", () => {
  const html = scope(reportInput({ lang: "tr" }));
  assert.match(html, /<h2 id="coverage-h">Kapsam<\/h2>/);
  assert.match(html, /<b>9<\/b> olaydan 11|11 olaydan <b>9<\/b>/);
  assert.match(html, /2 olayda eksik parametre/);
  assert.match(html, /placeholder="Olay ara"/);
  assert.match(html, /<b>2<\/b> geçti|4 satın almadan <b>2<\/b> geçti/);
  assert.match(html, /aria-label="Etiket envanteri"/);
  assert.match(html, /Kontrol edildi, görülmedi/);
  assert.match(html, /<b>36<\/b> istek/);
  assert.match(html, /<dt>Oluşturulma<\/dt>/);
  assert.match(html, /<dt>Sürüm<\/dt>|<dt>[^<]+<\/dt><dd><code>\d/);
  assert.match(html, /ilk istek <b>50–63<\/b> ms/);
  for (const en of ["Search events", "missing params", "Seen<", "Generated", "first hit", "Needs<", "None seen"]) assert.ok(!html.includes(en), en);
});
