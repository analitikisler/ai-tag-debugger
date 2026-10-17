import { readFile } from "node:fs/promises";
import path from "node:path";
import { listRunIds, runsDir } from "./workspace.js";

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
function routes(runs = []) {
  const out = new Map();
  for (const r of runs) {
    const pages = [];
    for (const s of r.steps ?? []) if (s.pagePath && pages.at(-1) !== s.pagePath) pages.push(s.pagePath);
    if (pages.length) out.set(`${r.journeyId}|${r.viewport}`, { journeyId: r.journeyId, viewport: r.viewport, pages });
  }
  return out;
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
