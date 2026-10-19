// The job pool behind --concurrency: a few journeys at once, with the results in the jobs' order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseConcurrency, runPool, taggedLog } from "../src/pool.js";
import { runAudit } from "../src/audit.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A worker that takes job.ms to finish and records how many jobs were running when each one started. */
const tracking = () => {
  let active = 0;
  const peaks = [];
  const started = [];
  const finished = [];
  const worker = async (job) => {
    started.push(job.id);
    peaks.push(++active);
    await sleep(job.ms);
    active--;
    finished.push(job.id);
    return job.id;
  };
  return { worker, peaks, started, finished };
};

test("runs at most `limit` jobs at once and keeps the jobs' order whatever finishes first", async () => {
  const jobs = [{ id: "a", ms: 60 }, { id: "b", ms: 5 }, { id: "c", ms: 5 }, { id: "d", ms: 5 }, { id: "e", ms: 5 }];
  const t = tracking();
  const results = await runPool(jobs, 2, t.worker);
  assert.deepEqual(results, ["a", "b", "c", "d", "e"]);
  assert.equal(Math.max(...t.peaks), 2, "two jobs ran at once");
  assert.ok(t.finished.indexOf("e") < t.finished.indexOf("a"), "the slow first job finished last");
  assert.deepEqual(t.started, ["a", "b", "c", "d", "e"], "jobs start in order");
});

test("limit 1 runs the jobs strictly one after another", async () => {
  const jobs = [{ id: 1, ms: 20 }, { id: 2, ms: 1 }, { id: 3, ms: 10 }];
  const t = tracking();
  assert.deepEqual(await runPool(jobs, 1, t.worker), [1, 2, 3]);
  assert.deepEqual(t.peaks, [1, 1, 1]);
  assert.deepEqual(t.finished, [1, 2, 3]);
});

test("a limit above the job count never starts more lanes than jobs, and no jobs is fine", async () => {
  const t = tracking();
  assert.deepEqual(await runPool([{ id: "x", ms: 1 }], 8, t.worker), ["x"]);
  assert.deepEqual(await runPool([], 4, t.worker), []);
});

test("errors are the worker's business: a worker that keeps them returns them in place, one that throws rejects the pool", async () => {
  const results = await runPool(["ok", "bad", "ok"], 3, async (job) => Promise.reject(new Error(job)).catch((err) => (job === "bad" ? { error: err.message } : "fine")));
  assert.deepEqual(results, ["fine", { error: "bad" }, "fine"]);
  await assert.rejects(runPool([1], 1, async () => { throw new Error("browser gone"); }), /browser gone/);
});

test("taggedLog starts every non-empty line with the tag", () => {
  const lines = [];
  const log = taggedLog((m) => lines.push(m), "[checkout/mobile]");
  log("\n▶ checkout (mobile)");
  log("  Accept cookies");
  log("one\n\ntwo");
  assert.deepEqual(lines, ["\n[checkout/mobile] ▶ checkout (mobile)", "[checkout/mobile]   Accept cookies", "[checkout/mobile] one\n\n[checkout/mobile] two"]);
});

test("concurrency is 1 unless given, and only a whole number from 1 to 8 is accepted", () => {
  assert.equal(parseConcurrency(undefined), 1);
  assert.equal(parseConcurrency(""), 1);
  assert.equal(parseConcurrency("3"), 3);
  assert.equal(parseConcurrency(8), 8);
  for (const bad of [0, 9, "two", 1.5, "-1", true]) assert.throws(() => parseConcurrency(bad), /"concurrency" must be a whole number from 1 to 8/, String(bad));
});

test("a bad concurrency stops the audit before the browser starts, from the options or the config", async () => {
  const logged = [];
  const config = { site: "http://127.0.0.1:9", journeys: [{ id: "home", steps: [{ action: "wait", value: "1" }] }] };
  const base = { config, plan: { events: [] }, scripted: true, ai: false, log: (m) => logged.push(m) };
  await assert.rejects(runAudit({ ...base, concurrency: 9 }), /^Error: "concurrency" must be a whole number from 1 to 8 \(--concurrency <n>, or "concurrency" in the config\)\.$/);
  await assert.rejects(runAudit({ ...base, config: { ...config, concurrency: "0" } }), /"concurrency" must be a whole number/);
  assert.deepEqual(logged, [], "no journey started");
});

