import { AD_PLATFORMS, consentTable } from "./consent.js";
import { OWNERS, ownerOf, verifyLinks } from "./verify.js";
import { createProvider } from "./providers.js";
import { canonicalEvent, groupFindings, hitMatchesEvent, summarize } from "./checks.js";
import { messages } from "./i18n.js";
import { parseTrackingRequest, providerOf, PROVIDERS } from "./parsers.js";
import { decodeGa4Item, isEventParam, paramTip } from "./glossary.js";
import { buildInventory } from "./inventory.js";
import { LOGOS } from "./brand.js";
import { brandCss } from "./whitelabel.js";
import { computeMetrics } from "./metrics.js";
import { historySummaryLines, sparkline } from "./history.js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const EXPLAIN_SYSTEM = `You are a senior digital analytics consultant reviewing an automated tracking audit. You receive findings from deterministic checks, the measurement plan, the hits captured on each step of each journey, and optionally a Google Tag Manager container export.

For each finding with severity broken, risk or warning, give:
- impact: one sentence on what this does to the data, the reports or ad spend;
- likely_cause: the most likely cause, in plain language a marketing manager can follow and an analyst can act on;
- fix_steps: the fix as short, ordered steps.
When a GTM container is provided, name the specific tags, triggers or variables involved. Only state causes the evidence supports; when the cause is uncertain, say what to check. When a finding's gtm[].evaluation.why is present, it is a deterministic evaluation of that tag's triggers and consent against the captured dataLayer: rely on it for the likely cause instead of guessing.

Then write the summary:
- headline: one sentence naming what matters most for data quality and ad spend;
- points: the main problems, most important first, each one sentence with its severity;
- also_check: things you can see in the captured hits that the findings list does not cover (for example a conversion that fires on page load, or a cookie banner click counted as a conversion). Only include what the captured data shows; leave the list empty otherwise.

Formatting: in the headline, points, also_check, impact, likely_cause and fix_steps, wrap numbers and counts in double asterisks (for example sent **2** times, at **+70.4s**) and event, parameter, tag and trigger names in backticks (for example \`begin_checkout\`). Use no other formatting: no headings, lists, links or HTML.`;

const SEVERITIES = ["broken", "risk", "warning", "info"];
const EXPLAIN_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "object",
      properties: {
        headline: { type: "string", description: "One sentence on what matters most." },
        points: {
          type: "array",
          items: {
            type: "object",
            properties: { severity: { type: "string", enum: SEVERITIES }, text: { type: "string" } },
            required: ["severity", "text"],
            additionalProperties: false,
          },
        },
        also_check: { type: "array", items: { type: "string" } },
      },
      required: ["headline", "points", "also_check"],
      additionalProperties: false,
    },
    explanations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          finding: { type: "integer", description: "Index of the finding in the input list." },
          impact: { type: "string" },
          likely_cause: { type: "string" },
          fix_steps: { type: "array", items: { type: "string" } },
        },
        required: ["finding", "impact", "likely_cause", "fix_steps"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "explanations"],
  additionalProperties: false,
};

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

function hitsByStep(run) {
  return run.steps.map((step) => ({
    step: step.label,
    hits: run.hits
      .filter((h) => h.step === step.index)
      .map((h) => ({ platform: h.platform, event: h.name, params: h.params, ...(h.consent ? { consent: h.consent } : {}) })),
  }));
}

/**
 * Asks the AI model to explain the findings. Returns null on failure so the
 * deterministic report is still written.
 */
export async function explainFindings({ findings, plan, runs, gtmContainer, provider, providerName, client, model, lang = "en", log = () => {} }) {
  const actionable = groupFindings(findings).map((f, i) => ({ index: i, ...f })).filter((f) => ["broken", "risk", "warning"].includes(f.severity) && !f.accepted);
  if (actionable.length === 0) return { summary: { headline: messages(lang).ui.allGood, points: [], also_check: [] }, explanations: [] };
  try {
    const input = {
      findings: actionable,
      measurement_plan: plan,
      journeys: runs.map((r) => ({ journey: r.journeyId, viewport: r.viewport, completed: r.completed, note: r.note, steps: hitsByStep(r), page_errors: r.pageErrors })),
    };
    const texts = [`Audit data:\n${JSON.stringify(input, null, 1)}`];
    if (gtmContainer) texts.push(`GTM container export:\n${JSON.stringify(gtmContainer)}`);

    const ai = provider ?? (await createProvider({ name: providerName, model, client }));
    const result = await ai.json({
      system: lang === "en" ? EXPLAIN_SYSTEM : `${EXPLAIN_SYSTEM}\n\nWrite the summary, impacts, likely causes and fix steps in ${messages(lang).name}. Keep event, parameter, tag and trigger names exactly as they are.`,
      texts,
      schema: EXPLAIN_SCHEMA,
    });
    if (result.error) {
      log(`The model did not return explanations (${result.error}); writing the report without them.`);
      return null;
    }
    return result.value;
  } catch (err) {
    log(`Could not get explanations from the model: ${err.message}`);
    return null;
  }
}

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

/** The most severe finding that points at this hit, if any (for highlighting in the timeline). */
function hitSeverity(findings, run, step, hit) {
  let worst = null;
  for (const f of findings) {
    if (!(f.severity in SEVERITY_RANK)) continue;
    if (f.journey !== run.journeyId || f.viewport !== run.viewport || f.step !== step.label) continue;
    if (f.platform !== hit.platform || f.event !== hit.name) continue;
    if (worst === null || SEVERITY_RANK[f.severity] < SEVERITY_RANK[worst]) worst = f.severity;
  }
  return worst;
}

const seconds = (run, t) => `+${((t - run.startedAt) / 1000).toFixed(1)}s`;
const isConsentEntry = (value) => Array.isArray(value) && value[0] === "consent";

// Values from the audited page go into Markdown as text: no raw HTML, and no way out of a code span.
const mdText = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const mdCode = (v) => String(v ?? "").replace(/`/g, "'").replace(/\n/g, " ");

const routeList = (ch) => (ch?.routes ?? []).map((r) => `${r.journeyId} (${r.viewport})`).join(", ");

// ---------- The Markdown report (docs/design/md-report-spec.md) ----------
// A verdict first, evidence second, never a dump: the file goes into pull request comments, Slack
// previews and mails, so it stays around 120 lines and the per-hit timeline lives in timeline.csv.

const MD_BLOCKS = 5; // full finding blocks; findings beyond that are one line each
const MD_EVIDENCE = 200; // characters of raw evidence per finding
const MD_INVENTORY_ROWS = 10;
const MD_FLAGGED = 5;
const MD_PLACES = 3;

/** A finding's detail with quoted names as code spans, as the HTML shows it. */
const mdDetail = (s) => mdText(s).replace(/"([^"]+?)"/g, (_, x) => `\`${x.replace(/`/g, "'")}\``);
const mdClip = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
/** The path of a page address; the host is the site's and would repeat on every line. */
const mdPath = (url) => {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return String(url ?? "");
  }
};
const isProblem = (f) => f.severity in SEVERITY_RANK;
const runFor = (runs, w) => runs.find((r) => r.journeyId === w.journey && r.viewport === w.viewport) ?? null;
const placeKey = (w) => `${w.journey}|${w.viewport}`;
const uniqPlaces = (where) => [...new Map(where.map((w) => [placeKey(w), w])).values()];
const mdPlace = (w) => `${mdText(w.journey)} · ${mdText(w.viewport)}`;
/** "GA4 `purchase`", or the check name for a finding without an event. */
const mdTitle = (f) => [f.platform ? mdText(platformLabel(f.platform)) : "", f.event ? `\`${mdCode(f.event)}\`` : ""].filter(Boolean).join(" ") || mdText(f.check);
const mdAnchor = (f) => ["f", f.platform, f.event, f.check].filter(Boolean).map(safeKey).join("-");

/**
 * A text from one of the per-check tables (consequence, fix, verdict headline) that other parts of
 * i18n.js provide: a string as is, a function called with the grouped finding (or the verdict
 * context), nothing when the table or the entry is not there. Never throws, so a missing table only
 * costs the line.
 */
function mdTemplate(table, key, arg) {
  const v = table?.[key];
  if (typeof v === "string") return v;
  if (typeof v !== "function") return null;
  try {
    const out = v(arg);
    return typeof out === "string" && out ? out : null;
  } catch {
    return null;
  }
}

/** "checkout · mobile", "all 4 journeys", or the first three places and "+n more". */
function mdPlaces(m, runs, where) {
  const places = uniqPlaces(where);
  if (runs.length > 1 && places.length === runs.length) return m.ui.md.allJourneys(runs.length);
  const shown = places.slice(0, MD_PLACES).map(mdPlace);
  return places.length > MD_PLACES ? `${shown.join(", ")}, ${m.ui.md.more(places.length - MD_PLACES)}` : shown.join(", ");
}

/** The step a finding points at, from the first place that names one: { index, label, path, at }. */
function mdStep(runs, where) {
  for (const w of where) {
    if (!w.step) continue;
    const run = runFor(runs, w);
    const step = run?.steps?.find((s) => s.label === w.step);
    if (!step) return { index: null, label: w.step, path: null, at: null };
    return { index: step.index, label: step.label, path: step.pagePath ? mdPath(step.pagePath) : null, at: typeof run.startedAt === "number" && typeof step.t === "number" ? seconds(run, step.t) : null };
  }
  return null;
}

/** "checkout · mobile · step 11 "Place the order" · /thanks.html · +6.7s"; the short form stops at the step number. */
function mdWhere(m, runs, where, { full = true } = {}) {
  const parts = [mdPlaces(m, runs, where)];
  const step = mdStep(runs, where);
  if (step) {
    parts.push(step.index === null ? `"${mdText(step.label)}"` : `${m.ui.md.step(step.index)}${full ? ` "${mdText(step.label)}"` : ""}`);
    if (full && step.path) parts.push(mdText(step.path));
    if (full && step.at) parts.push(step.at);
  }
  return parts.join(" · ");
}

/** Completed runs where the same event fired and this check did not flag it: the contrast a reader needs ("desktop sent both"). */
function mdAlsoFineOn(m, runs, f) {
  if (!f.event || !f.platform) return "";
  const flagged = new Set(f.where.map(placeKey));
  const fine = runs.filter((r) => r.completed && !flagged.has(`${r.journeyId}|${r.viewport}`) && (r.hits ?? []).some((h) => h.platform === f.platform && canonicalEvent(h.name) === canonicalEvent(f.event)));
  return fine.length ? mdPlaces(m, runs, fine.map((r) => ({ journey: r.journeyId, viewport: r.viewport }))) : "";
}

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

/** "Changed since last run" in six lines at most: the headline, fixed, new, still open, and the route changes. */
function mdChanges(m, ch, rows) {
  if (!ch?.previous) return [];
  const lines = [`## ${m.ui.changesTitle}`, "", `**${mdText(m.ui.changesLine(ch))}** · ${mdText(m.ui.changesLead(ch.previous, ch.mode))}`, ""];
  const why = (c, bucket) => (ch.mode === "findings" ? mdDetail(c.detail) : mdText(m.ui.bucket[bucket]));
  if (ch.fixed.length) lines.push(`- ${m.ui.changeFixed}: ${ch.fixed.map((c) => `${mdText(changeLabel(c))} (${m.ui.history.fixedWas}: ${why(c, c.was)})`).join("; ")}`);
  if (ch.new.length) lines.push(`- ${m.ui.changeNew}: ${ch.new.map((c) => `${mdText(changeLabel(c))} (${why(c, c.bucket)})`).join("; ")}`);
  // Still open: this run's problems that the diff did not list as new.
  const key = (c) => (ch.mode === "plan" ? `${c.platform ?? ""}|${c.event ?? ""}` : `${c.check ?? ""}|${c.platform ?? ""}|${c.event ?? ""}`);
  const fresh = new Set(ch.new.map(key));
  const open = rows.filter((f) => isProblem(f) && !fresh.has(key(f)));
  if (open.length) lines.push(`- ${m.ui.md.stillOpen}: ${open.slice(0, MD_PLACES).map(mdTitle).join(", ")}${open.length > MD_PLACES ? `, ${m.ui.md.more(open.length - MD_PLACES)}` : ""}`);
  if (ch.routes?.length) lines.push(`- ${mdText(m.ui.routeChanged(routeList(ch)))}`);
  lines.push("");
  return lines;
}

/** The to-do list per owner, the owner that recovers the most points first; owners with nothing get one line. */
function mdPriorities(m, runs, metrics) {
  const lines = [`## ${m.ui.md.priorities}`, ""];
  const idle = [];
  for (const owner of Object.keys(m.ui.owners)) {
    const g = metrics.priorities.find((p) => p.owner === owner);
    if (!g) idle.push(owner);
  }
  for (const g of metrics.priorities) {
    lines.push(`### ${m.ui.owners[g.owner] ?? mdText(g.owner)}`);
    g.top.forEach((f, i) => lines.push(`${i + 1}. **${m.severity[f.severity]}** ${mdDetail(f.detail).replace(/\.$/, "")} · ${mdWhere(m, runs, f.where, { full: false })}`));
    if (g.total > g.top.length) lines.push(`${m.ui.md.more(g.total - g.top.length)}`);
    lines.push("");
  }
  if (idle.length) lines.push(...idle.map((o) => m.ui.md.nothingToDo(m.ui.owners[o])), "");
  return lines;
}

/** One finding as the fixed field list; the AI's impact, cause and fix steps replace the per-check templates when it ran. */
function mdFinding(m, runs, f) {
  const e = f.explanation;
  const lines = [`### ${m.severity[f.severity]}${f.accepted ? ` (${m.ui.accepted})` : ""}: ${mdDetail(f.detail)}`, `- ${m.ui.where}: ${mdWhere(m, runs, f.where)}`];
  const impact = e?.impact ?? mdTemplate(m.consequence, f.check, f);
  if (impact) lines.push(`- ${m.ui.impact}: ${mdText(impact)}`);
  if (e?.likely_cause) lines.push(`- ${m.ui.likelyCause}: ${mdText(e.likely_cause)}`);
  // Evidence is the hit's parameters as JSON; "{}" is a hit that carried none, and no evidence at all means there was no hit.
  if (f.evidence === "{}") lines.push(`- ${m.ui.evidence}: ${mdText(m.ui.md.noParams)}`);
  else if (f.evidence) lines.push(`- ${m.ui.evidence}: \`${mdClip(mdCode(f.evidence), MD_EVIDENCE)}\``);
  const fine = mdAlsoFineOn(m, runs, f);
  if (fine) lines.push(`- ${m.ui.md.alsoFineOn}: ${fine}`);
  lines.push(`- ${m.ui.md.owner}: ${m.ui.owners[ownerOf(f)]}`);
  if (f.gtm) lines.push(`- ${m.ui.gtmTags}: ${f.gtm.length ? f.gtm.map((t) => `${mdText(t.name)}${t.paused ? ` (${m.ui.gtmPaused})` : ""}, ${t.triggers.length ? `${m.ui.gtmFiresOn} ${t.triggers.map((x) => mdText(x.name)).join(", ")}` : m.ui.gtmNoTrigger}`).join("; ") : m.ui.gtmNoTag}`);
  for (const t of (f.gtm ?? []).filter((x) => x.evaluation)) lines.push(`- ${mdText(m.ui.gtmWhy(t.name, m.ui.gtmVerdict[t.evaluation.fired], t.evaluation.why))}`);
  const steps = fixSteps(e);
  const fix = steps.length ? steps.map((t, i) => `${i + 1}. ${mdText(t)}`).join("; ") : mdText(mdTemplate(m.fix, f.check, f) ?? "");
  if (fix) lines.push(`- ${m.ui.fix}: ${fix}`);
  const vl = verifyLinks(f);
  if (vl.length) lines.push(`- ${m.ui.verify}: ${vl.map((l) => `[${l.name}](${l.url})`).join(", ")}`);
  lines.push(`- ${m.ui.md.link}: report.html#${mdAnchor(f)}`, "");
  return lines;
}

/** One consent-scenario cell with its reason: the count, ✓ or ✗, and why ("cookieless", "before consent", "should not send"). */
function mdCell(m, col, cell, raw, adPlatform) {
  const c = m.ui.md.cell;
  if (cell.count === null) return c.notRun;
  const n = cell.count;
  if (cell.problem) return `**${n}** ${c.bad} ${c.shouldNotSend}`;
  if (!n) return "0";
  if (col === "before") return raw.cookieless >= n ? `${n} · ${c.cookieless} ${c.ok}` : `${n} ${c.bad} ${c.beforeConsent}`;
  if (col === "reject") return `${n} · ${c.cookieless} ${c.ok}`;
  if (col === "analytics" && adPlatform && raw.adDenied >= n) return `${n} · ${c.adDenied} ${c.ok}`;
  return `${n} ${c.ok}`;
}

/** The consent section: the Consent Mode timing sentence, then the scenario table with a reason in every cell. */
function mdConsent(m, metrics, scenarios) {
  const lines = [`## ${m.ui.md.consent}`, ""];
  const cm = metrics.consent?.consentMode;
  const tested = Boolean(cm?.runs?.length);
  if (tested) {
    const present = cm.runs.filter((d) => d.present).length;
    lines.push(present ? m.ui.md.consentMode(present, cm.runs.length, cm.defaultOnTime, cm.v2Signals.present) : m.ui.md.consentModeNone, "");
  }
  if (scenarios) {
    const { cols, rows } = consentTable(scenarios);
    const rawOf = (col, platform, event) => (col === "before" ? scenarios.before?.[platform]?.[event] : scenarios.states?.[col]?.after?.[platform]?.[event]) ?? { n: 0, cookieless: 0, adDenied: 0 };
    lines.push(`| ${m.ui.scenarioTag} | ${cols.map((c) => m.ui.scenarioCols[c]).join(" | ")} |`, `|${" --- |".repeat(cols.length + 1)}`);
    for (const r of rows) lines.push(`| ${mdText(platformLabel(r.platform))} \`${mdCode(r.event)}\` | ${r.cells.map((c) => mdCell(m, c.state, c, rawOf(c.state, r.platform, r.event), AD_PLATFORMS.has(r.platform))).join(" | ")} |`);
    lines.push("", m.ui.md.consentLegend, "");
  } else if (!tested) lines.push(m.ui.md.consentNotChecked, "");
  return lines;
}

/** What was verified, not only what failed: the ok checks, plan coverage, the purchases that pass, and personal data. */
function mdPassed(m, runs, findings, metrics, planCheck) {
  const items = [];
  const ok = new Map();
  for (const f of findings.filter((x) => x.severity === "ok")) {
    if (!ok.has(f.check)) ok.set(f.check, { detail: f.detail, where: [] });
    ok.get(f.check).where.push({ journey: f.journey, viewport: f.viewport });
  }
  for (const o of ok.values()) items.push(`${mdDetail(o.detail).replace(/\.$/, "")} · ${mdPlaces(m, runs, o.where)}`);
  if (metrics.coverage && !planCheck) items.push(m.ui.md.coverage(metrics.coverage.counts.implemented, metrics.coverage.checkable, metrics.coverage.percent.implemented));
  for (const r of (metrics.conversions?.rows ?? []).filter((x) => x.pass).slice(0, 3)) items.push(m.ui.md.purchaseOk(mdText(platformLabel(r.platform)), mdPlace({ journey: r.journey, viewport: r.viewport }), mdText(r.value), mdText(r.currency), r.transactionId ? mdText(r.transactionId) : ""));
  for (const p of metrics.parity ?? []) {
    // Two platforms "agree" only when both reported a value; two purchases without one agree on nothing.
    const purchase = p.shared.find((s) => s.event === "purchase" && !s.mismatch.length && Object.values(s.platforms).every((x) => x.value !== null));
    if (purchase) items.push(m.ui.md.parityOk(Object.keys(purchase.platforms).map((k) => mdText(platformLabel(k))).join(" & "), mdPlace({ journey: p.journey, viewport: p.viewport })));
  }
  if (runs.some((r) => r.hits?.length) && !findings.some((f) => String(f.check).startsWith("pii"))) items.push(m.ui.md.noPii);
  return [`## ${m.ui.md.whatPassed}`, "", ...(items.length ? items.slice(0, 10).map((i) => `- ${i}`) : [m.ui.nothing]), ""];
}

