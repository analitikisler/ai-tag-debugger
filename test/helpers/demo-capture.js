// The real 0.17 demo run and a run whose site never opened, as the argument renderHtml takes. demo-capture-full.json is
// the capture.json of `npm run demo` (4 runs: browse and checkout on desktop and mobile, 18 findings, with network
// requests, metrics and consent scenarios); failed-capture.json is the same journeys against a site that did not
// answer. test/fixtures/demo-capture.json is an older, smaller capture that report-html, report-md and metrics tests
// assert exact values from, so it stays as it is. The captures are parsed once: treat them as read-only.
import { readFileSync } from "node:fs";
import { computeMetrics } from "../../src/metrics.js";

const load = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));
const demo = load("demo-capture-full.json");
const failed = load("failed-capture.json");

/** The parsed capture.json of the demo run. */
export const demoCapture = () => demo;
/** The parsed capture.json of the failed run. */
export const failedCapture = () => failed;

/** renderHtml's argument for a capture; metrics are computed with today's metrics.js, as audit.js does. Any other field can be overridden. */
function input(capture, { lang = "en", ...rest } = {}) {
  const plan = capture.config?.plan ?? null;
  const consentScenarios = capture.consentScenarios ?? null;
  return {
    title: "ai tag debugger report: localhost", site: "localhost", generatedAt: "2026-10-19 09:13 UTC", lang,
    ai: capture.ai ?? null, findings: capture.findings, explained: capture.explained ?? null, runs: capture.runs, plan, consentScenarios,
    metrics: computeMetrics({ plan, runs: capture.runs, findings: capture.findings, consentScenarios }),
    ...rest,
  };
}

/** renderHtml's argument for the demo run, in English unless lang says otherwise. */
export const reportInput = (opts) => input(demo, opts);
/** renderHtml's argument for the failed run. */
export const failedInput = (opts) => input(failed, opts);
