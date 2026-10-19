import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CONFIG_SCHEMA, PLAN_SCHEMA, closest, validateConfig, validatePlan } from "../src/schema.js";
import { loadConfig } from "../src/audit.js";

const demoConfig = JSON.parse(readFileSync(new URL("../examples/demo.config.json", import.meta.url), "utf8"));
const demoPlan = JSON.parse(readFileSync(new URL("../examples/measurement-plan.json", import.meta.url), "utf8"));

const message = (fn) => {
  try {
    fn();
  } catch (err) {
    return err.message;
  }
  assert.fail("expected the check to throw");
};

test("the demo config and plan pass without warnings", () => {
  assert.deepEqual(validateConfig(demoConfig, { file: "demo.config.json" }), { value: demoConfig, warnings: [] });
  assert.deepEqual(validatePlan(demoPlan), { value: demoPlan, warnings: [] });
  assert.ok(CONFIG_SCHEMA.safeParse(demoConfig).success);
  assert.ok(PLAN_SCHEMA.safeParse(demoPlan).success);
});

test("a wrong value fails with the file, the path, the allowed values and what was found", () => {
  const bad = { ...demoConfig, viewports: ["desktop", "tablet"], journeys: [{ id: "a", steps: [{ action: "click" }, { action: "tap", selector: "#x" }] }] };
  assert.equal(
    message(() => validateConfig(bad, { file: "ai-tag-debugger.config.json" })),
    'Invalid config in ai-tag-debugger.config.json:\n  viewports[1]: must be one of desktop, mobile (got "tablet")\n  journeys[0].steps[1].action: must be one of goto, click, fill, select, scroll, wait (got "tap")',
  );
  assert.match(message(() => validateConfig({ journeys: { id: "checkout" } })), /^Invalid config:\n {2}journeys: must be a list \(got \{"id":"checkout"\}\)$/);
  assert.match(message(() => validateConfig({ notify: { slack: 5 } })), /notify\.slack: must be a webhook URL, or true to read SLACK_WEBHOOK_URL \(got 5\)/);
  assert.match(message(() => validateConfig({ language: "de", provider: "claude", block_hits: "no" })), /block_hits: must be true or false \(got "no"\)\n {2}language: must be one of en, tr \(got "de"\)\n {2}provider: must be one of anthropic, openai, gemini, vercel, cloudflare, openai-compatible \(got "claude"\)/);
  assert.match(message(() => validatePlan({ events: [{ platform: "ga4" }, { platform: "facebook", name: "x" }] }, { file: "plan.json" })), /^Invalid plan in plan\.json:\n {2}events\[0\]\.name: is required\n {2}events\[1\]\.platform: must be one of ga4, google_ads, meta, tiktok, .* \(got "GA4"\)$/);
  assert.match(message(() => validatePlan({ events: [{ platform: "ga4", name: "" }] })), /events\[0\]\.name: must not be empty/);
  assert.match(message(() => validatePlan({})), /^Invalid plan:\n {2}events: is required$/);
  // A plan written inline in the config is reported at its place in that file.
  assert.match(message(() => validatePlan({ events: "purchase" }, { file: "c.json", at: "plan" })), /^Invalid plan in c\.json:\n {2}plan\.events: must be a list \(got "purchase"\)$/);
  // Long values are cut so one line stays readable.
  assert.match(message(() => validateConfig({ site: Array.from({ length: 50 }, () => "x") })), /got \["x","x".{40,60}…\)$/);
});

