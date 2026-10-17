import { test } from "node:test";
import assert from "node:assert/strict";
import { campaignParamsIn, withCampaignParams } from "../src/campaign.js";
import { checkRun } from "../src/checks.js";

const req = "https://shop.com/?utm_source=aitd&gclid=g1";
const run = (landing, hits) => ({ journeyId: "j", viewport: "desktop", completed: true, steps: [{ index: 0, label: "open" }], dataLayerLog: [], network: [], landing, hits });
const pv = (loc) => ({ platform: "ga4", name: "page_view", step: 0, url: "https://x/", params: { page_location: loc } });
const checks = (r) => checkRun({ events: [] }, r).map((f) => f.check);

test("test parameters are added only to an address without campaign parameters", () => {
  assert.equal(withCampaignParams(req), req);
  const added = campaignParamsIn(withCampaignParams("https://shop.com/a"));
  assert.ok(added.utm_source && added.gclid && added.fbclid);
});

test("parameters that survive the redirect and reach the hits pass", () => {
  const landing = { step: 0, requested: req, chain: [req], final: req };
  assert.deepEqual(checks(run(landing, [pv(req)])).filter((c) => c.startsWith("campaign")), ["campaign_params"]);
});

test("a redirect that drops a parameter is broken", () => {
  const landing = { step: 0, requested: req, chain: [req, "https://shop.com/home?utm_source=aitd"], final: "https://shop.com/home?utm_source=aitd" };
  const f = checkRun({ events: [] }, run(landing, [pv(landing.final)])).find((x) => x.check === "campaign_lost_redirect");
  assert.equal(f.severity, "broken");
  assert.match(f.detail, /gclid/);
  assert.match(f.evidence, / -> /);
});

test("a hit that reports a page address without the parameters is broken", () => {
  const landing = { step: 0, requested: req, chain: [req], final: req };
  const found = checks(run(landing, [pv("https://shop.com/")]));
  assert.ok(found.includes("campaign_missing_in_hits"));
  assert.ok(!found.includes("campaign_lost_redirect"));
});

test("a run without a landing address has no campaign findings", () => {
  assert.deepEqual(checks(run(null, [pv("https://shop.com/")])).filter((c) => c.startsWith("campaign")), []);
});
