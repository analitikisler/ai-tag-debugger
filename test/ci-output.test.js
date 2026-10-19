import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSummary, failsAt, findingTitle, renderJunit, runSeconds } from "../src/ci-output.js";

const t0 = 1_000_000;
const run = (over) => ({
  journeyId: "checkout",
  viewport: "desktop",
  startedAt: t0,
  completed: true,
  note: "All scripted steps completed.",
  steps: [{ index: 0, label: "start", t: t0 }, { index: 1, label: "Add to cart", t: t0 + 1500 }],
  hits: [{ platform: "ga4", name: "add_to_cart", params: {}, url: "https://x/g/collect?en=add_to_cart", step: 1, t: t0 + 2500 }],
  ...over,
});
const runs = [run(), run({ viewport: "mobile", completed: false, note: 'Step "Pay" failed: <button> not found & gone' })];
const findings = [
  { journey: "checkout", viewport: "desktop", severity: "broken", check: "missing_params", platform: "ga4", event: "add_to_cart", step: "Add to cart", detail: '"add_to_cart" was sent without "value".' },
  { journey: "checkout", viewport: "desktop", severity: "risk", check: "pii", platform: "meta", event: "Purchase", detail: "An email address was sent in plain text with \"Purchase\" to meta." },
  { journey: "checkout", viewport: "mobile", severity: "warning", check: "journey_incomplete", detail: "The journey did not reach its goal. Events after that point could not be checked." },
  { journey: "checkout", viewport: "mobile", severity: "info", check: "unplanned_events", detail: "Events sent that are not in the measurement plan: ga4:scroll." },
  { journey: "checkout", viewport: "desktop", severity: "ok", check: "matches_plan", detail: "1 planned events matched the plan: ga4:purchase." },
];
const plan = { events: [{ platform: "ga4", name: "purchase" }, { platform: "Meta", name: "Purchase" }] };

const suites = (xml) => [...xml.matchAll(/<testsuite name="([^"]*)" tests="(\d+)" failures="(\d+)"[^>]*time="([^"]*)"/g)].map((m) => ({ name: m[1], tests: Number(m[2]), failures: Number(m[3]), time: m[4] }));
const failures = (xml) => [...xml.matchAll(/<failure message="[^"]*" type="([^"]*)"/g)].map((m) => m[1]);

test("one suite per journey and viewport, with the run's duration and counts", () => {
  const xml = renderJunit({ runs, findings, lang: "en", failOn: "broken", version: "1.0.0", site: "example.com" });
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<testsuites name="ai-tag-debugger example.com" version="1.0.0" tests="7" failures="2" time="5"/);
  assert.deepEqual(suites(xml), [
    { name: "checkout (desktop)", tests: 4, failures: 1, time: "2.5" },
    { name: "checkout (mobile)", tests: 3, failures: 1, time: "2.5" },
  ]);
  assert.match(xml, /<testcase classname="missing_params" name="GA4 add_to_cart: &quot;add_to_cart&quot; was sent without &quot;value&quot;." time="0">/);
  assert.match(xml, /<testcase classname="matches_plan" name="1 planned events matched the plan: ga4:purchase." time="0"><system-out>/);
  assert.equal(runSeconds({ journeyId: "x", steps: [] }), 0);
});

test("the fail-on level decides which findings are failures", () => {
  assert.deepEqual(failures(renderJunit({ runs, findings, failOn: "broken" })), ["broken", "incomplete"]);
  assert.deepEqual(failures(renderJunit({ runs, findings, failOn: "risk" })), ["broken", "risk", "incomplete"]);
  assert.deepEqual(failures(renderJunit({ runs, findings, failOn: "warning" })), ["broken", "risk", "incomplete", "warning"]);
  // "never" fails nothing in the CLI, so nothing fails here either, not even the journey that did not finish.
  assert.deepEqual(failures(renderJunit({ runs, findings, failOn: "never" })), []);
  const risk = renderJunit({ runs, findings, failOn: "risk" });
  assert.match(risk, /<testcase classname="pii" name="Meta Purchase: An email address[^"]*" time="0"><failure message="Meta Purchase: An email address[^"]*" type="risk">An email address was sent in plain text with &quot;Purchase&quot; to meta.<\/failure><\/testcase>/);
  // Below the threshold, the message is kept as output, not as a failure.
  assert.match(renderJunit({ runs, findings, failOn: "broken" }), /<testcase classname="pii" [^>]*><system-out>An email address/);
  assert.equal(failsAt({ severity: "broken" }, "never"), false);
  assert.equal(failsAt({ severity: "risk" }, "risk"), true);
  assert.equal(failsAt({ severity: "warning" }, "risk"), false);
});

