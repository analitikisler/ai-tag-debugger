// The Chrome extension's recording pipeline, without a browser: raw events as the service worker and the page hook
// store them, turned into the run object the CLI's checks read, then checked, rendered and exported.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { copyCore } from "../scripts/extension.js";

let run, lib, analyze, body;
before(async () => {
  // The extension imports the shared modules from extension/core/, which the copy step writes.
  await copyCore();
  lib = await import("../extension/lib/run.js");
  analyze = await import("../extension/lib/analyze.js");
  body = await import("../extension/lib/body.js");
  run = lib.buildRun(EVENTS, { site: "https://shop.example", startedAt: 1000 });
});

const GA = "https://region1.google-analytics.com/g/collect?v=2&tid=G-TEST1&cid=111.222&dl=https%3A%2F%2Fshop.example%2Fproduct";
const EVENTS = [
  { t: 1000, seq: 1, kind: "cookies", cookies: [{ name: "_ga", domain: ".shop.example", hash: "aaa" }] },
  { t: 1100, seq: 2, kind: "step", action: "navigate", url: "https://shop.example/", label: "Opened /" },
  { t: 1200, seq: 3, kind: "push", top: true, frameUrl: "https://shop.example/", entry: { url: "https://shop.example/", value: ["consent", "default", { ad_storage: "denied", analytics_storage: "denied" }] } },
  { t: 1300, seq: 4, kind: "request", requestId: "r1", method: "GET", type: "ping", frameId: 0, url: `${GA}&en=page_view` },
  { t: 1350, seq: 5, kind: "status", requestId: "r1", status: 204 },
  { t: 2000, seq: 6, kind: "step", action: "navigate", url: "https://shop.example/product", label: "Opened /product" },
  // A GA4 batch: three events in one POST body, one carrying an email address in a custom parameter.
  { t: 2100, seq: 7, kind: "request", requestId: "r2", method: "POST", type: "ping", frameId: 0, url: GA, body: "en=view_item&cu=EUR&epn.value=10\nen=scroll&epn.percent_scrolled=90\nen=sign_up&ep.contact=jane%40mail.example" },
  { t: 2150, seq: 8, kind: "status", requestId: "r2", status: 503 },
  { t: 2200, seq: 9, kind: "push", top: true, frameUrl: "https://shop.example/product", entry: { url: "https://shop.example/product", value: { event: "view_item", ecommerce: { value: 10, currency: "EUR" } } } },
  { t: 2300, seq: 10, kind: "load", top: true, frameUrl: "https://shop.example/product", entry: { src: "https://www.googletagmanager.com/gtm.js?id=GTM-ABC123", how: "parser", page: "https://shop.example/product?x=1", doc: "d1" } },
  { t: 2400, seq: 11, kind: "step", action: "manual", label: "Added to cart" },
  { t: 2500, seq: 12, kind: "cookies", cookies: [{ name: "_ga", domain: ".shop.example", hash: "bbb" }, { name: "_fbp", domain: ".shop.example", hash: "ccc" }] },
  // Not a tracking request: never recorded as a hit or a call.
  { t: 2600, seq: 13, kind: "request", requestId: "r3", method: "GET", type: "image", frameId: 0, url: "https://shop.example/logo.png" },
];

test("events become the CLI's run shape, one step per page load and named step", () => {
  // The first step's name comes from the strings (labelsFor), so a copy change there doesn't break the shape check.
  // The cookie snapshot taken as recording starts belongs to the first page, so no "before the first page" step.
  assert.deepEqual(run.steps.map((s) => s.label), ["Opened /", "Opened /product", "Added to cart"]);
  assert.deepEqual(run.steps.map((s) => s.index), [0, 1, 2]);
  for (const key of ["hits", "dataLayerLog", "network", "cookieLog", "cookieChanges", "containerLoads", "frameMessages", "providers", "pageErrors"]) assert.ok(Array.isArray(run[key]), key);
  assert.equal(run.completed, true);
  assert.equal(run.live, true, "a hand recording's hits reached the real accounts");
});

