import { readFile } from "node:fs/promises";
import path from "node:path";
import { messages } from "./i18n.js";
import { platformLabel } from "./report.js";
import { PLAN_FILE, listPlanIds, listRunIds, plansDir, runsDir } from "./workspace.js";

const PROBLEMS = new Set(["broken", "risk", "warning"]);
const PLAN_PROBLEMS = new Set(["missing", "missing_params", "wrong_values"]);

const readJson = (file) => readFile(file, "utf8").then(JSON.parse).catch(() => null);

/** The site's newest saved run before this one, with its capture and plan check, or null. */
export async function previousRun(dataDir, site, before = null) {
  const ids = (await listRunIds(dataDir, site)).filter((id) => !before || id < before);
  for (const id of ids.reverse()) {
    const dir = path.join(runsDir(dataDir, site), id);
    const capture = await readJson(path.join(dir, "capture.json"));
    if (capture) return { id, capture, planCheck: await readJson(path.join(dir, "plan-check.json")) };
  }
  return null;
}

/** One entry per problem, keyed so the same problem matches across runs whatever its wording. */
function findingProblems(findings = []) {
  const out = new Map();
  for (const f of findings) {
    if (!PROBLEMS.has(f.severity)) continue;
    const k = [f.check, f.platform ?? "", f.event ?? ""].join("|");
    if (!out.has(k)) out.set(k, { check: f.check, platform: f.platform ?? null, event: f.event ?? null, severity: f.severity, detail: f.detail });
  }
  return out;
}

function planProblems(pc) {
  const out = new Map();
  for (const e of pc?.events ?? []) out.set(`${e.platform}|${e.event}`, { platform: e.platform, event: e.event, bucket: e.bucket });
  return out;
}

/** The pages one run visited, in order, one entry per journey and viewport. Null when it recorded none (older runs). */
function routes(runs = [], completedOnly = false) {
  const out = new Map();
  for (const r of runs) {
    if (completedOnly && (!r.completed || !r.goal)) continue;
    const pages = [];
    for (const s of r.steps ?? []) if (s.pagePath && pages.at(-1) !== s.pagePath) pages.push(s.pagePath);
    if (pages.length) out.set(`${r.journeyId}|${r.viewport}`, { journeyId: r.journeyId, viewport: r.viewport, goal: r.goal, pages });
  }
  return out;
}

const HINT_SCAN = 10;

/**
 * The pages each journey visited the last time it completed on this site, so a repeat run can start from a
 * known route: Map of "journeyId|viewport" to { goal, pages }. A run only counts for the same goal, since
 * "custom" and the like are reused for different goals, and only if it recorded its goal (older runs didn't).
 */
export async function routeHints(dataDir, site) {
  const hints = new Map();
  let before = null;
  for (let i = 0; i < HINT_SCAN; i++) {
    const prev = await previousRun(dataDir, site, before);
    if (!prev) break;
    for (const [k, r] of routes(prev.capture?.runs, true)) if (!hints.has(k)) hints.set(k, { goal: r.goal, pages: r.pages });
    before = prev.id;
  }
  return hints;
}

/** Journeys whose route through the site differs from the previous run: [{ journeyId, viewport, before, after }]. */
export function compareRoutes(prevRuns, runs) {
  const before = routes(prevRuns);
  const out = [];
  for (const [k, now] of routes(runs)) {
    const was = before.get(k);
    if (was && was.pages.join("\n") !== now.pages.join("\n")) out.push({ journeyId: now.journeyId, viewport: now.viewport, before: was.pages, after: now.pages });
  }
  return out;
}

/**
 * What changed since the previous run of the same site. Compares plan coverage when both runs were
 * checked against a plan, and the health findings otherwise.
 * Returns { previous: null } when there is no earlier run, else
 * { previous, mode: "plan" | "findings", fixed: [...], new: [...] }.
 */
export function compareRuns(prev, { findings, planCheck = null, runs = [] }) {
  if (!prev) return { previous: null };
  const routeChanges = compareRoutes(prev.capture?.runs, runs);
  const base = compareFindings(prev, { findings, planCheck });
  return routeChanges.length ? { ...base, routes: routeChanges } : base;
}

