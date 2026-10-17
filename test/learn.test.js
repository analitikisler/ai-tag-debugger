import { test } from "node:test";
import assert from "node:assert/strict";
import { learnPlan } from "../src/learn.js";
import { renderPlanHtml } from "../src/plan-html.js";

const runs = [
  { journeyId: "a", hits: [
    { platform: "ga4", name: "page_view", params: { page_location: "https://x.test/" } },
    { platform: "ga4", name: "purchase", params: { value: "10", currency: "EUR", coupon: "X" } },
    { platform: "meta", name: "PageView", params: {} },
    { platform: "tiktok", name: "(unnamed)", params: {} },
  ] },
  { journeyId: "b", hits: [{ platform: "ga4", name: "purchase", params: { value: "12", currency: "EUR" } }] },
];

test("learnPlan turns the events a site sends into a plan, without copying values", () => {
  const plan = learnPlan("https://x.test", runs);
  assert.equal(plan.learned, true);
  assert.deepEqual(plan.events.map((e) => `${e.platform}:${e.name}`), ["ga4:page_view", "ga4:purchase", "meta:PageView"]);
  const purchase = plan.events[1];
  assert.deepEqual(purchase.required_params, ["value", "currency"]);
  assert.deepEqual(Object.keys(purchase.parameters), ["value", "currency", "coupon"]);
  assert.ok(!JSON.stringify(plan).includes("EUR"));
  assert.equal(plan.events[2].required_params, undefined);
  assert.ok(renderPlanHtml(plan, { id: "2026-10-16_0905", generatedAt: "2026-10-16 09:05" }).includes("purchase"));
});

test("learnPlan returns null when nothing named was sent", () => {
  assert.equal(learnPlan("https://x.test", [{ hits: [] }]), null);
});
