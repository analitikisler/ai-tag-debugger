import { readFile } from "node:fs/promises";
import path from "node:path";
import { messages } from "./i18n.js";
import { platformLabel } from "./report.js";
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
  return { run: latest.id, ...compareRuns(prev, { findings: latest.capture.findings ?? [], planCheck: latest.planCheck }) };
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
  ];
}
