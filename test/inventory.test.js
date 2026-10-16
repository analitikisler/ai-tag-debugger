import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInventory } from "../src/inventory.js";
import { renderHtml, renderMarkdown } from "../src/report.js";

const call = (vendor, provider, url, pageUrl) => ({ vendor, provider, url, pageUrl, step: 1, t: 1 });
const run = {
  journeyId: "j", viewport: "desktop", completed: true, note: "", steps: [{ index: 0, label: "start", t: 0 }, { index: 1, label: "Home", t: 1 }],
  hits: [], dataLayerLog: [], startedAt: 0, providers: [],
  network: [
    call("Meta", "meta", "https://www.facebook.com/tr/?ev=PageView", "https://www.shop.com.tr/"),
    call("Meta", "meta", "https://www.facebook.com/tr/?ev=PageView", "https://www.shop.com.tr/cart"),
    call("Google Analytics (server-side)", "ga4", "https://metrics.shop.com.tr/g/collect?v=2", "https://www.shop.com.tr/"),
    call("Google Analytics", "ga4", "https://www.google-analytics.com/g/collect?v=2", "https://www.shop.com.tr/"),
  ],
  cookieLog: [
    { name: "_fbp", domain: ".shop.com.tr", step: 1 },
    { name: "_ga", domain: ".shop.com.tr", step: 1 },
    { name: "sessionid", domain: "www.shop.com.tr", step: 1 },
    { name: "tracker", domain: ".ads.example.net", step: 1 },
  ],
};

test("the inventory tells first-party from third-party vendors and ties cookies to them", () => {
  const inv = buildInventory([run]);
  const by = Object.fromEntries(inv.vendors.map((v) => [v.vendor, v]));
  assert.equal(by.Meta.party, "third");
  assert.deepEqual(by.Meta.pages, ["www.shop.com.tr/", "www.shop.com.tr/cart"]);
  assert.deepEqual(by.Meta.cookies, ["_fbp"]);
  assert.equal(by["Google Analytics (server-side)"].party, "first");
  assert.deepEqual(by["Google Analytics"].cookies, ["_ga"]);
  assert.deepEqual(inv.otherCookies, [{ name: "sessionid", party: "first" }, { name: "tracker", party: "third" }]);
});

test("the report lists the inventory in HTML and Markdown, and never cookie values", () => {
  const html = renderHtml({ title: "t", generatedAt: "now", findings: [], explained: null, runs: [run], lang: "en" });
  assert.match(html, /Tag inventory/);
  assert.match(html, /First party/);
  assert.match(html, /<code>_fbp<\/code>/);
  assert.match(renderMarkdown({ title: "t", generatedAt: "now", findings: [], explained: null, runs: [run] }), /\| Meta \| Third party \| 2 \| _fbp \|/);
});