const send = (en) => `fetch("https://region1.google-analytics.com/g/collect?v=2&tid=G-1&cid=1.2&_s=1&en=${en}", { method: "POST", keepalive: true });`;
const PAGES = {
  "/": `<!doctype html><script>${send("page_view")}</script><div class="banner"><button class="btn">Accept all</button></div><a href="/product">Product</a>`,
  "/product": `<!doctype html><script>${send("page_view")}${send("view_item")}${send("view_item")}</script><p>Product</p>`,
};
const key = (f) => `${f.severity} ${f.check} ${f.platform ?? ""} ${f.event ?? ""} ${(f.where ?? []).map((w) => `${w.journey}/${w.viewport}@${w.step}`).join(",")}`;

test("an audit with concurrency 2 gives the same runs and findings as one journey at a time, with tagged log lines", async () => {
  const server = createServer((req, res) => res.writeHead(200, { "content-type": "text/html" }).end(PAGES[new URL(req.url, "http://x").pathname] ?? ""));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const out = await mkdtemp(path.join(tmpdir(), "atd-pool-"));
  try {
    const config = {
      site: `http://127.0.0.1:${server.address().port}/`,
      providers: ["ga4"],
      viewports: ["desktop", "mobile"],
      consent_scenarios: false,
      journeys: [
        { id: "browse", steps: [{ action: "click", text: "Accept all", accepts_consent: true }, { action: "click", text: "Product" }, { action: "wait", value: "300" }] },
        { id: "home", steps: [{ action: "wait", value: "300" }] },
      ],
    };
    const plan = { events: [{ platform: "ga4", name: "view_item", journeys: ["browse"] }, { platform: "ga4", name: "purchase", journeys: ["browse"] }] };
    const audit = async (concurrency) => {
      const logged = [];
      const result = await runAudit({ config, plan, scripted: true, ai: false, concurrency, outDir: path.join(out, `c${concurrency}`), log: (m) => logged.push(m) });
      return { result, logged };
    };
    const one = await audit(1);
    const two = await audit(2);
    const order = (r) => r.runs.map((run) => `${run.journeyId}/${run.viewport}`);
    assert.deepEqual(order(one.result), ["browse/desktop", "browse/mobile", "home/desktop", "home/mobile"]);
    assert.deepEqual(order(two.result), order(one.result), "runs stay in the journey × viewport order");
    assert.ok(two.result.runs.every((run) => run.completed), two.result.runs.map((run) => run.note).join("; "));
    assert.deepEqual(two.result.findings.map(key).sort(), one.result.findings.map(key).sort());
    assert.ok(one.result.findings.map(key).some((k) => k.startsWith("broken missing_event ga4 purchase")));
    assert.deepEqual(two.result.runs.map((run) => run.hits.map((h) => h.name).sort()), one.result.runs.map((run) => run.hits.map((h) => h.name).sort()));

    const headers = (logged) => logged.filter((m) => m.includes("▶"));
    assert.deepEqual(headers(one.logged), ["\n▶ browse (desktop)", "\n▶ browse (mobile)", "\n▶ home (desktop)", "\n▶ home (mobile)"]);
    assert.deepEqual(headers(two.logged).sort(), ["\n[browse/desktop] ▶ browse (desktop)", "\n[browse/mobile] ▶ browse (mobile)", "\n[home/desktop] ▶ home (desktop)", "\n[home/mobile] ▶ home (mobile)"]);
    assert.ok(two.logged.filter((m) => m.includes("tracking hits captured")).every((m) => /^\[[a-z]+\/(desktop|mobile)\] {3}[✓✗] /.test(m)), "result lines are tagged too");
  } finally {
    server.close();
    await rm(out, { recursive: true, force: true });
  }
});
