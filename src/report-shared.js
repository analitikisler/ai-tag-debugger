// What the Markdown and the HTML renderers share: the version, escaping, the grouped findings, platform names and
// order, the plan-check lines and the verdict sentence. src/report.js and src/html/*.js both import from here and
// this module imports neither, so the two renderers never import each other.
import { readFileSync } from "node:fs";
import { groupFindings } from "./checks.js";
import { messages } from "./i18n.js";
import { PROVIDERS } from "./parsers.js";

export const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const SEVERITIES = ["broken", "risk", "warning", "info"];

/** The summary as { headline, points, also_check }. Older plain-text summaries become a headline-only paragraph. */
function summaryParts(summary) {
  if (!summary) return null;
  if (typeof summary === "string") return { text: summary, points: [], also_check: [] };
  return {
    headline: String(summary.headline ?? ""),
    points: (Array.isArray(summary.points) ? summary.points : []).filter((p) => p && p.text).map((p) => ({ severity: SEVERITIES.includes(p.severity) ? p.severity : "info", text: String(p.text) })),
    also_check: (Array.isArray(summary.also_check) ? summary.also_check : []).map(String).filter(Boolean),
  };
}

/** Fix steps of an explanation; older explanations had one "fix" string. */
const fixSteps = (e) => (Array.isArray(e?.fix_steps) && e.fix_steps.length ? e.fix_steps.map(String) : e?.fix ? [String(e.fix)] : []);

export const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function attachExplanations(findings, explained) {
  const byIndex = new Map((explained?.explanations ?? []).map((e) => [e.finding, e]));
  // A finding a baseline accepted carries `accepted: true`; the grouped card is accepted when every place it covers is.
  const key = (f) => [f.severity, f.check, f.platform, f.event, f.detail].join("|");
  const accepted = new Map();
  for (const f of findings) if (f.severity !== "ok") accepted.set(key(f), (accepted.get(key(f)) ?? true) && f.accepted === true);
  return groupFindings(findings).map((f, i) => ({ ...f, explanation: byIndex.get(i), ...(accepted.get(key(f)) ? { accepted: true } : {}) }));
}

const SEVERITY_RANK = { broken: 0, risk: 1, warning: 2 };

const seconds = (run, t) => `+${((t - run.startedAt) / 1000).toFixed(1)}s`;
const isConsentEntry = (value) => Array.isArray(value) && value[0] === "consent";

const routeList = (ch) => (ch?.routes ?? []).map((r) => `${r.journeyId} (${r.viewport})`).join(", ");

const isProblem = (f) => f.severity in SEVERITY_RANK;
const placeKey = (w) => `${w.journey}|${w.viewport}`;
const uniqPlaces = (where) => [...new Map(where.map((w) => [placeKey(w), w])).values()];
/** The problem the verdict is about: the one that costs the score most, else the most severe and widespread. */
function mdLead(rows, metrics) {
  const top = metrics.score?.deductions?.[0];
  const problems = rows.filter(isProblem);
  return (top && problems.find((f) => f.check === top.check && f.severity === top.severity && (f.platform ?? null) === top.platform && (f.event ?? null) === top.event)) ?? problems[0] ?? null;
}

/** " on mobile" when the lead problem is on one viewport of several, " on checkout" for one journey of several, " on every journey" when it is everywhere. */
function mdScope(m, runs, lead) {
  if (!lead) return "";
  const places = uniqPlaces(lead.where);
  if (runs.length > 1 && places.length === runs.length) return m.ui.md.everywhere;
  const viewports = new Set(places.map((w) => w.viewport));
  const journeys = new Set(places.map((w) => w.journey));
  if (viewports.size === 1 && new Set(runs.map((r) => r.viewport)).size > 1) return m.ui.md.onViewport(String([...viewports][0]));
  if (journeys.size === 1 && new Set(runs.map((r) => r.journeyId)).size > 1) return m.ui.md.onJourney(String([...journeys][0]));
  return "";
}

/**
 * The verdict sentence for the title, with no model, keyed the same way as metrics.verdict.headline. It names
 * the lead problem and where it is ("purchase tracking is broken on mobile"): the counts sit next to the
 * headline on every surface, so the count-based sentences in `verdict.headline` are left to the HTML verdict block.
 */