test("a GA4 batch gives one hit per event, on the step it was sent in", () => {
  assert.deepEqual(run.hits.map((h) => [h.name, h.step]), [["page_view", 0], ["view_item", 1], ["scroll", 1], ["sign_up", 1]]);
  assert.deepEqual(run.providers, ["ga4"]);
  assert.equal(run.hits[1].params.currency, "EUR");
});

test("each tracking call keeps its HTTP status, so a 503 shows as a failure", () => {
  assert.deepEqual(run.network.map((c) => [c.method, c.status, c.provider]), [["GET", 204, "ga4"], ["POST", 503, "ga4"]]);
  assert.ok(run.network[1].postData.includes("en=sign_up"));
});

test("values stay as sent in the run, with user data marked, and redactRun replaces it for exports", () => {
  const signUp = run.hits.find((h) => h.name === "sign_up");
  assert.ok(signUp.userData, "the email is marked");
  assert.ok(JSON.stringify(signUp.params).includes("jane@mail.example"), "the panel shows what was sent");
  const safe = lib.redactRun(run);
  assert.ok(!JSON.stringify(safe).includes("jane@mail.example"), "nothing leaves with the address");
  assert.ok(!JSON.stringify(safe.network).includes("jane%40mail.example"));
  // IDs are not user data: the client id stays, in the panel and in exports.
  assert.ok(safe.hits[0].url.includes("cid=111.222"));
});

test("dataLayer pushes, container loads and cookie changes are recorded like the CLI records them", () => {
  assert.deepEqual(run.dataLayerLog.map((p) => p.step), [0, 1]);
  assert.equal(run.containerLoads[0].id, "GTM-ABC123");
  assert.equal(run.containerLoads[0].page, "https://shop.example/product", "no query string");
  assert.deepEqual(run.cookieLog.map((c) => c.name), ["_ga", "_fbp"]);
  assert.deepEqual(run.cookieChanges.map((c) => `${c.name}:${c.change}`), ["_ga:added", "_ga:changed", "_fbp:added"]);
});

test("the CLI's checks run on the recording, with and without a plan", () => {
  const plan = { events: [{ platform: "ga4", name: "purchase" }, { platform: "ga4", name: "view_item", required_params: ["value", "currency"] }] };
  const withPlan = analyze.analyze(run, { plan, lang: "en" });
  assert.ok(withPlan.findings.some((f) => f.check === "missing_event" && f.event === "purchase"));
  assert.ok(withPlan.planCheck);
  const without = analyze.analyze(run, { lang: "tr" });
  assert.equal(without.planCheck, null);
  assert.ok(without.verdict.statusText && without.verdict.headline);
});

test("the report renders in English and Turkish, and an exported one carries no user data", () => {
  const opts = { plan: null, site: "https://shop.example", generatedAt: new Date("2026-11-06T12:00:00Z") };
  const local = analyze.reportHtml(run, { ...opts, lang: "en" });
  assert.match(local, /^<!doctype html>/i);
  assert.ok(local.includes("shop.example"));
  assert.ok(analyze.reportHtml(run, { ...opts, lang: "tr" }).includes('lang="tr"'));
  assert.ok(!analyze.reportHtml(run, { ...opts, lang: "en" }, { redacted: true }).includes("jane@mail.example"));
});

test("capture.json is what the CLI writes, marked as from the extension and redacted", () => {
  const capture = JSON.parse(analyze.captureJson(run, { site: "https://shop.example", lang: "en", extensionVersion: "0.1.0" }));
  assert.equal(capture.config.source, "extension");
  assert.equal(capture.config.extension_version, "0.1.0");
  assert.equal(capture.runs.length, 1);
  assert.ok(Array.isArray(capture.findings));
  assert.ok(!JSON.stringify(capture).includes("jane@mail.example"));
});

test("readPlan takes a plan's JSON and refuses anything else", () => {
  assert.deepEqual(analyze.readPlan('{"events":[{"name":"purchase"}]}').plan.events[0].name, "purchase");
  assert.equal(analyze.readPlan("not json").error, "planInvalid");
  assert.equal(analyze.readPlan('{"events":[{}]}').error, "planInvalid");
  assert.equal(analyze.readPlan("[]").error, "planInvalid");
});

