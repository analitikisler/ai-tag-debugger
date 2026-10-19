// Run history: what the site's saved runs say over time. changes.js compares a run with the one
// before it; this module reads every run in the window and turns it into views the report, the CLI
// and the alert can show: a timeline per finding, a trend series for sparklines and the completion
// rate of every journey. Only a small summary of each run is kept, so thirty runs cost a few KB.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { groupFindings } from "./checks.js";
import { LANGUAGES } from "./i18n.js";
import { PROVIDERS } from "./parsers.js";
import { listRunIds, runsDir, siteDir } from "./workspace.js";

/** The per-site index of run summaries, next to the plans and runs folders. */
export const HISTORY_FILE = "history.json";
export const historyFile = (dataDir, site) => path.join(siteDir(dataDir, site), HISTORY_FILE);

const INDEX_VERSION = 1;
const PROBLEMS = new Set(["broken", "risk", "warning"]);
const SEVERITY_RANK = { broken: 0, risk: 1, warning: 2 };
// Problems are weighed so one broken event outranks a few warnings when runs are compared.
const WEIGHT = { broken: 3, risk: 2, warning: 1 };
// "Recently" and the trend direction both look at the last few runs, not just the last one.
const RECENT = 3;

/**
 * The identity of a finding across runs: the same line replay.js writes to site.json ("severity check
 * journey viewport platform event"), so a replay and the history agree on what "the same finding" is.
 * Kept inline rather than imported because replay.js loads the browser and the audit, and the report
 * must stay importable without them. test/history.test.js pins the two to the same output.
 */
export const findingKey = (f) => [f.severity, f.check, f.journey, f.viewport, f.platform ?? "-", f.event ?? "-"].join(" ");

/** The id's local time as "YYYY-MM-DDTHH:MM"; the seconds suffix of a same-minute id is dropped. */
export const dateOfId = (id) => {
  const m = /^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})/.exec(id);
  return m ? `${m[1]}T${m[2]}:${m[3]}` : null;
};

/**
 * The summary of one run that history keeps: its journeys, its counts and its problems, a few hundred
 * bytes instead of a capture. Fields a capture may lack (older shapes, or ones audit.js does not write
 * yet such as version and ai) come out null, never throw. Findings a baseline accepted are left out,
 * as the counts and the verdict leave them out, so an accepted problem is not "still open" in the trend.
 */
export function runSummary(id, capture = {}, { version = null, ai = null } = {}) {
  const findings = Array.isArray(capture.findings) ? capture.findings : [];
  const counts = { broken: 0, risk: 0, warning: 0, info: 0, ok: 0 };
  for (const f of groupFindings(findings.filter((f) => f.severity in counts))) if (!f.accepted) counts[f.severity] += 1;
  const seen = new Set();
  const problems = [];
  for (const f of findings) {
    if (!PROBLEMS.has(f.severity) || !f.check || f.accepted === true) continue;
    const key = findingKey(f);
    if (seen.has(key)) continue;
    seen.add(key);
    problems.push({ key, check: f.check, severity: f.severity, platform: f.platform ?? null, event: f.event ?? null, journey: f.journey ?? null, viewport: f.viewport ?? null });
  }
  const journeys = (Array.isArray(capture.runs) ? capture.runs : [])
    .filter((r) => r && r.journeyId)
    .map((r) => ({ id: r.journeyId, viewport: r.viewport ?? null, completed: Boolean(r.completed), hits: Array.isArray(r.hits) ? r.hits.length : 0 }));
  return { id, date: dateOfId(id), version: capture.version ?? version, ai: capture.ai ?? ai, journeys, counts, findings: problems };
}

const readJson = (file) => readFile(file, "utf8").then(JSON.parse).catch(() => null);

/** The summaries the index holds, by run id; empty when there is no index or it is unreadable. */
async function readIndex(dataDir, site) {
  const index = await readJson(historyFile(dataDir, site));
  const runs = index?.version === INDEX_VERSION && Array.isArray(index.runs) ? index.runs : [];
  return new Map(runs.filter((r) => r && typeof r.id === "string").map((r) => [r.id, r]));
}

