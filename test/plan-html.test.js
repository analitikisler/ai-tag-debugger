import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderPlanHtml } from "../src/plan-html.js";
import { savePlan } from "../src/plan.js";

const plan = {
  site: "https://shop.test",
  consent_mode: true,
  events: [
    {
      platform: "ga4",
      name: "add_to_cart",
      description: "Visitor adds a product",
      trigger: { page: "product", element: "Add to cart button" },
      required_params: ["currency"],
      parameters: { currency: { description: "ISO code", example: "EUR" }, loyalty_tier: { custom: true, description: "Tier", example: "gold" } },
    },
    { platform: "ga4", name: "<script>alert(1)</script>", custom: true, description: "x & y", trigger: { page: "home", element: "<b>Hero</b>" }, parameters: {} },
  ],
  user_properties: [{ name: "customer_type", description: "New or returning", example: "returning" }],
};

test("renderPlanHtml shows events, parameters, user properties and consent mode", () => {
  const html = renderPlanHtml(plan, { id: "2026-10-16_0905" });
  for (const s of ["add_to_cart", "Visitor adds a product", "Add to cart button", "loyalty_tier", "gold", "customer_type", "Consent mode on", "custom event", "standard event", "required", "2026-10-16_0905"]) {
    assert.ok(html.includes(s), `missing ${s}`);
  }
  assert.ok(html.includes("analitikisler.com"));
});

test("renderPlanHtml escapes plan text", () => {
  const html = renderPlanHtml(plan);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("&lt;b&gt;Hero&lt;/b&gt;"));
  assert.ok(html.includes("x &amp; y"));
});

test("renderPlanHtml leaves the branding out when branding is false", () => {
  const html = renderPlanHtml(plan, { branding: false });
  assert.ok(!html.includes("analitikisler.com"));
});

test("savePlan writes plan.html next to measurement-plan.json", async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "aitd-planhtml-"));
  const saved = await savePlan(plan, { dataDir, site: "https://shop.test", branding: false });
  const html = readFileSync(path.join(saved.dir, "plan.html"), "utf8");
  assert.ok(html.includes("add_to_cart"));
  assert.ok(!html.includes("analitikisler.com"));
});
