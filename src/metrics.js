// Numbers for the report, computed from the captured data alone: a verdict and a data quality score,
// plan coverage, the expected-versus-observed funnel of each journey, platform parity, consent
// compliance, conversion integrity, timing, and where the problems sit. Every function is pure over
// { plan, runs, findings, consentScenarios } (no I/O, no AI, no HTML) and returns plain data; the
// report decides how to show it. The rules are documented in docs/design/metrics.md.

import { canonicalEvent, groupFindings, hasParam, hitMatchesEvent, isConsentCommand, PLAN_BUCKETS, planCheck, summarize } from "./checks.js";
import { AD_PLATFORMS, CONSENT_STATES, consentTable } from "./consent.js";
import { presetFor } from "./journeys.js";
import { OWNERS, ownerOf } from "./verify.js";

/**
 * What one problem costs on the data quality score, out of 100. The score counts distinct problems
 * (the same finding on desktop and mobile is one), so a site does not score lower only because it
 * was walked in more viewports. A problem on a conversion event is multiplied, because that is the
 * data the money decisions rest on. Change the numbers here; nothing else encodes them.
 */
export const SCORE_WEIGHTS = {
  severity: { broken: 15, risk: 10, warning: 5, info: 0, ok: 0 },
  // An unfinished journey hides every event after the point it stopped, so it costs as much as a broken event.
  check: { journey_incomplete: 15 },
  conversion: 2,
};

/** Events whose data decides revenue or lead counts, in the canonical form canonicalEvent gives. */
export const CONVERSION_EVENTS = new Set(["purchase", "generatelead", "lead", "signup", "completeregistration", "subscribe"]);

const PROBLEM_SEVERITIES = ["broken", "risk", "warning"];
const SEVERITY_ORDER = { broken: 0, risk: 1, warning: 2, info: 3, ok: 4 };
const GOOGLE_PLATFORMS = new Set(["ga4", "google_ads"]);
// Consent Mode v2 added two signals to ad_storage and analytics_storage. Google requires them for EEA/UK traffic.
const V2_SIGNALS = ["ad_user_data", "ad_personalization"];
// Consent findings that say the visitor's "no" was not honoured, against the ones that say the setup is risky.
const CONSENT_FAIL_CHECKS = new Set(["after_reject", "cookies_after_reject", "reject_ignored", "reject_button_failed"]);
const CONSENT_ATTENTION_CHECKS = new Set(["before_consent", "cookies_before_consent", "consent_default_missing", "consent_default_late", "consent_v2_missing", "consent_v2_update"]);
const CONSENT_CHECK = /^(consent_|cookies_|reject_|before_consent|after_reject)/;

// Ecommerce parameters sites send under another name (UA-style products/revenue, order ids), as checks.js reads them.
const PARAM_ALIASES = {
  items: ["products", "item_list", "contents"],
  value: ["revenue", "total"],
  transaction_id: ["order_id", "orderid", "oid"],
  currency: ["currency_code", "cu"],
};
const EMPTY_LIST = /^\s*(\[\s*\])?\s*$/;

const isConversion = (name) => CONVERSION_EVENTS.has(canonicalEvent(name));
const isProblem = (f) => PROBLEM_SEVERITIES.includes(f.severity);
const expectedIn = (ev, journeyId) => !ev.journeys || ev.journeys.includes(journeyId);
const checked = (ev, run) => !run.providers || run.providers.includes(ev.platform);
const lowerPlatform = (ev) => ({ ...ev, platform: String(ev.platform ?? "").toLowerCase() });
const round = (n, digits = 0) => (n == null ? null : Math.round(n * 10 ** digits) / 10 ** digits);
const percent = (part, whole) => (whole ? Math.round((part / whole) * 100) : null);
const emptyCounts = () => ({ broken: 0, risk: 0, warning: 0, info: 0, ok: 0 });
/** Whether a happened before b: an earlier step, or the same step and an earlier time when both have one. */
const sentBefore = (a, b) => a.step < b.step || (a.step === b.step && a.t != null && b.t != null && a.t < b.t);
const byTime = (a, b) => (sentBefore(a, b) ? -1 : sentBefore(b, a) ? 1 : 0);
const uniq = (list) => [...new Set(list)];