/**
 * The site's most recent `limit` runs, oldest first and newest last, each as a runSummary. Runs with a
 * missing or unreadable capture.json are skipped. A run already in history.json is taken from there;
 * the others are read from their capture.json, one at a time so only one capture is ever in memory.
 * Cost without an index: one read and parse per run (a capture is 100 KB to a few MB, roughly 1-10 ms
 * per 100 KB), then the parsed object is dropped. With the index, one small file.
 */
export async function loadHistory(dataDir, site, { limit = 30 } = {}) {
  const ids = (await listRunIds(dataDir, site)).slice(-Math.max(0, limit));
  const indexed = await readIndex(dataDir, site);
  const out = [];
  for (const id of ids) {
    const known = indexed.get(id);
    if (known) {
      out.push(known);
      continue;
    }
    const capture = await readJson(path.join(runsDir(dataDir, site), id, "capture.json"));
    if (capture && typeof capture === "object") out.push(runSummary(id, capture));
  }
  return out;
}

/**
 * Adds one run to the site's history.json (or replaces its entry) so later reports and CLI calls do not
 * re-read every capture. `run` is { id, capture, version?, ai? } or an existing runSummary. Entries whose
 * run folder is gone are dropped. Never throws on a missing or corrupt index: it is rebuilt from the run.
 */
export async function updateHistoryIndex(dataDir, site, run) {
  const entry = run.capture ? runSummary(run.id, run.capture, { version: run.version ?? null, ai: run.ai ?? null }) : run;
  const indexed = await readIndex(dataDir, site);
  indexed.set(entry.id, entry);
  const onDisk = new Set(await listRunIds(dataDir, site));
  const runs = [...indexed.values()].filter((r) => r.id === entry.id || onDisk.has(r.id)).sort((a, b) => (a.id < b.id ? -1 : 1));
  const file = historyFile(dataDir, site);
  await writeFile(file, JSON.stringify({ version: INDEX_VERSION, site, updated: new Date().toISOString(), runs }, null, 2));
  return { file, runs: runs.length };
}

/** Whether a run gives evidence about a journey: it ran and completed. An incomplete journey proves nothing by absence. */
const observed = (run) => new Set(run.journeys.filter((j) => j.completed).map((j) => `${j.id}|${j.viewport}`));

/**
 * One entry per finding seen in the window, oldest open first:
 * { key, check, severity, platform, event, journey, viewport, firstSeen, lastSeen, seenIn, openNow, openSince,
 *   flapping, fixedIn }. A run where the finding's journey did not complete says nothing: it is neither "seen"
 * nor "gone", so a crashed checkout does not count as a fix. flapping: seen, gone, then seen again.
 * fixedIn: the first run after lastSeen where the journey completed without it; null while open.
 */
export function findingTimeline(history) {
  const entries = new Map();
  for (const run of history) {
    for (const f of run.findings) {
      if (!entries.has(f.key)) entries.set(f.key, { ...f, states: [] });
    }
  }
  for (const run of history) {
    const present = new Set(run.findings.map((f) => f.key));
    const ok = observed(run);
    for (const e of entries.values()) {
      // A finding from an older capture without a journey has no completion to check: absence means gone.
      const state = present.has(e.key) ? "seen" : !e.journey || ok.has(`${e.journey}|${e.viewport}`) ? "gone" : null;
      e.states.push({ id: run.id, state });
    }
  }
  const out = [];
  for (const e of entries.values()) {
    const { states, ...rest } = e;
    const known = states.filter((s) => s.state);
    const seen = known.filter((s) => s.state === "seen");
    const firstSeen = seen[0].id;
    const lastSeen = seen.at(-1).id;
    const openNow = known.at(-1).state === "seen";
    // Open since the start of the current unbroken streak, which is firstSeen unless it flapped.
    let openSince = null;
    for (let i = known.length - 1; i >= 0 && known[i].state === "seen"; i--) openSince = known[i].id;
    const between = known.filter((s) => s.id > firstSeen && s.id < lastSeen);
    const flapping = between.some((s) => s.state === "gone");
    const fixedIn = openNow ? null : known.find((s) => s.id > lastSeen && s.state === "gone").id;
    out.push({ ...rest, firstSeen, lastSeen, seenIn: seen.length, openNow, openSince, flapping, fixedIn });
  }
  return out.sort(byOpenLongest);
}

