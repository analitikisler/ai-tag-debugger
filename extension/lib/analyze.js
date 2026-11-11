// The checks and the report for one recording, with the same functions src/audit.js calls for a CLI run: checkRun,
// annotateFindings, planCheck, computeMetrics and renderHtml. No model is called; the findings are deterministic.
import { checkRun, planCheck, summarize, groupFindings } from "../core/checks.js";
import { annotateFindings } from "../core/gtm.js";
import { computeMetrics } from "../core/metrics.js";
import { messages } from "../core/i18n.js";
import { verdictHeadline, VERSION } from "../core/report-shared.js";
import { renderHtml } from "../core/html/shell.js";
import { redactRun } from "./run.js";

/** A plan file's content as a plan, or an error message key. Only the shape the checks read is checked here. */
export function readPlan(text) {
  let plan;
  try {
    plan = JSON.parse(text);
  } catch {
    return { error: "planInvalid" };
  }
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.events) || plan.events.some((e) => !e || typeof e.name !== "string")) return { error: "planInvalid" };
  return { plan };
}

/**
 * Findings, counts, metrics and the verdict for a run, as { findings, counts, metrics, verdict, planCheck }.
 * plan: the measurement plan or null.
 */
export function analyze(run, { plan = null, lang = "en" } = {}) {
  const usedPlan = plan ?? { events: [] };
  const findings = annotateFindings(checkRun(usedPlan, run, { lang }), null, [run], { lang });
  const metrics = computeMetrics({ plan: usedPlan, runs: [run], findings });
  return {
    findings,
    counts: summarize(groupFindings(findings)),
    metrics,
    verdict: verdictHeadline({ findings, runs: [run], metrics, lang }),
    planCheck: plan ? planCheck(plan, [run], findings) : null,
  };
}

/** The report object renderHtml takes, for one recording. */
export function reportOf(run, { plan = null, lang = "en", site, generatedAt = new Date() }) {
  const { findings, metrics, planCheck: check } = analyze(run, { plan, lang });
  const host = (() => { try { return new URL(site).hostname; } catch { return String(site); } })();
  return {
    title: messages(lang).ui.title(host), site: host, ai: null,
    generatedAt: generatedAt.toISOString().slice(0, 16).replace("T", " ") + " UTC",
    findings, explained: null, runs: [run], plan: plan ?? { events: [] }, lang, branding: true,
    against: null, planCheck: check, changes: null, planChanges: null, consentScenarios: null, brand: null, metrics, trend: null,
  };
}

/** The HTML report. redacted: true for an exported file, false for the report tab, which stays on this computer. */
export function reportHtml(run, opts, { redacted = false } = {}) {
  return renderHtml(reportOf(redacted ? redactRun(run) : run, opts));
}

/**
 * capture.json in the format src/audit.js writes, with user data redacted, so `aitd` can read it like one of its own.
 * config.source marks where it came from.
 */
export function captureJson(run, { plan = null, lang = "en", site, extensionVersion }) {
  const safe = redactRun(run);
  const { findings, metrics } = analyze(safe, { plan, lang });
  return JSON.stringify({
    version: VERSION,
    ai: null,
    config: { site, source: "extension", extension_version: extensionVersion, language: lang, plan: plan ?? undefined },
    runs: [safe],
    findings,
    explained: null,
    metrics,
  }, null, 2);
}
