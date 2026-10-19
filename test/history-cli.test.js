// aitd history: the trend of a site's saved runs as a table, a sparkline and the summary lines, or as
// JSON; and the history index that every saved run updates through writeReports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeReports } from "../src/audit.js";
import { historyFile } from "../src/history.js";
import { runsDir } from "../src/workspace.js";

const SITE = "https://www.demo-shop.test";
const where = [["browse", "desktop"], ["checkout", "mobile"]];
const finding = (journey, viewport, severity, check, platform, event) => ({ journey, viewport, severity, check, platform, event, step: "Open /", detail: `${check} ${event}` });
const consent = () => where.map(([j, v]) => finding(j, v, "risk", "before_consent", "meta", "PageView"));
const purchase = () => [finding("checkout", "mobile", "broken", "missing_params", "ga4", "purchase")];
const run = (journeyId, viewport, completed = true) => ({ journeyId, viewport, goal: "g", completed, note: completed ? "done" : "stopped", hits: Array.from({ length: completed ? 9 : 2 }, (_, i) => ({ platform: "ga4", name: `e${i}`, params: {}, step: 1, t: 10 })), steps: [{ index: 0, label: "start", t: 0 }, { index: 1, label: "Open /", t: 5, pagePath: "/" }], startedAt: 0, dataLayerLog: [], network: [], providers: ["ga4", "meta"] });
const capture = (findings, runs = [run("browse", "desktop"), run("checkout", "mobile")]) => ({ config: { site: SITE }, runs, findings, explained: null });

/** Three saved runs: the purchase problem is fixed in the second, the third's checkout did not finish. */
async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "aitd-history-cli-"));
  const save = async (id, body) => {
    const d = path.join(runsDir(dir, SITE), id);
    await mkdir(d, { recursive: true });
    await writeFile(path.join(d, "capture.json"), JSON.stringify(body));
  };
  await save("2026-10-01_0900", capture([...consent(), ...purchase()]));
  await save("2026-10-02_0900", capture([...consent()]));
  await save("2026-10-03_0900", capture([...consent()], [run("browse", "desktop"), run("checkout", "mobile", false)]));
  return dir;
}

const cli = (...args) => execFileSync(process.execPath, ["src/cli.js", ...args], { encoding: "utf8" });
const fails = (args, pattern) => assert.throws(() => execFileSync(process.execPath, ["src/cli.js", ...args], { encoding: "utf8", stdio: "pipe" }), (e) => e.status === 2 && pattern.test(e.stderr));

test("aitd history prints one row per run, the sparkline and the summary lines", async () => {
  const dir = await fixture();
  const out = cli("history", "--site", SITE, "--data-dir", dir);
  const lines = out.trimEnd().split("\n");
  assert.match(lines[0], /^Run\s+Broken\s+Risk\s+Warning\s+Score\s+Complete$/);
  assert.match(lines[1], /^2026-10-01_0900\s+1\s+1\s+0\s+5\s+yes$/);
  assert.match(lines[2], /^2026-10-02_0900\s+0\s+1\s+0\s+2\s+yes$/);
  assert.match(lines[3], /^2026-10-03_0900\s+0\s+1\s+0\s+2\s+no$/);
  assert.equal(lines[4], "");
  assert.equal(lines[5], "█▄· improving over 3 runs (2026-10-01 → 2026-10-03)");
  assert.match(lines[6], /^Trend over 3 runs \(2026-10-01 → 2026-10-03\): improving\. Now 0 broken · 1 risk · 0 warning\.$/);
  assert.match(lines[7], /^Open longest: Meta PageView before_consent in 2 places since 2026-10-01 \(3 runs\)\.$/);
  assert.match(lines[8], /^Journeys that do not finish every time: checkout \(mobile\) 67%\.$/);
  assert.equal(lines.length, 9);
  // --limit reads only the newest runs; --lang follows the report languages.
  assert.match(cli("history", "--site", SITE, "--data-dir", dir, "--limit", "1"), /One saved run \(2026-10-03_0900\)/);
  assert.match(cli("history", "--site", SITE, "--data-dir", dir, "--lang", "tr"), /3 çalıştırmada eğilim/);
});