/** One table row per run, then the steps that carry a problem; the full timeline is timeline.csv. */
function mdJourneys(m, runs, rows) {
  const lines = [`## ${m.ui.tabJourneys}`, ""];
  if (!runs.length) return [...lines, m.ui.nothing, ""];
  const problems = rows.filter(isProblem);
  lines.push(`| ${m.ui.journey} | ${m.ui.md.viewport} | ${m.ui.completed} | ${m.ui.stepsCol} | ${m.ui.md.hits} | ${m.ui.findings} |`, "|---|---|---|---|---|---|");
  for (const r of runs) {
    const n = problems.filter((f) => f.where.some((w) => w.journey === r.journeyId && w.viewport === r.viewport)).length;
    const done = r.completed ? m.ui.md.yes : `${m.ui.md.no}${r.note ? ` · ${mdClip(mdText(r.note), 60)}` : ""}`;
    lines.push(`| ${mdText(r.journeyId)} | ${mdText(r.viewport)} | ${done.replace(/\|/g, "\\|")} | ${(r.steps ?? []).filter((s) => s.index > 0).length} | ${r.hits?.length ?? 0} | ${n} |`);
  }
  lines.push("");
  // The same step flagged on several journeys is one line with its places, as the findings are grouped.
  const flagged = new Map();
  for (const f of problems) {
    for (const w of f.where) {
      if (!w.step) continue;
      if (!flagged.has(w.step)) flagged.set(w.step, { where: [], titles: new Set() });
      flagged.get(w.step).where.push(w);
      flagged.get(w.step).titles.add(mdTitle(f));
    }
  }
  if (flagged.size) {
    const shown = [...flagged.values()].slice(0, MD_FLAGGED);
    lines.push(`**${m.ui.md.flaggedSteps}**`, ...shown.map(({ where, titles }) => `- ${mdWhere(m, runs, where)}: ${[...titles].join(", ")}`));
    if (flagged.size > shown.length) lines.push(`- ${m.ui.md.moreIn(flagged.size - shown.length, "timeline.csv")}`);
    lines.push("");
  }
  lines.push(m.ui.md.timelineNote, "");
  return lines;
}

/** What this run could not judge, each with the config key that enables it; omitted when nothing is missing. */
function mdNotChecked(m, runs, rows, plan, scenarios) {
  const items = [];
  if (!plan?.events?.length) items.push(m.ui.md.noPlan);
  const withEvent = rows.filter((f) => isProblem(f) && f.event);
  if (withEvent.length && !withEvent.some((f) => f.gtm)) items.push(m.ui.md.noGtm);
  if (scenarios) {
    if (!scenarios.states?.analytics?.after) items.push(m.ui.md.noAnalyticsOnly);
  } else if (runs.length) items.push(m.ui.md.noScenarios);
  const chosen = new Set(runs.flatMap((r) => r.providers ?? []));
  const seen = new Set(runs.flatMap((r) => (r.hits ?? []).map((h) => h.platform)));
  const silent = sortPlatforms([...chosen].filter((p) => !seen.has(p)));
  if (silent.length) items.push(m.ui.md.platformsSilent(silent.map((p) => mdText(platformLabel(p))).join(silent.length === 2 ? " & " : ", "), silent.length));
  return items.length ? [`## ${m.ui.md.notChecked}`, "", ...items.map((i) => `- ${i}`), ""] : [];
}

/** The vendor table, capped; the HTML report has the rest. Omitted when nothing was recorded. */
function mdInventory(m, runs) {
  const inv = buildInventory(runs);
  if (!inv.vendors.length) return [];
  const lines = [`## ${m.ui.inventoryTitle}`, "", `| ${m.ui.vendorCol} | ${m.ui.partyCol} | ${m.ui.pagesCol} | ${m.ui.cookiesCol} |`, "|---|---|---|---|"];
  for (const v of inv.vendors.slice(0, MD_INVENTORY_ROWS)) lines.push(`| ${mdText(v.vendor)} | ${m.ui.party[v.party]} | ${v.pages.length} | ${mdText(v.cookies.join(", ")) || "–"} |`);
  if (inv.vendors.length > MD_INVENTORY_ROWS) lines.push("", m.ui.md.moreIn(inv.vendors.length - MD_INVENTORY_ROWS, "report.html"));
  if (inv.otherCookies.length) lines.push("", `${m.ui.otherCookies}: ${mdText(inv.otherCookies.map((c) => c.name).join(", "))}`);
  lines.push("");
  return lines;
}

