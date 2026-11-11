import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeGcd, isCollectionEndpoint, parseTrackingRequest } from "../src/parsers.js";

test("parses a GA4 hit with ecommerce params and consent state", () => {
  const [hit] = parseTrackingRequest(
    "https://region1.google-analytics.com/g/collect?v=2&tid=G-X&en=purchase&cu=EUR&epn.value=19.9&ep.transaction_id=T1&pr1=idA~nmB&gcs=G101",
    null,
  );
  assert.equal(hit.platform, "ga4");
  assert.equal(hit.name, "purchase");
  assert.deepEqual(
    { currency: hit.params.currency, value: hit.params.value, transaction_id: hit.params.transaction_id, items: hit.params.items },
    { currency: "EUR", value: "19.9", transaction_id: "T1", items: "idA~nmB" },
  );
  assert.deepEqual(hit.consent, { ad_storage: "denied", analytics_storage: "granted" });
});

test("splits a batched GA4 POST into one hit per event", () => {
  const hits = parseTrackingRequest("https://www.google-analytics.com/g/collect?v=2&tid=G-X&cid=1", "en=page_view\nen=scroll&epn.percent_scrolled=90");
  assert.deepEqual(hits.map((h) => h.name), ["page_view", "scroll"]);
  assert.equal(hits[1].params.percent_scrolled, "90");
});

test("captures GA4 sent to a server-side GTM endpoint", () => {
  const hits = parseTrackingRequest("https://sgtm.example.com/g/collect?v=2&tid=G-X&en=page_view", null);
  assert.equal(hits[0].name, "page_view");
});

test("captures GA4 and Google Ads hits sent through Google tag gateway on the site's own domain", () => {
  const [ga4] = parseTrackingRequest("https://www.shop.co.uk/fR7vNz2w/ag/g/c?v=2&tid=G-8MZ&gtm=45g&_p=1&cid=1.2", "en=add_to_cart&cu=GBP");
  assert.deepEqual([ga4.platform, ga4.name, ga4.id, ga4.params.currency], ["ga4", "add_to_cart", "G-8MZ", "GBP"]);
  assert.equal(parseTrackingRequest("https://www.shop.co.uk/fR7vNz2w/ga/g/c?v=2&tid=G-8MZ&en=page_view", null)?.[0]?.name, "page_view");
  const [ads] = parseTrackingRequest("https://www.shop.co.uk/fR7vNz2w/as/p/c/1044474867/?random=1&cv=11&fst=1&fmt=3&label=abc&value=5", null);
  assert.deepEqual([ads.platform, ads.id, ads.name], ["google_ads", "1044474867", "conversion:abc"]);
  // Without a GA4 measurement id, a /g/c path is ordinary site traffic.
  assert.equal(parseTrackingRequest("https://www.shop.co.uk/catalog/g/c?v=2&tid=123", null), null);
});

test("parses Meta Pixel, Google Ads and TikTok hits", () => {
  const [meta] = parseTrackingRequest("https://www.facebook.com/tr/?id=1&ev=Purchase&cd[value]=10&cd[currency]=EUR", null);
  assert.deepEqual([meta.platform, meta.name, meta.params.value], ["meta", "Purchase", "10"]);

  const [ads] = parseTrackingRequest("https://www.googleadservices.com/pagead/conversion/123/?label=abc&value=10&currency_code=EUR&oid=T1", null);
  assert.deepEqual([ads.platform, ads.id, ads.params.transaction_id], ["google_ads", "123", "T1"]);

  const [tt] = parseTrackingRequest("https://analytics.tiktok.com/api/v2/pixel", JSON.stringify({ event: "CompletePayment", properties: { value: 5 } }));
  assert.deepEqual([tt.platform, tt.name, tt.params.value], ["tiktok", "CompletePayment", "5"]);
});

test("ignores unrelated requests", () => {
  assert.equal(parseTrackingRequest("https://example.com/app.js", null), null);
  assert.equal(parseTrackingRequest("data:text/plain,hi", null), null);
});

test("names analytics and ad vendors for the network timeline", async () => {
  const { vendorOf } = await import("../src/parsers.js");
  assert.equal(vendorOf("https://www.googletagmanager.com/gtm.js?id=GTM-X"), "Google Tag Manager");
  assert.equal(vendorOf("https://connect.facebook.net/en_US/fbevents.js"), "Meta");
  assert.equal(vendorOf("https://www.google.com/pagead/1p-conversion/123/"), "Google Ads");
  assert.equal(vendorOf("https://metrics.shop.com/g/collect?v=2"), "Google Analytics (server-side)");
  assert.equal(vendorOf("https://www.shop.co.uk/fR7vNz2w/?id=GTM-TBW"), "Google Tag Manager");
  assert.equal(vendorOf("https://collect.shop.app/gtm.js?id=GTM-PRK"), "Google Tag Manager");
  assert.equal(vendorOf("https://collect.shop.app/gtag/js?id=G-1234"), "Google Analytics (server-side)");
  assert.equal(vendorOf("https://shop.com/app.js"), null);
});

