// Accepted findings: keys that stay the same between runs, the file they are kept in, and runs that
// fail only on new findings.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyBaseline, findingKey, readBaseline, writeBaseline } from "../src/baseline.js";
import { groupFindings, summarize } from "../src/checks.js";
import { renderHtml, renderMarkdown } from "../src/report.js";

const finding = (extra = {}) => ({ journey: "checkout", viewport: "desktop", severity: "broken", check: "missing_params", platform: "ga4", event: "purchase", step: "Place the order", params: ["value"], detail: '"purchase" was sent without "value".', evidence: '{"currency":"EUR"}', ...extra });

let dir;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "atd-baseline-"));
});
after(() => rm(dir, { recursive: true, force: true }));

test("the key is the same for the same problem seen again, and differs by parameter, place and check", () => {
  const again = finding({ step: "Pay", evidence: '{"currency":"USD"}', detail: '"purchase" olayı "value" parametresi olmadan gönderildi.' });
  assert.equal(findingKey(finding()), findingKey(again));
  assert.notEqual(findingKey(finding()), findingKey(finding({ params: ["items"] })));
  assert.notEqual(findingKey(finding()), findingKey(finding({ viewport: "mobile" })));
  assert.notEqual(findingKey(finding()), findingKey(finding({ journey: "browse" })));
  assert.notEqual(findingKey(finding()), findingKey(finding({ check: "duplicate", params: undefined })));
  assert.equal(findingKey({ check: "consent_default_missing", journey: "j", viewport: "desktop" }), "consent_default_missing - - j desktop -");
});

test("applyBaseline flags the matches, leaves ok findings alone and names the entries no longer seen", () => {
  const findings = [finding(), finding({ viewport: "mobile" }), { journey: "checkout", viewport: "desktop", severity: "ok", check: "matches_plan", detail: "fine" }];
  const baseline = { findings: [{ key: findingKey(finding()) }, { key: "duplicate ga4 add_to_cart checkout desktop -" }] };
  assert.deepEqual(applyBaseline(findings, baseline), { accepted: 1, stale: ["duplicate ga4 add_to_cart checkout desktop -"] });
  assert.equal(findings[0].accepted, true);
  assert.equal(findings[1].accepted, undefined);
  assert.equal(findings[2].accepted, undefined);
});

test("accepted findings are left out of the counts, and a grouped problem is accepted only in all its places", () => {
  const findings = [finding(), finding({ viewport: "mobile" }), finding({ check: "duplicate", severity: "warning", event: "add_to_cart", params: undefined })];
  applyBaseline(findings, { findings: [{ key: findingKey(findings[0]) }, { key: findingKey(findings[2]) }] });
  const grouped = groupFindings(findings);
  assert.deepEqual(grouped.map((f) => [f.check, f.accepted ?? false]), [["missing_params", false], ["duplicate", true]]);
  assert.deepEqual(summarize(grouped), { broken: 1, risk: 0, warning: 0, info: 0, ok: 0 });
  applyBaseline(findings, { findings: [{ key: findingKey(findings[1]) }] });
  assert.deepEqual(summarize(groupFindings(findings)), { broken: 0, risk: 0, warning: 0, info: 0, ok: 0 });
});