/** The trend in up to five lines: the text sparkline with the direction, then the open-longest and flapping lines. */
function mdTrend(m, trend, lang) {
  if (!trend || trend.runs < 2) return [];
  const [headline, ...rest] = historySummaryLines(trend, lang);
  return [`## ${m.ui.md.trend}`, "", `\`${sparkline(trend)}\` ${mdText(headline)}`, ...rest.map(mdText), ""];
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

/**
 * The Markdown report: the verdict in the title, the meta and counts, what changed, the priorities by
 * owner, up to five full finding blocks, consent, what passed, the journeys with their flagged steps,
 * what was not checked, the inventory and the trend. `metrics` comes from computeMetrics (computed
 * here when the caller has none) and `trend` from history.js (null without a saved history).
 */
export function renderMarkdown({ title, site = null, generatedAt, findings, explained, runs, plan = null, lang = "en", branding = true, against = null, planCheck = null, changes = null, planChanges = null, consentScenarios = null, brand = null, metrics = null, trend = null }) {
  const m = messages(lang);
  const rows = attachExplanations(findings, explained).sort((a, b) => SEVERITY_ORDER_MD[a.severity] - SEVERITY_ORDER_MD[b.severity] || b.where.length - a.where.length);
  const counts = summarize(rows);
  const accepted = rows.filter((f) => f.accepted).length;
  metrics ??= computeMetrics({ plan, runs, findings, consentScenarios });
  const platformsSeen = sortPlatforms([...new Set(runs.flatMap((r) => (r.hits ?? []).map((h) => h.platform)))]);
  const meta = [m.ui.md.meta(mdText(generatedAt), runs.length, m.ui.md.platformsSeen(platformsSeen.length, platformsSeen.map((p) => mdText(platformLabel(p))).join(", ")), VERSION), `[${m.ui.md.htmlReport}](report.html)`, ...(against ? [mdText(m.ui.checkedAgainst(against))] : [])];
  const status = `**${m.verdict.status[metrics.verdict.status]}**${metrics.score?.score === null || metrics.score?.score === undefined ? "" : ` · ${m.ui.md.score(metrics.score.score)}`}`;
  const lines = [`# ${mdText(m.ui.md.title(site ?? title, mdHeadline(m, runs, rows, metrics)))}`, "", meta.join(" · "), status, `**${m.ui.counts(counts)}**${changes && !changes.previous ? ` · ${m.ui.noPreviousRun}` : ""}`, ""];
  if (accepted) lines.push(mdText(m.ui.acceptedLine(accepted)), "");
  if (planChanges) lines.push(mdText(m.ui.planChangesLine(planChanges)), "", ...planChangeItems(planChanges).map((i) => `- ${mdText(i)}`), ...(planChangeItems(planChanges).length ? [""] : []));
  const sum = summaryParts(explained?.summary);
  if (sum) {
    lines.push(`${m.ui.md.aiSummary}: ${sum.text ? mdText(sum.text) : `**${mdText(sum.headline)}**`}`);
    lines.push(...sum.points.slice(0, 3).map((p) => `- **${m.severity[p.severity]}**: ${mdText(p.text)}`));
    if (sum.also_check.length) lines.push(`- ${m.ui.alsoCheck}: ${sum.also_check.slice(0, 2).map(mdText).join("; ")}`);
    lines.push("");
  }
  lines.push(...mdChanges(m, changes, rows));
  lines.push(...mdTrend(m, trend, lang));
  if (planCheck) lines.push(...planVsSiteMd(m, planCheck));
  lines.push(...mdPriorities(m, runs, metrics));
  lines.push(`## ${m.ui.findings}`, "");
  const problems = rows.filter((f) => f.severity !== "ok");
  if (!problems.length) lines.push(m.ui.noProblems, "");
  for (const f of problems.slice(0, MD_BLOCKS)) lines.push(...mdFinding(m, runs, f));
  const rest = problems.slice(MD_BLOCKS);
  if (rest.length) lines.push(`### ${m.ui.md.also}`, ...rest.map((f) => `- **${m.severity[f.severity]}** ${mdDetail(f.detail).replace(/\.$/, "")} · ${mdWhere(m, runs, f.where, { full: false })}`), "");
  lines.push(...mdConsent(m, metrics, consentScenarios));
  lines.push(...mdPassed(m, runs, findings, metrics, planCheck));
  lines.push(...mdJourneys(m, runs, rows));
  lines.push(...mdNotChecked(m, runs, rows, plan, consentScenarios));
  lines.push(...mdInventory(m, runs));
  // A report with its own name or logo carries no Analitik İşler credit; the AI Tag Debugger one stays.
  if (brand?.name || brand?.logo) lines.push("---", "", `_${brand.name ? `${brand.name} · ` : ""}${m.ui.generatedBy}_`, "");
  else if (branding) lines.push("---", "", `_${m.ui.generatedBy} · [analitikisler.com](https://analitikisler.com)_`, "");
  return lines.join("\n");
}

const SEVERITY_ORDER_MD = { broken: 0, risk: 1, warning: 2, info: 3, ok: 4 };

const PLATFORM_ORDER = ["ga4", "google_ads", "meta", "tiktok", "x", "linkedin", "microsoft_ads", "pinterest", "snapchat", "criteo", "klaviyo", "adobe", "matomo", "piwik_pro", "clarity", "hotjar"];
export const platformLabel = (p) => PROVIDERS[p] ?? String(p).replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const platformRank = (p) => (PLATFORM_ORDER.includes(p) ? PLATFORM_ORDER.indexOf(p) : PLATFORM_ORDER.length);

// Pixel event names and their GA4 / dataLayer counterparts, so a Meta or TikTok hit can be shown next to the push behind it.
const EVENT_ALIASES = {
  pageview: "pageview", viewcontent: "viewitem", addtocart: "addtocart", addtowishlist: "addtowishlist", initiatecheckout: "begincheckout",
  addpaymentinfo: "addpaymentinfo", purchase: "purchase", completepayment: "purchase", placeanorder: "purchase", lead: "generatelead",
  completeregistration: "signup", search: "search", contact: "generatelead", submitform: "generatelead", subscribe: "subscribe", starttrial: "starttrial",
  viewbasket: "viewcart", tracktransaction: "purchase",
};
const normName = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const eventKey = (s) => EVENT_ALIASES[normName(s)] ?? normName(s);
// GTM-style pushes are objects ({event: "add_to_cart"}); gtag.js records arrays (["event", "add_to_cart", {...}]).
const pushEvent = (value) => (Array.isArray(value) ? (value[0] === "event" ? value[1] : undefined) : value && typeof value === "object" ? value.event : undefined);
const pushText = (value) => (Array.isArray(value) && typeof value[0] === "string" ? `gtag(${value.map((v) => JSON.stringify(v, null, 2)).join(", ")})` : JSON.stringify(value, null, 2));

// Per run: step index -> event key -> the pushes with that event name. Built once so rendering stays linear.
const pushIndexCache = new WeakMap();
function pushIndex(run) {
  let index = pushIndexCache.get(run);
  if (!index) {
    index = new Map();
    for (const e of run.dataLayerLog ?? []) {
      const name = pushEvent(e.value);
      if (typeof name !== "string" || !eventKey(name)) continue;
      if (!index.has(e.step)) index.set(e.step, new Map());
      const byKey = index.get(e.step);
      const key = eventKey(name);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(e);
    }
    pushIndexCache.set(run, index);
  }
  return index;
}

/** Every dataLayer push in the hit's step whose event name matches it (directly or through a pixel alias). */
const matchingPushes = (run, hit) => pushIndex(run).get(hit.step)?.get(eventKey(hit.name)) ?? [];

/** The push behind the hit. When the same event fires as often as it was pushed (duplicates), they are paired in order. */
function pushesForHit(run, hit) {
  const pushes = matchingPushes(run, hit);
  const key = eventKey(hit.name);
  const twins = run.hits.filter((h) => h.step === hit.step && h.platform === hit.platform && eventKey(h.name) === key);
  return twins.length > 1 && pushes.length === twins.length ? [pushes[twins.indexOf(hit)]] : pushes;
}

/** The network request that carried the hit. Identical hits (duplicates) are paired with identical requests in order. */
function callsForHit(run, hit) {
  const calls = (run.network ?? []).filter((c) => c.step === hit.step && c.url === hit.url);
  const twins = run.hits.filter((h) => h.step === hit.step && h.url === hit.url);
  return twins.length > 1 && calls.length === twins.length ? [calls[twins.indexOf(hit)]] : calls;
}


/* ---------- icons: one inline SVG sprite, referenced with <use> ---------- */

const STROKE = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';
// Severity glyphs (shape and mark, so they survive greyscale) and the interface icons (Lucide).
const UI_SYMBOLS = {
  "sev-broken": '<path d="M8.2 2.5h7.6l5.7 5.7v7.6l-5.7 5.7H8.2l-5.7-5.7V8.2z"/><path d="m9.5 9.5 5 5m0-5-5 5"/>',
  "sev-risk": '<path d="M12 2.5 21.5 12 12 21.5 2.5 12z"/><path d="M12 8v5"/><path d="M12 16.5h.01"/>',
  "sev-warning": '<path d="m12 3.5 9.5 16.5h-19z"/><path d="M12 10v4.5"/><path d="M12 17.5h.01"/>',
  "sev-info": '<circle cx="12" cy="12" r="9.5"/><path d="M12 11v5.5"/><path d="M12 7.5h.01"/>',
  "sev-ok": '<circle cx="12" cy="12" r="9.5"/><path d="m7.5 12.5 3 3 6-6.5"/>',
  "ui-chevron": '<path d="m9 18 6-6-6-6"/>',
  "ui-impact": '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
  "ui-cause": '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  "ui-evidence": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  "ui-fix": '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  "ui-where": '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  "ui-verify": '<path d="M9 12l2 2 4-4"/><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"/>',
  "ui-external": '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  "ui-theme": '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/>',
  "ui-gtm": '<path d="M4 4h6v6H4z"/><path d="M14 4h6v6h-6z"/><path d="M4 14h6v6H4z"/><path d="M14 14h6v6h-6z"/>',
};
// Platform artwork, the same drawings the report used as data URIs before, as symbols. Dark glyphs (TikTok, X) sit on a plate that follows the card colour.
const PLATFORM_ART = {
  ga4: '<rect x="15" y="2" width="6" height="20" rx="3" fill="#F9AB00"/><rect x="9" y="9" width="6" height="13" rx="3" fill="#E37400"/><circle cx="6" cy="19" r="3" fill="#E37400"/>',
  google_ads: '<rect x="9.5" y="1.5" width="6" height="21" rx="3" transform="rotate(30 12.5 12)" fill="#FBBC04"/><rect x="8.5" y="1.5" width="6" height="21" rx="3" transform="rotate(-30 11.5 12)" fill="#4285F4"/><circle cx="5.5" cy="18.5" r="3" fill="#34A853"/>',
  meta: '<path d="M2.5 15.5c0-4.4 2.3-9 5-9 3.4 0 6 11 9.5 11 2.2 0 4.5-2.6 4.5-6.5S19.8 6.5 17.5 6.5c-3.4 0-6 11-9.8 11-2.9 0-5.2-.7-5.2-2z" fill="none" stroke="#0866FF" stroke-width="2.4" stroke-linejoin="round"/>',
  tiktok: '<rect class="plate" x="0" y="0" width="24" height="24" rx="5"/><g fill="none" stroke-width="2.6" stroke-linecap="round"><path d="M13 3v11.5a3.5 3.5 0 1 1-3-3.46M13 3c.5 2.5 2.5 4 5 4" stroke="#25F4EE" transform="translate(-1 -1)"/><path d="M13 3v11.5a3.5 3.5 0 1 1-3-3.46M13 3c.5 2.5 2.5 4 5 4" stroke="#FE2C55" transform="translate(1 1)"/><path d="M13 3v11.5a3.5 3.5 0 1 1-3-3.46M13 3c.5 2.5 2.5 4 5 4" stroke="#111"/></g>',
  x: '<rect class="plate" x="0" y="0" width="24" height="24" rx="5"/><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" fill="#000" transform="translate(3 3) scale(.75)"/>',
  linkedin: '<path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" fill="#0A66C2"/>',
  microsoft_ads: '<rect x="1" y="1" width="10.5" height="10.5" fill="#F25022"/><rect x="12.5" y="1" width="10.5" height="10.5" fill="#7FBA00"/><rect x="1" y="12.5" width="10.5" height="10.5" fill="#00A4EF"/><rect x="12.5" y="12.5" width="10.5" height="10.5" fill="#FFB900"/>',
  pinterest: '<path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.401.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.354-.629-2.758-1.379l-.749 2.848c-.269 1.045-1.004 2.352-1.498 3.146 1.123.345 2.306.535 3.55.535 6.607 0 11.985-5.365 11.985-11.987C23.97 5.39 18.592.026 11.985.026L12.017 0z" fill="#BD081C"/>',
  snapchat: '<rect width="24" height="24" rx="5" fill="#FFFC00"/><path d="M12.206.793c.99 0 4.347.276 5.93 3.821.529 1.193.403 3.219.299 4.847l-.003.06c-.012.18-.022.345-.03.51.075.045.203.09.401.09.3-.016.659-.12 1.033-.301.165-.088.344-.104.464-.104.182 0 .359.029.509.09.45.149.734.479.734.838.015.449-.39.839-1.213 1.168-.089.029-.209.075-.344.119-.45.135-1.139.36-1.333.81-.09.224-.061.524.12.868l.015.015c.06.136 1.526 3.475 4.791 4.014.255.044.435.27.42.509 0 .075-.015.149-.045.225-.24.569-1.273.988-3.146 1.271-.059.091-.12.375-.164.57-.029.179-.074.36-.134.553-.076.271-.27.405-.555.405h-.03c-.135 0-.313-.031-.538-.074-.36-.075-.765-.135-1.273-.135-.3 0-.599.015-.913.074-.6.104-1.123.464-1.723.884-.853.599-1.826 1.288-3.294 1.288-.06 0-.119-.015-.18-.015h-.149c-1.468 0-2.427-.675-3.279-1.288-.599-.42-1.107-.779-1.707-.884-.314-.045-.629-.074-.928-.074-.54 0-.958.089-1.272.149-.211.043-.391.074-.54.074-.374 0-.523-.224-.583-.42-.061-.192-.09-.389-.135-.567-.046-.181-.105-.494-.166-.57-1.918-.222-2.95-.642-3.189-1.226-.031-.063-.052-.15-.055-.225-.015-.243.165-.465.42-.509 3.264-.54 4.73-3.879 4.791-4.02l.016-.029c.18-.345.224-.645.119-.869-.195-.434-.884-.658-1.332-.809-.121-.029-.24-.074-.346-.119-1.107-.435-1.257-.93-1.197-1.273.09-.479.674-.793 1.168-.793.146 0 .27.029.383.074.42.194.789.3 1.104.3.234 0 .384-.06.465-.105l-.046-.569c-.098-1.626-.225-3.651.307-4.837C7.392 1.077 10.739.807 11.727.807l.419-.015h.06z" transform="translate(3 3) scale(.75)" fill="#fff" stroke="#000" stroke-width="1.3"/>',
  criteo: '<circle cx="12" cy="12" r="11" fill="#FE5000"/><path d="M16.2 8.6a5 5 0 1 0 0 6.8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>',
  hotjar: '<path d="M10.119 9.814C12.899 8.27 16.704 6.155 16.704 0h-4.609c0 3.444-1.676 4.375-4.214 5.786C5.1 7.33 1.295 9.444 1.295 15.6h4.61c0-3.444 1.676-4.376 4.214-5.786zM18.096 8.4c0 3.444-1.677 4.376-4.215 5.785-2.778 1.544-6.585 3.66-6.585 9.815h4.609c0-3.444 1.676-4.376 4.214-5.786 2.78-1.544 6.586-3.658 6.586-9.814h-4.609z" fill="#FF3C00"/>',
  adobe: '<path d="M0 2h8.5L0 22zM24 2h-8.5L24 22zM12 9l5.5 13h-3.6l-1.7-4.2H8.9z" fill="#EB1000"/>',
  matomo: '<path d="M6 18l6-9 6 9" fill="none" stroke="#3152A0" stroke-width="2"/><circle cx="6" cy="18" r="3" fill="#95C748"/><circle cx="12" cy="9" r="3" fill="#3152A0"/><circle cx="18" cy="18" r="3" fill="#3152A0"/>',
  piwik_pro: '<rect width="24" height="24" rx="5" fill="#0C2D5B"/><path d="M8 18V6h5a3.5 3.5 0 010 7H8" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  clarity: '<rect width="24" height="24" rx="5" fill="#0078D4"/><path d="M12 5a7 7 0 100 14M12 9a3 3 0 100 6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>',
};

/** An icon from the sprite. Decorative: the text next to it names the thing. */
const use = (id, size = 16, cls = "") => `<svg class="ic${cls ? ` ${cls}` : ""}" width="${size}" height="${size}" aria-hidden="true"><use href="#${id}"/></svg>`;

/** The sprite with only the symbols the page references, so a report never carries artwork it does not show. */
function sprite(html) {
  const used = new Set([...html.matchAll(/href="#((?:sev|ui)-[a-z]+|p-[a-z0-9_]+)"/g)].map((x) => x[1]));
  const symbols = [...used].sort().map((id) => {
    if (id.startsWith("p-")) return `<symbol id="${id}" viewBox="0 0 24 24">${PLATFORM_ART[id.slice(2)]}</symbol>`;
    return `<symbol id="${id}" ${STROKE}>${UI_SYMBOLS[id]}</symbol>`;
  });
  return `<svg hidden style="display:none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${symbols.join("")}</svg>`;
}

/** The platform's icon, or for a platform without artwork its initials on a neutral square. Screen readers get the name as text. */
function platIcon(key, size = 16, label = platformLabel(key)) {
  const k = safeKey(key);
  const art = PLATFORM_ART[k] ? use(`p-${k}`, size) : `<span class="plat-fb s${size}" aria-hidden="true">${escapeHtml(label.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase())}</span>`;
  return `${art}<span class="sr">${escapeHtml(label)} </span>`;
}
/** Icon and name of a platform. */
function plat(key, size = 16, label = platformLabel(key)) {
  const k = safeKey(key);
  const art = PLATFORM_ART[k] ? use(`p-${k}`, size) : `<span class="plat-fb s${size}" aria-hidden="true">${escapeHtml(label.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase())}</span>`;
  return `<span class="plat">${art}<span>${escapeHtml(label)}</span></span>`;
}

const kvTable = (label, rows) => `<table class="ptable" aria-label="${escapeHtml(label)}"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}</tbody></table>`;
// Platform keys go into class names, ids and attribute selectors.
const safeKey = (k) => String(k ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "") || "other";
const cell = (v) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

const STANDARD_ITEM_KEYS = new Set(["item_id", "item_name", "affiliation", "coupon", "discount", "index", "item_brand", "item_category", "item_category2", "item_category3", "item_category4", "item_category5", "item_list_id", "item_list_name", "item_variant", "location_id", "price", "quantity", "promotion_id", "promotion_name", "creative_name", "creative_slot"]);
const ECOMMERCE_EVENTS = new Set(["view_item", "view_item_list", "select_item", "add_to_cart", "remove_from_cart", "view_cart", "begin_checkout", "add_shipping_info", "add_payment_info", "purchase", "refund", "add_to_wishlist", "view_promotion", "select_promotion"]);

/** GA4 item strings (pr1=…) as { fields, custom } pairs. */
const ga4Items = (strings) => (strings ?? []).map(decodeGa4Item);
/** dataLayer ecommerce.items objects as { fields, custom } pairs: standard GA4 item keys, then the site's own. */
const objectItems = (list) =>
  list.filter((it) => it && typeof it === "object").map((it) => {
    const entries = Object.entries(it).map(([k, v]) => [k, cell(v)]);
    return { fields: entries.filter(([k]) => STANDARD_ITEM_KEYS.has(k)), custom: entries.filter(([k]) => !STANDARD_ITEM_KEYS.has(k)) };
  });
/** The items array of a GTM-style ({ecommerce: {items}}) or gtag.js-style (["event", name, {items}]) push. */
function pushItems(value) {
  const items = Array.isArray(value) ? value[2]?.items : value?.ecommerce?.items ?? value?.items;
  return Array.isArray(items) ? items : [];
}

function itemCards(m, items) {
  return items
    .map(({ fields, custom }, i) => {
      const get = (k) => fields.find(([n]) => n === k)?.[1];
      const price = get("price");
      const qty = get("quantity");
      const head = `<div class="item-head"><span class="item-idx">${i + 1}</span><b>${escapeHtml(get("item_name") ?? "")}</b><span class="mono muted">${escapeHtml(get("item_id") ?? "")}</span>${price !== undefined || qty !== undefined ? `<span class="item-price mono">${escapeHtml(price ?? "–")} × ${escapeHtml(qty ?? "1")}</span>` : ""}</div>`;
      const rest = fields.filter(([n]) => !["item_name", "item_id", "price", "quantity"].includes(n));
      const grid = (rows) => `<dl class="grid4">${rows.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v === "" ? "–" : v)}</dd></div>`).join("")}</dl>`;
      return `<div class="item">${head}${rest.length ? grid(rest) : ""}${custom.length ? `<h6>${m.ui.customItemParams}</h6>${grid(custom)}` : ""}</div>`;
    })
    .join("");
}
const itemsBlock = (m, items) => (items.length ? `<h6>${m.ui.items} <span class="n">${items.length}</span></h6>${itemCards(m, items)}` : "");

/** The most severe finding that points at this hit, or null. */
function hitFlag(findings, run, step, hit) {
  let worst = null;
  for (const f of findings) {
    if (!(f.severity in SEVERITY_RANK)) continue;
    if (f.journey !== run.journeyId || f.viewport !== run.viewport || f.step !== step.label) continue;
    if (f.platform !== hit.platform || f.event !== hit.name) continue;
    if (worst === null || SEVERITY_RANK[f.severity] < SEVERITY_RANK[worst.severity]) worst = f;
  }
  return worst;
}

const hostPath = (url) => {
  try {
    const u = new URL(url);
    return u.host + u.pathname;
  } catch {
    return String(url ?? "");
  }
};

/** The card of the grouped finding a raw finding belongs to, by the same key groupFindings uses. */
const cardOf = (ids, f) => {
  for (const [row, id] of ids) if (row.severity === f.severity && row.check === f.check && row.platform === f.platform && row.event === f.event && row.detail === f.detail) return id;
  return null;
};

function eventRow(m, findings, run, step, hit, ids = new Map()) {
  const flag = hitFlag(findings, run, step, hit);
  const pushes = pushesForHit(run, hit);
  const calls = callsForHit(run, hit);
  const items = ga4Items(hit.items);
  const params = Object.entries(hit.params ?? {}).filter(([k]) => !(k === "items" && items.length));
  const bits = [];
  if (items.length) bits.push(m.ui.itemsCount(items.length));
  if (hit.params?.value) bits.push(`${hit.params.value} ${hit.params.currency ?? ""}`.trim());
  if (!items.length && hit.platform === "ga4" && ECOMMERCE_EVENTS.has(hit.name)) bits.push(m.ui.noItems);
  if (hit.delivery === "server") bits.push(m.ui.serverSideTag);
  const consent = hit.consent ? `<p class="xs muted consents">${m.html.consentOnHit} ${Object.entries(hit.consent).map(([k, v]) => `<span class="consent ${v === "granted" ? "granted" : "denied"}">${escapeHtml(k)} ${escapeHtml(v)}</span>`).join(" ")}</p>` : "";
  const pushLine = pushes.length ? pushes.map((e) => `<span class="mono">${escapeHtml(pushEvent(e.value) ?? "")} · ${escapeHtml(seconds(run, e.t))}</span>`).join("") : `<span class="muted">${m.ui.noMatchingPush}</span>`;
  const reqText = calls.length
    ? calls.map((c) => `<span class="mono"><span class="method">${escapeHtml(c.method)}</span> ${escapeHtml(hostPath(c.url))} <span class="status">${escapeHtml(c.status ?? "")}</span>${c.blocked ? ` <span class="muted">${escapeHtml(m.html.blockedBy(platformLabel(hit.platform)))}</span>` : ""}</span>`).join("")
    : `<span class="mono">${escapeHtml(hostPath(hit.url))}</span>`;
  const card = flag ? cardOf(ids, flag) : null;
  return `<li class="event${flag ? ` flag-${flag.severity} sev-${flag.severity}` : ""}"><details${flag ? " open" : ""}>
<summary>${plat(hit.platform, 16)}<code class="ev">${escapeHtml(hit.name)}</code>${flag ? `<span class="tag badge sev-${flag.severity}">${use(`sev-${flag.severity}`, 12)}${m.severity[flag.severity]}</span>` : ""}<span class="meta">${escapeHtml(bits.join(" · ") || `${params.length} ${m.ui.paramsShort}`)}</span><span class="time">${escapeHtml(seconds(run, hit.t))}</span>${use("ui-chevron", 14, "chev")}</summary>
<div class="event-body">${flag ? `<p class="flagnote sev-${flag.severity}">${detailHtml(flag.detail)}${card ? ` <a href="#${card}">${m.html.findingLink}</a>` : ""}</p>` : ""}${consent}
<div class="ebgrid"><div>${params.length ? kvTable(m.ui.parameters, params) : `<p class="muted xs">${m.ui.noParameters}</p>`}</div>
<aside><h6>${m.ui.source}</h6><ul class="srclist"><li><span class="lbl">dataLayer</span>${pushLine}</li><li><span class="lbl">${m.ui.request}</span>${reqText}</li></ul></aside></div>
${itemsBlock(m, items)}</div></details></li>`;
}

const clip = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

function pushRow(m, run, e) {
  const name = isConsentEntry(e.value) ? `consent ${e.value[1]}` : pushEvent(e.value) ?? clip(JSON.stringify(e.value) ?? String(e.value), 80);
  const items = objectItems(pushItems(e.value));
  const ec = Array.isArray(e.value) ? e.value[2] : e.value?.ecommerce;
  const bits = items.length ? [m.ui.itemsCount(items.length), ec?.value !== undefined ? `${ec.value} ${ec.currency ?? ""}`.trim() : ""].filter(Boolean).join(" · ") : "";
  return `<li class="event"><details><summary><code class="ev">${escapeHtml(name)}</code>${bits ? `<span class="meta">${escapeHtml(bits)}</span>` : ""}<span class="time">${escapeHtml(seconds(run, e.t))}</span>${use("ui-chevron", 14, "chev")}</summary>
<div class="event-body">${itemsBlock(m, items)}${items.length ? `<details class="raw"><summary>${use("ui-chevron", 14, "chev")} ${m.ui.rawJson}</summary><pre>${escapeHtml(pushText(e.value))}</pre></details>` : `<pre>${escapeHtml(pushText(e.value))}</pre>`}</div></details></li>`;
}

/** Nested JSON as dotted keys (properties.value); arrays stay JSON text. */
function flatten(obj, prefix = "", out = []) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && prefix.split(".").length < 3) flatten(v, key, out);
    else out.push([key, cell(v)]);
  }
  return out;
}

/**
 * The parameter sets a request carried: one per event in a GA4 batch (query plus
 * each body line), the query plus a flattened JSON body, or just the query.
 */
function paramSets(call) {
  let u;
  try {
    u = new URL(call.url);
  } catch {
    return [[]];
  }
  const query = [...u.searchParams];
  const body = call.postData;
  if (!body) return [query];
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    try {
      return [[...query, ...flatten(JSON.parse(trimmed))]];
    } catch { /* not JSON, or cut at the size limit */ }
  }
  if (/^[^\s{]*=/.test(trimmed)) {
    return trimmed.split("\n").filter(Boolean).map((line) => {
      const merged = new Map(query);
      for (const [k, v] of new URLSearchParams(line)) merged.set(k, v);
      return [...merged];
    });
  }
  return [query];
}

/** Parameter rows with a glossary tip: the "?" shows the tip on hover and takes no focus; the tip text is read by screen readers from the hidden span. */
function paramRows(m, lang, entries) {
  return entries
    .map(([k, v]) => {
      const tip = paramTip(k, lang);
      const isItem = /^pr\d+$/.test(k);
      return `<tr${isItem ? ' class="pr"' : ""}><th scope="row"><span class="pk">${escapeHtml(k)}</span>${tip ? `<span class="q" aria-hidden="true" data-tip="${escapeHtml(tip)}">?</span><span class="sr">${escapeHtml(tip)}</span>` : ""}</th><td>${isItem ? `<span class="muted small">${escapeHtml(paramTip(k, lang))}</span>` : escapeHtml(v)}</td></tr>`;
    })
    .join("");
}

/** One row per event in each network request of the step. */
function requestRows(m, lang, run, step) {
  const rows = [];
  for (const c of (run.network ?? []).filter((x) => x.step === step.index)) {
    const sets = paramSets(c);
    const hits = parseTrackingRequest(c.url, c.postData ?? null) ?? [];
    const key = safeKey(c.provider ?? providerOf(c.url)?.key ?? c.vendor);
    const label = PROVIDERS[key] ?? c.vendor ?? key;
    sets.forEach((entries, i) => {
      const name = hits[i]?.name ?? (hits.length === 1 ? hits[0].name : "");
      const eventEntries = entries.filter(([k]) => isEventParam(k));
      const context = entries.filter(([k]) => !isEventParam(k));
      const items = ga4Items(entries.filter(([k]) => /^pr\d+$/.test(k)).map(([, v]) => v));
      const raw = c.url + (c.postData ? `\n\n${c.postData}` : "");
      const html = `<li class="event"><details><summary>${plat(key, 16, label)}<span class="method">${escapeHtml(c.method)}</span>${name ? `<code class="ev">${escapeHtml(name)}</code>` : ""}<span class="meta mono">${escapeHtml(hostPath(c.url))}${sets.length > 1 ? ` · ${escapeHtml(m.ui.inBatch(i + 1, sets.length))}` : ""}</span><span class="status mono">${escapeHtml(c.status ?? "")}</span><span class="time">${escapeHtml(seconds(run, c.t))}</span>${use("ui-chevron", 14, "chev")}</summary>
<div class="event-body">${c.blocked ? `<p class="muted small">${escapeHtml(m.html.blockedBy(label))}</p>` : ""}${c.bodyDropped ? `<p class="muted small">${m.ui.bodyDropped}</p>` : ""}${eventEntries.length ? `<h6>${m.ui.eventParams}</h6><table class="ptable glossary" aria-label="${m.ui.eventParams}"><tbody>${paramRows(m, lang, eventEntries)}</tbody></table>` : ""}
${context.length ? `<details class="raw ctx"${eventEntries.length ? "" : " open"}><summary>${use("ui-chevron", 14, "chev")} ${m.ui.contextParams} <span class="n">${context.length}</span></summary><table class="ptable glossary" aria-label="${m.ui.contextParams}"><tbody>${paramRows(m, lang, context)}</tbody></table></details>` : ""}
${itemsBlock(m, items)}<details class="raw"><summary>${use("ui-chevron", 14, "chev")} ${m.ui.rawRequest}</summary><pre class="url">${escapeHtml(raw)}</pre></details></div></details></li>`;
      rows.push({ key, label, html });
    });
  }
  return rows;
}

const stepAnchor = (ri, si) => `j${ri}-s${si}`;
const skippedText = (counts) => Object.entries(counts ?? {}).sort((a, b) => b[1] - a[1]);
const sortPlatforms = (keys) => [...keys].sort((a, b) => platformRank(a) - platformRank(b) || platformLabel(a).localeCompare(platformLabel(b)));

// AI text marks numbers with **x** and names with `x`. Only those two marks become HTML; everything else is escaped.
const fmt = (s) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>");
// Finding texts quote event and parameter names ("add_to_cart"); show those as code.
const detailHtml = (s) => escapeHtml(s).replace(/&quot;([^&]+?)&quot;/g, "<code>$1</code>");

const sec = (name, label) => `<h5 class="sec-h">${use(`ui-${name}`, 14)}<span>${label}</span></h5>`;
/** A severity badge: glyph and word, never colour alone. A badge without a severity is a plain grey chip. */
const badge = (sev, text) => (UI_SYMBOLS[`sev-${sev}`] ? `<span class="badge sev-${sev}">${use(`sev-${sev}`, 14)}${escapeHtml(text)}</span>` : `<span class="badge">${escapeHtml(text)}</span>`);

// The dark palette, written twice: once for the OS preference (unless the page is forced light) and once for the forced dark theme.
const DARK_TOKENS = `--page:#0B0F19;--card:#141927;--well:#1B2235;--fg:#EEF2FF;--muted:#9AA4BD;--border:#263050;
--accent:#4F8EF7;--accent-fg:#8CBBFF;--accent-bg:#1A2F5C;
--sev-broken:#F04438;--sev-broken-fg:#FDA29B;--sev-broken-bg:#3D1D1D;
--sev-risk:#D78AD6;--sev-risk-fg:#E3A6E0;--sev-risk-bg:#34203A;
--sev-warning:#E8B44A;--sev-warning-fg:#F5C451;--sev-warning-bg:#352B10;
--sev-info:#8191B8;--sev-info-fg:#B4C0DC;--sev-info-bg:#1E2536;
--sev-ok:#3FB98A;--sev-ok-fg:#5BD39A;--sev-ok-bg:#113128;
--shadow-sm:none;--muted-bg:var(--well);--bg:var(--card);--warn:var(--sev-warning-fg);--warn-bg:var(--sev-warning-bg);--danger:var(--sev-broken-fg);--ok:var(--sev-ok-fg)`;

export const CSS = `
:root{
color-scheme:light dark;
--page:#F6F7F9;--card:#FFFFFF;--well:#EEF1F6;--fg:#111827;--muted:#4B5567;--border:#D9DEE8;
--accent:#2E6CDB;--accent-fg:#2459C0;--accent-bg:#EBF1FE;
--sev-broken:#D92D20;--sev-broken-fg:#B42318;--sev-broken-bg:#FEE4E2;
--sev-risk:#9B3B9A;--sev-risk-fg:#86338A;--sev-risk-bg:#F7E8F7;
--sev-warning:#B7791F;--sev-warning-fg:#7A5A00;--sev-warning-bg:#FBF0D0;
--sev-info:#5B6B8C;--sev-info-fg:#3F4D6B;--sev-info-bg:#E9EDF5;
--sev-ok:#17805A;--sev-ok-fg:#167A55;--sev-ok-bg:#E1F3EA;
--s1:4px;--s2:8px;--s3:12px;--s4:16px;--s5:24px;--s6:32px;--s7:48px;
--r-sm:4px;--r-md:8px;--radius:var(--r-md);
--shadow-sm:0 1px 2px rgb(16 24 40 / 6%);
--font-sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif;
--font-mono:ui-monospace,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
--muted-bg:var(--well);--bg:var(--card);--warn:var(--sev-warning-fg);--warn-bg:var(--sev-warning-bg);--danger:var(--sev-broken-fg);--ok:var(--sev-ok-fg)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${DARK_TOKENS}}}
:root[data-theme="dark"]{${DARK_TOKENS}}
*{box-sizing:border-box}
html{scroll-padding-top:72px;scrollbar-gutter:stable}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;background:var(--page);color:var(--fg);font:400 14px/1.55 var(--font-sans);-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
a{color:var(--accent-fg);text-decoration:none}
a:hover{text-decoration:underline}
h1,h2,h3,h4,h5,h6{margin:0;line-height:1.3}
h1{font-size:24px;font-weight:700;line-height:1.2;overflow-wrap:anywhere}
h2{font-size:17px;font-weight:600;margin:0 0 var(--s4)}
h3{font-size:14px;font-weight:600}
h4,h5,h6{font-size:12.5px;font-weight:600}
.card-h h4{font-size:14px}
h4.ftitle{font-size:14px;font-weight:400;line-height:1.55}
p{margin:0}
strong{font-weight:600}
code,.mono,.time,pre{font-family:var(--font-mono)}
code{font-size:12.5px;background:var(--well);padding:1px 5px;border-radius:var(--r-sm);overflow-wrap:anywhere}
.muted{color:var(--muted)}.xs,.small{font-size:12.5px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.skip{position:absolute;left:var(--s4);top:-48px;z-index:20;padding:var(--s2) var(--s3);background:var(--card);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--fg)}
.skip:focus{top:var(--s2)}
.wrap{width:100%;max-width:1120px;margin:0 auto;padding:0 var(--s4)}
.n{font:500 12px/1.4 var(--font-mono);background:var(--well);color:var(--muted);padding:0 6px;border-radius:var(--r-sm)}
.ic{flex:none;vertical-align:-3px}
svg[hidden]{display:none}
.plate{fill:var(--card);stroke:var(--border);stroke-width:1}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.js-only{display:none}html.js .js-only{display:inline-flex}html.js .tabs.js-only{display:flex}
.topbar{background:var(--card);border-bottom:1px solid var(--border)}
.topbar .wrap{display:flex;align-items:center;justify-content:space-between;gap:var(--s4);min-height:56px}
.product img,.brand-name{display:block}
.brand-name{font:600 16px var(--font-sans);color:var(--fg)}
.logo{display:inline-flex}
.logo img{display:block;width:auto}
.logo .l-dark{display:none}
@media (prefers-color-scheme:dark){html:not([data-theme="light"]) .logo .l-light{display:none}html:not([data-theme="light"]) .logo .l-dark{display:block}}
html[data-theme="dark"] .logo .l-light{display:none}html[data-theme="dark"] .logo .l-dark{display:block}
.actions{display:flex;align-items:center;gap:var(--s3)}
.byline{display:inline-flex;align-items:center;gap:var(--s2);min-height:24px;font-size:12px;color:var(--muted)}
.btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--card);color:var(--fg);font:500 12.5px var(--font-sans);cursor:pointer}
.btn:hover{background:var(--well)}
.verdict{background:var(--card);border-bottom:1px solid var(--border);padding:var(--s5) 0}
.eyebrow{font:500 11px/1.4 var(--font-mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:var(--s1)}
.verdict-line{display:flex;gap:var(--s3);align-items:flex-start;font-size:20px;line-height:1.3;letter-spacing:-.01em;margin-top:var(--s3);max-width:760px}
.verdict-line strong{font-weight:600}
.verdict .meta{margin-top:var(--s3);font-size:12.5px}
.vmark{margin-top:3px;color:var(--sev-fg)}
.aisum{margin-top:var(--s3);max-width:760px;display:grid;gap:var(--s2)}
.ai-l{font:500 11px/1.4 var(--font-mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-right:4px}
.summary-list{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.summary-list li{display:flex;gap:8px;align-items:baseline}
.also{margin:0;padding-left:18px;display:grid;gap:4px;font-size:13px}
.counts{list-style:none;margin:var(--s5) 0 0;padding:0;display:grid;grid-template-columns:repeat(5,1fr);gap:var(--s2)}
.count a{display:grid;grid-template-columns:auto 1fr;gap:2px var(--s2);align-items:center;padding:10px 12px;border:1px solid var(--border);border-top:3px solid var(--sev);border-radius:var(--r-md);color:var(--fg);background:var(--card)}
.count a:hover{text-decoration:none;background:var(--well)}
.count .ic{color:var(--sev-fg);grid-row:1/3}
.count .k{font-size:12px;color:var(--muted)}
.count .v{font:600 24px/1 var(--font-mono)}
.count.zero a{border-top-color:var(--border);color:var(--muted)}.count.zero .ic{color:var(--muted)}
.sev-broken{--sev:var(--sev-broken);--sev-fg:var(--sev-broken-fg);--sev-bg:var(--sev-broken-bg)}
.sev-risk{--sev:var(--sev-risk);--sev-fg:var(--sev-risk-fg);--sev-bg:var(--sev-risk-bg)}
.sev-warning{--sev:var(--sev-warning);--sev-fg:var(--sev-warning-fg);--sev-bg:var(--sev-warning-bg)}
.sev-info{--sev:var(--sev-info);--sev-fg:var(--sev-info-fg);--sev-bg:var(--sev-info-bg)}
.sev-ok{--sev:var(--sev-ok);--sev-fg:var(--sev-ok-fg);--sev-bg:var(--sev-ok-bg)}
.facts{margin:var(--s5) 0 0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s3) var(--s5);font-size:13px}
.facts div{display:grid;gap:2px;min-width:0}
.facts dt{font-size:12px;color:var(--muted)}
.facts dd{margin:0;overflow-wrap:anywhere}
.plats{display:inline-flex;flex-wrap:wrap;gap:var(--s1) var(--s3)}
.plat{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.plat-fb{display:inline-grid;place-items:center;border-radius:var(--r-sm);background:var(--well);color:var(--muted);font:500 10px var(--font-mono);flex:none}
.plat-fb.s12{width:12px;height:12px;font-size:8px}.plat-fb.s14{width:14px;height:14px;font-size:9px}.plat-fb.s16{width:16px;height:16px}.plat-fb.s20{width:20px;height:20px;font-size:11px}
.tabbar{position:sticky;top:0;z-index:10;background:var(--page);border-bottom:1px solid var(--border)}
html:not(.js) .tabbar{display:none}
.tabs{display:flex;gap:2px;overflow-x:auto;scrollbar-width:none}
.tabs [role=tab]{appearance:none;background:none;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;padding:12px 10px;color:var(--muted);font:500 14px var(--font-sans);white-space:nowrap;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.tabs [role=tab]:hover{color:var(--fg)}
.tabs [role=tab][aria-selected=true]{color:var(--fg);border-bottom-color:var(--accent)}
.panel{padding:var(--s5) 0 var(--s6)}
html.js .panel:not(.active){display:none}
html.js .panel>h2{display:none}
.panel:focus{outline:none}
.stack{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--s4)}
.ov-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--s4);align-items:start}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--r-md);box-shadow:var(--shadow-sm);min-width:0}
.card-h{padding:var(--s4) var(--s4) 0}.card-c{padding:var(--s3) var(--s4) var(--s4)}
.card-h+.tscroll{margin-top:var(--s3)}
.card-d{font-size:12.5px;color:var(--muted);margin-top:2px}
.card-t{font-weight:600}
.badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px 2px 6px;border-radius:var(--r-sm);font:500 12px/16px var(--font-sans);white-space:nowrap;background:var(--well);color:var(--muted)}
.badge[class*=sev-]{background:var(--sev-bg);color:var(--sev-fg)}
.chip{display:inline-flex;align-items:center;gap:8px;padding:3px 10px 3px 3px;border:1px solid var(--border);border-radius:var(--r-sm);color:var(--fg);font-size:12px;background:var(--card)}
.chip.owner{padding:1px 8px;color:var(--muted)}
span.chip:not(.owner){padding-left:10px}
a.chip:hover{border-color:var(--accent);text-decoration:none}
.chip-step{display:inline-grid;place-items:center;min-width:20px;height:20px;border-radius:var(--r-sm);background:var(--accent-bg);color:var(--accent-fg);font:500 12px var(--font-mono)}
.sidx{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:var(--r-sm);background:var(--accent-bg);color:var(--accent-fg);font:500 12px var(--font-mono)}
.ogroup+.ogroup{margin-top:var(--s4)}
.ogroup-h{display:flex;align-items:baseline;flex-wrap:wrap;gap:var(--s2);margin:0 0 var(--s2);font-size:14px}
.ogroup-h .pts{margin-left:auto}
.fixlist{list-style:none;margin:0;padding:0;display:grid;gap:var(--s2)}
.fixlist a,.fixlist .fl-row{display:grid;grid-template-columns:auto 1fr;gap:2px var(--s3);align-items:start;padding:10px 12px;border:1px solid var(--border);border-left:3px solid var(--sev);border-radius:var(--r-sm);color:var(--fg)}
.fixlist a:hover{text-decoration:none;background:var(--well)}
.fl-ic{color:var(--sev-fg);margin-top:2px;grid-row:1/3}
.fl-t{overflow-wrap:anywhere}
.fl-m{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;font-size:12px;color:var(--muted)}
.oklist{list-style:none;margin:0;padding:0;display:grid;gap:var(--s2)}
.oklist li{display:grid;grid-template-columns:auto 1fr;gap:var(--s3);align-items:start;font-size:13px}
.empty{padding:var(--s1) 0;color:var(--muted)}
.score-v{display:flex;align-items:baseline;gap:4px}
.score-v .v{font:600 32px/1 var(--font-mono)}
.deductions{list-style:none;margin:var(--s3) 0 0;padding:0;display:grid;gap:6px;font-size:13px}
.deductions li{display:grid;grid-template-columns:44px 1fr;gap:var(--s2);align-items:baseline}
.deductions .num{color:var(--sev-broken-fg);font-weight:600;text-align:right}
.spark{display:block;max-width:100%;height:auto}
.spark polyline{fill:none;stroke:var(--sev);stroke-width:1.75;stroke-linejoin:round}
.spark circle{fill:var(--sev);stroke:var(--card);stroke-width:1}
.spark circle.hollow{fill:var(--card);stroke:var(--sev);stroke-width:1.5}
.spark-legend{display:flex;flex-wrap:wrap;gap:4px 12px}
.spark-legend i{display:inline-block;width:10px;height:3px;background:var(--sev);margin-right:5px;vertical-align:middle;border-radius:2px}
.changes{list-style:none;margin:var(--s2) 0 0;padding:0;display:grid;gap:6px;font-size:13px}
.changes li{overflow-wrap:anywhere}
.run{margin:0;display:grid;gap:var(--s3) var(--s5);font-size:13px}
.run div{display:grid;grid-template-columns:120px minmax(0,1fr);gap:var(--s3);min-width:0}
.run dt{color:var(--muted)}.run dd{margin:0;overflow-wrap:anywhere}
/* position:relative keeps the hidden screen-reader spans inside the scroll box; without it they sit at their static x and widen the page. */
.tscroll{overflow-x:auto;position:relative}
table.dt{width:100%;border-collapse:collapse;font-size:13px}
table.dt th,table.dt td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:middle;overflow-wrap:anywhere}
table.dt thead th{font-weight:500;color:var(--muted);font-size:12px;background:var(--well);white-space:nowrap}
table.dt th:first-child,table.dt td:first-child{padding-left:var(--s4)}
table.dt tbody tr:last-child td{border-bottom:0}
table.dt .num{text-align:right;font-family:var(--font-mono);white-space:nowrap}
table.dt td.bad{color:var(--sev-broken-fg);font-weight:600}
table.dt td.bad .xs{font-weight:400;white-space:normal}
table.dt td.bad .xs a{display:inline-flex;align-items:center;min-height:24px}
table.dt a{color:var(--fg)}
.cov td.c,.cov th.c,table.dt td.c,table.dt th.c{text-align:center;font-family:var(--font-mono);white-space:nowrap}
.y{color:var(--sev-ok-fg)}.x{color:var(--sev-broken-fg);font-weight:600}.o{color:var(--muted)}
.plat-v{display:inline-flex;align-items:center;gap:4px;margin-right:8px;white-space:nowrap}
.sevbar{display:flex;height:6px;border-radius:3px;overflow:hidden;gap:2px;margin:var(--s1) 0 var(--s2)}
.sevbar span{display:block;background:var(--sev)}
.lead{margin-bottom:var(--s4)}
.flist{list-style:none;margin:0;padding:0;display:grid;gap:var(--s2)}
.finding{background:var(--card);border:1px solid var(--border);border-left:3px solid var(--sev);border-radius:var(--r-md);box-shadow:var(--shadow-sm);scroll-margin-top:72px}
summary{cursor:pointer;list-style:none}summary::-webkit-details-marker{display:none}
.chev{color:var(--muted);transition:transform .15s ease}details[open]>summary>.chev{transform:rotate(90deg)}
.finding>details>summary{display:flex;align-items:center;gap:var(--s3);padding:14px var(--s4)}
.fmark{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:var(--r-sm);background:var(--sev-bg);color:var(--sev-fg);flex:none}
.fhead{flex:1;min-width:0;display:grid;gap:4px}
.ftitle{overflow-wrap:anywhere}
.fmeta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;font-size:12px;color:var(--muted)}
.fbody{padding:0 var(--s4) var(--s4);border-top:1px solid var(--border)}
.note{margin-top:var(--s3);padding:6px 10px;border:1px dashed var(--border);border-radius:var(--r-sm);color:var(--muted)}
.impact{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;margin-top:var(--s3);background:var(--sev-bg);border-radius:var(--r-sm)}
.impact .ic{color:var(--sev-fg);margin-top:3px}
.impact-l{display:block;font-size:12px;color:var(--sev-fg);margin-bottom:2px}
.fcols{display:grid;grid-template-columns:minmax(0,1fr);gap:0 var(--s6)}
.fcol{min-width:0}
.sec-h{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:500;color:var(--muted);margin:var(--s4) 0 var(--s2)}
.sec-h .ic{color:var(--accent-fg)}
.fix-steps{list-style:none;margin:0;padding:0;display:grid;gap:var(--s2);counter-reset:fx}
.fix-steps li{display:grid;grid-template-columns:22px 1fr;gap:10px;counter-increment:fx}
.fix-steps li::before{content:counter(fx);display:inline-grid;place-items:center;width:22px;height:22px;border-radius:var(--r-sm);background:var(--accent-bg);color:var(--accent-fg);font:500 12px var(--font-mono)}
.where{display:flex;flex-wrap:wrap;gap:6px}
.also-fine{margin-top:var(--s2)}
.verify{display:flex;flex-wrap:wrap;gap:6px 14px;margin:0;padding:0;list-style:none;font-size:13px}
.verify a{display:inline-flex;align-items:center;gap:4px;min-height:24px}
.ptable{width:100%;border-collapse:collapse;font:12.5px/1.5 var(--font-mono);border:1px solid var(--border);border-radius:var(--r-sm)}
.ptable th,.ptable td{text-align:left;vertical-align:top;padding:5px 8px;border-bottom:1px solid var(--border)}
.ptable th{color:var(--muted);font-weight:400;white-space:nowrap;width:1%;min-width:120px;background:var(--well)}
.glossary th{min-width:170px}
.ptable td{overflow-wrap:anywhere}
.ptable tr:last-child>*{border-bottom:0}
.gtm-why{margin-top:4px}
.missing{display:inline-block;padding:0 6px;border-radius:var(--r-sm);background:var(--sev-broken-bg);color:var(--sev-broken-fg);font-weight:500}
.jtabs{display:inline-flex;flex-wrap:wrap;gap:2px;padding:3px;background:var(--well);border-radius:var(--r-md);margin:var(--s4) 0}
html:not(.js) .jtabs{display:none}
.jtabs [role=tab]{appearance:none;border:0;background:none;display:inline-flex;align-items:center;gap:8px;padding:5px 10px;border-radius:var(--r-sm);color:var(--muted);font:500 13px var(--font-sans);cursor:pointer}
.jtabs [role=tab]:hover{color:var(--fg)}
.jtabs [role=tab][aria-selected=true]{background:var(--card);color:var(--fg);box-shadow:var(--shadow-sm)}
.jpanel{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--s4);scroll-margin-top:72px}
html:not(.js) .jpanel{margin-top:var(--s5)}
html.js .jpanel:not(.active){display:none}
.jhead{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--s3);flex-wrap:wrap}
.jhead h3{font-size:16px}
.jbadges{display:flex;gap:6px;flex-wrap:wrap}
.ctl{list-style:none;margin:var(--s2) 0 0;padding:0;display:grid;gap:var(--s2)}
.ctl>li{border:1px solid var(--border);border-radius:var(--r-sm);padding:10px 12px;background:var(--page)}
.ctl .ch{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;font-size:13px;margin-bottom:6px}
.ctl .ch b{font-weight:600}
.sigs{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:6px}
.sig{display:flex;justify-content:space-between;gap:8px;align-items:center;border:1px solid var(--border);border-radius:var(--r-sm);padding:4px 10px;font:12px var(--font-mono);background:var(--card)}
.sig .granted{color:var(--sev-ok-fg)}.sig .denied{color:var(--sev-warning-fg)}
.consent-card .muted.xs{margin-top:var(--s2)}
table.steps{width:100%;border-collapse:collapse;font-size:13px}
table.steps th,table.steps td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top}
table.steps thead th{font-weight:500;color:var(--muted);font-size:12px;background:var(--well);white-space:nowrap}
table.steps tbody th{padding-left:var(--s3)}
table.steps tbody tr:last-child>*{border-bottom:0}
table.steps tr.flagged>th{box-shadow:inset 3px 0 0 var(--sev)}
table.steps .slabel{min-width:180px;overflow-wrap:anywhere}
.smeta{display:block;margin-top:2px}
table.steps .time{font-size:12px;color:var(--muted);white-space:nowrap}
table.steps .num{text-align:right;font-family:var(--font-mono)}
table.steps .hits{width:100%}
.hits-wrap{display:flex;flex-wrap:wrap;gap:4px}
table.steps tr.has-d>*{border-bottom:0}
table.steps .drow td{padding:0 var(--s3) var(--s2) 42px}
table.steps .drow:last-child td{border-bottom:0}
.drow>td>details>summary{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--muted);padding:4px 0;min-height:24px}
.drow>td>details>summary:hover{color:var(--fg)}
.hit{display:inline-flex;align-items:center;gap:4px;padding:2px 6px 2px 4px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--card)}
.hit code{background:none;padding:0;font-size:12px}
.hit.flag{border-color:var(--sev);background:var(--sev-bg)}
.hit.flag .ic:last-of-type{color:var(--sev-fg)}
.sdetail h5{font-size:12px;font-weight:500;color:var(--muted);margin:var(--s3) 0 6px}
.netblock{margin-top:var(--s3)}
.netblock>summary{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:500;color:var(--muted);padding:4px 0;min-height:24px}
.netblock>summary:hover{color:var(--fg)}
.netblock>.evlist{margin-top:6px}
.evlist{list-style:none;margin:0;padding:0;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--card)}
.evlist>li+li{border-top:1px solid var(--border)}
.event>details>summary{display:flex;align-items:center;gap:10px;padding:7px 10px;flex-wrap:wrap}
.event>details>summary:hover{background:var(--well)}
.event>details>summary .chev{margin-left:auto}
.event .meta{font-size:12px;color:var(--muted)}
.event .time{font-size:12px;color:var(--muted)}
.ev{font:12px var(--font-mono);background:none;padding:0;overflow-wrap:anywhere}
.event-body{padding:4px 10px 12px 36px}
.flagnote{margin:4px 0 10px;padding:6px 10px;border-radius:var(--r-sm);background:var(--sev-bg);color:var(--sev-fg);font-size:13px}
.flagnote a{color:inherit;text-decoration:underline}
.consents{margin:0 0 var(--s2)}
.consent{font-size:12px;padding:1px 6px;border-radius:var(--r-sm);font-family:var(--font-mono);white-space:nowrap}
.consent.granted{background:var(--sev-ok-bg);color:var(--sev-ok-fg)}.consent.denied{background:var(--sev-warning-bg);color:var(--sev-warning-fg)}
.ebgrid{display:grid;gap:var(--s3);margin-top:var(--s2)}
.ebgrid>*{min-width:0}
.ebgrid aside{background:var(--well);border-radius:var(--r-sm);padding:8px 12px;align-self:start}
.ebgrid aside h6{margin:0 0 6px}
h6{margin:var(--s3) 0 6px;font-size:12px;font-weight:500;color:var(--muted)}
.srclist{list-style:none;margin:0;padding:0;display:grid;gap:6px;font-size:12px}
.srclist li{display:grid;gap:1px;overflow-wrap:anywhere}.srclist .lbl{color:var(--muted)}
.method{font:500 12px var(--font-mono);padding:0 5px;border-radius:var(--r-sm);background:var(--accent-bg);color:var(--accent-fg)}
.status{color:var(--sev-ok-fg);font-family:var(--font-mono);font-size:12px}
.item{border:1px solid var(--border);border-radius:var(--r-sm);padding:10px 12px;margin-bottom:8px}
.item-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 10px;margin-bottom:8px}
.item-head b{font-weight:500}
.item-idx{font:12px var(--font-mono);color:var(--muted)}
.item-price{margin-left:auto;font-size:12px}
.grid4{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 16px;margin:0}
.grid4 dt{font:12px var(--font-mono);color:var(--muted);overflow-wrap:anywhere}.grid4 dd{margin:0;font:12px var(--font-mono);overflow-wrap:anywhere}
.pk{margin-right:4px}
.q{position:relative;display:inline-grid;place-items:center;width:15px;height:15px;border:1px solid var(--muted);border-radius:50%;font:500 10px var(--font-sans);color:var(--muted);cursor:help;vertical-align:1px}
.q:hover{border-color:var(--accent);color:var(--accent-fg)}
.q:hover::after{content:attr(data-tip);position:absolute;left:0;top:calc(100% + 6px);z-index:5;width:260px;padding:8px 10px;background:var(--fg);color:var(--page);font:400 12px/1.45 var(--font-sans);border-radius:var(--r-sm);white-space:normal;text-align:left}
tr.pr td{color:var(--muted)}
details.raw{margin-top:10px}details.raw>summary{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);min-height:24px}
pre{margin:8px 0 0;font-size:12px;line-height:1.5;background:var(--well);border-radius:var(--r-sm);padding:10px 12px;white-space:pre-wrap;overflow-wrap:anywhere}
.scope-note{margin-top:10px}
main{flex:1 0 auto;width:100%}
.footer{border-top:1px solid var(--border);background:var(--card);margin-top:var(--s6)}
.footer .wrap{display:grid;gap:var(--s4);padding:var(--s6) var(--s4)}
.footer p{font-size:12.5px;color:var(--muted)}
.footer a{color:var(--fg)}
.f-links{display:flex;flex-wrap:wrap;gap:8px 20px;font-size:12px;margin-top:6px}
.f-meta{font:12px var(--font-mono);color:var(--muted)}
.logo-link{display:inline-flex}
.f-atd{display:inline-flex;align-items:center;gap:6px;vertical-align:-3px}.f-atd img{height:16px;width:auto}
.title{margin-top:20px;display:grid;gap:4px}.title .meta{font-size:12px;color:var(--muted)}.product-logo{display:inline-flex}.card-c.tight{padding:8px}.ptag{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}
@media (min-width:768px){
.wrap{padding:0 var(--s5)}
.card-h{padding:var(--s4) var(--s5) 0}.card-c{padding:var(--s3) var(--s5) var(--s4)}
table.dt th:first-child,table.dt td:first-child{padding-left:var(--s5)}
.facts{grid-template-columns:repeat(3,minmax(0,1fr))}
.ov-grid{grid-template-columns:minmax(0,3fr) minmax(0,2fr)}
.fcols{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
.ebgrid{grid-template-columns:minmax(0,3fr) minmax(0,2fr)}
.grid4{grid-template-columns:repeat(4,minmax(0,1fr))}
.footer .wrap{grid-template-columns:auto 1fr auto;align-items:center;padding:var(--s6) var(--s5)}
.footer .wrap.plain{grid-template-columns:1fr auto}
.verdict{padding:var(--s6) 0}
}
@media (max-width:480px){.logo-atd img{height:22px}.byline span{display:none}.logo-h img{height:14px}.topbar .wrap{gap:var(--s2)}}
@media (max-width:640px){
.counts{grid-template-columns:repeat(3,1fr)}
.count a{padding:8px 10px}
.count .v{font-size:20px}
.run div{grid-template-columns:1fr}
table.steps thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
table.steps tr{display:grid;grid-template-columns:auto 1fr auto;grid-template-areas:"idx label time" "hits hits hits";gap:4px 8px;padding:8px var(--s3);border-bottom:1px solid var(--border)}
table.steps tr>*{border-bottom:0!important;padding:0!important}
table.steps tr.flagged{box-shadow:inset 3px 0 0 var(--sev)}
table.steps tr.flagged>th{box-shadow:none}
table.steps tbody th{grid-area:idx}table.steps .slabel{grid-area:label;min-width:0}table.steps .time{grid-area:time}table.steps .hits{grid-area:hits}
table.steps .num{display:none}
table.steps .drow{display:block;padding:0 var(--s3) var(--s2) 42px}
table.steps .drow td{display:block}
.event-body{padding-left:10px}
.finding>details>summary{flex-wrap:wrap;align-items:flex-start}
.finding>details>summary .badge{margin-left:44px}
.finding>details>summary .chev{display:none}
.finding>details>summary .fhead{flex-basis:calc(100% - 44px)}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
@media print{
:root{--page:#fff;--card:#fff;--well:#f2f2f2;--shadow-sm:none}
body{font-size:12.5px;background:#fff}
.topbar .actions,.tabbar,.jtabs,.btn,.skip,.print-skip{display:none!important}
.panel,.jpanel{display:block!important}
.panel>h2{display:block!important}
.jpanel+.jpanel{margin-top:var(--s5)}
.panel{break-before:page;padding:0}
#overview{break-before:auto}
h2,h3{break-after:avoid}
.finding,.ptable,table.steps tr,table.dt tr,.ctl>li,.count a,.fixlist a,.oklist li,.event,.card{break-inside:avoid}
.tabbar,.finding,.jpanel{position:static}
.finding>details>*,.drow[class*=sev-]>td>details>*,.event[class*=flag-]>details>*{display:block}
.chev,.q{display:none}
.badge,.chip,.missing,.consent{background:none!important;border:1px solid currentColor}
.impact,.flagnote,.hit.flag{background:none!important;border:1px solid currentColor}
.fmark{background:none;border:1px solid currentColor}
table.dt thead th,table.steps thead th,.ptable th,.ebgrid aside{background:#f2f2f2;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sevbar span,.count a,.finding,.fixlist a,table.steps tr.flagged>th,.spark{-webkit-print-color-adjust:exact;print-color-adjust:exact}
a{color:inherit}
.verdict{padding:0 0 var(--s4);border:0}
.footer{margin-top:var(--s5)}
}
`;

/** A logo with its light and dark versions as two images; the CSS shows the one that fits the colour scheme or the forced theme. */
export const logo = (key, alt, height, cls) => `<span class="logo ${cls}"><img class="l-light" src="${LOGOS[`${key}-light`]}" alt="${alt}" height="${height}"><img class="l-dark" src="${LOGOS[`${key}-dark`]}" alt="${alt}" height="${height}"></span>`;

/** The journey and step a finding's place points at. Steps are named by label; when labels repeat, prefer the step where the finding's event fired. */
function whereTarget(runs, w, f) {
  const ri = runs.findIndex((r) => r.journeyId === w.journey && r.viewport === w.viewport);
  if (ri < 0) return null;
  const candidates = w.step ? runs[ri].steps.filter((s) => s.index > 0 && s.label === w.step) : [];
  const step = candidates.find((s) => runs[ri].hits.some((h) => h.step === s.index && h.platform === f.platform && h.name === f.event)) ?? candidates[0];
  return { ri, step };
}

const pathOf = (url) => {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return String(url ?? "");
  }
};

/** The same problem's identity across the grouped rows, the metrics and the history: severity, check, platform and event. */
const problemKey = (f) => [f.severity, f.check, f.platform ?? "", f.event ?? ""].join("|");
/** The grouped finding's full identity, as groupFindings keys it, so a metrics entry finds its card. */
const rowKey = (f) => `${problemKey(f)}|${f.detail ?? ""}`;

/** Stable card ids (f-<platform>-<event>-<check>, with a counter when two cards would share one) for the problem rows. */
function cardIds(rows) {
  const taken = new Map();
  const ids = new Map();
  for (const f of rows) {
    if (f.severity === "ok") continue;
    const base = ["f", safeKey(f.platform ?? "site"), f.event ? safeKey(f.event) : "", safeKey(f.check)].filter(Boolean).join("-");
    const n = (taken.get(base) ?? 0) + 1;
    taken.set(base, n);
    ids.set(f, n === 1 ? base : `${base}-${n}`);
  }
  return ids;
}

/** Runs where the finding's event fired but the finding did not: the "desktop sent both" contrast. */
function alsoFineOn(runs, f) {
  if (!f.event || !f.platform) return [];
  const flagged = new Set(f.where.map((w) => `${w.journey}|${w.viewport}`));
  return runs.filter((r) => !flagged.has(`${r.journeyId}|${r.viewport}`) && r.hits.some((h) => h.platform === f.platform && h.name === f.event));
}

/** The plan's required parameters the finding's event lacks, as evidence rows marked "missing". */
function missingParamRows(plan, f, evidence) {
  if (f.check !== "missing_params" || !f.event) return [];
  const ev = (plan?.events ?? []).find((e) => String(e.platform ?? "").toLowerCase() === f.platform && hitMatchesEvent({ ...e, platform: f.platform }, { platform: f.platform, name: f.event }));
  return (ev?.required_params ?? []).filter((p) => !(p in evidence));
}

/** The captured hit a finding points at, for evidence when the finding carries none. */
function hitFor(runs, f) {
  for (const w of f.where) {
    const t = whereTarget(runs, w, f);
    if (!t?.step) continue;
    const hit = runs[t.ri].hits.find((h) => h.step === t.step.index && h.platform === f.platform && h.name === f.event);
    if (hit) return { run: runs[t.ri], hit };
  }
  return null;
}

const missingCell = (m) => `<span class="missing">${m.ui.missing}</span>`;

/** Evidence table: the finding's captured parameters (plus the plan's missing ones), the hit it points at, or the missing request. */
function evidenceHtml(m, runs, plan, f) {
  let captured = null;
  if (f.evidence) {
    try {
      const v = JSON.parse(f.evidence);
      if (v && typeof v === "object" && !Array.isArray(v)) captured = Object.entries(v).map(([k, x]) => [k, escapeHtml(cell(x))]);
    } catch { /* plain text */ }
    if (!captured) return `<pre>${escapeHtml(f.evidence)}</pre>`;
  }
  const rows = captured ?? [];
  if (!captured) {
    const found = hitFor(runs, f);
    if (found) {
      rows.push(...Object.entries(found.hit.params ?? {}).map(([k, v]) => [k, escapeHtml(cell(v))]));
      rows.push([m.ui.request, `<span class="mono">${escapeHtml(hostPath(found.hit.url))}</span> · ${escapeHtml(seconds(found.run, found.hit.t))}`]);
      if (found.hit.consent) rows.push([m.ui.consent, Object.entries(found.hit.consent).map(([k, v]) => consentChip(k, v)).join(" ")]);
    } else if (f.check === "missing_event" && f.platform) rows.push([m.ui.requestTo(platformLabel(f.platform)), missingCell(m)]);
  }
  for (const p of missingParamRows(plan, f, Object.fromEntries(rows))) rows.push([p, missingCell(m)]);
  if (!rows.length) return "";
  return `<table class="ptable" aria-label="${m.ui.evidence}"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${escapeHtml(k)}</th><td>${v}</td></tr>`).join("")}</tbody></table>`;
}

/** The tags in the GTM container export that send this finding's event, with their triggers. */
function gtmHtml(m, tags) {
  if (!tags) return "";
  if (!tags.length) return `${sec("gtm", m.ui.gtmTags)}<p class="muted">${m.ui.gtmNoTag}</p>`;
  const trig = (t) => `${escapeHtml(t.name)}${t.event ? ` <span class="muted">(${escapeHtml(t.event)})</span>` : ""}`;
  const rows = tags.map((t) => {
    const notes = [t.paused ? m.ui.gtmPaused : "", t.consent.length ? m.ui.gtmConsent(t.consent.join(", ")) : ""].filter(Boolean);
    const why = t.evaluation ? `<div class="xs gtm-why">${escapeHtml(m.ui.gtmWhy(t.name, m.ui.gtmVerdict[t.evaluation.fired], t.evaluation.why))}</div>` : "";
    return `<tr><th scope="row">${escapeHtml(t.name)}${notes.length ? `<div class="muted xs">${escapeHtml(notes.join(" · "))}</div>` : ""}</th><td>${t.triggers.length ? `${m.ui.gtmFiresOn} ${t.triggers.map(trig).join(", ")}` : `<span class="missing">${m.ui.gtmNoTrigger}</span>`}${t.blocking.length ? `<div class="muted xs">${m.ui.gtmBlockedBy} ${t.blocking.map(trig).join(", ")}</div>` : ""}${why}</td></tr>`;
  });
  return `${sec("gtm", m.ui.gtmTags)}<table class="ptable gtm-tags" aria-label="${m.ui.gtmTags}"><tbody>${rows.join("")}</tbody></table>`;
}

const externalLink = (m, url, name) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(name)}${use("ui-external", 12)}<span class="sr"> (${m.html.newTab})</span></a>`;

function verifyHtml(m, f) {
  const links = verifyLinks(f);
  if (!links.length) return "";
  return `${sec("verify", m.ui.verify)}<ul class="verify">${links.map((l) => `<li>${externalLink(m, l.url, l.name)}</li>`).join("")}</ul>`;
}

/** The check's own consequence or fix text from i18n, when a language has it; a function gets the finding. */
const checkText = (block, f) => {
  const v = block?.[f.check];
  return typeof v === "function" ? v(f) : typeof v === "string" ? v : "";
};

const placeText = (w) => `${w.journey} · ${w.viewport}`;

/** Where a problem was seen, in short: every run, the one or two places, or a count. */
function spreadText(m, runs, f) {
  const places = [...new Set(f.where.map((w) => `${w.journey}|${w.viewport}`))];
  if (runs.length > 1 && places.length === runs.length) return m.html.allRuns(runs.length);
  if (places.length <= 2) return m.html.onlyOn(places.map((p) => p.replace("|", " · ")));
  return m.ui.spread(places.length, f.where.filter((w) => w.step).length);
}

function whereChips(m, runs, f) {
  const chips = f.where.map((w) => {
    const t = whereTarget(runs, w, f);
    const page = t?.step?.pagePath ? pathOf(t.step.pagePath) : null;
    const inner = `${t?.step ? `<span class="chip-step">${t.step.index}</span>` : ""}<span>${escapeHtml(placeText(w))}${w.step ? ` <span class="muted">· ${escapeHtml(w.step)}</span>` : ""} <span class="muted">· ${page ? `<code>${escapeHtml(page)}</code>` : m.html.pageUnknown}</span></span>`;
    return t ? `<a href="#${t.step ? stepAnchor(t.ri, t.step.index) : `j${t.ri}`}" class="chip">${inner}</a>` : `<span class="chip">${inner}</span>`;
  });
  const fine = alsoFineOn(runs, f);
  const also = fine.length ? `<p class="xs muted also-fine">${m.html.alsoFineOn} ${fine.map((r) => `<a href="#j${runs.indexOf(r)}">${escapeHtml(`${r.journeyId} · ${r.viewport}`)}</a>`).join(", ")}.</p>` : "";
  return `<div class="where">${chips.join("")}</div>${also}`;
}

function findingCard(m, runs, plan, f, id, open) {
  const e = f.explanation;
  const steps = fixSteps(e);
  const impact = e?.impact ? fmt(e.impact) : escapeHtml(checkText(m.consequence, f));
  const cause = e?.likely_cause ? `<p>${fmt(e.likely_cause)}</p>` : f.severity === "info" ? "" : `<p class="muted">${m.html.noModel}</p>`;
  const fixText = checkText(m.fix, f);
  const fix = steps.length ? `<ol class="fix-steps">${steps.map((t) => `<li><span>${fmt(t)}</span></li>`).join("")}</ol>` : fixText ? `<p>${escapeHtml(fixText)}</p>` : "";
  const evidence = evidenceHtml(m, runs, plan, f);
  const accepted = f.accepted === true ? `<p class="note xs"><span class="badge">${use("sev-ok", 14)}${m.html.accepted}</span> ${m.html.acceptedNote}</p>` : "";
  return `<li class="finding sev-${f.severity}" id="${id}" data-sev="${f.severity}"><details${open ? " open" : ""}><summary>
<span class="fmark">${use(`sev-${f.severity}`, 18)}</span>
<span class="fhead"><h4 class="ftitle">${detailHtml(f.detail)}</h4><span class="fmeta">${f.platform ? plat(f.platform, 16) : ""}${f.event ? `<code>${escapeHtml(f.event)}</code>` : ""}<span class="chip owner">${m.ui.owners[ownerOf(f)]}</span><span>${escapeHtml(spreadText(m, runs, f))}</span>${f.accepted === true ? `<span class="badge">${m.html.accepted}</span>` : ""}</span></span>
${badge(f.severity, m.severity[f.severity])}${use("ui-chevron", 16, "chev")}</summary>
<div class="fbody">${accepted}${impact ? `<div class="impact">${use("ui-impact", 16)}<div><span class="impact-l">${m.ui.impact}</span>${impact}</div></div>` : ""}
<div class="fcols"><div class="fcol">${cause ? `${sec("cause", m.ui.likelyCause)}${cause}` : ""}${evidence ? `${sec("evidence", m.ui.evidence)}${evidence}` : ""}${gtmHtml(m, f.gtm)}</div>
<div class="fcol">${fix ? `${sec("fix", m.ui.fixSteps)}${fix}` : ""}${sec("where", m.ui.where)}${whereChips(m, runs, f)}${verifyHtml(m, f)}</div></div></div></details></li>`;
}

const FINDING_SEVERITIES = ["broken", "risk", "warning", "info"];

/** OK findings as one line per distinct result, with how many runs saw it. */
function okLines(m, runs, rows) {
  const seen = new Map();
  for (const f of rows.filter((r) => r.severity === "ok")) {
    const k = f.detail;
    if (!seen.has(k)) seen.set(k, { detail: f.detail, places: new Set() });
    for (const w of f.where) seen.get(k).places.add(`${w.journey}|${w.viewport}`);
  }
  return [...seen.values()].map((o) => `<li>${badge("ok", m.severity.ok)}<span>${detailHtml(o.detail)} <span class="muted">· ${escapeHtml(o.places.size === runs.length && runs.length > 1 ? m.html.allRuns(runs.length) : [...o.places].map((p) => p.replace("|", " · ")).join(", "))}</span></span></li>`);
}

function findingsPanel(m, runs, plan, rows, ids, counts) {
  const problems = rows.filter((f) => f.severity !== "ok");
  const okCount = rows.length - problems.length;
  if (!problems.length) {
    const ok = okLines(m, runs, rows);
    return `<div class="card"><div class="card-h"><h3>${m.html.whatWasChecked}</h3><p class="card-d">${m.ui.noProblems}</p></div><div class="card-c">${ok.length ? `<ul class="oklist">${ok.join("")}</ul>` : `<p class="muted">${m.html.nothingVerified}</p>`}</div></div>`;
  }
  const present = FINDING_SEVERITIES.filter((s) => counts[s]);
  const bar = `<div class="sevbar" role="img" aria-label="${escapeHtml(present.map((s) => `${counts[s]} ${m.severity[s]}`).join(", "))}">${present.map((s) => `<span class="sev-${s}" style="flex:${counts[s]}"></span>`).join("")}</div>`;
  const groups = OWNERS.map((o) => {
    const mine = FINDING_SEVERITIES.flatMap((s) => problems.filter((f) => f.severity === s && ownerOf(f) === o));
    if (!mine.length) return "";
    // The first card of each owner group is open, so each owner lands on their worst problem with its evidence showing.
    const cards = mine.map((f, i) => findingCard(m, runs, plan, f, ids.get(f), i === 0 && f.severity !== "info")).join("");
    return `<section class="ogroup" data-owner="${o}"><h3 class="ogroup-h"><span>${m.ui.owners[o]}</span><span class="n">${mine.length}</span><span class="muted xs">${m.ui.ownerHint[o]}</span></h3><ul class="flist">${cards}</ul></section>`;
  }).join("");
  return `${bar}<p class="muted xs lead">${m.html.findingsLead}${okCount ? ` ${escapeHtml(m.html.okInOverview(okCount))}` : ""}</p>${groups}`;
}

/** The glyph of a metrics verdict. */
const verdictGlyph = (v) => ({ fail_broken: "broken", fail_incomplete: "warning", attention_risk: "risk", attention_warning: "warning", attention_no_hits: "info", attention_nothing_tested: "info", pass: "ok" })[v.headline] ?? "info";
/** The owner split starts a sentence here, so it gets a capital; the locale keeps Turkish "i" as "İ". */
const sentence = (s, lang) => (s ? s[0].toLocaleUpperCase(lang) + s.slice(1) : s);

/** "2 for the developer, 2 for Tag Manager." from the priorities, or nothing. */
const ownerSplit = (m, priorities) => (priorities.length ? m.html.ownerSplit(priorities.map((p) => m.html.forOwner[p.owner](p.total))) : "");

function aiSummary(m, explained) {
  const s = summaryParts(explained?.summary);
  if (!s) return "";
  const head = s.text ? fmt(s.text) : fmt(s.headline);
  return `<div class="aisum"><p><span class="ai-l">${m.html.aiSummary}</span> ${head}</p>${s.points?.length ? `<ul class="summary-list">${s.points.map((p) => `<li>${badge(p.severity, m.severity[p.severity])}<span>${fmt(p.text)}</span></li>`).join("")}</ul>` : ""}${s.also_check?.length ? `<p class="xs muted">${m.ui.alsoCheck}</p><ul class="also">${s.also_check.map((t) => `<li>${fmt(t)}</li>`).join("")}</ul>` : ""}</div>`;
}

/** The providers that were checked: from the runs, or for older captures the platforms seen. */
function checkedProviders(runs) {
  const chosen = new Set(runs.flatMap((r) => r.providers ?? []));
  if (!chosen.size) for (const r of runs) for (const h of r.hits) chosen.add(h.platform);
  return sortPlatforms(chosen);
}

function skippedTotals(runs) {
  const totals = {};
  for (const r of runs) for (const counts of Object.values(r.skipped ?? {})) for (const [v, n] of Object.entries(counts)) totals[v] = (totals[v] ?? 0) + n;
  return skippedText(totals);
}

const callProvider = (c) => safeKey(c.provider ?? providerOf(c.url)?.key ?? c.vendor);
const uniqList = (xs) => [...new Set(xs)];

/** The run facts: journeys, platforms, plan, consent, campaign check and the tool itself. */
function runFacts(m, runs, metrics, { ai, plan, lang, against, planChanges, consentScenarios }) {
  const provs = checkedProviders(runs);
  const completed = runs.filter((r) => r.completed).length;
  const journeys = runs.length ? `${escapeHtml(uniqList(runs.map((r) => r.journeyId)).join(", "))} · ${escapeHtml(uniqList(runs.map((r) => r.viewport)).join(", "))} · <span class="muted">${escapeHtml(completed === runs.length ? m.html.runsAllCompleted(runs.length) : m.html.runsCompleted(completed, runs.length))}</span>` : "–";
  const planBits = [plan?.events?.length ? m.ui.runPlanEvents(plan.events.length) : m.ui.runNoPlan, plan?.consent_mode ? m.html.consentModeOn : "", against ? m.ui.checkedAgainst(against) : "", planChanges ? m.ui.planChangesLine(planChanges) : ""].filter(Boolean);
  const states = consentScenarios ? ["before", ...Object.keys(consentScenarios.states ?? {}).filter((s) => consentScenarios.states[s]?.after)] : [];
  const consent = consentScenarios ? `${escapeHtml(consentScenarios.cmp === "banner" ? m.html.cmpBanner : String(consentScenarios.cmp ?? ""))} · <span class="muted">${escapeHtml(m.html.scenariosRun(states.length))}</span>` : metrics.consent.consentMode.defaultPresent ? m.html.consentModeSeen : "–";
  const campaign = runs.some((r) => r.landing) ? m.html.campaignChecked : "–";
  const facts = [
    [m.ui.runJourneys, journeys],
    [m.html.platformsChecked, provs.length ? `<span class="plats">${provs.map((k) => plat(k, 16)).join("")}</span>` : "–"],
    [m.ui.runPlan, escapeHtml(planBits.join(" · "))],
    [m.ui.consent, consent],
    [m.html.campaignCheck, escapeHtml(campaign)],
    [m.ui.runAi, `${escapeHtml(ai ? m.ui.runAiOn(ai.name, ai.model) : m.ui.runAiOff)} · <span class="muted">ai-tag-debugger ${escapeHtml(VERSION)}, ${escapeHtml(messages(lang).name)}</span>`],
  ];
  return `<dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
}

function verdictBlock(m, { site, title, generatedAt, findings, runs, lang, metrics, explained, counts, accepted, runInfo, changes }) {
  const v = metrics.verdict;
  const sev = verdictGlyph(v);
  // The same status word and headline as the CLI, the alerts and the Markdown title ("Fail: purchase tracking is broken on
  // mobile."); the count-and-owner sentence follows, except on a pass, where it would only repeat the headline.
  const head = verdictHeadline({ findings, runs, metrics, lang });
  const headline = [`${head.headline}.`, v.headline === "pass" ? "" : m.verdict.headline[v.headline]?.(v) ?? "", sentence(ownerSplit(m, metrics.priorities), lang)].filter(Boolean).join(" ");
  const tiles = ["broken", "risk", "warning", "info", "ok"].map((s) => `<li class="count sev-${s}${counts[s] ? "" : " zero"}"><a href="#findings">${use(`sev-${s}`, 16)}<span class="k">${m.severity[s]}</span><span class="v">${counts[s]}</span></a></li>`).join("");
  return `<section class="verdict" id="verdict" aria-labelledby="site"><div class="wrap">
<p class="eyebrow">${m.html.eyebrow} · ${escapeHtml(generatedAt)}</p>
<h1 id="site">${escapeHtml(site ?? title)}</h1>
<p class="verdict-line">${use(`sev-${sev}`, 22, `vmark sev-${sev}`)}<span><strong>${escapeHtml(head.statusText)}:</strong> ${escapeHtml(headline)}</span></p>
${accepted ? `<p class="meta accepted-line">${escapeHtml(m.ui.acceptedLine(accepted))}</p>\n` : ""}${aiSummary(m, explained)}
<ul class="counts" aria-label="${m.html.countsLabel}">${tiles}</ul>
${runFacts(m, runs, metrics, runInfo)}${changes?.routes?.length ? `\n<p class="meta"><a href="#changes">${escapeHtml(m.ui.routeChanged(routeList(changes)))}</a></p>` : ""}
</div></section>`;
}

/** The problem lines of one owner on the overview, each linking to its card. */
function fixFirst(m, runs, rows, ids, metrics) {
  const byKey = new Map(rows.map((f) => [rowKey(f), f]));
  const groups = OWNERS.map((o) => {
    const p = metrics.priorities.find((x) => x.owner === o);
    const head = `<h4 class="ogroup-h"><span>${m.ui.owners[o]}</span><span class="n">${p?.total ?? 0}</span><span class="muted xs">${m.ui.ownerHint[o]}</span>${p?.points ? `<span class="muted xs pts">${escapeHtml(m.html.pointsToRecover(p.points))}</span>` : ""}</h4>`;
    if (!p) return `<section class="ogroup">${head}<p class="muted xs empty">${escapeHtml(m.html.nothingFor(m.ui.owners[o]))}</p></section>`;
    const items = p.top.map((d) => {
      const f = byKey.get(rowKey(d)) ?? d;
      const id = ids.get(f);
      const inner = `${use(`sev-${f.severity}`, 16, "fl-ic")}<span class="fl-t">${detailHtml(f.detail)}</span><span class="fl-m">${f.platform ? plat(f.platform, 14) : ""}${f.event ? `<code>${escapeHtml(f.event)}</code>` : ""}<span>${escapeHtml(spreadText(m, runs, f))}</span></span>`;
      return `<li class="sev-${f.severity}">${id ? `<a href="#${id}">${inner}</a>` : `<span class="fl-row">${inner}</span>`}</li>`;
    });
    const more = p.total > p.top.length ? `<p class="xs"><a href="#findings">${escapeHtml(m.html.moreInFindings(p.total - p.top.length))}</a></p>` : "";
    return `<section class="ogroup">${head}<ol class="fixlist">${items.join("")}</ol>${more}</section>`;
  });
  return `<div class="card"><div class="card-h"><h3>${m.html.fixFirst}</h3><p class="card-d">${m.html.fixFirstLead}</p></div><div class="card-c">${groups.join("")}</div></div>`;
}

function workingCard(m, runs, rows, metrics) {
  const lines = okLines(m, runs, rows);
  const c = metrics.coverage;
  if (c) lines.unshift(`<li>${badge("ok", m.severity.ok)}<span>${escapeHtml(m.html.coverageVerified(c.counts.implemented, c.checkable, c.percent.implemented))} <a href="#scope">${m.ui.planCoverage}</a></span></li>`);
  if (!lines.length) return "";
  return `<div class="card"><div class="card-h"><h3>${m.html.working}</h3></div><div class="card-c"><ul class="oklist">${lines.join("")}</ul></div></div>`;
}

/** Problem cards that point at this run. */
const problemsIn = (rows, run) => rows.filter((f) => f.severity in SEVERITY_RANK && f.where.some((w) => w.journey === run.journeyId && w.viewport === run.viewport)).length;

function journeysTable(m, runs, rows) {
  if (!runs.length) return "";
  const body = runs.map((r, ri) => {
    const n = problemsIn(rows, r);
    return `<tr><td><a href="#j${ri}">${escapeHtml(r.journeyId)}</a></td><td>${escapeHtml(r.viewport)}</td><td class="num">${r.steps.filter((s) => s.index > 0).length}</td><td class="num">${r.hits.length}</td><td class="num${n ? " bad" : ""}">${n ? `${use("sev-broken", 12)} ${n}` : "0"}</td></tr>`;
  }).join("");
  return `<div class="card"><div class="card-h"><h3>${m.ui.tabJourneys}</h3><p class="card-d">${m.html.journeysLead}</p></div><div class="tscroll"><table class="dt"><caption class="sr">${m.ui.tabJourneys}</caption><thead><tr><th scope="col">${m.ui.journey}</th><th scope="col">${m.html.viewport}</th><th scope="col" class="num">${m.ui.stepsCol}</th><th scope="col" class="num">${m.html.hitsCol}</th><th scope="col" class="num">${m.ui.problemsCol}</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
}

const SPARK_SERIES = ["broken", "risk", "warning"];

/** Three count lines over the saved runs, evenly spaced by run; incomplete runs are hollow points. */
function sparklineSvg(m, t) {
  const s = t.series;
  const W = 280, H = 64, P = 6;
  const max = Math.max(3, ...s.flatMap((p) => SPARK_SERIES.map((k) => p[k])));
  const x = (i) => P + (i * (W - 2 * P)) / (s.length - 1);
  const y = (v) => H - P - (v * (H - 2 * P)) / max;
  const lines = SPARK_SERIES.map((k) => `<polyline class="sev-${k}" points="${s.map((p, i) => `${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(" ")}"/>`).join("");
  const points = s.flatMap((p, i) => SPARK_SERIES.map((k) => `<circle class="sev-${k}${p.complete ? "" : " hollow"}" cx="${x(i).toFixed(1)}" cy="${y(p[k]).toFixed(1)}" r="${i === s.length - 1 ? 3.5 : 2.5}"><title>${escapeHtml(`${p.date ?? p.id} · ${p[k]} ${m.severity[k]}${p.complete ? "" : ` · ${m.html.runIncomplete}`}`)}</title></circle>`)).join("");
  const label = SPARK_SERIES.map((k) => `${m.severity[k]}: ${s.map((p) => p[k]).join(", ")}`).join("; ");
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeHtml(label)}">${lines}${points}</svg>`;
}

const changeLabel = (c) => `${platformLabel(c.platform ?? "")} ${c.event ?? ""}`.trim() || c.check;
const changeItems = (m, ch) => [
  ...ch.fixed.map((c) => ({ sev: "ok", tag: m.ui.changeFixed, text: `${changeLabel(c)} (${ch.mode === "findings" ? c.detail : m.ui.bucket[c.was]})` })),
  ...ch.new.map((c) => ({ sev: "broken", tag: m.ui.changeNew, text: `${changeLabel(c)} (${ch.mode === "findings" ? c.detail : m.ui.bucket[c.bucket]})` })),
];
const routeLines = (ch) => (ch?.routes ?? []).map((r) => `<li>${escapeHtml(`${r.journeyId} (${r.viewport}): ${r.before.join(" → ")} ⇒ ${r.after.join(" → ")}`)}</li>`).join("");

/** "Changed since last run" when there is no history: the headline, what was fixed and what is new. */
function changesCard(m, ch) {
  const head = `<div class="card-h"><h3>${m.ui.changesTitle}</h3>${ch.previous ? `<p class="card-d">${escapeHtml(m.ui.changesLead(ch.previous, ch.mode))}</p>` : ""}</div>`;
  if (!ch.previous) return `<div class="card" id="changes">${head}<div class="card-c"><p class="muted">${m.ui.noPreviousRun}</p></div></div>`;
  const items = changeItems(m, ch);
  return `<div class="card" id="changes">${head}<div class="card-c"><p><strong>${escapeHtml(m.ui.changesLine(ch))}</strong></p>${items.length ? `<ul class="changes">${items.map((i) => `<li>${badge(i.sev, i.tag)} ${escapeHtml(i.text)}</li>`).join("")}</ul>` : ""}${ch.routes?.length ? `<ul class="changes">${routeLines(ch)}</ul>` : ""}</div></div>`;
}

/** One problem from the history as a line: the current card's title when it is still open, else platform, event and check. */
function historyLine(m, rows, ids, e) {
  const f = rows.find((r) => problemKey(r) === problemKey(e));
  const text = f ? detailHtml(f.detail) : `${e.platform ? `${escapeHtml(platformLabel(e.platform))} ` : ""}${e.event ? `<code>${escapeHtml(e.event)}</code> ` : ""}${escapeHtml(e.check)}`;
  return f && ids.get(f) ? `<a href="#${ids.get(f)}">${text}</a>` : text;
}

const dateOnly = (id) => String(id ?? "").slice(0, 10);

/** The trend over the saved runs: a sparkline, the diff with the last run, flapping problems and the ones open longest. */
function trendCard(m, t, rows, ids, changes) {
  const direction = `<p><strong>${escapeHtml(m.html.trendDirection[t.direction] ?? t.direction)}</strong> <span class="muted">${escapeHtml(m.html.trendSpan(t.runs, dateOnly(t.first), dateOnly(t.last)))}</span></p>`;
  const diff = changes?.previous ? `<div id="changes"><p class="xs"><strong>${escapeHtml(m.ui.changesLine(changes))}</strong> <span class="muted">${escapeHtml(m.ui.changesLead(changes.previous, changes.mode))}</span></p>${changeItems(m, changes).length ? `<ul class="changes">${changeItems(m, changes).map((i) => `<li>${badge(i.sev, i.tag)} ${escapeHtml(i.text)}</li>`).join("")}</ul>` : ""}${changes.routes?.length ? `<ul class="changes">${routeLines(changes)}</ul>` : ""}</div>` : "";
  const flapping = t.flapping.length ? `<h4 class="sec-h">${m.html.flapping}</h4><ul class="changes">${t.flapping.map((e) => `<li>${badge(e.severity, m.severity[e.severity])} ${historyLine(m, rows, ids, e)} <span class="muted">· ${escapeHtml(m.html.seenIn(e.seenIn, t.runs))}</span></li>`).join("")}</ul>` : "";
  const open = t.openLongest.length ? `<h4 class="sec-h">${m.html.openLongest}</h4><ul class="changes">${t.openLongest.map((e) => `<li>${badge(e.severity, m.severity[e.severity])} ${historyLine(m, rows, ids, e)} <span class="muted">· ${escapeHtml(m.html.openSince(dateOnly(e.openSince), e.runsOpen, e.places.length))}</span></li>`).join("")}</ul>` : "";
  const legend = `<p class="xs muted spark-legend">${SPARK_SERIES.map((k) => `<span class="sev-${k}"><i></i>${m.severity[k]}</span>`).join(" ")}</p>`;
  return `<div class="card" id="trend"><div class="card-h"><h3>${m.html.trend}</h3><p class="card-d">${escapeHtml(m.html.trendLead)}</p></div><div class="card-c stack">${sparklineSvg(m, t)}${legend}${direction}${diff}${flapping}${open}</div></div>`;
}

function scoreCard(m, metrics, rows, ids) {
  const s = metrics.score;
  if (s.score === null) return "";
  const byKey = new Map(rows.map((f) => [problemKey(f), f]));
  const items = s.deductions.slice(0, 5).map((d) => {
    const f = byKey.get(problemKey(d));
    const text = f ? detailHtml(f.detail) : `${escapeHtml(platformLabel(d.platform ?? ""))} <code>${escapeHtml(d.event ?? "")}</code> ${escapeHtml(d.check)}`;
    return `<li><span class="num mono">−${d.points}</span><span>${f && ids.get(f) ? `<a href="#${ids.get(f)}">${text}</a>` : text} <span class="muted">· ${m.severity[d.severity]} · ${m.ui.owners[d.owner]}</span></span></li>`;
  });
  return `<div class="card" id="score"><div class="card-h"><h3>${m.html.score}</h3><p class="card-d">${escapeHtml(m.html.scoreLead)}</p></div><div class="card-c"><p class="score-v"><span class="v">${s.score}</span><span class="muted">/100</span>${s.lost ? ` <span class="muted xs">${escapeHtml(m.html.scoreLost(s.lost))}</span>` : ""}</p>${items.length ? `<ul class="deductions">${items.join("")}</ul>` : ""}</div></div>`;
}

function overviewPanel(m, runs, rows, ids, metrics, trend, changes) {
  const right = [trend && trend.series.length >= 2 ? trendCard(m, trend, rows, ids, changes) : changes ? changesCard(m, changes) : "", scoreCard(m, metrics, rows, ids)].filter(Boolean).join("");
  return `<div class="ov-grid"><div class="stack">${fixFirst(m, runs, rows, ids, metrics)}${workingCard(m, runs, rows, metrics)}${journeysTable(m, runs, rows)}</div><div class="stack">${right}</div></div>`;
}

/* ---------- journeys ---------- */

const consentChip = (k, v) => `<span class="consent ${v === "granted" ? "granted" : "denied"}">${escapeHtml(k)} ${escapeHtml(v)}</span>`;

/** The journey's Consent Mode: a timing sentence, the first default and the first update, and how often they were re-sent. */
function consentCard(m, run, info) {
  const cmds = (run.dataLayerLog ?? []).filter((e) => isConsentEntry(e.value) && (e.value[1] === "default" || e.value[1] === "update"));
  const head = `<div class="card-h"><h4>${m.html.consentMode}</h4></div>`;
  if (!cmds.length) return `<div class="card consent-card">${head}<div class="card-c"><p class="muted">${m.ui.consentNone}</p></div></div>`;
  const firstDefault = cmds.find((e) => e.value[1] === "default");
  const firstUpdate = cmds.find((e) => e.value[1] === "update" && (!firstDefault || e.t >= firstDefault.t));
  const tile = (e) => {
    const step = run.steps.find((s) => s.index === e.step);
    const sigs = Object.entries(e.value[2] ?? {}).filter(([, v]) => typeof v === "string");
    return `<li><div class="ch"><b>${e.value[1] === "default" ? m.ui.consentDefault : m.ui.consentUpdate}</b><span class="muted xs">${step ? `${m.ui.step} ${step.index} · ${escapeHtml(step.label)} · ` : ""}${escapeHtml(seconds(run, e.t))}</span></div><div class="sigs">${sigs.map(([k, v]) => `<span class="sig"><span>${escapeHtml(k)}</span><span class="${v === "granted" ? "granted" : "denied"}">${escapeHtml(v)}</span></span>`).join("")}</div></li>`;
  };
  const timing = !info ? "" : info.present ? m.html.consentTiming(info.ms, info.beforeFirstGoogleHit, info.v2Signals.present, info.v2Signals.missing) : m.html.consentNoDefault;
  const resent = cmds.filter((e) => e !== firstDefault && e !== firstUpdate).length;
  return `<div class="card consent-card">${head}<div class="card-c">${timing ? `<p class="xs">${escapeHtml(timing)}</p>` : ""}<ol class="ctl">${[firstDefault, firstUpdate].filter(Boolean).map(tile).join("")}</ol>${resent ? `<p class="muted xs">${escapeHtml(m.html.consentResent(resent))}</p>` : ""}</div></div>`;
}

/** The reason a scenario cell counts as it does: cookieless pings, ad storage denied, or hits with cookies. */
function scenarioReason(m, scenarios, platform, event, state) {
  const after = state === "before" ? scenarios.before : scenarios.states?.[state]?.after;
  const c = after?.[platform]?.[event];
  if (!c || !c.n) return "";
  if (c.cookieless >= c.n) return m.html.cellCookieless;
  if (c.adDenied >= c.n) return m.html.cellAdDenied;
  return m.html.cellWithCookies;
}

/** Consent scenarios: one row per tag, one column per consent choice, hit counts with a reason per cell. */
function scenariosCard(m, scenarios, rows, ids) {
  if (!scenarios) return "";
  const { cols, rows: tagRows } = consentTable(scenarios);
  const findingFor = (platform, event) => rows.find((f) => f.platform === platform && f.event === event && /^(after_reject|before_consent)$/.test(f.check));
  const head = `<tr><th scope="col">${m.ui.scenarioTag}</th>${cols.map((c) => `<th scope="col" class="num">${m.ui.scenarioCols[c]}</th>`).join("")}</tr>`;
  const body = tagRows.map((r) => `<tr><td>${plat(r.platform, 16)} <code>${escapeHtml(r.event)}</code></td>${r.cells.map((c) => {
    if (c.count === null) return `<td class="num muted">–</td>`;
    const reason = scenarioReason(m, scenarios, r.platform, r.event, c.state);
    if (!c.problem) return `<td class="num">${c.count}${reason ? ` <span class="muted xs">${escapeHtml(reason)}</span>` : ""}</td>`;
    const f = findingFor(r.platform, r.event);
    return `<td class="num bad">${use("sev-broken", 12)} ${c.count}<span class="sr"> ${m.html.cellProblem}</span> <span class="xs">${escapeHtml(m.html.cellShouldNot)}${f && ids.get(f) ? ` <a href="#${ids.get(f)}">${m.html.findingLink}</a>` : ""}</span></td>`;
  }).join("")}</tr>`).join("");
  const notRun = cols.filter((c) => c !== "before" && !scenarios.states?.[c]?.via).map((c) => m.ui.scenarioCols[c]);
  return `<div class="card scenarios"><div class="card-h"><h3>${m.ui.scenarios}</h3><p class="card-d">${escapeHtml(m.html.scenariosLead(scenarios.cmp === "banner" ? m.html.cmpBanner : scenarios.cmp))}${notRun.length ? ` ${escapeHtml(m.ui.scenarioNotRun)}: ${escapeHtml(notRun.join(", "))}.` : ""}</p></div><div class="tscroll"><table class="dt"><caption class="sr">${m.ui.scenarios}</caption><thead>${head}</thead><tbody>${body}</tbody></table></div><div class="card-c"><p class="muted xs">${escapeHtml(m.html.scenariosLegend)}</p></div></div>`;
}

const funnelStatus = (m, r) => (r.status === "ok" ? `<span class="y">${use("sev-ok", 12)} ${m.severity.ok}</span>` : r.status === "missing_params" ? `<span class="x">${use("sev-broken", 12)} ${escapeHtml(m.html.params(r.missingParams))}</span>` : `<span class="x">${use("sev-broken", 12)} ${m.html.notSent}</span>`);

/** Expected versus observed for one run, in plan order. */
function funnelCard(m, fu) {
  if (!fu?.events?.length) return "";
  const rows = fu.events.map((r) => `<tr><td>${plat(r.platform, 16)} <code>${escapeHtml(r.event)}</code>${r.conversion ? ` <span class="badge">${m.html.conversion}</span>` : ""}</td><td>${funnelStatus(m, r)}</td><td class="num">${r.count}</td><td>${r.step !== null ? `${m.ui.step} ${r.step}${r.stepLabel ? ` · ${escapeHtml(r.stepLabel)}` : ""}` : "–"}</td><td class="xs">${r.page ? `<code>${escapeHtml(pathOf(r.page))}</code>` : "–"}</td></tr>`).join("");
  return `<div class="card"><div class="card-h"><h4>${m.html.funnel}</h4><p class="card-d">${escapeHtml(m.html.funnelLead(fu.observed, fu.expected, fu.ok))}${fu.firstMissing ? ` ${escapeHtml(m.html.funnelBreaks(fu.firstMissing))}` : ""}</p></div><div class="tscroll"><table class="dt"><caption class="sr">${m.html.funnel}</caption><thead><tr><th scope="col">${m.ui.event}</th><th scope="col">${m.ui.status}</th><th scope="col" class="num">${m.html.sent}</th><th scope="col">${m.html.firstAt}</th><th scope="col">${m.html.page}</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

/** The same event on two platforms for one run, with what differs, and the events only one platform sent. */
function parityCard(m, pa) {
  if (!pa || (!pa.shared.length && !pa.onlyOn.length)) return "";
  const money = (p) => (p.value !== null ? ` · ${p.value}${p.currency ? ` ${escapeHtml(p.currency)}` : ""}` : "");
  const rows = pa.shared.map((s) => `<tr><td><code>${escapeHtml(s.event)}</code></td><td>${Object.entries(s.platforms).map(([k, p]) => `<span class="plat-v">${plat(k, 14)} <span class="mono">${p.count}×${money(p)}</span></span>`).join(" ")}</td><td>${s.mismatch.length ? `<span class="x">${use("sev-warning", 12)} ${escapeHtml(s.mismatch.map((x) => m.html.mismatch[x] ?? x).join(", "))}</span>` : `<span class="y">${use("sev-ok", 12)} ${m.html.agree}</span>`}</td></tr>`).join("");
  const only = pa.onlyOn.length ? `<p class="muted xs">${escapeHtml(m.html.onlyOnPlatform)} ${sortPlatforms(new Set(pa.onlyOn.map((o) => o.platform))).map((k) => `${plat(k, 14)}: ${pa.onlyOn.filter((o) => o.platform === k).map((o) => `<code>${escapeHtml(o.name)}</code>`).join(", ")}`).join(" · ")}</p>` : "";
  return `<div class="card print-skip"><div class="card-h"><h4>${m.html.parity}</h4><p class="card-d">${escapeHtml(m.html.parityLead)}</p></div>${rows ? `<div class="tscroll"><table class="dt"><caption class="sr">${m.html.parity}</caption><thead><tr><th scope="col">${m.ui.event}</th><th scope="col">${m.html.perPlatform}</th><th scope="col">${m.html.difference}</th></tr></thead><tbody>${rows}</tbody></table></div>` : ""}${only ? `<div class="card-c">${only}</div>` : ""}</div>`;
}

/** The chips of the hits a step sent: platform icon, event name and the worst finding's glyph. */
function hitChip(m, findings, run, step, hit) {
  const flag = hitFlag(findings, run, step, hit);
  return `<span class="hit${flag ? ` flag sev-${flag.severity}` : ""}">${platIcon(hit.platform, 14)}<code>${escapeHtml(hit.name)}</code>${flag ? `${use(`sev-${flag.severity}`, 12)}<span class="sr"> ${m.severity[flag.severity]}</span>` : ""}</span>`;
}

function stepRow(m, lang, findings, run, ri, step, ids, flagged) {
  const hits = run.hits.filter((h) => h.step === step.index).sort((a, b) => a.t - b.t);
  const pushes = (run.dataLayerLog ?? []).filter((e) => e.step === step.index).sort((a, b) => a.t - b.t);
  const reqRows = requestRows(m, lang, run, step);
  const skipped = skippedText(run.skipped?.[step.index]);
  const skippedN = skipped.reduce((a, [, n]) => a + n, 0);
  const id = stepAnchor(ri, step.index);
  const worst = [...hits.map((h) => hitFlag(findings, run, step, h)?.severity), flagged.get(id)].filter(Boolean).sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b])[0] ?? null;
  const meta = [step.pagePath ? `<code>${escapeHtml(pathOf(step.pagePath))}</code>` : "", step.action ? escapeHtml(step.action) : "", step.forced ? escapeHtml(m.ui.clickedThrough) : ""].filter(Boolean).join(" · ");
  const hasDetail = hits.length || pushes.length || reqRows.length;
  const row = `<tr id="${id}" class="srow${worst ? ` flagged sev-${worst}` : ""}${hasDetail ? " has-d" : ""}"><th scope="row"><span class="sidx">${step.index}</span></th><td class="slabel">${escapeHtml(step.label)}${worst ? `<span class="sr"> (${escapeHtml(m.html.hasFinding(m.severity[worst]))})</span>` : ""}${meta ? `<span class="smeta xs muted">${meta}</span>` : ""}</td><td class="time">${escapeHtml(seconds(run, step.t))}</td><td class="hits">${hits.length ? `<div class="hits-wrap">${hits.map((h) => hitChip(m, findings, run, step, h)).join("")}</div>` : `<span class="muted xs">${m.ui.noHits}</span>`}</td><td class="num">${pushes.length}</td></tr>`;
  if (!hasDetail) return row;
  const hitList = hits.length ? `<h5>${m.html.hitsInStep} <span class="n">${hits.length}</span></h5><ul class="evlist">${hits.map((h) => eventRow(m, findings, run, step, h, ids)).join("")}</ul>` : "";
  const pushList = pushes.length ? `<h5>dataLayer <span class="n">${pushes.length}</span></h5><ul class="evlist">${pushes.map((e) => pushRow(m, run, e)).join("")}</ul>` : "";
  const net = reqRows.length || skippedN ? `<details class="netblock"><summary>${use("ui-chevron", 14, "chev")}<span>${m.ui.tabNetwork} <span class="n">${reqRows.length}</span></span></summary>${reqRows.length ? `<ul class="evlist">${reqRows.map((r) => r.html).join("")}</ul>` : ""}${skippedN ? `<p class="muted xs scope-note">${escapeHtml(m.ui.skippedInStep(skipped.map(([v, n]) => `${v} ${n}`).join(", "), skippedN))}</p>` : ""}</details>` : "";
  return `${row}<tr class="drow${worst ? ` sev-${worst}` : ""}"><td colspan="5"><details${worst ? " open" : ""}><summary>${use("ui-chevron", 14, "chev")}<span>${escapeHtml(m.html.stepDetails(hits.length, pushes.length))}</span></summary><div class="sdetail">${hitList}${pushList}${net}</div></details></td></tr>`;
}

/** The worst severity of the problem cards pointing at each step of the run, by step anchor. */
function flaggedSteps(rows, runs, run, ri) {
  const out = new Map();
  for (const f of rows) {
    if (!(f.severity in SEVERITY_RANK)) continue;
    for (const w of f.where) {
      if (w.journey !== run.journeyId || w.viewport !== run.viewport) continue;
      const t = whereTarget(runs, w, f);
      if (!t?.step) continue;
      const id = stepAnchor(ri, t.step.index);
      if (!out.has(id) || SEVERITY_RANK[f.severity] < SEVERITY_RANK[out.get(id)]) out.set(id, f.severity);
    }
  }
  return out;
}

function journeyPanel(m, lang, findings, rows, runs, run, ri, ids, metrics) {
  const steps = run.steps.filter((s) => s.index > 0);
  const flagged = flaggedSteps(rows, runs, run, ri);
  const n = problemsIn(rows, run);
  const badges = `${run.completed ? badge("ok", m.ui.completed) : badge("warning", m.ui.notCompleted)}${n ? badge(rows.filter((f) => f.severity in SEVERITY_RANK && f.where.some((w) => w.journey === run.journeyId && w.viewport === run.viewport)).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])[0].severity, m.html.problems(n)) : ""}`;
  const table = steps.length
    ? `<div class="card"><div class="card-h"><h4>${m.html.stepsTitle}</h4><p class="card-d">${m.html.stepsLead}</p></div><div class="tscroll"><table class="steps"><caption class="sr">${m.html.stepsTitle}</caption><thead><tr><th scope="col">#</th><th scope="col">${m.html.stepCol}</th><th scope="col">${m.html.timeCol}</th><th scope="col">${m.html.hitsCol}</th><th scope="col" class="num">dataLayer</th></tr></thead><tbody>${steps.map((s) => stepRow(m, lang, findings, run, ri, s, ids, flagged)).join("")}</tbody></table></div></div>`
    : `<p class="empty">${m.ui.noSteps}</p>`;
  return `<article class="jpanel" id="j${ri}" role="tabpanel" aria-labelledby="jtab-${ri}">
<header class="jhead"><div><h3>${escapeHtml(run.journeyId)} <span class="muted">· ${escapeHtml(run.viewport)}</span></h3>${run.note ? `<p class="muted xs">${escapeHtml(run.note)}</p>` : ""}</div><div class="jbadges">${badges}</div></header>
${consentCard(m, run, metrics.consent.consentMode.runs[ri])}${table}${funnelCard(m, metrics.funnel[ri])}${parityCard(m, metrics.parity[ri])}</article>`;
}