function mdHeadline(m, runs, rows, metrics) {
  const v = metrics.verdict;
  const lead = mdLead(rows, metrics);
  const what = lead ? (lead.event ? m.ui.md.tracking(String(lead.event)) : m.ui.md.setup(String(lead.check).replace(/_/g, " "))) : "";
  const scope = mdScope(m, runs, lead);
  const incomplete = runs.find((r) => !r.completed);
  const ctx = { key: v.headline, what, scope, journey: incomplete ? String(incomplete.journeyId) : "", events: metrics.coverage?.checkable ?? 0, journeys: runs.length, counts: v.counts, lead };
  const fallback = m.ui.md.headline[v.headline] ?? m.ui.md.headline.attention_nothing_tested;
  if (v.headline === "fail_incomplete") return fallback(ctx.journey);
  if (v.headline === "pass") return fallback(ctx.events, ctx.journeys);
  if (v.headline === "attention_no_hits" || v.headline === "attention_nothing_tested") return fallback();
  return fallback(what, scope);
}

/**
 * The verdict as the CLI, the alert subject and the Markdown title say it: { status, statusText, headline,
 * score }, in the report's language and with no Markdown in it. `metrics` is computeMetrics' result.
 */
export function verdictHeadline({ findings = [], runs = [], metrics, lang = "en" }) {
  const m = messages(lang);
  const rows = groupFindings(findings).sort((a, b) => SEVERITY_ORDER_MD[a.severity] - SEVERITY_ORDER_MD[b.severity] || b.where.length - a.where.length);
  return { status: metrics.verdict.status, statusText: m.verdict.status[metrics.verdict.status], headline: mdHeadline(m, runs, rows, metrics), score: metrics.score?.score ?? null };
}

const SEVERITY_ORDER_MD = { broken: 0, risk: 1, warning: 2, info: 3, ok: 4 };

const PLATFORM_ORDER = ["ga4", "google_ads", "meta", "tiktok", "x", "linkedin", "microsoft_ads", "pinterest", "snapchat", "criteo", "klaviyo", "adobe", "matomo", "piwik_pro", "clarity", "hotjar"];
export const platformLabel = (p) => PROVIDERS[p] ?? String(p).replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const platformRank = (p) => (PLATFORM_ORDER.includes(p) ? PLATFORM_ORDER.indexOf(p) : PLATFORM_ORDER.length);

// Platform keys go into class names, ids and attribute selectors.
const safeKey = (k) => String(k ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "") || "other";
const sortPlatforms = (keys) => [...keys].sort((a, b) => platformRank(a) - platformRank(b) || platformLabel(a).localeCompare(platformLabel(b)));
const changeLabel = (c) => `${platformLabel(c.platform ?? "")} ${c.event ?? ""}`.trim() || c.check;
const coverageLines = (m, pc) => [
  m.ui.coverageLine(pc.coverage),
  ...sortPlatforms(Object.keys(pc.coverage.platforms)).map((p) => `${platformLabel(p)}: ${m.ui.coverageLine(pc.coverage.platforms[p])}`),
];
const pcSort = (pc) => [...pc.events].sort((a, b) => BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket) || platformRank(a.platform) - platformRank(b.platform));
const BUCKET_ORDER = ["missing", "missing_params", "wrong_values", "implemented", "unplanned", "not_checked"];

const planChangeItems = (pc) => [
  ...pc.added.map((c) => `+ ${changeLabel(c)}`),
  ...pc.removed.map((c) => `− ${changeLabel(c)}`),
  ...pc.changed.map((c) => `~ ${changeLabel(c)}: ${c.what.join(", ")}`),
];

export {
  SEVERITIES, summaryParts, fixSteps, attachExplanations, SEVERITY_RANK, SEVERITY_ORDER_MD, seconds, isConsentEntry, routeList,
  isProblem, placeKey, uniqPlaces, mdHeadline, PLATFORM_ORDER, platformRank, safeKey, sortPlatforms, changeLabel,
  coverageLines, pcSort, BUCKET_ORDER, planChangeItems,
};