test("request bodies decode from raw bytes, gzip and form data", async () => {
  const bytes = (s) => [{ bytes: new TextEncoder().encode(s).buffer }];
  assert.equal(await body.bodyText({ raw: bytes("en=page_view\nen=scroll") }), "en=page_view\nen=scroll");
  const gz = gzipSync(Buffer.from("en=add_to_cart&cu=TRY"));
  assert.equal(await body.bodyText({ raw: [{ bytes: gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.length) }] }), "en=add_to_cart&cu=TRY");
  assert.equal(await body.bodyText({ formData: { a: ["1", "2"], b: ["x y"] } }), "a=1&a=2&b=x+y");
  assert.equal(await body.bodyText(undefined), null);
  assert.equal(await body.bodyText({ error: "Unknown error." }), null);
  assert.equal((await body.bodyText({ raw: bytes("x".repeat(100)) }, 10)).length, 10);
});

test("a recording stops growing at the CLI's limits", () => {
  const many = Array.from({ length: lib.LIMITS.hits + 5 }, (_, i) => ({ t: 10 + i, seq: i, kind: "request", requestId: `q${i}`, method: "GET", frameId: 0, url: `${GA}&en=e${i}` }));
  const big = lib.buildRun(many, { site: "https://shop.example" });
  assert.equal(big.hits.length, lib.LIMITS.hits);
  assert.ok(big.pageErrors.some((e) => /Recording limit reached/.test(e.message)));
});

test("Google's container registry, read from the page, decides whether a container ran", () => {
  const load = { t: 1200, seq: 3, kind: "load", top: true, frameUrl: "https://shop.example/", entry: { src: "https://www.googletagmanager.com/gtm.js?id=GTM-RAN1", how: "parser", page: "https://shop.example/", doc: "d1" } };
  const nav = { t: 1100, seq: 2, kind: "step", action: "navigate", url: "https://shop.example/", label: "Opened /" };
  const notRun = (r) => analyze.analyze(r).findings.some((f) => f.check === "container_not_run");
  // Never read: unknown, so no finding claims the container never ran.
  const unread = lib.buildRun([nav, load], { site: "https://shop.example" });
  assert.equal(unread.containersRunning, undefined);
  assert.equal(notRun(unread), false);
  // Read and present in the registry: it ran.
  const ran = lib.buildRun([nav, load, { t: 1500, seq: 4, kind: "page", registry: ["GTM-RAN1", "G-ABC"], preloads: [], tagConsent: { entries: { ad_storage: { default: "denied" } } }, problem: null }], { site: "https://shop.example" });
  assert.deepEqual(ran.containersRunning, [{ id: "GTM-RAN1", step: 0 }, { id: "G-ABC", step: 0 }]);
  assert.equal(ran.steps[0].tagConsent.entries.ad_storage.default, "denied");
  assert.equal(notRun(ran), false);
  // Read and missing from it: it never ran, which is worth a finding.
  const missing = lib.buildRun([nav, load, { t: 1500, seq: 4, kind: "page", registry: [], preloads: [] }], { site: "https://shop.example" });
  assert.equal(notRun(missing), true);
});

test("platforms chosen before recording decide what is checked; the rest is counted, and tag managers stay", () => {
  const events = [
    { t: 1, seq: 1, kind: "step", action: "navigate", url: "https://shop.example/", label: "Opened /" },
    { t: 2, seq: 2, kind: "request", requestId: "a", method: "GET", frameId: 0, url: `${GA}&en=page_view` },
    { t: 3, seq: 3, kind: "request", requestId: "b", method: "GET", frameId: 0, url: "https://www.facebook.com/tr/?id=1&ev=PageView" },
    { t: 4, seq: 4, kind: "request", requestId: "c", method: "GET", frameId: 0, url: "https://www.googletagmanager.com/gtm.js?id=GTM-ABC123" },
  ];
  const onlyMeta = lib.buildRun(events, { site: "https://shop.example", providers: ["meta"] });
  assert.deepEqual(onlyMeta.hits.map((h) => h.platform), ["meta"]);
  assert.deepEqual(onlyMeta.providers, ["meta"]);
  assert.deepEqual(onlyMeta.skipped, { 0: { GA4: 1 } });
  assert.ok(onlyMeta.network.some((c) => c.provider === "gtm"), "the tag manager is kept");
  const all = lib.buildRun(events, { site: "https://shop.example" });
  assert.deepEqual(all.hits.map((h) => h.platform).sort(), ["ga4", "meta"]);
});