test("an incomplete journey is a failing 'journey completed' case, and special characters are escaped", () => {
  const xml = renderJunit({ runs, findings });
  assert.match(xml, /<testsuite name="checkout \(mobile\)"[^>]*>\n {4}<testcase classname="journey" name="journey completed" time="2.5"><failure message="Step &quot;Pay&quot; failed: &lt;button&gt; not found &amp; gone" type="incomplete">Step &quot;Pay&quot; failed: &lt;button&gt; not found &amp; gone<\/failure><\/testcase>/);
  assert.match(xml, /<testsuite name="checkout \(desktop\)"[^>]*>\n {4}<testcase classname="journey" name="journey completed" time="2.5"><system-out>All scripted steps completed.<\/system-out><\/testcase>/);
  assert.doesNotMatch(xml, /[^&]<button>|&(?!lt;|gt;|amp;|quot;|apos;)/);
  const control = renderJunit({ runs: [run()], findings: [{ ...findings[0], detail: "bad\u0000char" }] });
  assert.match(control, /badchar/);
  assert.match(renderJunit({ runs, findings, lang: "tr" }), /name="yolculuk tamamlandı"/);
});

test("accepted findings pass, and findings not tied to a run get a suite of their own", () => {
  const accepted = findings.map((f) => (f.severity === "broken" ? { ...f, accepted: true } : f));
  assert.deepEqual(failures(renderJunit({ runs, findings: accepted, failOn: "broken" })), ["incomplete"]);
  const loose = [...findings, { severity: "risk", check: "consent_default_missing", detail: "No consent default." }];
  const xml = renderJunit({ runs, findings: loose, failOn: "risk" });
  assert.deepEqual(suites(xml).map((s) => s.name), ["checkout (desktop)", "checkout (mobile)", "site"]);
  assert.match(xml, /<testsuite name="site" tests="1" failures="1"/);
  assert.doesNotMatch(renderJunit({ runs, findings }), /name="site"/);
});

test("the summary has the counts, the journeys, each finding and the file list", () => {
  const s = buildSummary({ runs, findings, plan, against: { id: "2026-10-01_0900", file: "x" }, ai: { name: "anthropic", model: "m", key: "secret" }, lang: "en", reportPath: "/out/run/report.html", outDir: "/out/run", changes: { previous: "p", fixed: [{ check: "pii" }], new: [] }, version: "1.2.3", site: "example.com" });
  assert.equal(s.version, "1.2.3");
  assert.equal(s.site, "example.com");
  assert.match(s.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(s.ai, { name: "anthropic", model: "m" });
  assert.deepEqual(s.plan, { id: "2026-10-01_0900", events: ["ga4:purchase", "meta:Purchase"] });
  assert.deepEqual(s.journeys, [
    { id: "checkout", viewport: "desktop", completed: true, note: "All scripted steps completed.", steps: 2, hits: 1 },
    { id: "checkout", viewport: "mobile", completed: false, note: 'Step "Pay" failed: <button> not found & gone', steps: 2, hits: 1 },
  ]);
  assert.deepEqual(s.counts, { broken: 1, risk: 1, warning: 1, info: 1, ok: 1 });
  assert.equal(s.findings.length, 5);
  assert.deepEqual(s.findings[0], { check: "missing_params", severity: "broken", platform: "ga4", event: "add_to_cart", journey: "checkout", viewport: "desktop", title: 'GA4 add_to_cart: "add_to_cart" was sent without "value".', message: '"add_to_cart" was sent without "value".', key: "ga4:add_to_cart" });
  assert.equal("key" in s.findings[2], false);
  assert.deepEqual(s.changes, { fixed: [{ check: "pii" }], new: [] });
  // Only the folder's name, not the runner's path: the file is uploaded as a CI artifact.
  assert.equal(s.run, "run");
  assert.equal("dir" in s, false);
  assert.deepEqual(s.files, { html: "report.html", md: "report.md", csv: "timeline.csv", capture: "capture.json", planCheck: "plan-check.json", junit: "junit.xml", summary: "summary.json" });
  assert.equal(s.verdict, null);
  assert.equal(s.score, null);
  assert.equal(s.trend, null);
  const judged = buildSummary({ runs, findings, reportPath: "/out/run/report.html", outDir: "/out/run", metrics: { verdict: { status: "fail", headline: "fail_broken", counts: {} }, score: { score: 25, deductions: [] } }, trend: { direction: "improving", runs: 4, series: [] } });
  assert.deepEqual(judged.verdict, { status: "fail", headline: "fail_broken" });
  assert.equal(judged.score, 25);
  assert.deepEqual(judged.trend, { direction: "improving", runs: 4 });
  const plain = buildSummary({ runs, findings: [{ ...findings[0], accepted: true }], reportPath: "/out/run/report.html", outDir: "/out/run" });
  assert.deepEqual(plain.plan, { id: null, events: [] });
  assert.equal(plain.ai, null);
  assert.equal(plain.changes, null);
  assert.equal(plain.findings[0].accepted, true);
  assert.equal("planCheck" in plain.files, false);
  // An accepted finding is listed but not counted, so a baseline keeps the exit code and the summary in step.
  assert.deepEqual(plain.counts, { broken: 0, risk: 0, warning: 0, info: 0, ok: 0 });
});

test("a finding's title is short and names the platform and event when it has them", () => {
  assert.equal(findingTitle({ check: "consent_default_missing", detail: "No consent default." }), "No consent default.");
  assert.equal(findingTitle({ check: "x", platform: "google_ads", event: "conversion", detail: "d" }), "Google Ads conversion: d");
  const long = findingTitle({ check: "x", detail: "w".repeat(200) });
  assert.equal(long.length, 120);
  assert.ok(long.endsWith("…"));
});
