import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { compareRuns, previousRun, routeHints } from "../src/changes.js";
import { renderHtml, renderMarkdown } from "../src/report.js";

const f = (check, event, severity = "broken") => ({ severity, check, platform: "ga4", event, detail: `${check} ${event}`, journey: "j", viewport: "desktop" });

test("no earlier run says so", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "aitd-"));
  const prev = await previousRun(dir, "https://www.example.com");
  assert.equal(prev, null);
  const ch = compareRuns(prev, { findings: [] });
  assert.deepEqual(ch, { previous: null });
  assert.match(renderMarkdown({ title: "t", generatedAt: "g", findings: [], explained: null, runs: [], changes: ch }), /first saved run/);
});

test("finds the newest earlier run and compares health findings", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "aitd-"));
  const runs = path.join(dir, "example.com", "runs");
  for (const [id, findings] of [["2026-10-01_0900", [f("missing_event", "x")]], ["2026-10-02_0900", [f("missing_event", "purchase"), f("missing_params", "add_to_cart")]]]) {
    await mkdir(path.join(runs, id), { recursive: true });
    await writeFile(path.join(runs, id, "capture.json"), JSON.stringify({ findings }));
  }
  const prev = await previousRun(dir, "https://example.com");
  assert.equal(prev.id, "2026-10-02_0900");
  const ch = compareRuns(prev, { findings: [f("missing_params", "add_to_cart"), f("dup", "page_view", "warning"), f("x", "y", "info")] });
  assert.equal(ch.mode, "findings");
  assert.deepEqual(ch.fixed.map((c) => c.event), ["purchase"]);
  assert.deepEqual(ch.new.map((c) => c.event), ["page_view"]);
  const html = renderHtml({ title: "t", generatedAt: "g", findings: [], explained: null, runs: [], changes: ch });
  assert.match(html, /Changed since last run/);
  assert.match(html, /1 problem fixed, 1 new problem/);
});

test("compares plan coverage when both runs used a plan", () => {
  const pc = (buckets) => ({ events: Object.entries(buckets).map(([event, bucket]) => ({ platform: "ga4", event, bucket })) });
  const prev = { id: "a", capture: { findings: [] }, planCheck: pc({ purchase: "missing", lead: "implemented", search: "wrong_values" }) };
  const ch = compareRuns(prev, { findings: [], planCheck: pc({ purchase: "implemented", lead: "missing_params", search: "wrong_values", sign_up: "missing" }) });
  assert.equal(ch.mode, "plan");
  assert.deepEqual(ch.fixed.map((c) => c.event), ["purchase"]);
  assert.deepEqual(ch.new.map((c) => c.event).sort(), ["lead", "sign_up"]);
  assert.match(renderMarkdown({ title: "t", generatedAt: "g", findings: [], explained: null, runs: [], changes: ch, lang: "tr" }), /1 olay düzeldi, 2 yeni sorun/);
});

test("flags a journey whose route differs from the last run", () => {
  const run = (...pages) => ({ journeyId: "purchase", viewport: "desktop", steps: pages.map((pagePath) => ({ pagePath })) });
  const prev = { id: "a", capture: { findings: [], runs: [run("https://x.com/", "https://x.com/cart")] } };
  const same = compareRuns(prev, { findings: [], runs: [run("https://x.com/", "https://x.com/", "https://x.com/cart")] });
  assert.equal(same.routes, undefined);
  const ch = compareRuns(prev, { findings: [], runs: [run("https://x.com/", "https://x.com/shop", "https://x.com/cart")] });
  assert.equal(ch.routes.length, 1);
  assert.match(renderMarkdown({ title: "t", generatedAt: "g", findings: [], explained: null, runs: [], changes: ch }), /different route through the site than in the last run: purchase \(desktop\)/);
  assert.match(renderHtml({ title: "t", generatedAt: "g", findings: [], explained: null, runs: [], changes: ch }), /class="meta"><a href="#changes">The AI took a different route/);
  assert.equal(compareRuns({ id: "a", capture: { findings: [] } }, { findings: [], runs: [run("https://x.com/")] }).routes, undefined);
});

test("route hints come from the last completed run of the same goal", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "aitd-"));
  const site = "https://www.example.com";
  const save = async (id, runs) => {
    const { runsDir } = await import("../src/workspace.js");
    const d = path.join(runsDir(dir, site), id);
    await mkdir(d, { recursive: true });
    await writeFile(path.join(d, "capture.json"), JSON.stringify({ runs }));
  };
  const run = (completed, goal, ...pages) => ({ journeyId: "custom", viewport: "desktop", completed, goal, steps: pages.map((pagePath) => ({ pagePath })) });
  await save("2026-01-01_1000", [run(true, "buy", "https://x.com/", "https://x.com/old"), { ...run(true, undefined, "https://x.com/nogoal"), journeyId: "other" }]);
  await save("2026-01-02_1000", [run(true, "buy", "https://x.com/", "https://x.com/cart")]);
  await save("2026-01-03_1000", [run(false, "buy", "https://x.com/", "https://x.com/broken")]);
  const hints = await routeHints(dir, site);
  assert.deepEqual(hints.get("custom|desktop"), { goal: "buy", pages: ["https://x.com/", "https://x.com/cart"] });
  assert.equal(hints.has("other|desktop"), false);
  assert.equal((await routeHints(await mkdtemp(path.join(tmpdir(), "aitd-")), site)).size, 0);
});

test("compares a plan with the version before it", async () => {
  const { comparePlans, previousPlanChanges } = await import("../src/changes.js");
  const ev = (name, extra = {}) => ({ name, required_params: ["currency"], parameters: { currency: {} }, ...extra });
  const prev = { events: [ev("purchase"), ev("search"), ev("login")] };
  const next = { events: [ev("purchase", { required_params: ["currency", "value"] }), ev("search"), ev("size_guide_open")] };
  const pc = comparePlans(prev, next, "2026-10-01_0900");
  assert.deepEqual(pc.added.map((c) => c.event), ["size_guide_open"]);
  assert.deepEqual(pc.removed.map((c) => c.event), ["login"]);
  assert.deepEqual(pc.changed.map((c) => [c.event, c.what]), [["purchase", ["required parameters"]]]);
  assert.equal(comparePlans(prev, prev, "x").same, true);
  assert.equal(comparePlans(null, next), null);

  const dir = await mkdtemp(path.join(tmpdir(), "aitd-"));
  for (const [id, plan] of [["2026-10-01_0900", prev], ["2026-10-02_0900", next]]) {
    await mkdir(path.join(dir, "example.com", "plans", id), { recursive: true });
    await writeFile(path.join(dir, "example.com", "plans", id, "measurement-plan.json"), JSON.stringify(plan));
  }
  assert.equal(await previousPlanChanges(dir, "https://example.com", "2026-10-01_0900", prev), null);
  assert.equal((await previousPlanChanges(dir, "https://example.com", "2026-10-02_0900", next)).previous, "2026-10-01_0900");

  const args = { title: "t", generatedAt: "g", findings: [], explained: null, runs: [], against: "2026-10-02_0900", planChanges: pc };
  assert.match(renderHtml(args), /Plan changed since 2026-10-01_0900: 1 added, 1 removed, 1 changed/);
  assert.match(renderMarkdown(args), /- ~ .*purchase: required parameters/);
});