test("aitd history --json gives the trend, the timeline and the stability for scripts", async () => {
  const dir = await fixture();
  const json = JSON.parse(cli("history", "--site", SITE, "--data-dir", dir, "--json"));
  assert.equal(json.runs, 3);
  assert.equal(json.trend.direction, "improving");
  assert.deepEqual(json.trend.series.map((p) => p.score), [5, 2, 2]);
  assert.equal(json.timeline.find((e) => e.check === "missing_params").fixedIn, "2026-10-02_0900");
  assert.equal(json.stability[0].completionRate, 2 / 3);
});

test("aitd history says so without runs, and needs a site and a whole number limit", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "aitd-history-cli-"));
  assert.match(cli("history", "--site", SITE, "--data-dir", dir), /No saved run for this site yet/);
  assert.deepEqual(JSON.parse(cli("history", "--site", SITE, "--data-dir", dir, "--json")).trend.series, []);
  fails(["history"], /history needs --site <url>/);
  fails(["history", "--site", SITE, "--limit", "x"], /--limit must be a positive whole number/);
  fails(["history", "--site", "not a url"], /is not a full URL/);
  assert.match(cli("history", "--help"), /--limit <n>[\s\S]*--json/);
});

test("a saved run updates history.json and the next one gets the trend in its reports and summary", async () => {
  const dir = await fixture();
  const config = { site: SITE };
  const out = async (id, findings, runs) => {
    const d = path.join(runsDir(dir, SITE), id);
    await writeReports({ outDir: d, config, plan: null, runs, findings, explained: null, lang: "en", previous: null, history: { dataDir: dir } });
    return d;
  };
  const first = await out("2026-10-04_0900", [...consent()], [run("browse", "desktop"), run("checkout", "mobile")]);
  // The index holds the runs saved through writeReports; the three older folders are still read from their captures.
  const index = JSON.parse(await readFile(historyFile(dir, SITE), "utf8"));
  assert.deepEqual(index.runs.map((r) => r.id), ["2026-10-04_0900"]);
  assert.match(index.runs.at(-1).version, /^\d+\.\d+\.\d+$/);
  const md = await readFile(path.join(first, "report.md"), "utf8");
  assert.match(md, /## Trend\n\n`█▄·▄` Trend over 4 runs \(2026-10-01 → 2026-10-04\): flat\. Now 0 broken · 1 risk · 0 warning; 3 runs ago 1 broken · 1 risk · 0 warning\./);
  const capture = JSON.parse(await readFile(path.join(first, "capture.json"), "utf8"));
  assert.equal(capture.metrics.verdict.status, "attention");
  assert.equal(capture.version, index.runs.at(-1).version);
  const summary = JSON.parse(await readFile(path.join(first, "summary.json"), "utf8"));
  assert.deepEqual(summary.verdict, { status: "attention", headline: "attention_risk" });
  assert.equal(summary.score, 90);
  assert.deepEqual(summary.trend, { direction: "flat", runs: 4 });
  // Without history (an --out run or a replay) nothing is indexed and the summary says so.
  const plain = await mkdtemp(path.join(tmpdir(), "aitd-out-"));
  await writeReports({ outDir: plain, config, plan: null, runs: [run("browse", "desktop")], findings: [], explained: null, lang: "en" });
  assert.equal(JSON.parse(await readFile(path.join(plain, "summary.json"), "utf8")).trend, null);
  assert.doesNotMatch(await readFile(path.join(plain, "report.md"), "utf8"), /## Trend/);
  assert.equal(JSON.parse(await readFile(historyFile(dir, SITE), "utf8")).runs.length, 1);
});
