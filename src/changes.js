import { readFile } from "node:fs/promises";
import path from "node:path";
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

/**
 * What changed since the previous run of the same site. Compares plan coverage when both runs were
 * checked against a plan, and the health findings otherwise.
 * Returns { previous: null } when there is no earlier run, else
 * { previous, mode: "plan" | "findings", fixed: [...], new: [...] }.
 */
export function compareRuns(prev, { findings, planCheck = null }) {
  if (!prev) return { previous: null };
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