test("a planned event a hand recording never reached is unverified, not broken", () => {
  const plan = { events: [{ platform: "ga4", name: "purchase", required_params: ["transaction_id"] }] };
  const missing = analyze.analyze(run, { plan }).findings.find((f) => f.check === "missing_event" && f.event === "purchase");
  assert.equal(missing.severity, "info");
  assert.match(missing.detail, /not reached in this recording/);
});

test("a tracking request that failed on a live recording is a broken finding", () => {
  const failed = analyze.analyze(run).findings.filter((f) => f.check === "hit_failed");
  assert.equal(failed.length, 1);
  assert.equal(failed[0].severity, "broken");
  assert.match(failed[0].detail, /^1 GA4 request got HTTP 503, the first at "Opened \/product"/);
  const onlyFailed = lib.buildRun([EVENTS[1], { ...EVENTS[3], url: `${GA}&en=page_view` }, { t: 1350, seq: 5, kind: "status", requestId: "r1", status: 503 }], { site: "https://shop.example" });
  assert.match(analyze.analyze(onlyFailed).verdict.headline, /GA4 delivery is broken/);
  // The CLI's own runs answer tracking requests in the browser, so the check stays off there.
  assert.equal(analyze.analyze({ ...run, live: false }).findings.some((f) => f.check === "hit_failed"), false);
});

test("a pixel sent before the visitor accepted, in the same step, is a before-consent risk", () => {
  const events = [
    { t: 1, seq: 1, kind: "step", action: "navigate", url: "https://shop.example/", label: "Opened /" },
    { t: 2, seq: 2, kind: "push", top: true, entry: { url: "https://shop.example/", value: ["consent", "default", { ad_storage: "denied", analytics_storage: "denied" }] } },
    { t: 800, seq: 3, kind: "request", requestId: "m", method: "GET", frameId: 0, url: "https://www.facebook.com/tr/?id=1&ev=PageView" },
    { t: 6400, seq: 4, kind: "push", top: true, entry: { url: "https://shop.example/", value: ["consent", "update", { ad_storage: "granted", analytics_storage: "granted" }] } },
    { t: 7000, seq: 5, kind: "request", requestId: "m2", method: "GET", frameId: 0, url: "https://www.facebook.com/tr/?id=1&ev=ViewContent" },
  ];
  const found = analyze.analyze(lib.buildRun(events, { site: "https://shop.example" })).findings.filter((f) => f.check === "before_consent");
  assert.deepEqual(found.map((f) => f.event), ["PageView"]);
});

test("the same event sent to two Meta pixels is one send to each: no duplicate, and parity counts per pixel", () => {
  const events = [
    { t: 1, seq: 1, kind: "step", action: "navigate", url: "https://shop.example/p", label: "Opened /p" },
    { t: 10, seq: 2, kind: "request", requestId: "g", method: "GET", frameId: 0, url: `${GA}&en=add_to_cart&cu=TRY&epn.value=10` },
    { t: 20, seq: 3, kind: "request", requestId: "m1", method: "GET", frameId: 0, url: "https://www.facebook.com/tr/?id=111&ev=AddToCart&cd[value]=10&cd[currency]=TRY" },
    { t: 21, seq: 4, kind: "request", requestId: "m2", method: "GET", frameId: 0, url: "https://www.facebook.com/tr/?id=222&ev=AddToCart&cd[value]=10&cd[currency]=TRY" },
  ];
  const r = lib.buildRun(events, { site: "https://shop.example" });
  const a = analyze.analyze(r);
  assert.equal(a.findings.some((f) => f.check === "duplicate"), false);
  const shared = a.metrics.parity[0].shared.find((x) => x.event === "addtocart");
  assert.deepEqual(shared.mismatch, []);
  assert.deepEqual(shared.platforms.meta.ids, ["111", "222"]);
  // The same pixel twice is still a duplicate.
  const twice = lib.buildRun([...events.slice(0, 3), { ...events[2], seq: 5, t: 22, requestId: "m3" }], { site: "https://shop.example" });
  assert.equal(analyze.analyze(twice).findings.some((f) => f.check === "duplicate" && f.platform === "meta"), true);
});