function journeysPanel(m, lang, findings, rows, runs, ids, metrics, scenarios) {
  const sc = scenariosCard(m, scenarios, rows, ids);
  if (!runs.length) return `${sc}<p class="empty">${m.ui.noSteps}</p>`;
  const tabs = runs.map((r, ri) => `<button type="button" role="tab" id="jtab-${ri}" aria-controls="j${ri}" aria-selected="${ri === 0 ? "true" : "false"}"${ri === 0 ? "" : ' tabindex="-1"'}>${escapeHtml(r.journeyId)} <span class="muted">· ${escapeHtml(r.viewport)}</span><span class="n">${problemsIn(rows, r)}</span></button>`).join("");
  return `${sc}<div class="jtabs js-only" role="tablist" aria-label="${m.ui.chooseJourney}">${tabs}</div>\n${runs.map((r, ri) => journeyPanel(m, lang, findings, rows, runs, r, ri, ids, metrics)).join("\n")}`;
}

/* ---------- scope and plan ---------- */

const BUCKET_SEV = { implemented: "ok", missing: "broken", missing_params: "broken", wrong_values: "warning", unplanned: "info", not_checked: "muted" };
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


function planVsSiteMd(m, pc) {
  const [overall, ...perPlatform] = coverageLines(m, pc);
  const lines = [`## ${m.ui.planVsSite}`, "", `**${mdText(overall)}**`, "", ...perPlatform.map((l) => `- ${mdText(l)}`), ...(perPlatform.length ? [""] : [])];
  lines.push(`| ${m.ui.event} | ${m.ui.bucketCol} | |`, "|---|---|---|");
  for (const e of pcSort(pc)) lines.push(`| ${mdText(platformLabel(e.platform))} \`${mdCode(e.event)}\` | ${m.ui.bucket[e.bucket]} | ${mdText((e.details ?? []).join(" ")).replace(/\|/g, "\\|")} |`);
  lines.push("");
  return lines;
}