test("parses Pinterest, Snap, Klaviyo and Hotjar hits", () => {
  const [pin] = parseTrackingRequest('https://ct.pinterest.com/v3/?event=checkout&tid=2612&event_id=e1&ed={"value":"19.9","currency":"EUR"}&pd={"em":"abc"}', null);
  assert.deepEqual([pin.platform, pin.name, pin.id, pin.params.value, pin.params.event_id, Object.keys(pin.userFields)], ["pinterest", "checkout", "2612", "19.9", "e1", ["pd.em"]]);
  assert.equal(parseTrackingRequest("https://ct.pinterest.com/user/?tid=1", null), null);

  const [snap] = parseTrackingRequest("https://tr.snapchat.com/p", "pid=abc-1&ev=PURCHASE&pr=10&cur=EUR&u_hem=h");
  assert.deepEqual([snap.platform, snap.name, snap.id, snap.params.currency, Object.keys(snap.userFields)], ["snapchat", "PURCHASE", "abc-1", "EUR", ["u_hem"]]);

  const body = JSON.stringify({ data: { type: "event", attributes: { metric: { data: { attributes: { name: "Viewed Product" } } }, properties: { Price: 5, nested: { a: 1 } }, profile: { data: { attributes: { email: "a@b.co" } } } } } });
  const [kl] = parseTrackingRequest("https://a.klaviyo.com/client/events/?company_id=AbC123", body);
  assert.deepEqual([kl.platform, kl.name, kl.id, kl.params, Object.keys(kl.userFields)], ["klaviyo", "Viewed Product", "AbC123", { Price: "5" }, ["profile.email"]]);

  const [hj] = parseTrackingRequest("https://in.hotjar.com/api/v2/client/sites/123456/visit-data?sv=7", null);
  assert.deepEqual([hj.platform, hj.id], ["hotjar", "123456"]);
  assert.equal(parseTrackingRequest("https://static.hotjar.com/c/hotjar-123456.js?sv=7", null)[0].name, "script_load");
});

test("Meta hit carries event_id and advanced matching fields", () => {
  const [meta] = parseTrackingRequest("https://www.facebook.com/tr/?id=1&ev=Purchase&eid=ord-5&ud[em]=abc", null);
  assert.equal(meta.params.event_id, "ord-5");
  assert.deepEqual(Object.keys(meta.userFields), ["ud[em]"]);
});

test("GA4 hits carry the first_visit and session_start flags as the automatic events they stand for", () => {
  const [first] = parseTrackingRequest("https://www.google-analytics.com/g/collect?v=2&tid=G-X&en=page_view&_fv=1&_ss=1&_nsi=1");
  assert.deepEqual(first.autoEvents, ["first_visit", "session_start"]);
  const [later] = parseTrackingRequest("https://www.google-analytics.com/g/collect?v=2&tid=G-X&en=page_view");
  assert.equal(later.autoEvents, undefined);
});

test("gcd is read per signal into its default and update, and an unknown letter is kept as it is", () => {
  const all = decodeGcd("13r3r3r2r5l1");
  assert.deepEqual(all.ad_storage, { letter: "r", default: "denied", update: "granted", known: true });
  assert.deepEqual(Object.keys(all), ["ad_storage", "analytics_storage", "ad_user_data", "ad_personalization"]);
  assert.deepEqual(decodeGcd("13p3t3l2v5l1").analytics_storage, { letter: "t", default: "granted", known: true });
  assert.deepEqual(decodeGcd("13p3t3l2v5l1").ad_user_data, { letter: "l", known: true });
  assert.deepEqual(decodeGcd("13z3r3r2r5l1").ad_storage, { letter: "z", known: false });
  assert.equal(decodeGcd("G111"), null);
  assert.equal(decodeGcd(undefined), null);
});

