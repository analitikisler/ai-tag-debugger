// Deterministic checks that compare captured hits with the measurement plan.
// They run without any API call; the AI model only explains the results.

import { messages } from "./i18n.js";

const NON_GOOGLE_AD_PLATFORMS = new Set(["meta", "tiktok"]);
const EMAIL = /[A-Z0-9._%+-]+(@|%40)[A-Z0-9.-]+\.[A-Z]{2,}/i;
const SEVERITY_ORDER = { broken: 0, risk: 1, warning: 2, info: 3, ok: 4 };

/**
 * @typedef {{ platform: string, name: string, required_params?: string[], journeys?: string[], allow_multiple?: boolean }} PlanEvent
 * @typedef {{ consent_mode?: boolean, events: PlanEvent[] }} Plan
 * @typedef {{ severity: "broken"|"risk"|"warning"|"info"|"ok", check: string, journey: string, viewport: string, platform?: string, event?: string, step?: string, detail: string, evidence?: string }} Finding
 */

const key = (platform, name) => `${platform}:${name}`;

function expectedIn(planEvent, journeyId) {
  return !planEvent.journeys || planEvent.journeys.includes(journeyId);
}

function isConsentCommand(entry, kind) {
  return Array.isArray(entry.value) && entry.value[0] === "consent" && entry.value[1] === kind;
}

/** The step at which the visitor gave ad consent, from the run or from Consent Mode updates. */
export function consentGrantedStep(run) {
  const fromUpdate = run.dataLayerLog.find(
    (e) => isConsentCommand(e, "update") && e.value[2]?.ad_storage === "granted",
  );
  const candidates = [run.consentStep, fromUpdate?.step].filter((s) => s !== null && s !== undefined);
  return candidates.length ? Math.min(...candidates) : null;
}

/**
 * @param {Plan} plan
 * @param {{ journeyId: string, viewport: string, completed: boolean, note?: string, hits: any[], steps: any[], consentStep: number|null, dataLayerLog: any[] }} run
 * @param {{ lang?: string }} [opts] Report language for the finding texts.
 * @returns {Finding[]}
 */