function compareFindings(prev, { findings, planCheck }) {
  if (planCheck && prev.planCheck) {
    const before = planProblems(prev.planCheck);
    const now = planProblems(planCheck);
    const fixed = [];
    const added = [];
    for (const [k, e] of now) {
      const was = before.get(k)?.bucket;
      if (e.bucket === "implemented" && PLAN_PROBLEMS.has(was)) fixed.push({ ...e, was });
      if (PLAN_PROBLEMS.has(e.bucket) && !PLAN_PROBLEMS.has(was)) added.push({ ...e, was: was ?? null });
    }
    return { previous: prev.id, mode: "plan", fixed, new: added };
  }
  const before = findingProblems(prev.capture?.findings);
  const now = findingProblems(findings);
  return {
    previous: prev.id,
    mode: "findings",
    fixed: [...before].filter(([k]) => !now.has(k)).map(([, f]) => f),
    new: [...now].filter(([k]) => !before.has(k)).map(([, f]) => f),
  };
}

/**
 * The "since last run" diff for a site's newest saved run, as the report showed it: that run compared
 * with the one before. Returns { run: null } when nothing is saved, else { run, ...compareRuns() }.
 * Shared by anything that reports the diff outside the report (MCP, alerts).
 */
export async function sinceLastRun(dataDir, site) {
  const latest = await previousRun(dataDir, site);
  if (!latest) return { run: null, previous: null };
  const saved = latest.capture.changes;
  if (saved) return { run: latest.id, ...saved };
  const prev = await previousRun(dataDir, site, latest.id);
  return { run: latest.id, ...compareRuns(prev, { findings: latest.capture.findings ?? [], planCheck: latest.planCheck, runs: latest.capture.runs }) };
}

/** The diff as plain lines: a headline, then one line per fixed and new problem. */
export function changesLines(ch, lang = "en") {
  const m = messages(lang);
  if (!ch.run) return [m.ui.noSavedRun];
  if (!ch.previous) return [m.ui.noPreviousRun];
  const label = (c) => `${platformLabel(c.platform ?? "")} ${c.event ?? ""}`.trim() || c.check;
  const why = (c, bucket) => (ch.mode === "findings" ? c.detail : m.ui.bucket[bucket]);
  return [
    `${m.ui.changesLine(ch)}. ${m.ui.changesLead(ch.previous, ch.mode)} (${ch.run}).`,
    ...ch.fixed.map((c) => `- ${m.ui.changeFixed}: ${label(c)} (${why(c, c.was)})`),
    ...ch.new.map((c) => `- ${m.ui.changeNew}: ${label(c)} (${why(c, c.bucket)})`),
    ...(ch.routes?.length ? [m.ui.routeChanged(ch.routes.map((r) => `${r.journeyId} (${r.viewport})`).join(", "))] : []),
  ];
}

const planKey = (e) => [e.platform ?? "ga4", e.name].join("|");
const sortedList = (v) => JSON.stringify([...(v ?? [])].sort());

/** What differs for an event kept in both plans: its required parameters, parameter list or journeys. */
function eventChanges(a, b) {
  const out = [];
  if (sortedList(a.required_params) !== sortedList(b.required_params)) out.push("required parameters");
  if (sortedList(Object.keys(a.parameters ?? {})) !== sortedList(Object.keys(b.parameters ?? {}))) out.push("parameters");
  if (sortedList(a.journeys) !== sortedList(b.journeys)) out.push("journeys");
  return out;
}

/**
 * How a plan differs from the version before it: events added, removed and changed.
 * Returns null when there is no earlier version, else { previous, added, removed, changed, same }.
 */
export function comparePlans(prevPlan, plan, previousId = null) {
  if (!prevPlan || !plan) return null;
  const before = new Map((prevPlan.events ?? []).map((e) => [planKey(e), e]));
  const now = new Map((plan.events ?? []).map((e) => [planKey(e), e]));
  const label = (e) => ({ platform: e.platform ?? "ga4", event: e.name });
  const added = [...now].filter(([k]) => !before.has(k)).map(([, e]) => label(e));
  const removed = [...before].filter(([k]) => !now.has(k)).map(([, e]) => label(e));
  const changed = [...now].filter(([k]) => before.has(k)).map(([k, e]) => ({ ...label(e), what: eventChanges(before.get(k), e) })).filter((c) => c.what.length);
  return { previous: previousId, added, removed, changed, same: !added.length && !removed.length && !changed.length };
}

/** The saved plan right before `planId` for the site, compared with `plan`; null for the first version or an unsaved plan. */
export async function previousPlanChanges(dataDir, site, planId, plan) {
  if (!planId) return null;
  const ids = await listPlanIds(dataDir, site);
  const prevId = ids.filter((id) => id < planId).at(-1);
  if (!prevId) return null;
  const prevPlan = await readJson(path.join(plansDir(dataDir, site), prevId, PLAN_FILE));
  return comparePlans(prevPlan, plan, prevId);
}