/** A hit's parameter under its own name or the first common alias it carries. */
function paramOf(hit, name) {
  for (const n of [name, ...(PARAM_ALIASES[name] ?? [])]) {
    if (hit.params?.[n] !== undefined && hit.params[n] !== "") return hit.params[n];
  }
  return undefined;
}

/** The run's step with this index, or with this label when the finding only carries the label. */
const stepOf = (run, ref) => (run?.steps ?? []).find((s) => (typeof ref === "number" ? s.index === ref : s.label === ref)) ?? null;

/** Points one grouped finding takes off the score: its severity weight (or the check's own), doubled on a conversion event. */
function deductionFor(f) {
  const base = SCORE_WEIGHTS.check[f.check] ?? SCORE_WEIGHTS.severity[f.severity] ?? 0;
  const conversion = Boolean(f.event && isConversion(f.event));
  return { points: base * (conversion ? SCORE_WEIGHTS.conversion : 1), conversion };
}

/**
 * Pass, fail or attention, from the findings and whether every journey finished. Fail: any broken
 * finding or any journey that did not complete. Attention: only risks or warnings, or nothing to
 * judge (no runs, or runs that captured no hit at all). Pass: neither. Counts are over distinct
 * problems (groupFindings), as the report's overview shows them. The headline is a key for the
 * renderer's texts: fail_broken, fail_incomplete, attention_risk, attention_warning,
 * attention_nothing_tested, attention_no_hits, pass.
 */
export function verdict({ findings = [], runs = [] } = {}) {
  const counts = summarize(groupFindings(findings));
  const incompleteRuns = runs.length
    ? runs.filter((r) => !r.completed).map((r) => `${r.journeyId}|${r.viewport}`)
    : findings.filter((f) => f.check === "journey_incomplete").map((f) => `${f.journey}|${f.viewport}`);
  const incomplete = uniq(incompleteRuns).length;
  const journeys = { total: runs.length, completed: runs.filter((r) => r.completed).length, incomplete };
  const hits = runs.reduce((n, r) => n + (r.hits?.length ?? 0), 0);
  let status = "pass";
  let headline = "pass";
  if (!runs.length && !findings.length) [status, headline] = ["attention", "attention_nothing_tested"];
  else if (counts.broken) [status, headline] = ["fail", "fail_broken"];
  else if (incomplete) [status, headline] = ["fail", "fail_incomplete"];
  else if (counts.risk) [status, headline] = ["attention", "attention_risk"];
  else if (counts.warning) [status, headline] = ["attention", "attention_warning"];
  else if (runs.length && !hits) [status, headline] = ["attention", "attention_no_hits"];
  return { status, headline, counts, journeys, problems: counts.broken + counts.risk + counts.warning };
}

/**
 * Data quality score, 0 to 100: start at 100 and take off SCORE_WEIGHTS points for every distinct
 * problem, doubled when the problem is on a conversion event, never below 0. The deductions list
 * says exactly what moved the score and who owns the fix. A run with no findings and no runs is
 * not a 100; it is null, because nothing was measured. Problems a baseline accepted cost nothing,
 * as the verdict skips them too.
 */