export function checkRun(plan, run, { lang = "en" } = {}) {
  const d = messages(lang).detail;
  const findings = [];
  const base = { journey: run.journeyId, viewport: run.viewport };
  // Platforms are compared in lower case ("GA4" in a plan is ga4). Planned events for
  // providers the user chose not to check are left out, and listed in one info line.
  plan = { ...plan, events: plan.events.map((e) => ({ ...e, platform: String(e.platform ?? "").toLowerCase() })) };
  if (run.providers) {
    const skipped = plan.events.filter((e) => !run.providers.includes(e.platform) && expectedIn(e, run.journeyId));
    plan = { ...plan, events: plan.events.filter((e) => run.providers.includes(e.platform)) };
    if (skipped.length) findings.push({ ...base, severity: "info", check: "planned_out_of_scope", detail: d.plannedOutOfScope(skipped.map((e) => key(e.platform, e.name))) });
  }
  const stepLabel = (i) => run.steps[i]?.label ?? `step ${i}`;
  const planByKey = new Map(plan.events.map((e) => [key(e.platform, e.name), e]));

  if (!run.completed) {
    findings.push({ ...base, severity: "warning", check: "journey_incomplete", detail: d.journeyIncomplete(run.note) });
  }

  // Expected events that never fired.
  for (const ev of plan.events) {
    if (!expectedIn(ev, run.journeyId)) continue;
    const fired = run.hits.some((h) => h.platform === ev.platform && h.name === ev.name);
    if (!fired) {
      findings.push({
        ...base,
        severity: run.completed ? "broken" : "info",
        check: "missing_event",
        platform: ev.platform,
        event: ev.name,
        detail: run.completed ? d.missingEvent(ev.platform, ev.name) : d.missingEventEarly(ev.name),
      });
    }
  }

  // Required parameters missing on events that did fire (reported once per event).
  const paramsReported = new Set();
  for (const hit of run.hits) {
    const ev = planByKey.get(key(hit.platform, hit.name));
    if (!ev?.required_params?.length) continue;
    const missing = ev.required_params.filter((p) => hit.params[p] === undefined || hit.params[p] === "");
    const reportKey = `${key(hit.platform, hit.name)}|${missing.join(",")}`;
    if (missing.length && !paramsReported.has(reportKey)) {
      paramsReported.add(reportKey);
      findings.push({
        ...base,
        severity: "broken",
        check: "missing_params",
        platform: hit.platform,
        event: hit.name,
        step: stepLabel(hit.step),
        detail: d.missingParams(hit.name, missing),
        evidence: JSON.stringify(hit.params),
      });
    }
  }

  // The same event sent more than once by a single action.
  const perStep = new Map();
  for (const hit of run.hits) {
    const k = `${hit.step}|${key(hit.platform, hit.name)}`;
    perStep.set(k, [...(perStep.get(k) ?? []), hit]);
  }
  for (const [, hits] of perStep) {
    const ev = planByKey.get(key(hits[0].platform, hits[0].name));
    if (hits.length < 2 || ev?.allow_multiple) continue;
    findings.push({
      ...base,
      severity: "warning",
      check: "duplicate",
      platform: hits[0].platform,
      event: hits[0].name,
      step: stepLabel(hits[0].step),
      detail: d.duplicate(hits[0].name, hits.length),
    });
  }

  // Consent.
  const granted = consentGrantedStep(run);
  const firstHitStep = run.hits.length ? Math.min(...run.hits.map((h) => h.step)) : null;
  if (plan.consent_mode) {
    const defaultEntry = run.dataLayerLog.find((e) => isConsentCommand(e, "default"));
    if (!defaultEntry) {
      findings.push({ ...base, severity: "risk", check: "consent_default_missing", detail: d.consentDefaultMissing() });
    } else if (firstHitStep !== null && defaultEntry.step > firstHitStep) {
      findings.push({ ...base, severity: "risk", check: "consent_default_late", detail: d.consentDefaultLate() });
    }
  }
  const beforeConsent = new Map();
  for (const hit of run.hits) {
    const early = granted === null || hit.step < granted;
    if (!early) continue;
    const adPlatform = NON_GOOGLE_AD_PLATFORMS.has(hit.platform);
    const googleClaimsGranted = hit.consent?.ad_storage === "granted" || hit.consent?.analytics_storage === "granted";
    if (adPlatform || googleClaimsGranted) {
      const k = key(hit.platform, hit.name);
      if (!beforeConsent.has(k)) beforeConsent.set(k, hit);
    }
  }
  for (const [, hit] of beforeConsent) {
    findings.push({
      ...base,
      severity: "risk",
      check: "before_consent",
      platform: hit.platform,
      event: hit.name,
      step: stepLabel(hit.step),
      detail: granted === null ? d.beforeConsentNever(hit.platform, hit.name) : d.beforeConsent(hit.platform, hit.name),
    });
  }

  // Personal data in hits.
  const piiSeen = new Set();
  for (const hit of run.hits) {
    let url = hit.url;
    try {
      url = decodeURIComponent(hit.url);
    } catch { /* malformed % sequence, e.g. "50%": search the raw URL */ }
    const haystack = url + " " + JSON.stringify(hit.params);
    if (piiSeen.has(key(hit.platform, hit.name))) continue;
    // User data for ad matching is redacted at capture; userData.plain lists the fields that were not hashed.
    if (hit.userData?.plain?.length) {
      piiSeen.add(key(hit.platform, hit.name));
      findings.push({ ...base, severity: "risk", check: "pii", platform: hit.platform, event: hit.name, step: stepLabel(hit.step), detail: d.piiUnhashed(hit.platform, hit.name, hit.userData.plain) });
    } else if (EMAIL.test(haystack)) {
      piiSeen.add(key(hit.platform, hit.name));
      findings.push({ ...base, severity: "risk", check: "pii", platform: hit.platform, event: hit.name, step: stepLabel(hit.step), detail: d.pii(hit.platform, hit.name) });
    }
  }

  // Events that are not in the plan.
  const unplanned = [...new Set(run.hits.filter((h) => !planByKey.has(key(h.platform, h.name))).map((h) => key(h.platform, h.name)))];
  if (unplanned.length) {
    findings.push({ ...base, severity: "info", check: "unplanned_events", detail: d.unplanned(unplanned) });
  }

  // Planned events that fired cleanly.
  const problemKeys = new Set(findings.filter((f) => f.event).map((f) => key(f.platform, f.event)));
  const okKeys = [...new Set(run.hits.map((h) => key(h.platform, h.name)))].filter((k) => planByKey.has(k) && !problemKeys.has(k));
  if (okKeys.length) {
    findings.push({ ...base, severity: "ok", check: "matches_plan", detail: d.matches(okKeys) });
  }

  return findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function summarize(findings) {
  const counts = { broken: 0, risk: 0, warning: 0, info: 0, ok: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}

/**
 * Merges the same problem seen on several journeys or viewports into one
 * finding with a list of places, so the report reads as a list of problems.
 */
export function groupFindings(findings) {
  const groups = new Map();
  for (const f of findings) {
    const k = f.severity === "ok" ? `ok|${f.journey}|${f.viewport}` : [f.severity, f.check, f.platform, f.event, f.detail].join("|");
    const where = { journey: f.journey, viewport: f.viewport, step: f.step };
    if (groups.has(k)) groups.get(k).where.push(where);
    else groups.set(k, { severity: f.severity, check: f.check, platform: f.platform, event: f.event, detail: f.detail, evidence: f.evidence, where: [where] });
  }
  return [...groups.values()].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
