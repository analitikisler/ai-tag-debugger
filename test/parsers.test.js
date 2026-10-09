import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTrackingRequest } from "../src/parsers.js";

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
  assert.equal(vendorOf("https://shop.com/app.js"), null);
});