test("steps are named after the page title, and a route change on the same path is the same step", () => {
  const events = [
    { t: 1, seq: 1, kind: "step", action: "navigate", url: "https://shop.example/", label: "Opened /" },
    { t: 5, seq: 2, kind: "page", title: "Ana Sayfa | Örnek Mobilya" },
    { t: 10, seq: 3, kind: "step", action: "route", url: "https://shop.example/masa?renk=ceviz", label: "Route /masa?…" },
    { t: 15, seq: 4, kind: "page", title: "Masalar - Örnek Mobilya" },
    // A filter that only changes the query: still the same page.
    { t: 20, seq: 5, kind: "step", action: "route", url: "https://shop.example/masa?renk=mese", label: "Route /masa?…" },
    { t: 30, seq: 6, kind: "step", action: "manual", label: "Add to cart" },
  ];
  const r = lib.buildRun(events, { site: "https://shop.example" });
  assert.deepEqual(r.steps.map((s) => s.label), ["Ana Sayfa", "Masalar", "Add to cart"]);
  assert.equal(lib.cleanTitle("Lina Yemek Masası | Örnek Mobilya"), "Lina Yemek Masası");
});

test("the cookie snapshot taken as recording starts opens no step of its own", () => {
  const r = lib.buildRun([
    { t: 1, seq: 1, kind: "cookies", cookies: [{ name: "_ga", domain: ".shop.example", hash: "a" }] },
    { t: 5, seq: 2, kind: "step", action: "navigate", url: "https://shop.example/", label: "Opened /" },
    { t: 9, seq: 3, kind: "request", requestId: "x", method: "GET", frameId: 0, url: `${GA}&en=page_view` },
  ], { site: "https://shop.example" });
  assert.deepEqual(r.steps.map((s) => s.label), ["Opened /"]);
  assert.deepEqual(r.cookieLog.map((c) => `${c.name}@${c.step}`), ["_ga@0"]);
});

test("the same GA4 client id on two page loads while analytics_storage is denied is a finding", () => {
  const page = (n, cid, gcs, p) => [
    { t: n * 1000, seq: n * 10, kind: "step", action: "navigate", url: `https://shop.example/${n}`, label: `Opened /${n}` },
    { t: n * 1000 + 100, seq: n * 10 + 1, kind: "request", requestId: `p${n}`, method: "GET", type: "ping", frameId: 0, url: `https://region1.google-analytics.com/g/collect?v=2&tid=G-TEST1&cid=${cid}&_p=${p}&gcs=${gcs}&en=page_view&dl=https%3A%2F%2Fshop.example%2F${n}` },
  ];
  const kept = lib.buildRun([...page(1, "5.6", "G100", "a"), ...page(2, "5.6", "G100", "b")], { site: "https://shop.example" });
  const f = analyze.analyze(kept, { lang: "en" }).findings.find((x) => x.check === "client_id_persisted");
  assert.ok(f, "the stored id is found");
  assert.match(f.detail, /5\.6/);
  assert.equal(f.step, "Opened /2");
  // A fresh id per page load is what a cookieless ping does; the same id once consent is granted is just a cookie.
  for (const events of [[...page(1, "5.6", "G100", "a"), ...page(2, "7.8", "G100", "b")], [...page(1, "5.6", "G111", "a"), ...page(2, "5.6", "G111", "b")]]) {
    const fine = lib.buildRun(events, { site: "https://shop.example" });
    assert.ok(!analyze.analyze(fine, { lang: "en" }).findings.some((x) => x.check === "client_id_persisted"));
  }
});
