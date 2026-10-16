import { test } from "node:test";
import assert from "node:assert/strict";
import { filterFindings, planRun, presetFor } from "../src/journeys.js";

const config = { journeys: [{ id: "checkout", goal: "Buy something." }, { id: "browse", goal: "Look around." }] };
const plan = { events: [{ platform: "ga4", name: "purchase", journeys: ["checkout"] }, { platform: "ga4", name: "page_view" }] };

test("without picks, every config journey runs", () => {
  assert.deepEqual(planRun({ config, plan }).journeys.map((j) => j.id), ["checkout", "browse"]);
});

test("picks choose config journeys or ready-made ones, by name or alias", () => {
  const { journeys, plan: p } = planRun({ config, plan, picks: ["browse", "signup"] });
  assert.deepEqual(journeys.map((j) => j.id), ["browse", "sign_up"]);
  assert.match(journeys[1].goal, /sign-up or registration form/);
  assert.ok(p.events.some((e) => e.name === "sign_up" && e.journeys.includes("sign_up")));
  assert.ok(p.events.some((e) => e.platform === "meta" && e.name === "CompleteRegistration"));
  assert.equal(presetFor("Checkout").id, "purchase");
  assert.throws(() => planRun({ config, picks: ["wishlist"] }), /Unknown journey "wishlist".*--goal/);
});

test("a ready-made journey expects events the plan already has", () => {
  const { plan: p } = planRun({ config, plan, picks: ["purchase"] });
  assert.deepEqual(p.events.find((e) => e.name === "purchase").journeys, ["checkout", "purchase"]);
  assert.equal(plan.events[0].journeys.length, 1, "the original plan is not changed");
});

test("a plain-language goal expects the picked events", () => {
  const { journeys, plan: p } = planRun({ goals: ["Subscribe to the newsletter."], events: ["newsletter_signup"] });
  assert.deepEqual(journeys, [{ id: "custom", goal: "Subscribe to the newsletter." }]);
  assert.deepEqual(p.events, [{ platform: "ga4", name: "newsletter_signup", journeys: ["custom"] }]);
});

test("an events filter narrows the plan and the findings", () => {
  const { plan: p } = planRun({ config, plan, picks: ["purchase"], events: ["purchase"] });
  assert.deepEqual([...new Set(p.events.map((e) => e.name.toLowerCase()))], ["purchase"]);
  const findings = [
    { check: "missing_params", event: "purchase" },
    { check: "duplicate", event: "add_to_cart" },
    { check: "consent_default_missing" },
    { check: "unplanned_events" },
  ];
  assert.deepEqual(filterFindings(findings, ["Purchase"]).map((f) => f.check), ["missing_params", "consent_default_missing"]);
  assert.equal(filterFindings(findings, []).length, 4);
});

test("an unknown viewport stops the audit before the browser or model starts", async () => {
  const { runAudit } = await import("../src/audit.js");
  const logged = [];
  const config = { site: "http://127.0.0.1:9", journeys: [{ id: "home", steps: [{ action: "wait", value: "1" }] }] };
  const base = { config, plan: { events: [] }, provider: "anthropic", log: (m) => logged.push(m) };
  await assert.rejects(runAudit({ ...base, viewports: ["tablet"] }), /^Error: Unknown viewport "tablet"\. Use: desktop, mobile\.$/);
  await assert.rejects(runAudit({ ...base, config: { ...config, viewports: ["desktop", "phone"] } }), /Unknown viewport "phone"/);
  await assert.rejects(runAudit({ ...base, config: { ...config, viewports: "mobile" } }), /"viewports" must be a list/);
  assert.deepEqual(logged, [], "no model was set up and no journey started");
});

test("with nothing picked and no config journeys, a run has no journeys (and no hidden default)", () => {
  assert.deepEqual(planRun({}).journeys, []);
  assert.deepEqual(planRun({ plan: { events: [{ platform: "ga4", name: "generate_lead", journeys: ["lead"] }] } }).journeys, []);
});

test("config journeys run when nothing is picked", () => {
  assert.deepEqual(planRun({ config: { journeys: [{ id: "mine", goal: "x" }] } }).journeys.map((j) => j.id), ["mine"]);
});
