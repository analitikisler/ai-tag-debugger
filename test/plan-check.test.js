import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checkRun, planCheck } from "../src/checks.js";
import { writeReports } from "../src/audit.js";
import { renderHtml, renderMarkdown } from "../src/report.js";

const plan = {
  events: [
    { platform: "GA4", name: "add_to_cart", journeys: ["cart"], required_params: ["currency"] },
    { platform: "ga4", name: "view_item", journeys: ["cart"] },
    { platform: "ga4", name: "purchase", journeys: ["checkout"], required_params: ["value"] },
    { platform: "ga4", name: "sign_up", journeys: ["signup"] },
    { platform: "meta", name: "AddToCart", journeys: ["cart"] },
    { platform: "tiktok", name: "AddToCart", journeys: ["cart"] },
  ],
};
const hit = (platform, name, step, params = {}) => ({ platform, name, step, params, url: "https://x/" });
const run = (journeyId, hits) => ({ journeyId, viewport: "desktop", completed: true, steps: [{ index: 0, label: "start" }, { index: 1, label: "go" }], consentStep: null, dataLayerLog: [], hits, providers: ["ga4", "meta"] });
const runs = [
  run("cart", [hit("ga4", "add_to_cart", 1), hit("ga4", "view_item", 1), hit("ga4", "scroll", 1)]),
  run("checkout", [hit("ga4", "purchase", 1, { value: "0", currency: "EUR", items: "[]" })]),
];
const findings = runs.flatMap((r) => checkRun(plan, r));

test("sorts each planned event into one bucket and scores coverage on the checkable ones", () => {
  const pc = planCheck(plan, runs, findings);
  const bucket = (p, n) => pc.events.find((e) => e.platform === p && e.event === n)?.bucket;
  assert.equal(bucket("ga4", "add_to_cart"), "missing_params");
  assert.equal(bucket("ga4", "view_item"), "implemented");
  assert.equal(bucket("ga4", "purchase"), "wrong_values");
  assert.equal(bucket("ga4", "sign_up"), "not_checked");
  assert.equal(bucket("meta", "AddToCart"), "missing");
  assert.equal(bucket("tiktok", "AddToCart"), "not_checked");
  assert.equal(bucket("ga4", "scroll"), "unplanned");
  assert.deepEqual(pc.coverage, { implemented: 1, checkable: 4, not_checked: 2, percent: 25, platforms: {
    ga4: { implemented: 1, checkable: 3, not_checked: 1, percent: 33 },
    meta: { implemented: 0, checkable: 1, not_checked: 0, percent: 0 },
    tiktok: { implemented: 0, checkable: 0, not_checked: 1, percent: null },
  } });
});

const base = { title: "T", generatedAt: "now", findings, explained: null, runs, plan };

test("the report opens with Plan vs. site and the coverage line, in English and Turkish", () => {
  const pc = planCheck(plan, runs, findings);
  const md = renderMarkdown({ ...base, against: "p1", planCheck: pc });
  assert.match(md, /## Plan vs\. site/);
  assert.match(md, /Coverage 1 of 4 \(25%\), 2 events not checked/);
  assert.ok(md.indexOf("Plan vs. site") < md.indexOf("## Findings") || !md.includes("## Findings"));
  const html = renderHtml({ ...base, against: "p1", planCheck: pc });
  assert.match(html, /id="plan-vs-site"/);
  assert.match(html, /Missing params/);
  assert.match(renderMarkdown({ ...base, lang: "tr", planCheck: pc }), /Kapsam 4 olaydan 1 \(%25\), 2 olay kontrol edilmedi/);
});

test("without a plan the report has no Plan vs. site section and no plan-check.json", async () => {
  assert.doesNotMatch(renderMarkdown(base), /Plan vs\. site/);
  assert.doesNotMatch(renderHtml(base), /plan-vs-site/);
  const config = { site: "https://example.com" };
  const plain = await mkdtemp(path.join(os.tmpdir(), "aitd-pc-"));
  await writeReports({ outDir: plain, config, plan, runs, findings, explained: null, lang: "en" });
  await assert.rejects(access(path.join(plain, "plan-check.json")));
  const withPlan = await mkdtemp(path.join(os.tmpdir(), "aitd-pc-"));
  await writeReports({ outDir: withPlan, config, plan, runs, findings, explained: null, lang: "en", against: { id: "p1", file: "x", label: "p1" } });
  const json = JSON.parse(await readFile(path.join(withPlan, "plan-check.json"), "utf8"));
  assert.equal(json.plan_id, "p1");
  assert.equal(json.events.length, 7);
  // Every run also gets the CI files, next to the others.
  assert.match(await readFile(path.join(plain, "junit.xml"), "utf8"), /<testsuites name="ai-tag-debugger example.com"/);
  const summary = JSON.parse(await readFile(path.join(withPlan, "summary.json"), "utf8"));
  assert.equal(summary.plan.id, "p1");
  assert.equal(summary.files.junit, path.join(withPlan, "junit.xml"));
});
