import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { draftPlan } from "../src/plan.js";

const capture = {
  runs: [
    {
      journeyId: "browse",
      dataLayerLog: [{ value: ["consent", "default", { ad_storage: "denied" }] }],
      hits: [
        { platform: "ga4", name: "page_view", params: { page_location: "https://x.test/", page_title: "Home" } },
        { platform: "ga4", name: "add_to_cart", params: { currency: "USD", value: "10", coupon: "A" }, items: ["id1"] },
        { platform: "ga4", name: "add_to_cart", params: { currency: "USD", value: "12" }, items: ["id2"] },
        { platform: "hotjar", name: "identify", params: {} },
      ],
    },
    {
      journeyId: "purchase",
      dataLayerLog: [],
      hits: [
        { platform: "ga4", name: "page_view", params: { page_location: "https://x.test/" } },
        { platform: "meta", name: "Purchase", params: { value: "20", currency: "USD" } },
        { platform: "meta", name: "(unnamed)", params: {} },
      ],
    },
  ],
};

test("draftPlan lists each event once with the params it always sent", () => {
  const plan = draftPlan(capture);
  assert.equal(plan.consent_mode, true);
  assert.deepEqual(plan.events, [
    { platform: "ga4", name: "page_view" },
    { platform: "ga4", name: "add_to_cart", journeys: ["browse"], required_params: ["currency", "items", "value"] },
    { platform: "meta", name: "Purchase", journeys: ["purchase"], required_params: ["currency", "value"] },
  ]);
});

test("consent_mode is false when no Consent Mode default was pushed", () => {
  assert.equal(draftPlan({ runs: [{ journeyId: "a", hits: [], dataLayerLog: [] }] }).consent_mode, false);
});

test("aitd plan --from writes the plan and keeps an existing file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aitd-plan-"));
  writeFileSync(path.join(dir, "capture.json"), JSON.stringify(capture));
  const out = path.join(dir, "plan.json");
  const run = (...args) => execFileSync(process.execPath, ["src/cli.js", "plan", "--from", dir, "--out", out, ...args], { encoding: "utf8", stdio: "pipe" });
  assert.match(run(), /Wrote 3 events/);
  assert.equal(JSON.parse(readFileSync(out, "utf8")).events.length, 3);
  assert.throws(() => run(), /already exists/);
  assert.match(run("--force"), /Wrote 3 events/);
});
