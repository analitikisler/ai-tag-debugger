// The side panel's model (extension/panel/model.js): steps and rows from a recording's events, batches, consent
// changes, the plan check per hit, which hits a push fired, and the Consent tab's verdict per platform.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { copyCore } from "../scripts/extension.js";

let M;
before(async () => {
  await copyCore();
  M = await import("../extension/panel/model.js");
});

const GA = "https://region1.google-analytics.com/g/collect?v=2&tid=G-TEST1&cid=111.222&_fv=1&_ss=1&dl=https%3A%2F%2Fshop.example%2F";
const PR = encodeURIComponent("idSKU1~nmMasa~pr18499~qt1~brOrnek~caMobilya~c2Masalar~vaCeviz~k0finish~v0mat");
const PR2 = encodeURIComponent("idSKU2~nmSandalye~pr6299~qt2");
const EVENTS = [
  { t: 100, seq: 1, kind: "step", action: "navigate", url: "https://shop.example/", label: "Opened /" },
  { t: 101, seq: 2, kind: "doc", url: "https://shop.example/", status: 200 },
  { t: 110, seq: 3, kind: "push", entry: { value: ["consent", "default", { ad_storage: "denied", analytics_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", security_storage: "granted" }] } },
  { t: 120, seq: 4, kind: "cookies", cookies: [{ name: "_fbp", domain: ".shop.example", hash: "a" }] },
  { t: 200, seq: 5, kind: "request", requestId: "g1", method: "GET", url: `${GA}&en=page_view&gcs=G100` },
  { t: 210, seq: 6, kind: "request", requestId: "m1", method: "GET", url: "https://www.facebook.com/tr/?id=1&ev=PageView" },
  { t: 220, seq: 7, kind: "request", requestId: "c1", method: "GET", url: "https://pagead2.googlesyndication.com/ccm/collect?en=page_view&gcs=G100" },
  { t: 900, seq: 8, kind: "push", entry: { value: ["consent", "update", { ad_storage: "granted", analytics_storage: "granted", ad_user_data: "granted", ad_personalization: "granted" }] } },
  { t: 950, seq: 9, kind: "page", title: "Ornek Mobilya" },
  { t: 1000, seq: 10, kind: "step", action: "manual", label: "Add to cart" },
  { t: 1100, seq: 11, kind: "push", entry: { value: { event: "add_to_cart", ecommerce: { value: 31097, currency: "TRY" } } } },
  // A batch: add_to_cart (value one lira off the items' total) and an automatic user_engagement.
  { t: 1200, seq: 12, kind: "request", requestId: "g2", method: "POST", url: `${GA}&gcs=G111`, body: `en=add_to_cart&cu=TRY&epn.value=31096&pr1=${PR}&pr2=${PR2}\nen=user_engagement&_et=500` },
  { t: 1210, seq: 13, kind: "status", requestId: "g2", status: 204 },
  { t: 1300, seq: 14, kind: "cookies", cookies: [{ name: "_fbp", domain: ".shop.example", hash: "a" }, { name: "_ga", domain: ".shop.example", hash: "b" }] },
];

test("steps, rows and batches come out in the order they happened", () => {
  const m = M.buildModel(EVENTS);
  assert.deepEqual(m.steps.map((s) => [s.label, s.docStatus, s.title]), [["Opened /", 200, "Ornek Mobilya"], ["Add to cart", null, null]]);
  const hits = m.rows.filter((r) => r.kind === "hit");
  assert.deepEqual(hits.map((r) => `${r.platform}:${r.name}@${r.step}`), ["ga4:page_view@0", "meta:PageView@0", "ga4:add_to_cart@1", "ga4:user_engagement@1"]);
  const [, , add, ue] = hits;
  assert.deepEqual(add.batch, { index: 1, size: 2 });
  assert.equal(ue.auto, true);
  assert.deepEqual(hits[0].flags, ["_fv", "_ss"]);
  assert.equal(add.status, 204);
  // The consent ping is kept apart as another request, labelled with its real vendor, not AdSense.
  const ping = m.rows.find((r) => r.kind === "call");
  assert.equal(ping.vendor, "Google Ads");
  assert.equal(ping.en, "page_view");
  assert.deepEqual(m.counts, { ga4: 3, meta: 1 });
});

test("a hit's items are decoded with every field, and value is checked against their total", () => {
  const add = M.buildModel(EVENTS).rows.find((r) => r.name === "add_to_cart");
  assert.equal(add.items[0].item_brand, "Ornek");
  assert.equal(add.items[0].item_category2, "Masalar");
  assert.deepEqual(add.items[0].custom, [["finish", "mat"]]);
  assert.equal(M.itemsTotal(add.items), 31097);
  assert.equal(add.check.state, "warning");
  assert.deepEqual(add.check.problems, [{ kind: "valueTotal", value: 31096, total: 31097 }]);
  // The wire keys stay as sent, for the label-over-key display.
  assert.ok(add.wire.some(([k, v]) => k === "epn.value" && v === "31096"));
  assert.ok(add.wire.some(([k]) => k === "cu"));
});

test("with a plan, a missing required parameter breaks the hit; a planned hit with everything matches", () => {
  const plan = { events: [{ platform: "ga4", name: "add_to_cart", required_params: ["currency", "value", "items", "coupon"] }, { platform: "ga4", name: "page_view" }] };
  const m = M.buildModel(EVENTS, { plan });
  const add = m.rows.find((r) => r.name === "add_to_cart");
  assert.equal(add.check.state, "broken");
  assert.ok(add.check.problems.some((p) => p.kind === "missing" && p.param === "coupon"));
  assert.deepEqual(m.rows.find((r) => r.name === "page_view").check, { state: "ok", problems: [], planned: true });
});

test("consent commands become dividers in the stream, and each hit knows the state it was sent under", () => {
  const m = M.buildModel(EVENTS);
  assert.deepEqual(m.consent.map((c) => `${c.mode}:${c.summary}@${c.step}`), ["default:denied@0", "update:granted@0"]);
  assert.ok(m.steps[0].entries.some((e) => e.kind === "consent"));
  assert.equal(m.rows.find((r) => r.name === "PageView").consentAt.ad_storage, "denied");
  assert.equal(m.rows.find((r) => r.name === "add_to_cart").consentAt.ad_storage, "granted");
  assert.equal(M.consentSummary({ ad_storage: "denied", analytics_storage: "granted" }), "partly");
});

test("a push links to the hit it fired by name and time", () => {
  const m = M.buildModel(EVENTS);
  const push = m.pushes.find((p) => p.name === "add_to_cart");
  assert.deepEqual(push.fired.map((f) => `${f.platform}:${f.name}:${f.same}`), ["ga4:add_to_cart:true"]);
  assert.equal(m.rows.find((r) => r.name === "add_to_cart").push, push.key);
});

test("the Consent tab says Meta ignored the denied default, GA4 sent only cookieless pings, and which cookies came first", () => {
  const report = M.consentReport(M.buildModel(EVENTS));
  assert.equal(report.default.summary, "denied");
  assert.equal(report.grantAt.t, 900);
  const by = Object.fromEntries(report.platforms.map((p) => [p.platform, p]));
  assert.equal(by.meta.verdict, "violated");
  assert.equal(by.ga4.verdict, "respected");
  assert.equal(by.ga4.cookieless, 1);
  assert.deepEqual(report.cookiesBefore.map((c) => c.name), ["_fbp"]);
  assert.deepEqual(report.cookiesAfter.map((c) => c.name), ["_ga"]);
});

test("platforms left out in setup are recorded but marked, and without consent commands nothing is judged", () => {
  const m = M.buildModel(EVENTS, { platforms: ["meta"] });
  assert.deepEqual(m.rows.filter((r) => r.kind === "hit" && r.selected).map((r) => r.platform), ["meta"]);
  const none = M.consentReport(M.buildModel(EVENTS.filter((e) => e.kind !== "push")));
  assert.ok(none.platforms.every((p) => p.verdict === "unknown"));
});

// Server-side tagging: the same property sent through a first-party server container and, once, straight to Google.
const SS = "https://metrics.shop.example/g/collect?v=2&tid=G-TEST1&cid=1.2&gtm=45je5";
const SERVER_EVENTS = [
  { t: 100, seq: 1, kind: "step", action: "navigate", url: "https://shop.example/", label: "Opened /" },
  { t: 150, seq: 2, kind: "request", requestId: "d1", method: "GET", initiator: "https://shop.example", url: `${GA}&en=page_view&gcs=G100` },
  { t: 200, seq: 3, kind: "push", entry: { value: ["config", "G-TEST1", { server_container_url: "https://metrics.shop.example" }] } },
  { t: 300, seq: 4, kind: "request", requestId: "s1", method: "GET", initiator: "https://shop.example", url: `${SS}&en=view_item&gcs=G111` },
  { t: 320, seq: 5, kind: "request", requestId: "s2", method: "GET", initiator: "https://shop.example", url: `${SS}&en=scroll` },
  { t: 400, seq: 6, kind: "request", requestId: "w1", method: "GET", initiator: "https://shop.example", url: "https://shop.example/metrics/g/c?v=2&tid=G-OTHER&en=page_view" },
  { t: 450, seq: 7, kind: "request", requestId: "k1", method: "GET", initiator: "https://shop.example", url: "https://metrics.shop.example/_/set_cookie?val=x" },
  { t: 500, seq: 8, kind: "cookies", cookies: [{ name: "FPID", domain: ".shop.example", hash: "a", httpOnly: true, expirationDate: 1 }] },
  { t: 600, seq: 9, kind: "request", requestId: "m1", method: "GET", url: "https://www.facebook.com/tr/?id=1&ev=PageView&eid=e1" },
];

test("each Google hit gets its route and endpoint kind, and a direct hit for a served property is a leak", () => {
  const m = M.buildModel(SERVER_EVENTS);
  const by = (name, id) => m.rows.find((r) => r.name === name && r.hit?.id === id);
  assert.equal(by("view_item", "G-TEST1").route.kind, "sgtm");
  assert.equal(by("view_item", "G-TEST1").route.firstParty, true);
  assert.deepEqual(by("view_item", "G-TEST1").endpoint, { kind: "server" });
  assert.equal(by("page_view", "G-TEST1").route.kind, "direct");
  assert.deepEqual(by("page_view", "G-TEST1").endpoint, { kind: "regular" });
  assert.equal(by("page_view", "G-OTHER").route.kind, "gateway");
  assert.equal(by("page_view", "G-OTHER").endpoint.kind, "gateway");
  assert.equal(m.rows.find((r) => r.platform === "meta").route, null);
  // The cookie call is named for what it is, not mistaken for an event.
  assert.equal(m.rows.find((r) => r.kind === "call").callKind, "setCookie");
});

test("the Where hits go card groups hosts, finds the config that set the route, the leak and the server cookie", () => {
  const routes = M.routesOf(M.buildModel(SERVER_EVENTS));
  assert.equal(routes.leaks, 1);
  const server = routes.blocks.find((b) => b.host === "metrics.shop.example");
  assert.equal(server.hits, 2);
  assert.equal(server.config.key, "server_container_url");
  assert.equal(server.noConsent, 1, "the scroll hit carried no gcs");
  assert.deepEqual(server.cookies.map((c) => [c.name, c.httpOnly]), [["FPID", true]]);
  const leak = routes.blocks.find((b) => b.kind === "direct");
  assert.equal(leak.beforeConfig, true);
  assert.equal(routes.vendor.meta, 1);
  assert.equal(routes.vendor.metaWithoutEventId, 0);
  assert.equal(M.routesOf(M.buildModel(EVENTS)), null, "no server route, no card");
});

test("search ignores case and accents and says which field matched; item gaps name the fields others carry", () => {
  const add = M.buildModel(EVENTS).rows.find((r) => r.name === "add_to_cart");
  assert.equal(M.matchRow(add, "ADD_TO"), "");
  assert.equal(M.matchRow(add, "sandalye"), "item_name");
  assert.equal(M.matchRow(add, "masa"), "item_name");
  assert.equal(M.matchRow(add, "nothing-like-it"), null);
  assert.equal(M.fold("Kasım İNDİRİMİ"), "kasim indirimi");
  const gaps = M.itemGaps(add.items);
  assert.equal(gaps[0], null);
  assert.deepEqual(gaps[1].missing.sort(), ["item_brand", "item_category", "item_category2", "item_variant"]);
  assert.equal(gaps[1].from, 0);
});

test("user properties are read from the request, and a changed one is pointed at", () => {
  const evs = [
    { t: 1, seq: 1, kind: "step", action: "navigate", url: "https://shop.example/", label: "Opened /" },
    { t: 2, seq: 2, kind: "request", requestId: "a", method: "GET", url: `${GA}&en=page_view&up.user_type=guest` },
    { t: 3, seq: 3, kind: "step", action: "manual", label: "Login" },
    { t: 4, seq: 4, kind: "request", requestId: "b", method: "GET", url: `${GA}&en=login&uid=u-48213&up.user_type=premium&upn.orders=3` },
  ];
  const [first, second] = M.buildModel(evs).rows;
  assert.deepEqual(first.userProps, [["up.user_type", "guest"]]);
  assert.deepEqual(second.userProps.map(([k]) => k), ["uid", "up.user_type", "upn.orders"]);
  assert.deepEqual(second.propChanges, { "up.user_type": { was: "guest", step: 0 } });
});

test("a hit on a later page is not before consent because the page re-pushed a denied default", () => {
  const later = [
    ...EVENTS,
    { t: 2000, seq: 20, kind: "step", action: "navigate", url: "https://shop.example/cart", label: "Opened /cart" },
    { t: 2001, seq: 21, kind: "push", entry: { value: ["consent", "default", { ad_storage: "denied", analytics_storage: "denied" }] } },
    { t: 2010, seq: 22, kind: "request", requestId: "m9", method: "GET", url: "https://www.facebook.com/tr/?id=1&ev=PageView" },
    { t: 2200, seq: 23, kind: "push", entry: { value: ["consent", "update", { ad_storage: "granted", analytics_storage: "granted" }] } },
  ];
  const m = M.buildModel(later);
  const [first, second] = m.rows.filter((r) => r.name === "PageView");
  assert.equal(first.beforeGrant, true);
  assert.equal(second.beforeGrant, false);
  assert.equal(M.consentReport(m).platforms.find((p) => p.platform === "meta").violations.length, 1);
});

test("platforms that send to several IDs are listed, so rows can say which pixel each hit went to", () => {
  const m = M.buildModel([
    { t: 1, seq: 1, kind: "step", action: "navigate", url: "https://shop.example/", label: "Opened /" },
    { t: 2, seq: 2, kind: "request", requestId: "a", method: "GET", url: "https://www.facebook.com/tr/?id=111&ev=PageView" },
    { t: 3, seq: 3, kind: "request", requestId: "b", method: "GET", url: "https://www.facebook.com/tr/?id=222&ev=PageView" },
    { t: 4, seq: 4, kind: "request", requestId: "c", method: "GET", url: `${GA}&en=page_view` },
  ]);
  assert.deepEqual(m.multiId, { meta: ["111", "222"] });
});

test("the Consent tab says GA4 kept its client id when a denied hit's cid comes back on the next page load", () => {
  const ga = (cid, p) => `https://region1.google-analytics.com/g/collect?v=2&tid=G-TEST1&cid=${cid}&_p=${p}&gcs=G100&en=page_view`;
  const events = (cid2) => [
    { t: 100, seq: 1, kind: "step", action: "navigate", url: "https://shop.example/", label: "Opened /" },
    { t: 110, seq: 2, kind: "push", entry: { value: ["consent", "default", { ad_storage: "denied", analytics_storage: "denied" }] } },
    { t: 200, seq: 3, kind: "request", requestId: "a", method: "GET", url: ga("1.1", "x") },
    { t: 1000, seq: 4, kind: "step", action: "navigate", url: "https://shop.example/cart", label: "Opened /cart" },
    { t: 1100, seq: 5, kind: "request", requestId: "b", method: "GET", url: ga(cid2, "y") },
  ];
  const ga4 = M.consentReport(M.buildModel(events("1.1"))).platforms.find((p) => p.platform === "ga4");
  assert.equal(ga4.verdict, "violated");
  assert.deepEqual([ga4.persisted.cid, ga4.persisted.pages, ga4.persisted.row.key], ["1.1", 2, "b:0"]);
  const fresh = M.consentReport(M.buildModel(events("2.2"))).platforms.find((p) => p.platform === "ga4");
  assert.equal(fresh.verdict, "respected");
  assert.equal(fresh.persisted, null);
});