function planVsSiteCard(m, pc) {
  const [overall, ...perPlatform] = coverageLines(m, pc);
  const rows = pcSort(pc).map((e) => `<tr><td>${plat(e.platform, 16)} <code>${escapeHtml(e.event)}</code></td><td>${badge(BUCKET_SEV[e.bucket], m.ui.bucket[e.bucket])}</td><td class="muted xs">${(e.details ?? []).map(detailHtml).join("<br>")}</td></tr>`).join("");
  return `<div class="card" id="plan-vs-site"><div class="card-h"><h3>${m.ui.planVsSite}</h3><p class="card-d">${m.ui.planVsSiteLead}</p></div><div class="card-c"><p><strong>${escapeHtml(overall)}</strong></p>${perPlatform.length ? `<p class="muted xs">${perPlatform.map(escapeHtml).join("<br>")}</p>` : ""}</div><div class="tscroll"><table class="dt"><caption class="sr">${m.ui.planVsSite}</caption><thead><tr><th scope="col">${m.ui.event}</th><th scope="col">${m.ui.bucketCol}</th><th scope="col">${m.html.detailsCol}</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

/** Each planned event × each journey: sent with its parameters, sent without them, not sent, or not expected there. */
function coverageCard(m, plan, runs, metrics) {
  const head = (lead) => `<div class="card-h"><h3>${m.ui.planCoverage}</h3><p class="card-d">${lead}</p></div>`;
  if (!plan?.events?.length || !runs.length) return `<div class="card">${head(m.ui.planCoverageLead)}<div class="card-c"><p class="muted">${m.ui.noPlan}</p></div></div>`;
  const events = plan.events.map((e) => ({ ...e, platform: String(e.platform ?? "").toLowerCase() }));
  const checks = (r, e) => !r.providers?.length || r.providers.includes(e.platform);
  const body = events.map((e) => {
    const cells = runs.map((r, ri) => {
      const row = metrics.funnel[ri]?.events.find((x) => x.platform === e.platform && x.event === e.name);
      if (!row || !checks(r, e)) return `<td class="c o">–<span class="sr"> ${m.html.notExpected}</span></td>`;
      if (row.status === "ok") return `<td class="c y">✓<span class="sr"> ${m.html.sent}</span></td>`;
      if (row.status === "missing_params") return `<td class="c x">${use("sev-broken", 12)} ${m.html.paramsShort}<span class="sr"> ${escapeHtml(m.html.params(row.missingParams))}</span></td>`;
      return `<td class="c x">✗<span class="sr"> ${m.html.notSent}</span></td>`;
    });
    const unchecked = !runs.some((r) => checks(r, e));
    const needs = e.required_params?.length ? `<span class="muted xs"> · ${escapeHtml(m.html.needs(e.required_params))}</span>` : "";
    return `<tr><td>${plat(e.platform, 16)} <code>${escapeHtml(e.name)}</code>${needs}${unchecked ? ` ${badge("muted", m.ui.notChecked)}` : ""}</td>${cells.join("")}</tr>`;
  }).join("");
  const c = metrics.coverage;
  const lead = c ? escapeHtml(m.ui.coverageLine({ implemented: c.counts.implemented, checkable: c.checkable, percent: c.percent.implemented, not_checked: c.counts.not_checked })) : m.ui.planCoverageLead;
  return `<div class="card" id="coverage">${head(lead)}<div class="tscroll"><table class="dt cov"><caption class="sr">${m.ui.planCoverage}</caption><thead><tr><th scope="col">${m.ui.event}</th>${runs.map((r) => `<th scope="col" class="c">${escapeHtml(r.journeyId)}<br><span class="muted xs">${escapeHtml(r.viewport)}</span></th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div><div class="card-c"><p class="muted xs">${escapeHtml(m.html.coverageLegend)}</p></div></div>`;
}

const CONVERSION_CHECKS = ["value", "currency", "transactionId", "items", "duplicate", "parity", "eventId"];

/** One row per purchase seen, with each integrity check as a pass, fail or not-applicable cell. */
function conversionsCard(m, metrics) {
  const c = metrics.conversions;
  if (!c.rows.length) return "";
  const cellOf = (v) => (v === "pass" ? `<td class="c y">✓<span class="sr"> ${m.html.pass}</span></td>` : v === "fail" ? `<td class="c x">${use("sev-broken", 12)}<span class="sr"> ${m.html.fail}</span></td>` : `<td class="c o">–<span class="sr"> ${m.html.notApplicable}</span></td>`);
  const rows = c.rows.map((r) => `<tr><td>${escapeHtml(`${r.journey} · ${r.viewport}`)}</td><td>${plat(r.platform, 16)} <code>${escapeHtml(r.event)}</code></td><td class="mono xs">${r.transactionId ? escapeHtml(r.transactionId) : "–"}</td><td class="num">${r.value !== null ? `${escapeHtml(String(r.value))}${r.currency ? ` ${escapeHtml(r.currency)}` : ""}` : missingCell(m)}</td><td class="num">${r.items ?? "–"}</td>${CONVERSION_CHECKS.map((k) => cellOf(r.checks[k])).join("")}</tr>`).join("");
  return `<div class="card" id="conversions"><div class="card-h"><h3>${m.html.conversions}</h3><p class="card-d">${escapeHtml(m.html.conversionsLead(c.passed, c.total))}</p></div><div class="tscroll"><table class="dt"><caption class="sr">${m.html.conversions}</caption><thead><tr><th scope="col">${m.ui.journey}</th><th scope="col">${m.ui.event}</th><th scope="col">${m.html.orderId}</th><th scope="col" class="num">${m.html.value}</th><th scope="col" class="num">${m.ui.items}</th>${CONVERSION_CHECKS.map((k) => `<th scope="col" class="c">${m.html.conversionChecks[k]}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

const PAGES_SHOWN = 5;

function inventoryCard(m, runs) {
  const inv = buildInventory(runs);
  const head = `<div class="card-h"><h3>${m.ui.inventoryTitle}</h3><p class="card-d">${m.ui.inventoryLead}</p></div>`;
  if (!inv.vendors.length) return `<div class="card" id="inventory">${head}<div class="card-c"><p class="muted">${m.ui.noInventory}</p></div></div>`;
  const names = (xs) => xs.map((x) => `<code>${escapeHtml(x)}</code>`).join(" ");
  const pages = (v) => `${names(v.pages.slice(0, PAGES_SHOWN))}${v.pages.length > PAGES_SHOWN ? ` <span class="muted">${m.ui.morePages(v.pages.length - PAGES_SHOWN)}</span>` : ""}`;
  const rows = inv.vendors.map((v) => `<tr><td>${escapeHtml(v.vendor)}</td><td>${escapeHtml(m.ui.party[v.party])}</td><td class="num">${v.pages.length}</td><td class="xs">${pages(v)}</td><td class="xs">${v.cookies.length ? names(v.cookies) : '<span class="muted">–</span>'}</td></tr>`).join("");
  const other = inv.otherCookies.length ? `<div class="card-c"><p class="muted xs">${m.ui.otherCookies}: ${inv.otherCookies.map((c) => `${escapeHtml(c.name)} (${escapeHtml(m.ui.party[c.party])})`).join(", ")}</p></div>` : "";
  return `<div class="card" id="inventory">${head}<div class="tscroll"><table class="dt"><caption class="sr">${m.ui.inventoryTitle}</caption><thead><tr><th scope="col">${m.ui.vendorCol}</th><th scope="col">${m.ui.partyCol}</th><th scope="col" class="num">${m.ui.pagesCol}</th><th scope="col">${m.html.seenOn}</th><th scope="col">${m.ui.cookiesCol}</th></tr></thead><tbody>${rows}</tbody></table></div>${other}</div>`;
}

/** Platforms checked (seen or never seen) and vendors out of scope, with their request counts. */
function providersCard(m, runs) {
  const provs = checkedProviders(runs);
  const skipped = skippedTotals(runs);
  if (!provs.length && !skipped.length) return "";
  const calls = runs.flatMap((r) => r.network ?? []);
  const seen = new Set(runs.flatMap((r) => r.hits.map((h) => h.platform)));
  const rows = [
    ...provs.map((k) => {
      const n = calls.filter((c) => callProvider(c) === k).length;
      return [plat(k, 16), seen.has(k) || n ? badge("ok", m.ui.checked) : badge("info", m.html.checkedNotSeen), `${n}`];
    }),
    ...skipped.map(([v, n]) => [escapeHtml(v), badge("muted", m.ui.outOfScopeStatus), `${n}`]),
  ];
  const notSeen = provs.filter((k) => !seen.has(k));
  return `<div class="card" id="platforms"><div class="card-h"><h3>${m.ui.providers}</h3>${notSeen.length ? `<p class="card-d">${escapeHtml(m.html.neverSeen(notSeen.map(platformLabel).join(", ")))}</p>` : ""}</div><div class="tscroll"><table class="dt"><caption class="sr">${m.ui.providers}</caption><thead><tr><th scope="col">${m.ui.platform}</th><th scope="col">${m.ui.status}</th><th scope="col" class="num">${m.ui.requestsCol}</th></tr></thead><tbody>${rows.map(([n, s, c]) => `<tr><td>${n}</td><td>${s}</td><td class="num">${c}</td></tr>`).join("")}</tbody></table></div></div>`;
}

const ms = (v) => (v === null || v === undefined ? "–" : `${Math.round(v)} ms`);

/** How long each run took and how far behind each step its first hit came. */
function timingCard(m, metrics) {
  const t = metrics.timing.filter((r) => r.durationMs !== null);
  if (!t.length) return "";
  const rows = t.map((r) => `<tr><td>${escapeHtml(`${r.journey} · ${r.viewport}`)}</td><td class="num">${(r.durationMs / 1000).toFixed(1)} s</td><td class="num">${ms(r.medianFirstHitMs)}</td><td class="xs">${r.slowest[0] ? `${plat(r.slowest[0].platform, 14)} <code>${escapeHtml(r.slowest[0].event)}</code> · ${m.ui.step} ${r.slowest[0].step} · ${ms(r.slowest[0].ms)}` : "–"}</td></tr>`).join("");
  return `<div class="card print-skip" id="timing"><div class="card-h"><h3>${m.html.timing}</h3><p class="card-d">${escapeHtml(m.html.timingLead)}</p></div><div class="tscroll"><table class="dt"><caption class="sr">${m.html.timing}</caption><thead><tr><th scope="col">${m.ui.journey}</th><th scope="col" class="num">${m.html.duration}</th><th scope="col" class="num">${m.html.medianFirstHit}</th><th scope="col">${m.html.slowestHit}</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

/** The run's settings, for the reader who doubts a result. */
function runCard(m, runs, { ai, plan, lang, against, planChanges }) {
  const skipped = skippedTotals(runs);
  const skippedN = skipped.reduce((a, [, x]) => a + x, 0);
  const rows = [
    [m.ui.runPlatforms, checkedProviders(runs).map((k) => plat(k, 16)).join(" ") || '<span class="muted">–</span>'],
    [m.ui.runAi, escapeHtml(ai ? m.ui.runAiOn(ai.name, ai.model) : m.ui.runAiOff)],
    [m.ui.runPlan, escapeHtml(plan?.events?.length ? m.ui.runPlanEvents(plan.events.length) : m.ui.runNoPlan)],
    ...(against ? [[m.ui.planVsSite, escapeHtml(m.ui.checkedAgainst(against))]] : []),
    ...(planChanges ? [[m.html.planChanges, `${escapeHtml(m.ui.planChangesLine(planChanges))}${planChangeItems(planChanges).length ? `<ul class="changes xs">${planChangeItems(planChanges).map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>` : ""}`]] : []),
    [m.ui.runJourneys, escapeHtml(uniqList(runs.map((r) => r.journeyId)).join(", ") || "–")],
    [m.ui.runViewports, escapeHtml(uniqList(runs.map((r) => r.viewport)).join(", ") || "–")],
    ...(skippedN ? [[m.ui.outOfScopeStatus, escapeHtml(m.ui.skippedLine(skipped.map(([v]) => v).join(", "), skippedN))]] : []),
    [m.ui.runLanguage, escapeHtml(messages(lang).name)],
    [m.ui.runVersion, `<code>${escapeHtml(VERSION)}</code>`],
  ];
  return `<div class="card" id="run"><div class="card-h"><h3>${m.ui.runCard}</h3></div><div class="card-c"><dl class="run">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl></div></div>`;
}

function scopePanel(m, runs, plan, metrics, planCheckResult, runInfo) {
  return `<div class="stack">${planCheckResult ? planVsSiteCard(m, planCheckResult) : ""}${coverageCard(m, plan, runs, metrics)}${conversionsCard(m, metrics)}${inventoryCard(m, runs)}${providersCard(m, runs)}${timingCard(m, metrics)}${runCard(m, runs, runInfo)}</div>`;
}

/* ---------- page ---------- */

/** The inline script: tablists with arrow keys, hash deep links that open what holds the target, and the theme toggle. Fixed text, so its hash is fixed. */
export const SCRIPT = `(function () {
  var html = document.documentElement;
  html.classList.add("js");
  function tablist(list) {
    var tabs = Array.prototype.slice.call(list.querySelectorAll("[role=tab]"));
    function select(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
        var panel = document.getElementById(t.getAttribute("aria-controls"));
        if (panel) panel.classList.toggle("active", on);
      });
      if (focus) tab.focus();
    }
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () { select(t); });
      t.addEventListener("keydown", function (e) {
        var j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
        if (j < 0) return;
        e.preventDefault();
        select(tabs[(j + tabs.length) % tabs.length], true);
      });
    });
    return { tabs: tabs, select: select };
  }
  var lists = Array.prototype.map.call(document.querySelectorAll("[role=tablist]"), tablist);
  lists.forEach(function (l) { l.select(l.tabs.filter(function (t) { return t.getAttribute("aria-selected") === "true"; })[0] || l.tabs[0]); });
  function reveal() {
    var id = location.hash.slice(1);
    if (!id) return;
    var el = document.getElementById(id);
    if (!el) return;
    var node = el;
    while (node && node !== document.body) {
      if (node.getAttribute && node.getAttribute("role") === "tabpanel") {
        var tab = document.getElementById(node.getAttribute("aria-labelledby"));
        lists.forEach(function (l) { if (l.tabs.indexOf(tab) >= 0) l.select(tab); });
      }
      if (node.tagName === "DETAILS") node.open = true;
      node = node.parentNode;
    }
    var next = el.nextElementSibling;
    if (next && next.classList.contains("drow")) next.querySelector("details").open = true;
    el.scrollIntoView({ block: "start" });
  }
  window.addEventListener("hashchange", reveal);
  reveal();
  var btn = document.getElementById("theme");
  if (!btn) return;
  var order = ["auto", "light", "dark"];
  function apply(mode) {
    if (mode === "auto") html.removeAttribute("data-theme"); else html.setAttribute("data-theme", mode);
    btn.setAttribute("aria-pressed", mode === "auto" ? "false" : "true");
    btn.title = btn.getAttribute("data-" + mode);
    btn.setAttribute("aria-label", btn.getAttribute("data-" + mode));
  }
  var mode = "auto";
  try { mode = localStorage.getItem("aitd-theme") || "auto"; } catch (e) {}
  if (order.indexOf(mode) < 0) mode = "auto";
  apply(mode);
  btn.addEventListener("click", function () {
    mode = order[(order.indexOf(mode) + 1) % order.length];
    apply(mode);
    try { localStorage.setItem("aitd-theme", mode); } catch (e) {}
  });
})();`;

/** The CSP source for the report's inline script, for the MCP server's Content-Security-Policy header and the page's own meta tag. */
export const scriptCspSource = () => `'sha256-${createHash("sha256").update(SCRIPT).digest("base64")}'`;

/**
 * The HTML report. metrics (computeMetrics) and trend (history.js) are computed by the caller when it has
 * them; metrics is computed here otherwise so every report carries the verdict, and the Trend card is
 * left out without a history of at least two runs.
 */
export function renderHtml({ title, site = null, ai = null, generatedAt, findings, explained, runs, plan = null, lang = "en", branding = true, against = null, planCheck = null, changes = null, planChanges = null, consentScenarios = null, brand = null, metrics = null, trend = null }) {
  const m = messages(lang);
  const rows = attachExplanations(findings, explained);
  metrics ??= computeMetrics({ plan, runs, findings, consentScenarios });
  const counts = summarize(rows);
  const problems = rows.filter((f) => f.severity !== "ok").length;
  const ids = cardIds(rows);
  const runInfo = { ai, plan, lang, against, planChanges, consentScenarios };
  const atd = `<a class="f-atd" href="https://github.com/analitikisler/ai-tag-debugger" rel="noopener noreferrer"><img src="${LOGOS["atd-icon"]}" alt="" height="16">AI Tag Debugger</a>`;
  // A custom name or logo takes the place of the Analitik İşler branding. The AI Tag Debugger logo and credit stay, smaller, as with branding false.
  const whiteLabel = Boolean(brand?.logo || brand?.name);
  if (whiteLabel) branding = false;
  const brandName = brand?.name ? escapeHtml(brand.name) : "";
  const brandLogo = brand?.logo ? `<img src="${brand.logo}" alt="${brandName}" height="26">` : "";
  const productLogo = whiteLabel ? (brandLogo || `<span class="brand-name">${brandName}</span>`) : logo("atd-lockup", "AI Tag Debugger", 26, "logo-atd");
  const atdByline = whiteLabel ? `<a href="https://github.com/analitikisler/ai-tag-debugger" class="byline" rel="noopener noreferrer"><span>${m.ui.by}</span>${logo("atd-lockup", "AI Tag Debugger", 18, "logo-atd")}</a>` : "";
  const footer = branding
    ? `<div class="wrap"><a href="https://analitikisler.com" class="logo-link" aria-label="analitikisler.com" rel="noopener noreferrer">${logo("stacked", "Analitik İşler", 56, "logo-s")}</a>