test("writeBaseline and readBaseline round-trip, keep notes, and reject files that are not baselines", async () => {
  const file = path.join(dir, "nested", "baseline.json");
  const findings = [finding(), finding({ step: "Pay" }), finding({ check: "duplicate", severity: "warning", event: "add_to_cart", params: undefined }), { journey: "checkout", viewport: "desktop", severity: "ok", check: "matches_plan", detail: "fine" }];
  assert.equal(await writeBaseline(file, { site: "https://shop.test", findings }), 2);
  const written = await readBaseline(file);
  assert.equal(written.site, "https://shop.test");
  assert.match(written.updated, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(written.findings[0], { key: findingKey(finding()), check: "missing_params", severity: "broken", platform: "ga4", event: "purchase", journey: "checkout", viewport: "desktop" });
  assert.deepEqual(applyBaseline(findings, written), { accepted: 3, stale: [] });

  written.findings[0].note = "Value is added in the next release.";
  await writeFile(file, JSON.stringify(written));
  assert.equal(await writeBaseline(file, { site: "https://shop.test", findings: findings.slice(0, 1) }), 1);
  assert.equal((await readBaseline(file)).findings[0].note, "Value is added in the next release.");

  await assert.rejects(readBaseline(path.join(dir, "missing.json")), (err) => err.code === "ENOENT" && /Could not read the baseline/.test(err.message));
  await writeFile(path.join(dir, "plan.json"), JSON.stringify({ events: [] }));
  await assert.rejects(readBaseline(path.join(dir, "plan.json")), /is not a baseline: it needs a "findings" list/);
});

test("the reports label accepted findings, in English and Turkish, and say how many are not counted", () => {
  const run = { journeyId: "checkout", viewport: "desktop", startedAt: 0, completed: true, note: "done", steps: [{ index: 0, label: "start", t: 0 }], hits: [], dataLayerLog: [], network: [] };
  const findings = [finding({ accepted: true }), finding({ check: "duplicate", severity: "warning", event: "add_to_cart", params: undefined, detail: "sent twice" })];
  const md = renderMarkdown({ title: "t", generatedAt: "now", findings, explained: null, runs: [run], lang: "en" });
  assert.match(md, /\*\*0 broken · 0 risk · 1 warning · 0 info · 0 ok\*\*\n\n1 accepted finding from the baseline is not counted\n/);
  assert.match(md, /^### Broken \(Accepted\): `purchase` was sent without `value`\./m);
  assert.match(md, /^### Warning: sent twice/m);
  const html = renderHtml({ title: "t", generatedAt: "now", findings, explained: null, runs: [run], lang: "en" });
  assert.match(html, /<div class="meta accepted-line">1 accepted finding from the baseline is not counted<\/div>/);
  assert.match(html, /<span class="badge broken">Broken<\/span><span class="badge muted">Accepted<\/span>/);
  assert.equal((html.match(/class="badge muted">Accepted/g) ?? []).length, 1);
  const tr = renderMarkdown({ title: "t", generatedAt: "now", findings, explained: null, runs: [run], lang: "tr" });
  assert.match(tr, /Temel dosyada kabul edilen 1 bulgu sayılmadı/);
  assert.match(tr, /^### Bozuk \(Kabul edildi\):/m);
  const none = renderMarkdown({ title: "t", generatedAt: "now", findings: findings.slice(1), explained: null, runs: [run], lang: "en" });
  assert.doesNotMatch(none, /accepted/);
});

// The demo shop, replayed without AI: a run that writes the baseline still fails, the next one passes.
const PORT = 4396;
const cli = (args, cwd) => {
  try {
    return { status: 0, stdout: execFileSync(process.execPath, [path.resolve("src/cli.js"), ...args], { cwd, encoding: "utf8", stdio: "pipe" }) };
  } catch (e) {
    return { status: e.status, stdout: e.stdout, stderr: e.stderr };
  }
};

test("a run with --update-baseline writes the file, and the next run with --baseline exits 0 on the same findings", async () => {
  const server = spawn(process.execPath, ["examples/serve.js"], { env: { ...process.env, PORT: String(PORT) }, stdio: "pipe" });
  await new Promise((resolve) => server.stdout.once("data", resolve));
  try {
    const config = {
      site: `http://localhost:${PORT}`,
      plan: path.resolve("examples/measurement-plan.json"),
      viewports: ["desktop"],
      consent_scenarios: false,
      baseline: "known/baseline.json",
      journeys: [{ id: "browse", steps: [
        { action: "click", selector: "#consent-accept", accepts_consent: true, reason: "Accept cookies" },
        { action: "click", selector: "a.card", reason: "Open the first product" },
        { action: "click", selector: "#add-to-cart", reason: "Add to cart" },
      ] }],
    };
    await writeFile(path.join(dir, "demo.config.json"), JSON.stringify(config));
    const common = ["run", "--config", "demo.config.json", "--scripted", "--no-ai", "--fail-on", "risk", "--data-dir", "data"];

    const missing = cli([...common, "--baseline", "nowhere.json"], dir);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /Could not read the baseline nowhere\.json/);

    const first = cli([...common, "--update-baseline"], dir);
    assert.equal(first.status, 1, first.stdout);
    assert.match(first.stdout, /\n0 broken · 1 risk · 1 warning · 0 info · 1 ok\n/);
    assert.doesNotMatch(first.stdout, /accepted \(baseline/);
    assert.match(first.stdout, /Baseline .*known[\\/]baseline\.json now holds 2 findings\./);
    const baseline = JSON.parse(await readFile(path.join(dir, "known", "baseline.json"), "utf8"));
    assert.equal(baseline.site, config.site);
    assert.deepEqual(baseline.findings.map((f) => `${f.severity} ${f.check} ${f.platform} ${f.event}`), ["risk before_consent meta PageView", "warning duplicate ga4 add_to_cart"]);

    baseline.findings.push({ key: "duplicate ga4 purchase checkout desktop -", note: "fixed last week" });
    await writeFile(path.join(dir, "known", "baseline.json"), JSON.stringify(baseline));
    const second = cli(common, dir);
    assert.equal(second.status, 0, second.stdout);
    assert.match(second.stdout, /\n0 broken · 0 risk · 0 warning · 0 info · 1 ok\n2 accepted \(baseline .*known[\\/]baseline\.json\), 1 stale baseline entry\n/);
    const runDir = path.dirname(second.stdout.match(/Report: (.+report\.html)/)[1]);
    const capture = JSON.parse(await readFile(path.join(dir, runDir, "capture.json"), "utf8"));
    assert.deepEqual(capture.findings.filter((f) => f.severity !== "ok").map((f) => f.accepted), [true, true]);
    assert.match(await readFile(path.join(dir, runDir, "report.md"), "utf8"), /2 accepted findings from the baseline are not counted/);
  } finally {
    server.kill();
  }
});