test("Google hits take their consent from gcs and gcd and keep the protocol fields apart from the event parameters", () => {
  const [hit] = parseTrackingRequest("https://region1.google-analytics.com/g/collect?v=2&tid=G-X&cid=123.456&sid=789&sct=2&seg=1&gcs=G111&gcd=13r3r3p2r5l1&dma=1&_ss=1&en=page_view&dl=https%3A%2F%2Fshop%2F");
  // gcs decides ad_storage and analytics_storage; gcd adds the v2 signals: ad_user_data denied (p), ad_personalization granted (r).
  assert.deepEqual(hit.consent, { ad_storage: "granted", analytics_storage: "granted", ad_user_data: "denied", ad_personalization: "granted" });
  assert.deepEqual(hit.protocol, { cid: "123.456", sid: "789", sct: "2", seg: "1", gcs: "G111", gcd: "13r3r3p2r5l1", dma: "1", _ss: "1" });
  assert.equal(hit.params.cid, undefined);
  // Without gcs, gcd stands in for all four.
  const [only] = parseTrackingRequest("https://region1.google-analytics.com/g/collect?v=2&tid=G-X&gcd=13p3p3p2p5l1&en=page_view");
  assert.deepEqual(only.consent, { ad_storage: "denied", analytics_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
  // Google Ads conversions carry the same fields.
  const [ads] = parseTrackingRequest("https://www.googleadservices.com/pagead/conversion/123/?label=abc&value=10&gcs=G100&gcd=13q3q3q2q5l1&npa=1");
  assert.deepEqual(ads.consent, { ad_storage: "denied", analytics_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
  assert.deepEqual(ads.protocol, { gcs: "G100", gcd: "13q3q3q2q5l1", npa: "1" });
  const [plain] = parseTrackingRequest("https://www.googleadservices.com/pagead/conversion/123/?label=abc");
  assert.equal(plain.consent, undefined);
});

test("gcd as gtag.js sent it for each consent sequence decodes to that sequence", () => {
  // Captured from gtag.js (November 2026): a page with these consent commands, the gcd of the hit sent after them.
  const sent = {
    "13l3l3l3l1l1": [{}, {}],
    "13p3p3p3p5l1": [{ default: "denied" }, {}],
    "13t3t3t3t5l1": [{ default: "granted" }, {}],
    "13r3r3r3r5l1": [{ default: "denied" }, { update: "granted" }],
    "13q3q3q3q5l1": [{ default: "denied" }, { update: "denied" }],
    "13u3u3u3u5l1": [{ default: "granted" }, { update: "denied" }],
    "13v3v3v3v5l1": [{ default: "granted" }, { update: "granted" }],
    "13n3n3n3n5l1": [{}, { update: "granted" }],
    "13m3m3m3m5l1": [{}, { update: "denied" }],
  };
  for (const [gcd, [def, upd]] of Object.entries(sent)) {
    for (const [signal, state] of Object.entries(decodeGcd(gcd))) {
      assert.deepEqual({ default: state.default, update: state.update }, { default: def.default, update: upd.update }, `${gcd} ${signal}`);
      assert.ok(state.known);
    }
  }
  // A default of ad_storage denied, analytics_storage granted, ad_user_data denied, ad_personalization granted.
  const mixed = decodeGcd("13p3t3p3t5l1");
  assert.deepEqual(Object.fromEntries(Object.entries(mixed).map(([k, v]) => [k, v.default])), { ad_storage: "denied", analytics_storage: "granted", ad_user_data: "denied", ad_personalization: "granted" });
});

test("a GA4 batch joined with CRLF, as gtag.js sends it, leaves no carriage return in names or values", () => {
  const hits = parseTrackingRequest("https://www.google-analytics.com/g/collect?v=2&tid=G-1", "en=purchase&epn.value=10&cu=EUR\r\nen=scroll");
  assert.deepEqual(hits.map((h) => h.name), ["purchase", "scroll"]);
  assert.equal(hits[0].params.currency, "EUR");
});

test("a malformed escape in an Adobe-style path is kept as sent instead of throwing out of the request handler", () => {
  assert.equal(parseTrackingRequest("https://evil.example/b/ss/%zz/1/s1")[0].id, "%zz");
});

test("a tag's own script is read as a hit but is not a collection endpoint, so it still loads when hits are answered locally", () => {
  for (const url of ["https://static.hotjar.com/c/hotjar-123456.js?sv=7", "https://www.clarity.ms/tag/abc123"]) {
    assert.equal(parseTrackingRequest(url, null)[0].name, "script_load");
    assert.equal(isCollectionEndpoint(url), false, url);
  }
  assert.equal(isCollectionEndpoint("https://a.clarity.ms/collect"), true);
});

test("a Meta event sent in a POST body, form-encoded or as multipart form data, is read like one in the URL", () => {
  const [form] = parseTrackingRequest("https://www.facebook.com/tr/", "id=1&ev=Purchase&cd[value]=10&cd[currency]=EUR&eid=ord-9&ud[em]=abc");
  assert.deepEqual([form.name, form.id, form.params.value, form.eventId, Object.keys(form.userFields)], ["Purchase", "1", "10", "ord-9", ["ud[em]"]]);
  const part = (name, value) => `------b\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  const [multi] = parseTrackingRequest("https://www.facebook.com/tr/", `${part("id", "1")}${part("ev", "Purchase")}${part("cd[value]", "10")}------b--\r\n`);
  assert.deepEqual([multi.name, multi.id, multi.params.value], ["Purchase", "1", "10"]);
  // Still a hit without its body, so the request is answered locally either way.
  assert.equal(parseTrackingRequest("https://www.facebook.com/tr/", null)[0].name, "(unnamed)");
});