<div><p>${m.ui.credit(atd)}</p><div class="f-links"><a href="https://analitikisler.com" rel="noopener noreferrer">analitikisler.com</a><a href="https://github.com/analitikisler/ai-tag-debugger" rel="noopener noreferrer">GitHub</a></div></div>
<div class="f-meta">${escapeHtml(site ?? title)} · ${escapeHtml(generatedAt)} · v${VERSION}</div></div>`
    : `<div class="wrap plain"><div class="f-meta">${whiteLabel ? `${brandName}${brandName ? " · " : ""}${m.ui.credit(atd)}` : "AI Tag Debugger"}</div><div class="f-meta">${escapeHtml(site ?? title)} · ${escapeHtml(generatedAt)} · v${VERSION}</div></div>`;
  const themeButton = `<button type="button" class="btn js-only" id="theme" aria-pressed="false" aria-label="${m.html.themeAuto}" title="${m.html.themeAuto}" data-auto="${m.html.themeAuto}" data-light="${m.html.themeLight}" data-dark="${m.html.themeDark}">${use("ui-theme", 16)}</button>`;
  const tab = (id, label, selected) => `<button type="button" role="tab" id="tab-${id}" aria-controls="${id}" aria-selected="${selected ? "true" : "false"}"${selected ? "" : ' tabindex="-1"'}>${label}</button>`;
  const panel = (id, heading, body) => `<section class="panel" id="${id}" role="tabpanel" aria-labelledby="tab-${id}"><h2>${heading}</h2>${body}</section>`;
  const body = `${verdictBlock(m, { site, title, generatedAt, findings, runs, lang, metrics, explained, counts, accepted: rows.filter((f) => f.accepted).length, runInfo, changes })}
