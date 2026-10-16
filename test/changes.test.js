import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { compareRuns, previousRun } from "../src/changes.js";
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
