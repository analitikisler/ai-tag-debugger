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

test("Adobe Analytics: page views and links by report suite, on Adobe or first-party hosts", () => {
  const [view] = parseTrackingRequest("https://metrics.shop.test/b/ss/shopprod,shopglobal/1/JS-2.22.0/s123?pageName=Home&events=event1&g=https%3A%2F%2Fshop.test%2F");
  assert.deepEqual({ ...view, url: undefined }, { platform: "adobe", name: "pageView", id: "shopprod,shopglobal", params: { page_title: "Home", events: "event1", page_location: "https://shop.test/" }, url: undefined });
  const [buy] = parseTrackingRequest("https://shop.sc.omtrdc.net/b/ss/shopprod/1/JS-2.22.0/s9?events=purchase&purchaseID=T1&products=%3Bsku1%3B1%3B10&cc=EUR");
  assert.deepEqual(buy.params, { events: "purchase", items: ";sku1;1;10", transaction_id: "T1", currency: "EUR" });
  assert.equal(parseTrackingRequest("https://shop.sc.omtrdc.net/b/ss/shopprod/1/s9?pe=lnk_o&pev2=Signup")[0].name, "link:Signup");
  assert.equal(parseTrackingRequest("https://shop.test/b/other"), null);
  assert.equal(providerOf("https://metrics.shop.test/b/ss/x/1/s1").key, "adobe");
  assert.equal(providerOf("https://shop.sc.omtrdc.net/id?d_visid_ver=1").key, "adobe");
});

test("Matomo and Piwik PRO: events, goals, orders and batches by site id", () => {
  const [ev] = parseTrackingRequest("https://stats.shop.test/matomo.php?idsite=3&rec=1&e_c=Video&e_a=Play&e_n=intro&uid=a%40b.co");
  assert.equal(ev.platform, "matomo");
  assert.equal(ev.name, "Video:Play");
  assert.equal(ev.id, "3");
  assert.deepEqual(ev.userFields, { uid: "a@b.co" });
  assert.equal(parseTrackingRequest("https://stats.shop.test/piwik.php?idsite=3&idgoal=2&revenue=5")[0].name, "goal:2");
  const [order] = parseTrackingRequest("https://stats.shop.test/matomo.php?idsite=3&idgoal=0&ec_id=T1&revenue=20");
  assert.deepEqual({ name: order.name, params: order.params }, { name: "ecommerce_order", params: { value: "20", transaction_id: "T1" } });
  assert.equal(parseTrackingRequest("https://stats.shop.test/matomo.php?rec=1"), null);
  const batch = parseTrackingRequest("https://stats.shop.test/matomo.php?idsite=3", JSON.stringify({ requests: ["?idsite=3&action_name=Home", "?idsite=3&search=shoes"] }));
  assert.deepEqual(batch.map((h) => h.name), ["pageview", "site_search"]);
  const [ppms] = parseTrackingRequest("https://shop.containers.piwik.pro/ppms.php?idsite=0a1b2c&e_c=cta&e_a=click");
  assert.equal(ppms.platform, "piwik_pro");
  assert.equal(ppms.name, "cta:click");
  assert.equal(providerOf("https://shop.containers.piwik.pro/ppms.php?idsite=1").key, "piwik_pro");
  assert.equal(providerOf("https://shop.containers.piwik.pro/shop/consent.js").key, "consent");
  assert.ok(isCollectionEndpoint("https://stats.shop.test/matomo.php?idsite=3"));
});

test("Clarity and Hotjar: tag loads name the project or site", () => {
  assert.deepEqual(parseTrackingRequest("https://www.clarity.ms/tag/abc123xyz")[0].id, "abc123xyz");
  assert.equal(parseTrackingRequest("https://k.clarity.ms/collect")[0].name, "collect");
  assert.equal(parseTrackingRequest("https://www.clarity.ms/s/0.8/clarity.js"), null);
  const [load] = parseTrackingRequest("https://static.hotjar.com/c/hotjar-12345.js?sv=6");
  assert.deepEqual({ name: load.name, id: load.id }, { name: "script_load", id: "12345" });
});