test("unknown keys are kept, warned about and get a suggestion when a known key is close", () => {
  const config = { ...demoConfig, viewport: ["mobile"], journies: [], owner: "Ann", journeys: [{ id: "a", goals: "x", steps: [{ action: "wait", valeu: "1", optional: true }] }] };
  const { value, warnings } = validateConfig(config, { file: "c.json" });
  assert.deepEqual(value, config);
  // Warnings follow the order of the keys in the file; "journeys" sits before the extra keys here.
  assert.deepEqual(warnings, [
    'Unknown key "journeys[0].goals" in c.json is ignored. Did you mean "goal"?',
    'Unknown key "journeys[0].steps[0].valeu" in c.json is ignored. Did you mean "value"?',
    'Unknown key "viewport" in c.json is ignored. Did you mean "viewports"?',
    'Unknown key "journies" in c.json is ignored. Did you mean "journeys"?',
    'Unknown key "owner" in c.json is ignored.',
  ]);
  assert.deepEqual(validatePlan({ ...demoPlan, events: [{ platform: "ga4", name: "purchase", required_parms: ["value"] }], notes: "" }).warnings, [
    'Unknown key "events[0].required_parms" is ignored. Did you mean "required_params"?',
    'Unknown key "notes" is ignored.',
  ]);
  assert.equal(closest("Viewport", ["site", "viewports"]), "viewports");
  assert.equal(closest("colour", ["site", "viewports"]), null);
});

test("fields the code reads but the README leaves out are accepted", () => {
  const config = {
    site: "https://x.test", plan: { events: [] }, providers: "ga4,meta", detect_providers: true, report: { name: "Acme", color: null, pdf: true },
    notify: { slack: true, email: ["a@x.test"] },
    journeys: [{ id: "j", start: "/shop", incomplete: "No cart", steps: [{ action: "click", ref: 3, text: "Buy", rejects_consent: true, optional: true }, { action: "wait", value: 500 }] }],
  };
  assert.deepEqual(validateConfig(config).warnings, []);
  const plan = {
    site: "https://x.test", learned: true, consent_mode: true, pages: [{ type: "home", url: "/" }],
    events: [{ platform: "meta", name: "Purchase", aliases: ["order"], allow_multiple: true, custom: true, description: "d", trigger: { page: "checkout", element: "Pay" }, parameters: { value: {}, currency: { custom: true, description: null, example: "EUR" } }, seen: true }],
    user_properties: ["customer_type", { name: "plan", description: "", example: "" }],
  };
  assert.deepEqual(validatePlan(plan).warnings, []);
});

test("loadConfig refuses a bad config or plan file with the schema message and prints warnings through log", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aitd-schema-"));
  const file = path.join(dir, "bad.config.json");
  writeFileSync(file, JSON.stringify({ site: "https://x.test", viewports: ["desktop", "tablet"], journeys: [{ id: "a", steps: [{ action: "swipe" }] }] }));
  await assert.rejects(loadConfig(file), { message: `Invalid config in ${file}:\n  viewports[1]: must be one of desktop, mobile (got "tablet")\n  journeys[0].steps[0].action: must be one of goto, click, fill, select, scroll, wait (got "swipe")` });

  writeFileSync(path.join(dir, "plan.json"), JSON.stringify({ events: [{ platform: "ga4" }] }));
  writeFileSync(file, JSON.stringify({ site: "https://x.test", plan: "plan.json" }));
  await assert.rejects(loadConfig(file), { message: "Invalid plan in plan.json:\n  events[0].name: is required" });

  writeFileSync(file, JSON.stringify({ site: "https://x.test", plan: { events: [{ platform: "ga4", name: "x", journey: ["a"] }] }, viewport: ["mobile"] }));
  const logged = [];
  const loaded = await loadConfig(file, { log: (m) => logged.push(m) });
  assert.equal(loaded.validated, true);
  assert.deepEqual(logged, [`Unknown key "viewport" in ${file} is ignored. Did you mean "viewports"?`, `Unknown key "plan.events[0].journey" in ${file} is ignored. Did you mean "journeys"?`]);
});

test("null fields, uppercase platforms and string triggers still load, as they did before the schema", () => {
  const { warnings } = validateConfig({ site: "https://x.example", plan: null, gtm_container: null, language: null, report: null }, { file: "c.json" });
  assert.deepEqual(warnings, []);
  const plan = validatePlan({ events: [{ platform: "GA4", name: "purchase", trigger: "click Buy" }, { platform: "Meta", name: "Purchase", trigger: { page: "/thanks" } }] }, { file: "p.json" });
  assert.deepEqual(plan.warnings, []);
});