export function qualityScore({ findings = [], runs = [] } = {}) {
  if (!runs.length && !findings.length) return { score: null, deductions: [], lost: 0 };
  const deductions = groupFindings(findings)
    .filter((f) => isProblem(f) && !f.accepted)
    .map((f) => {
      const { points, conversion } = deductionFor(f);
      return { check: f.check, severity: f.severity, platform: f.platform ?? null, event: f.event ?? null, owner: ownerOf(f), conversion, points, where: f.where.length };
    })
    .filter((d) => d.points > 0)
    .sort((a, b) => b.points - a.points || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const lost = deductions.reduce((n, d) => n + d.points, 0);
  return { score: Math.max(0, 100 - lost), deductions, lost };
}

/** Bucket counts and shares for one list of planCheck entries. Shares are of the checkable planned events; unplanned events are counted apart. */
function coverageOf(entries) {
  const counts = Object.fromEntries(PLAN_BUCKETS.map((b) => [b, entries.filter((e) => e.bucket === b).length]));
  const planned = entries.length - counts.unplanned;
  const checkable = planned - counts.not_checked;
  const shares = Object.fromEntries(["implemented", "missing", "missing_params", "wrong_values"].map((b) => [b, percent(counts[b], checkable)]));
  return { planned, checkable, counts, percent: shares };
}

/**
 * How much of the plan the site implements, from planCheck: per bucket (implemented, missing,
 * missing_params, wrong_values, unplanned, not_checked) as counts and as a share of the planned
 * events this run could check, overall and per platform. Null without a plan, since without one
 * every event would be "unplanned" and nothing would be "implemented".
 */
export function planCoverage({ plan = null, runs = [], findings = [] } = {}) {
  if (!plan?.events?.length) return null;
  const check = planCheck(plan, runs, findings);
  const platforms = uniq(check.events.map((e) => e.platform)).sort();
  return {
    ...coverageOf(check.events),
    platforms: Object.fromEntries(platforms.map((p) => [p, coverageOf(check.events.filter((e) => e.platform === p))])),
    events: check.events,
  };
}

/** The events one run was expected to send, in plan order, or the ready-made journey's events when the plan names none for it. */
function expectedEvents(plan, run) {
  const fromPlan = (plan?.events ?? []).map(lowerPlatform).filter((e) => expectedIn(e, run.journeyId) && checked(e, run));
  if (fromPlan.length) return { source: "plan", events: fromPlan };
  const preset = presetFor(run.journeyId);
  const fromPreset = (preset?.events ?? []).filter((e) => checked(e, run));
  return fromPreset.length ? { source: "preset", events: fromPreset } : { source: "none", events: [] };
}

/**
 * Expected versus observed, per journey and viewport: each expected event in the order the plan (or
 * the ready-made journey) lists it, whether it fired, the step and page where it first fired, how
 * many times, and whether every send carried the required parameters. `firstMissing` is where the
 * funnel breaks: the first expected event that never fired.
 */
export function journeyFunnel({ plan = null, runs = [] } = {}) {
  return runs.map((run) => {
    const { source, events } = expectedEvents(plan, run);
    const rows = events.map((ev) => {
      const hits = (run.hits ?? []).filter((h) => hitMatchesEvent(ev, h)).sort(byTime);
      const first = hits[0] ?? null;
      const step = first ? stepOf(run, first.step) : null;
      const required = ev.required_params ?? [];
      const missingParams = uniq(hits.flatMap((h) => required.filter((p) => !hasParam(h, p))));
      const status = !first ? "missing" : missingParams.length ? "missing_params" : "ok";
      return {
        platform: ev.platform, event: ev.name, conversion: isConversion(ev.name), observed: Boolean(first), count: hits.length,
        step: first?.step ?? null, stepLabel: step?.label ?? null, page: step?.pagePath ?? first?.pageUrl ?? null,
        required, missingParams, paramsOk: Boolean(first) && !missingParams.length, status,
      };
    });
    const observed = rows.filter((r) => r.observed).length;
    return {
      journey: run.journeyId, viewport: run.viewport, completed: Boolean(run.completed), source,
      expected: rows.length, observed, ok: rows.filter((r) => r.status === "ok").length, percent: percent(observed, rows.length),
      firstMissing: rows.find((r) => !r.observed)?.event ?? null, events: rows,
    };
  });
}

/**
 * The same event seen on more than one platform (purchase on GA4 and Purchase on Meta), per journey
 * and viewport: the count, value and currency each platform reported and which of those differ. Plus
 * the events only one platform sent, which is where a missing Meta or TikTok tag shows. Events are
 * matched by canonicalEvent, so AddToCart pairs with add_to_cart and ViewContent with view_item.
 */
export function platformParity({ runs = [] } = {}) {
  return runs.map((run) => {
    const groups = new Map();
    for (const h of run.hits ?? []) {
      const k = canonicalEvent(h.name);
      if (!groups.has(k)) groups.set(k, new Map());
      const byPlatform = groups.get(k);
      byPlatform.set(h.platform, [...(byPlatform.get(h.platform) ?? []), h]);
    }
    const shared = [];
    const onlyOn = [];
    for (const [event, byPlatform] of groups) {
      const platforms = Object.fromEntries([...byPlatform].map(([platform, hits]) => {
        const valued = hits.find((h) => paramOf(h, "value") !== undefined) ?? hits.find((h) => paramOf(h, "currency") !== undefined) ?? hits[0];
        const value = paramOf(valued, "value");
        return [platform, { names: uniq(hits.map((h) => h.name)), count: hits.length, value: value === undefined ? null : Number(value), currency: paramOf(valued, "currency") ?? null }];
      }));
      if (byPlatform.size < 2) {
        const [[platform, p]] = Object.entries(platforms);
        onlyOn.push({ event, name: p.names[0], platform, count: p.count, conversion: CONVERSION_EVENTS.has(event) });
        continue;
      }
      const list = Object.values(platforms);
      const mismatch = [];
      if (uniq(list.map((p) => p.count)).length > 1) mismatch.push("count");
      const values = list.map((p) => p.value).filter((v) => v !== null && Number.isFinite(v));
      if (values.length > 1 && Math.max(...values) - Math.min(...values) > 0.005) mismatch.push("value");
      const currencies = uniq(list.map((p) => p.currency).filter(Boolean).map((c) => c.toUpperCase()));
      if (currencies.length > 1) mismatch.push("currency");
      // A value one platform has and the other lacks is a mismatch too: the platforms will not agree on revenue.
      if (list.some((p) => p.value !== null) && list.some((p) => p.value === null)) mismatch.push("value_missing");
      shared.push({ event, conversion: CONVERSION_EVENTS.has(event), platforms, mismatch });
    }
    const order = (a, b) => Number(b.conversion) - Number(a.conversion) || a.event.localeCompare(b.event);
    return { journey: run.journeyId, viewport: run.viewport, shared: shared.sort(order), onlyOn: onlyOn.sort(order), mismatches: shared.filter((s) => s.mismatch.length).length };
  });
}

/** When the Consent Mode default was pushed in one run: the step, how many ms into it, and whether a Google hit beat it. */
function consentDefaultIn(run) {
  const log = run.dataLayerLog ?? [];
  const entry = log.find((e) => isConsentCommand(e, "default")) ?? null;
  const firstGoogleHit = (run.hits ?? []).filter((h) => GOOGLE_PLATFORMS.has(h.platform)).sort(byTime)[0] ?? null;
  const step = entry ? stepOf(run, entry.step) : null;
  const declared = uniq(log.filter((e) => isConsentCommand(e, "default")).flatMap((e) => Object.keys(e.value[2] ?? {})));
  const missing = V2_SIGNALS.filter((k) => !declared.includes(k));
  return {
    journey: run.journeyId, viewport: run.viewport, present: Boolean(entry),
    step: entry?.step ?? null, stepLabel: step?.label ?? null, ms: entry && step && entry.t != null && step.t != null ? entry.t - step.t : null,
    beforeFirstGoogleHit: entry && firstGoogleHit ? !sentBefore(firstGoogleHit, entry) : null,
    v2Signals: { present: Boolean(entry) && !missing.length, missing: entry ? missing : V2_SIGNALS },
  };
}

/**
 * Whether the site respects the visitor's choice, per platform and overall. From the findings: tags
 * sent before consent and after "reject"; from the consent scenarios: tags sent after each choice on
 * the start page, with the ones a choice should have silenced; from the runs: when the Consent Mode
 * default was pushed and whether it carried the v2 signals. Status per platform and overall: fail
 * when a "no" was not honoured, attention when tags fired before any choice or the Consent Mode setup
 * is incomplete, pass otherwise; unknown when nothing was captured.
 */
export function consentCompliance({ plan = null, runs = [], findings = [], consentScenarios = null } = {}) {
  const table = consentScenarios ? consentTable(consentScenarios) : null;
  const consentFindings = findings.filter((f) => CONSENT_CHECK.test(f.check));
  const platforms = uniq([...runs.flatMap((r) => (r.hits ?? []).map((h) => h.platform)), ...(table?.rows.map((r) => r.platform) ?? [])]).sort();
  const distinct = (check, platform) => uniq(consentFindings.filter((f) => f.check === check && f.platform === platform).map((f) => f.event ?? "")).length;
  const scenarioCount = (platform, state, problemsOnly) => {
    const ran = state === "before" ? Boolean(consentScenarios?.before) : Boolean(consentScenarios?.states?.[state]?.after);
    if (!table || !ran) return null;
    return table.rows.filter((r) => r.platform === platform).reduce((n, r) => {
      const cell = r.cells.find((c) => c.state === state);
      return n + (problemsOnly ? Number(cell.problem) : cell.count ?? 0);
    }, 0);
  };
  const rows = platforms.map((platform) => {
    const beforeConsent = distinct("before_consent", platform);
    const afterReject = distinct("after_reject", platform) + (scenarioCount(platform, "reject", true) ?? 0);
    const afterAnalyticsOnly = AD_PLATFORMS.has(platform) ? scenarioCount(platform, "analytics", true) : null;
    const status = afterReject ? "fail" : beforeConsent || afterAnalyticsOnly ? "attention" : "pass";
    const scenarios = table ? Object.fromEntries(["before", ...CONSENT_STATES].map((s) => [s, scenarioCount(platform, s, false)])) : null;
    return { platform, ad: AD_PLATFORMS.has(platform), beforeConsent, afterReject, afterAnalyticsOnly, scenarios, status };
  });
  const defaults = runs.map(consentDefaultIn);
  const consentMode = {
    expected: Boolean(plan?.consent_mode),
    defaultPresent: defaults.length ? defaults.every((d) => d.present) : null,
    defaultOnTime: defaults.some((d) => d.beforeFirstGoogleHit !== null) ? defaults.every((d) => d.beforeFirstGoogleHit !== false) : null,
    v2Signals: { present: defaults.length ? defaults.every((d) => d.v2Signals.present) : null, missing: uniq(defaults.flatMap((d) => d.v2Signals.missing)) },
    runs: defaults,
  };
  const scenarios = consentScenarios ? {
    cmp: consentScenarios.cmp ?? null,
    states: Object.fromEntries(CONSENT_STATES.map((s) => [s, Boolean(consentScenarios.states?.[s]?.after)])),
    problems: (table?.rows ?? []).flatMap((r) => r.cells.filter((c) => c.problem).map((c) => ({ platform: r.platform, event: r.event, state: c.state, count: c.count }))),
  } : null;
  const checks = uniq(consentFindings.map((f) => f.check));
  let status = "pass";
  if (rows.some((r) => r.status === "fail") || checks.some((c) => CONSENT_FAIL_CHECKS.has(c))) status = "fail";
  else if (rows.some((r) => r.status === "attention") || checks.some((c) => CONSENT_ATTENTION_CHECKS.has(c))) status = "attention";
  else if (!runs.length && !consentScenarios) status = "unknown";
  return { status, consentMode, platforms: rows, scenarios, findings: checks };
}

/** Whether a hit's item list is non-empty: GA4 items (pr1..), Meta contents or content_ids, or the parsed items the capture kept. */
function itemsState(hit) {
  if (Array.isArray(hit.items)) return hit.items.length ? "pass" : "fail";
  const listed = ["items", "contents", "content_ids", "products", "item_list"].filter((n) => hit.params?.[n] !== undefined);
  if (listed.length) return listed.every((n) => EMPTY_LIST.test(String(hit.params[n]))) ? "fail" : "pass";
  // GA4 purchases without items lose every product report; the other platforms treat items as optional.
  return hit.platform === "ga4" ? "fail" : null;
}

/** The purchase on another platform that reports the same order: by transaction id, else the only other purchase in the run. */
function counterpartOf(hit, purchases) {
  const others = purchases.filter((h) => h.platform !== hit.platform);
  const id = paramOf(hit, "transaction_id");
  const sameId = id !== undefined && others.find((h) => paramOf(h, "transaction_id") === id);
  if (sameId) return sameId;
  const mine = purchases.filter((h) => h.platform === hit.platform);
  return mine.length === 1 && others.length === 1 && (id === undefined || paramOf(others[0], "transaction_id") === undefined) ? others[0] : null;
}

/**
 * One row per purchase observed, with pass, fail or null (not applicable) per property: value (a
 * number above 0), currency (an ISO code), transaction id, items (non-empty), duplicate (the same
 * order sent twice), parity (the same value and currency as the other platform's purchase) and
 * eventId (present, required once a server container is in play). `pass` is the row's overall state.
 */
export function conversionIntegrity({ runs = [] } = {}) {
  const rows = [];
  for (const run of runs) {
    const purchases = (run.hits ?? []).filter((h) => canonicalEvent(h.name) === "purchase").sort(byTime);
    const serverSeen = (run.hits ?? []).some((h) => h.delivery === "server");
    for (const hit of purchases) {
      const value = paramOf(hit, "value");
      const currency = paramOf(hit, "currency");
      const transactionId = paramOf(hit, "transaction_id");
      const n = Number(value);
      const sameOrder = purchases.filter((h) => h !== hit && h.platform === hit.platform && (transactionId !== undefined ? paramOf(h, "transaction_id") === transactionId : h.step === hit.step));
      const duplicate = sameOrder.some((h) => !h.eventId || h.eventId !== hit.eventId);
      const other = counterpartOf(hit, purchases);
      // Parity compares value and currency with the other platform's purchase. A field only one side
      // sent is a mismatch (the platforms will not agree on revenue); nothing to compare on either side is null.
      let parity = null;
      if (other) {
        const [ov, oc] = [paramOf(other, "value"), paramOf(other, "currency")];
        const comparable = [value, ov, currency, oc].some((v) => v !== undefined);
        const valueDiffers = value !== undefined && ov !== undefined ? Math.abs(Number(value) - Number(ov)) > 0.005 : value !== ov;
        const currencyDiffers = currency !== undefined && oc !== undefined ? String(currency).toUpperCase() !== String(oc).toUpperCase() : currency !== oc;
        parity = !comparable ? null : valueDiffers || currencyDiffers ? "fail" : "pass";
      }
      const step = stepOf(run, hit.step);
      const checks = {
        value: value === undefined || String(value).trim() === "" || !Number.isFinite(n) || n <= 0 ? "fail" : "pass",
        currency: currency === undefined || !/^[A-Z]{3}$/.test(String(currency)) ? "fail" : "pass",
        // Meta and TikTok have no standard order id; one is only expected there when the site sends it.
        transactionId: transactionId !== undefined ? "pass" : hit.platform === "ga4" ? "fail" : null,
        items: itemsState(hit),
        duplicate: duplicate ? "fail" : "pass",
        parity,
        eventId: hit.eventId ? "pass" : serverSeen ? "fail" : null,
      };
      rows.push({
        journey: run.journeyId, viewport: run.viewport, platform: hit.platform, event: hit.name, delivery: hit.delivery ?? "browser",
        step: hit.step, stepLabel: step?.label ?? null, page: step?.pagePath ?? hit.pageUrl ?? null,
        transactionId: transactionId ?? null, value: value === undefined ? null : Number.isFinite(n) ? n : String(value), currency: currency ?? null,
        items: Array.isArray(hit.items) ? hit.items.length : null, eventId: hit.eventId ?? null, counterpart: other ? other.platform : null,
        checks, failed: Object.keys(checks).filter((k) => checks[k] === "fail"), pass: !Object.values(checks).includes("fail"),
      });
    }
  }
  return { rows, total: rows.length, passed: rows.filter((r) => r.pass).length, percent: percent(rows.filter((r) => r.pass).length, rows.length) };
}

/**
 * How long things took, from the timestamps on steps and hits: per run the total duration, per step
 * the time from the step's action to its first and last tracking hit, and the slowest hits of the
 * run. A step's clock starts when its action begins, so a page load is part of the delay. Runs that
 * recorded no timestamps get null durations.
 */
export function timing({ runs = [], slowest = 5 } = {}) {
  return runs.map((run) => {
    const steps = (run.steps ?? []).map((s, i, all) => {
      const next = all[i + 1];
      const times = (run.hits ?? []).filter((h) => h.step === s.index && h.t != null).map((h) => h.t);
      const timed = s.t != null && times.length;
      return {
        index: s.index, label: s.label, action: s.action ?? null, page: s.pagePath ?? null, hits: (run.hits ?? []).filter((h) => h.step === s.index).length,
        durationMs: s.t != null && next?.t != null ? next.t - s.t : null,
        firstHitMs: timed ? Math.min(...times) - s.t : null, lastHitMs: timed ? Math.max(...times) - s.t : null,
      };
    });
    const delays = (run.hits ?? []).flatMap((h) => {
      const s = stepOf(run, h.step);
      return h.t != null && s?.t != null ? [{ platform: h.platform, event: h.name, step: h.step, stepLabel: s.label, ms: h.t - s.t }] : [];
    }).sort((a, b) => b.ms - a.ms);
    const stamps = [...(run.steps ?? []).map((s) => s.t), ...(run.hits ?? []).map((h) => h.t)].filter((t) => t != null);
    const start = run.startedAt ?? (stamps.length ? Math.min(...stamps) : null);
    const withHits = steps.filter((s) => s.firstHitMs !== null);
    return {
      journey: run.journeyId, viewport: run.viewport,
      durationMs: start != null && stamps.length ? Math.max(...stamps) - start : null,
      medianFirstHitMs: withHits.length ? round(median(withHits.map((s) => s.firstHitMs))) : null,
      steps, slowest: delays.slice(0, slowest),
    };
  });
}

function median(list) {
  const s = [...list].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Problem findings grouped under one key each, with severity counts, worst first. */
function groupBy(findings, keyOf) {
  const groups = new Map();
  for (const f of findings) {
    const k = keyOf(f) ?? null;
    if (!groups.has(k)) groups.set(k, { key: k, counts: emptyCounts(), findings: [] });
    const g = groups.get(k);
    g.counts[f.severity] += 1;
    g.findings.push(f);
  }
  const worst = (g) => PROBLEM_SEVERITIES.findIndex((s) => g.counts[s] > 0);
  return [...groups.values()]
    .map((g) => ({ ...g, total: g.findings.length }))
    .sort((a, b) => worst(a) - worst(b) || b.total - a.total || String(a.key).localeCompare(String(b.key)));
}

/**
 * Where the problems are: the same findings counted by the page they happened on (the step's page;
 * null for journey-wide findings such as a missing event), by owner, by platform and by journey.
 * Counts are per occurrence, so a problem seen on two pages or two viewports counts on each.
 */
export function findingsBy({ findings = [], runs = [] } = {}) {
  const problems = findings.filter(isProblem);
  const runOf = (f) => runs.find((r) => r.journeyId === f.journey && r.viewport === f.viewport);
  const pageOf = (f) => (f.step ? stepOf(runOf(f), f.step)?.pagePath ?? null : null);
  return {
    byPage: groupBy(problems, pageOf),
    byOwner: groupBy(problems, ownerOf),
    byPlatform: groupBy(problems, (f) => f.platform ?? null),
    byJourney: groupBy(problems, (f) => f.journey),
  };
}

/**
 * The fix list per owner: distinct problems (groupFindings) sorted by the points they cost on the
 * score, with the top three per owner and how many points fixing all of theirs would recover. Owners
 * come in the order of points recovered, so the group that moves the score most is first. Accepted
 * problems cost no points, so they are not listed.
 */
export function prioritiesByOwner(findings = [], { top = 3 } = {}) {
  const grouped = groupFindings(findings).filter((f) => isProblem(f) && !f.accepted).map((f) => ({ ...f, owner: ownerOf(f), ...deductionFor(f) }));
  return OWNERS.map((owner) => {
    const mine = grouped.filter((f) => f.owner === owner).sort((a, b) => b.points - a.points || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    const counts = emptyCounts();
    for (const f of mine) counts[f.severity] += 1;
    return { owner, total: mine.length, counts, points: mine.reduce((n, f) => n + f.points, 0), top: mine.slice(0, top) };
  }).filter((g) => g.total).sort((a, b) => b.points - a.points || a.owner.localeCompare(b.owner));
}

/** Every metric at once, from the capture as audit.js writes it. */
export function computeMetrics({ plan = null, runs = [], findings = [], consentScenarios = null } = {}) {
  return {
    verdict: verdict({ findings, runs }),
    score: qualityScore({ findings, runs }),
    coverage: planCoverage({ plan, runs, findings }),
    funnel: journeyFunnel({ plan, runs }),
    parity: platformParity({ runs }),
    consent: consentCompliance({ plan, runs, findings, consentScenarios }),
    conversions: conversionIntegrity({ runs }),
    timing: timing({ runs }),
    where: findingsBy({ findings, runs }),
    priorities: prioritiesByOwner(findings),
  };
}