<nav class="tabbar" aria-label="${m.ui.sections}"><div class="wrap"><div class="tabs js-only" role="tablist" aria-label="${m.ui.sections}">${tab("overview", m.ui.tabOverview, true)}${tab("findings", `${m.ui.findings} <span class="n">${problems}</span>`)}${tab("journeys", `${m.ui.tabJourneys} <span class="n">${runs.length}</span>`)}${tab("scope", m.ui.tabScope)}</div></div></nav>
<div class="wrap">
${panel("overview", m.ui.tabOverview, overviewPanel(m, runs, rows, ids, metrics, trend, changes))}
${panel("findings", `${m.ui.findings} <span class="n">${problems}</span>`, findingsPanel(m, runs, plan, rows, ids, counts))}
${panel("journeys", `${m.ui.tabJourneys} <span class="n">${runs.length}</span>`, journeysPanel(m, lang, findings, rows, runs, ids, metrics, consentScenarios))}
${panel("scope", m.ui.tabScope, scopePanel(m, runs, plan, metrics, planCheck, runInfo))}
</div>`;
  const topbar = `<header class="topbar"><div class="wrap"><span class="product">${productLogo}</span><div class="actions">${atdByline}${branding ? `<a href="https://analitikisler.com" class="byline" rel="noopener noreferrer"><span>${m.ui.by}</span>${logo("horizontal", "Analitik İşler", 18, "logo-h")}</a>` : ""}${themeButton}</div></div></header>`;
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src ${scriptCspSource()}">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)}</title><link rel="icon"${brand?.logo ? "" : ' type="image/png"'} href="${brand?.logo ?? LOGOS.favicon}">
<style>${CSS}${brandCss(brand?.color)}</style></head><body>
<a class="skip" href="#main">${m.html.skip}</a>
${sprite(`${topbar}${body}`)}
${topbar}
<main id="main">
${body}
</main>
<footer class="footer">${footer}</footer>
<script>${SCRIPT}</script>
</body></html>`;
}

