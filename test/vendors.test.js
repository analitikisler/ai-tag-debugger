import test from "node:test";
import assert from "node:assert/strict";
import { parseTrackingRequest, providerOf, isCollectionEndpoint, PROVIDERS, VENDORS } from "../src/parsers.js";
import { redactUrl } from "../src/redact.js";
import { AuditSession } from "../src/browser.js";

test("LinkedIn Insight Tag: conversions by id, otherwise a page view", () => {
  const [conv] = parseTrackingRequest("https://px.ads.linkedin.com/collect/?pid=123&conversionId=456&fmt=js&eventId=e1&value=9.5&currency=EUR");
  assert.deepEqual({ ...conv, url: undefined }, { platform: "linkedin", name: "conversion:456", id: "123", eventId: "e1", params: { value: "9.5", currency: "EUR", event_id: "e1" }, url: undefined });
  assert.equal(parseTrackingRequest("https://px.ads.linkedin.com/collect/?pid=123&fmt=js")[0].name, "pageview");
  assert.equal(parseTrackingRequest("https://px.ads.linkedin.com/collect/?fmt=js"), null);
});

test("Microsoft Ads UET: page loads and custom events by action", () => {
  assert.equal(parseTrackingRequest("https://bat.bing.com/action/0?ti=999&evt=pageLoad&p=https%3A%2F%2Fshop.test%2F")[0].name, "pageLoad");
  const [hit] = parseTrackingRequest("https://bat.bing.com/action/0?ti=999&evt=custom&ea=purchase&ec=checkout&gv=10&gc=EUR");
  assert.equal(hit.platform, "microsoft_ads");
  assert.equal(hit.name, "purchase");
  assert.equal(hit.id, "999");
  assert.deepEqual(hit.params, { event_category: "checkout", value: "10", currency: "EUR" });
});

test("Criteo OneTag: named by its event entry, with the email hash as user data", () => {
  const url = "https://sslwidget.criteo.com/event?a=4242&v=5&p0=e%3Dexd%26site_type%3Dd&p1=e%3Dvc%26id%3DT1%26item%3Dsku1&p2=e%3Dce%26m%3Dabc";
  const [hit] = parseTrackingRequest(url);
  assert.equal(hit.platform, "criteo");
  assert.equal(hit.name, "trackTransaction");
  assert.equal(hit.id, "4242");
  assert.deepEqual(hit.params, { site_type: "d", transaction_id: "T1", items: "sku1" });
  assert.deepEqual(hit.userFields, { "ce.m": "abc" });
  const redacted = redactUrl(url);
  assert.deepEqual(redacted.fields, ["m"]);
  assert.ok(!redacted.url.includes("abc"));
  assert.equal(parseTrackingRequest("https://sslwidget.criteo.com/event?a=4242"), null);
});

test("every vendor has a label, and its hosts map back to it", () => {
  for (const v of VENDORS) assert.equal(PROVIDERS[v.key], v.label);
  assert.equal(providerOf("https://static.criteo.net/js/ld/ld.js").key, "criteo");
  assert.equal(providerOf("https://bat.bing.com/bat.js").key, "microsoft_ads");
  assert.equal(providerOf("https://snap.licdn.com/li.lms-analytics/insight.min.js").key, "linkedin");
  assert.ok(isCollectionEndpoint("https://sslwidget.criteo.com/event?a=1&p0=e%3Dvh"));
});

test("without chosen platforms, other known platforms are detected on first sight", () => {
  const auto = new AuditSession({ viewport: "desktop" });
  assert.equal(auto.checks("criteo"), true);
  assert.ok(auto.providers.includes("criteo"));
  assert.equal(auto.checks("not_a_vendor"), false);
  const chosen = new AuditSession({ viewport: "desktop", providers: ["ga4"] });
  assert.equal(chosen.checks("criteo"), false);
  assert.deepEqual(chosen.providers, ["ga4"]);
});