/** Open findings first, the one open longest on top; then the fixed ones, the most recently fixed on top. */
function byOpenLongest(a, b) {
  if (a.openNow !== b.openNow) return a.openNow ? -1 : 1;
  if (a.openNow) return a.openSince < b.openSince ? -1 : a.openSince > b.openSince ? 1 : bySeverity(a, b);
  return a.fixedIn > b.fixedIn ? -1 : a.fixedIn < b.fixedIn ? 1 : bySeverity(a, b);
}

const bySeverity = (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/**
 * The same problem on several journeys or viewports as one entry with its places, as the report groups
 * findings. The first entry in timeline order speaks for the group, so its dates are the longest open.
 */
function grouped(entries) {
  const out = new Map();
  for (const { journey, viewport, ...e } of entries) {
    const k = [e.severity, e.check, e.platform, e.event].join("|");
    if (out.has(k)) out.get(k).places.push({ journey, viewport });
    else out.set(k, { ...e, places: [{ journey, viewport }] });
  }
  return [...out.values()];
}

const score = (c) => c.broken * WEIGHT.broken + c.risk * WEIGHT.risk + c.warning * WEIGHT.warning;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * The series for sparklines plus a summary of the window.
 * series: per run { id, date, broken, risk, warning, score, complete }, oldest first. score is
 * 3·broken + 2·risk + warning (lower is better); complete is false when a journey did not finish.
 * direction: the mean score of the last 3 complete runs against the 3 complete runs before them
 * ("improving" when lower, "worsening" when higher, else "flat"); with fewer than 4 complete runs the
 * two halves are compared, and with fewer than 2 it is "flat". Incomplete runs are left out because a
 * journey that stopped early hides findings rather than fixing them.
 * openLongest: the 5 problems open longest; fixedRecently / newRecently: fixed or first seen in the
 * last 3 runs; flapping: seen, gone and seen again in the window. Each list has one entry per problem
 * with its `places` (journey and viewport, as the report groups findings) and its `runsOpen` count.
 */
export function trend(history) {
  const series = history.map((r) => ({ id: r.id, date: r.date, broken: r.counts.broken, risk: r.counts.risk, warning: r.counts.warning, score: score(r.counts), complete: r.journeys.every((j) => j.completed) }));
  const timeline = findingTimeline(history);
  const ids = history.map((r) => r.id);
  const recentIds = new Set(ids.slice(-RECENT));
  const withAge = (e) => ({ ...e, runsOpen: e.openNow ? ids.length - ids.indexOf(e.openSince) : 0 });
  return {
    runs: ids.length,
    first: ids[0] ?? null,
    last: ids.at(-1) ?? null,
    series,
    direction: direction(series.filter((p) => p.complete).map((p) => p.score)),
    openLongest: grouped(timeline.filter((e) => e.openNow)).slice(0, 5).map(withAge),
    fixedRecently: grouped(timeline.filter((e) => e.fixedIn && recentIds.has(e.fixedIn))).map(withAge),
    newRecently: grouped(timeline.filter((e) => e.openNow && recentIds.has(e.firstSeen))).map(withAge),
    flapping: grouped(timeline.filter((e) => e.flapping)).map(withAge),
  };
}

function direction(scores) {
  if (scores.length < 2) return "flat";
  const n = Math.min(RECENT, Math.floor(scores.length / 2));
  const recent = mean(scores.slice(-n));
  const earlier = mean(scores.slice(-2 * n, -n));
  return recent < earlier ? "improving" : recent > earlier ? "worsening" : "flat";
}

/**
 * How reliably each journey finishes on this site, least reliable first: per journey and viewport
 * { id, viewport, runs, completed, completionRate, lastFailure, avgHits }. A journey that keeps
 * failing says the AI or the script cannot get through the site, not that the tracking is bad.
 */
export function journeyStability(history) {
  const out = new Map();
  for (const run of history) {
    for (const j of run.journeys) {
      const k = `${j.id}|${j.viewport}`;
      const s = out.get(k) ?? { id: j.id, viewport: j.viewport, runs: 0, completed: 0, lastFailure: null, hits: 0 };
      s.runs += 1;
      s.hits += j.hits;
      if (j.completed) s.completed += 1;
      else s.lastFailure = run.id;
      out.set(k, s);
    }
  }
  return [...out.values()]
    .map(({ hits, ...s }) => ({ ...s, completionRate: s.runs ? s.completed / s.runs : 0, avgHits: s.runs ? Math.round((hits / s.runs) * 10) / 10 : 0 }))
    .sort((a, b) => a.completionRate - b.completionRate || a.id.localeCompare(b.id) || String(a.viewport).localeCompare(String(b.viewport)));
}

const day = (id) => (id ? String(id).slice(0, 10) : "");
const platformLabel = (p) => (p ? PROVIDERS[p] ?? String(p) : "");
/** "GA4 purchase missing_params" or, for a finding without an event, the check name. */
const label = (e) => `${platformLabel(e.platform)} ${e.event ?? ""}`.trim().concat(` ${e.check}`).trim();
/** The strings of ui.history in the report's language; an unknown language falls back to English rather than throwing. */
const strings = (lang) => (LANGUAGES[lang] ?? LANGUAGES.en).ui.history;
/** "GA4 purchase missing_params in 4 places": the problem with its place count when it is seen in more than one. */
export const problemLabel = (e, lang = "en") => `${label(e)}${e.places?.length > 1 ? strings(lang).places(e.places.length) : ""}`;

const SPARK = "▁▂▃▄▅▆▇█";

/**
 * The trend series as a text sparkline for the CLI and the alert: one character per run, the score
 * mapped onto eight levels over 0..max, "·" for a run that did not complete (its lower counts are not
 * a fix). The scale starts at 3 so one warning does not draw a full bar. Empty under two runs.
 */
export function sparkline(t) {
  const series = t?.series ?? [];
  if (series.length < 2) return "";
  const max = Math.max(3, ...series.map((p) => p.score));
  return series.map((p) => (p.complete ? SPARK[Math.min(SPARK.length - 1, Math.round((p.score / max) * (SPARK.length - 1)))] : "·")).join("");
}

/**
 * The trend as 2-3 plain lines for the CLI after a run and for the alert: the direction with the counts
 * now and three runs ago, the findings open longest (up to 3), and the flapping ones when there are any.
 * Pass the stability list to add a line on journeys that do not always finish.
 */
export function historySummaryLines(t, lang = "en", stability = []) {
  const s = strings(lang);
  if (!t.runs) return [s.noRuns];
  if (t.runs === 1) return [s.oneRun(t.last)];
  const now = t.series.at(-1);
  const was = t.series.at(-1 - RECENT);
  const dir = s.direction[t.direction];
  const lines = [was ? s.headline(t.runs, day(t.first), day(t.last), dir, s.counts(now), s.counts(was), RECENT) : s.headlineShort(t.runs, day(t.first), day(t.last), dir, s.counts(now))];
  if (t.openLongest.length) lines.push(s.openLongest(t.openLongest.slice(0, 3).map((e) => s.since(problemLabel(e, lang), day(e.openSince), e.runsOpen))));
  if (t.flapping.length) lines.push(s.flapping(t.flapping.slice(0, 3).map((e) => s.seenIn(problemLabel(e, lang), e.seenIn, t.runs))));
  const unstable = stability.filter((j) => j.completionRate < 1);
  if (unstable.length) lines.push(s.unstable(unstable.slice(0, 3).map((j) => `${j.id} (${j.viewport}) ${Math.round(j.completionRate * 100)}%`)));
  return lines;
}

/**
 * The trend as the alert shows it: the direction line with the text sparkline, the flapping line, and
 * "still open after N runs" only when a problem has just reached a round number of runs (5, 10, 20, …),
 * so the open-longest list does not repeat in every message and train readers to skip it.
 */
export function historyAlertLines(t, lang = "en") {
  const s = strings(lang);
  if (!t || t.runs < 2) return [];
  const lines = [`${historySummaryLines(t, lang)[0]} \`${sparkline(t)}\``];
  if (t.flapping.length) lines.push(s.flapping(t.flapping.slice(0, 3).map((e) => s.seenIn(problemLabel(e, lang), e.seenIn, t.runs))));
  // A round number of runs open (5, 10, 20, then every 10) is worth one line; every other week it is noise.
  const milestone = (n) => [5, 10, 20].includes(n) || (n > 20 && n % 10 === 0);
  const ages = [...new Set(t.openLongest.filter((e) => milestone(e.runsOpen)).map((e) => e.runsOpen))].sort((a, b) => b - a);
  for (const n of ages) lines.push(s.stillOpen(n, t.openLongest.filter((e) => e.runsOpen === n).map((e) => problemLabel(e, lang))));
  return lines;
}