const csvCell = (v) => {
  let s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  // Text from the page could run as a formula in Excel or Sheets; a leading ' keeps it text.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per tracking hit, dataLayer push and network call, in time order, for spreadsheets. */
export function renderCsv({ findings, runs }) {
  const header = ["journey", "viewport", "step_index", "step", "time_s", "type", "platform_or_vendor", "event", "details", "status", "flag"];
  const rows = [];
  for (const r of runs) {
    const stepOf = (i) => r.steps[i] ?? { index: i, label: "" };
    const t = (x) => ((x - r.startedAt) / 1000).toFixed(2);
    for (const h of r.hits) {
      const s = stepOf(h.step);
      rows.push({ at: h.t, cells: [r.journeyId, r.viewport, s.index, s.label, t(h.t), "hit", h.platform, h.name, h.params, "", hitSeverity(findings, r, s, h) ?? ""] });
    }
    for (const e of r.dataLayerLog ?? []) {
      const s = stepOf(e.step);
      const name = isConsentEntry(e.value) ? `consent ${e.value[1]}` : e.value?.event ?? "";
      rows.push({ at: e.t, cells: [r.journeyId, r.viewport, s.index, s.label, t(e.t), "datalayer", "", name, e.value, "", ""] });
    }
    for (const c of r.network ?? []) {
      const s = stepOf(c.step);
      rows.push({ at: c.t, cells: [r.journeyId, r.viewport, s.index, s.label, t(c.t), "network", c.vendor, c.method, c.url, c.blocked ? `${c.status} (local)` : c.status, ""] });
    }
  }
  // Keep each run's rows together, in time order within the run.
  const order = new Map(runs.map((r, i) => [`${r.journeyId}|${r.viewport}`, i]));
  rows.sort((a, b) => order.get(`${a.cells[0]}|${a.cells[1]}`) - order.get(`${b.cells[0]}|${b.cells[1]}`) || a.at - b.at);
  // The BOM makes Excel open the file as UTF-8, so Turkish characters display correctly.
  return "﻿" + [header, ...rows.map((r) => r.cells)].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}
