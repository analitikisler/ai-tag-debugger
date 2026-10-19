// Machine-readable outputs for CI: junit.xml, which GitHub Actions, GitLab and Jenkins show as test
// results, and summary.json, a small file a script can read without parsing capture.json.
import path from "node:path";
import { groupFindings, summarize } from "./checks.js";
import { messages } from "./i18n.js";
import { platformLabel } from "./report.js";

// The same order the CLI uses for --fail-on: a finding fails when its severity is at or above the level.
const LEVELS = ["broken", "risk", "warning", "info"];

/** Whether a finding counts as a failure under --fail-on. Accepted (baselined) findings never do. */
export function failsAt(finding, failOn = "broken") {
  if (failOn === "never" || finding.accepted === true) return false;
  const level = LEVELS.indexOf(finding.severity);
  return level !== -1 && level <= LEVELS.indexOf(failOn);
}

/** How long a run took in seconds, from its start to its last step or hit; 0 when the run has no timing. */
export function runSeconds(run) {
  if (typeof run?.startedAt !== "number") return 0;
  const last = Math.max(...[...(run.steps ?? []), ...(run.hits ?? [])].map((x) => x?.t ?? 0));
  return last > run.startedAt ? Math.round((last - run.startedAt) / 10) / 100 : 0;
}

/** The one-line name of a finding: platform and event when it has them, then the message. */
export function findingTitle(f) {
  const what = [f.platform ? platformLabel(f.platform) : "", f.event ?? ""].filter(Boolean).join(" ");
  const line = what ? `${what}: ${f.detail}` : f.detail ?? f.check;
  return line.length > 120 ? `${line.slice(0, 119).trimEnd()}…` : line;
}

const escapeXml = (s) => String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
// Control characters are not allowed in XML 1.0 at all, so they are dropped rather than escaped.
// eslint-disable-next-line no-control-regex
const xmlText = (s) => escapeXml(String(s ?? "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ""));
const attrs = (o) => Object.entries(o).map(([k, v]) => ` ${k}="${xmlText(v)}"`).join("");

const belongsTo = (f, run) => f.journey === run.journeyId && f.viewport === run.viewport;

// A case is { xml, failed }: a failure carries the detail in its body, a pass keeps it in system-out.
const testcase = ({ classname, name, time = 0, failed, type, text, message = name }) => ({
  failed,
  xml: `<testcase${attrs({ classname, name, time })}>${failed ? `<failure${attrs({ message, type })}>${xmlText(text)}</failure>` : text ? `<system-out>${xmlText(text)}</system-out>` : ""}</testcase>`,
});

const findingCase = (f, failOn) => testcase({ classname: f.check, name: findingTitle(f), failed: failsAt(f, failOn), type: f.severity, text: f.detail });

function suite(name, cases, seconds) {
  const failures = cases.filter((c) => c.failed).length;
  return { failures, tests: cases.length, xml: `  <testsuite${attrs({ name, tests: cases.length, failures, errors: 0, skipped: 0, time: seconds })}>\n${cases.map((c) => `    ${c.xml}`).join("\n")}\n  </testsuite>` };
}

/**
 * JUnit XML: one suite per journey and viewport, one case per finding, plus a "journey completed" case
 * that fails when the journey did not reach its goal. Findings not tied to a run go in a suite of their own.
 */
export function renderJunit({ runs = [], findings = [], lang = "en", failOn = "broken", version = "", site = "" }) {
  const m = messages(lang).ui;
  const suites = runs.map((run) => {
    const journey = testcase({ classname: "journey", name: m.junitJourney, time: runSeconds(run), failed: run.completed === false, type: "incomplete", text: run.note, message: run.note ?? "" });
    return suite(`${run.journeyId} (${run.viewport})`, [journey, ...findings.filter((f) => belongsTo(f, run)).map((f) => findingCase(f, failOn))], runSeconds(run));
  });
  const loose = findings.filter((f) => !runs.some((run) => belongsTo(f, run)));
  if (loose.length) suites.push(suite(m.junitSite, loose.map((f) => findingCase(f, failOn)), 0));
  const totals = { tests: suites.reduce((n, s) => n + s.tests, 0), failures: suites.reduce((n, s) => n + s.failures, 0), time: runs.reduce((n, r) => n + runSeconds(r), 0) };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites${attrs({ name: `ai-tag-debugger ${site}`.trim(), ...(version ? { version } : {}), ...totals })}>\n${suites.map((s) => s.xml).join("\n")}\n</testsuites>\n`;
}

/** The run in one small object: counts, journeys, findings and where the other files are. */
export function buildSummary({ runs = [], findings = [], counts, plan = null, against = null, ai = null, lang = "en", reportPath, outDir, changes = null, version = "", site = "" }) {
  // File names are relative to the run folder, so a summary uploaded as a CI artifact still makes sense on another machine.
  const dir = outDir ?? (reportPath ? path.dirname(reportPath) : ".");
  const file = (name) => name;
  return {
    version,
    site,
    generatedAt: new Date().toISOString(),
    lang,
    ai: ai ? { name: ai.name, model: ai.model } : null,
    plan: { id: against?.id ?? null, events: (plan?.events ?? []).map((e) => `${String(e.platform ?? "").toLowerCase()}:${e.name}`) },
    journeys: runs.map((r) => ({ id: r.journeyId, viewport: r.viewport, completed: r.completed !== false, note: r.note ?? "", steps: r.steps?.length ?? 0, hits: r.hits?.length ?? 0 })),
    counts: counts ?? summarize(groupFindings(findings)),
    findings: findings.map((f) => ({
      check: f.check,
      severity: f.severity,
      platform: f.platform ?? null,
      event: f.event ?? null,
      journey: f.journey ?? null,
      viewport: f.viewport ?? null,
      title: findingTitle(f),
      message: f.detail ?? "",
      ...(f.platform && f.event ? { key: `${f.platform}:${f.event}` } : {}),
      ...(f.accepted === true ? { accepted: true } : {}),
    })),
    changes: changes ? { fixed: changes.fixed ?? [], new: changes.new ?? [] } : null,
    dir,
    files: { html: file("report.html"), md: file("report.md"), csv: file("timeline.csv"), capture: file("capture.json"), ...(against ? { planCheck: file("plan-check.json") } : {}), junit: file("junit.xml"), summary: file("summary.json") },
  };
}
