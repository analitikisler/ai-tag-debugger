import { test } from "node:test";
import assert from "node:assert/strict";
import { eventsNamedIn, filterFindings, journeysFromPlan, planRun, presetFor } from "../src/journeys.js";

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

const sitePlan = {
  site: "https://shop.test",
  events: [
    { platform: "ga4", name: "view_item", trigger: { page: "product", element: "Product page load" } },
    { platform: "ga4", name: "add_to_cart", trigger: { page: "product", element: "Add to cart" } },
    { platform: "ga4", name: "begin_checkout", trigger: { page: "cart", element: "Checkout" } },
    { platform: "ga4", name: "purchase", trigger: { page: "checkout", element: "Place order" } },
    { platform: "ga4", name: "newsletter_signup", custom: true, trigger: { page: "home", element: "Subscribe" } },
  ],
};

test("--against alone groups plan events by trigger page into journeys", () => {
  const { journeys, plan: p } = planRun({ plan: sitePlan, against: true });
  assert.deepEqual(journeys.map((j) => j.id), ["add_to_cart", "purchase", "checkout", "home"]);
  assert.match(journeys[0].goal, /add it to the cart/); // the ready-made journey's goal
  assert.match(journeys[3].goal, /home page and use "Subscribe"/);
  assert.deepEqual(p.events.find((e) => e.name === "newsletter_signup").journeys, ["home"]);
  assert.deepEqual(p.events.find((e) => e.name === "view_item").journeys, ["add_to_cart"]);
});

test("--against alone makes at most six journeys, the smallest groups sharing the last", () => {
  const events = Array.from({ length: 9 }, (_, i) => ({ platform: "ga4", name: `e${i}`, trigger: { page: `page${i}`, element: `b${i}` } }));
  const { journeys, plan: p } = journeysFromPlan({ events });
  assert.equal(journeys.length, 6);
  assert.equal(new Set(p.events.map((e) => e.journeys[0])).size, 6);
  assert.match(journeys[5].goal, /Then/);
});

test("--against with --journey checks only the plan events expected on it", () => {
  const { journeys, plan: p } = planRun({ plan: sitePlan, against: true, picks: ["add_to_cart"] });
  assert.deepEqual(journeys.map((j) => j.id), ["add_to_cart"]);
  const on = p.events.filter((e) => e.journeys.includes("add_to_cart")).map((e) => e.name);
  assert.deepEqual(on, ["view_item", "add_to_cart"]);
  // Preset events missing from the plan are not added, and the rest of the plan is expected nowhere.
  assert.equal(p.events.length, sitePlan.events.length);
  assert.deepEqual(p.events.find((e) => e.name === "purchase").journeys, []);
});

test("--against with --goal checks the plan events the goal names", () => {
  assert.deepEqual(eventsNamedIn("Subscribe to the newsletter signup on the home page", sitePlan), ["newsletter_signup"]);
  const { plan: p } = planRun({ plan: sitePlan, against: true, goals: ["Open a product page and add to cart"] });
  assert.deepEqual(p.events.filter((e) => e.journeys.includes("custom")).map((e) => e.name), ["view_item", "add_to_cart"]);
});

test("without --against nothing changes", () => {
  const { plan: p } = planRun({ plan: sitePlan, picks: ["add_to_cart"] });
  assert.equal(p.events.find((e) => e.name === "purchase").journeys, undefined);
});
