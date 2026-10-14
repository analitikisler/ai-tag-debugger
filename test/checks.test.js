import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRun, groupFindings } from "../src/checks.js";

const plan = {
  consent_mode: true,
  events: [
    { platform: "ga4", name: "purchase", journeys: ["checkout"], required_params: ["value", "currency"] },
    { platform: "ga4", name: "add_to_cart" },
    { platform: "meta", name: "PageView" },
  ],
};

const run = (over) => ({
  journeyId: "checkout",
  viewport: "mobile",
  completed: true,
  steps: [{ index: 0, label: "start" }, { index: 1, label: "Open home" }, { index: 2, label: "Accept", acceptsConsent: true }, { index: 3, label: "Add" }, { index: 4, label: "Pay" }],
  consentStep: 2,
  dataLayerLog: [{ step: 1, value: ["consent", "default", { ad_storage: "denied" }] }],
  hits: [],
  ...over,
});

const hit = (platform, name, step, params = {}, extra = {}) => ({ platform, name, step, params, url: "https://x/", ...extra });

test("flags missing params, duplicates, early pixels and missing events", () => {
  const findings = checkRun(plan, run({
    hits: [
      hit("meta", "PageView", 1),
      hit("ga4", "add_to_cart", 3),
      hit("ga4", "add_to_cart", 3),
      hit("ga4", "purchase", 4, { currency: "EUR" }),
    ],
  }));
  const checks = findings.map((f) => `${f.severity}:${f.check}:${f.event ?? ""}`);
  assert.ok(checks.includes("broken:missing_params:purchase"));
  assert.ok(checks.includes("warning:duplicate:add_to_cart"));
  assert.ok(checks.includes("risk:before_consent:PageView"));
});

test("does not flag Google hits sent with denied consent before acceptance", () => {
  const findings = checkRun(plan, run({ hits: [hit("ga4", "add_to_cart", 1, {}, { consent: { ad_storage: "denied", analytics_storage: "denied" } })] }));
  assert.ok(!findings.some((f) => f.check === "before_consent"));
});

test("reports a missing event as info when the journey stopped early", () => {
  const findings = checkRun(plan, run({ completed: false, note: "Payment needed a real card", hits: [hit("ga4", "add_to_cart", 3)] }));
  const missing = findings.find((f) => f.check === "missing_event" && f.event === "purchase");
  assert.equal(missing.severity, "info");
  assert.ok(findings.some((f) => f.check === "journey_incomplete"));
});

test("flags a missing consent default and email addresses in hits", () => {
  const findings = checkRun(plan, run({
    dataLayerLog: [],
    hits: [hit("ga4", "add_to_cart", 3, { user: "jane@example.com" })],
  }));
  assert.ok(findings.some((f) => f.check === "consent_default_missing"));
  assert.ok(findings.some((f) => f.check === "pii"));
});

test("groups the same problem across viewports", () => {
  const a = checkRun(plan, run({ viewport: "desktop", hits: [hit("meta", "PageView", 1)] }));
  const b = checkRun(plan, run({ viewport: "mobile", hits: [hit("meta", "PageView", 1)] }));
  const grouped = groupFindings([...a, ...b]).filter((f) => f.check === "before_consent");
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].where.length, 2);
});

test("writes finding texts in Turkish with --lang tr", () => {
  const findings = checkRun(plan, run({ hits: [hit("ga4", "purchase", 4, { currency: "EUR" })] }), { lang: "tr" });
  const missing = findings.find((f) => f.check === "missing_params");
  assert.equal(missing.detail, '"purchase" olayı "value" parametresi olmadan gönderildi.');
});

test("the duplicate check counts per page load, so a step that loads a new page doesn't add up both pages", async () => {
  const { checkRun } = await import("../src/checks.js");
  const hit = (p) => ({ platform: "ga4", name: "page_view", params: {}, url: `https://region1.google-analytics.com/g/collect?v=2&en=page_view&_p=${p}`, step: 1 });
  const run = (hits) => ({ journeyId: "j", viewport: "desktop", completed: true, hits, steps: [{ index: 0, label: "start" }, { index: 1, label: "Open privacy" }], consentStep: null, dataLayerLog: [] });
  const dup = (hits) => checkRun({ events: [] }, run(hits)).filter((f) => f.check === "duplicate");
  assert.equal(dup([hit("a"), hit("b")]).length, 0);
  assert.equal(dup([hit("a"), hit("a")]).length, 1);
});

test("unnamed TikTok pings are not reported as duplicates, named ones still are", () => {
  const tt = (name) => ({ platform: "tiktok", name, params: {}, url: "https://analytics.tiktok.com/api/v2/pixel", step: 1 });
  const base = { journeyId: "j", viewport: "desktop", completed: true, steps: [{ index: 0, label: "start" }, { index: 1, label: "Open home" }], consentStep: 1, dataLayerLog: [] };
  const dup = (hits) => checkRun({ events: [] }, { ...base, hits }).filter((f) => f.check === "duplicate");
  assert.equal(dup([tt("(unnamed)"), tt("(unnamed)"), tt("(unnamed)")]).length, 0);
  assert.equal(dup([tt("AddToCart"), tt("AddToCart")]).length, 1);
});
