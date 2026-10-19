import { AD_PLATFORMS, consentTable } from "./consent.js";
import { ownerOf, verifyLinks } from "./verify.js";
import { createProvider } from "./providers.js";
import { canonicalEvent, groupFindings, summarize } from "./checks.js";
import { messages } from "./i18n.js";
import { buildInventory } from "./inventory.js";
import { computeMetrics } from "./metrics.js";
import { historySummaryLines, sparkline } from "./history.js";
import {
  VERSION, SEVERITIES, summaryParts, fixSteps, attachExplanations, SEVERITY_RANK, SEVERITY_ORDER_MD, seconds, isConsentEntry, routeList,
  isProblem, placeKey, uniqPlaces, mdHeadline, platformLabel, safeKey, sortPlatforms, changeLabel, coverageLines, pcSort, planChangeItems,
} from "./report-shared.js";

// The HTML report lives in src/html/: the 0.17 renderer in legacy.js, the new one in shell.js and its section modules.
// Callers keep importing everything from here.
export { VERSION, escapeHtml, platformLabel, verdictHeadline } from "./report-shared.js";
export { CSS, SCRIPT, scriptCspSource, renderHtml } from "./html/legacy.js";
export { logo } from "./html/lib.js";


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

// Values from the audited page go into Markdown as text: no raw HTML, and no way out of a code span.
const mdText = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const mdCode = (v) => String(v ?? "").replace(/`/g, "'").replace(/\n/g, " ");

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
const runFor = (runs, w) => runs.find((r) => r.journeyId === w.journey && r.viewport === w.viewport) ?? null;
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


function planVsSiteMd(m, pc) {
  const [overall, ...perPlatform] = coverageLines(m, pc);
  const lines = [`## ${m.ui.planVsSite}`, "", `**${mdText(overall)}**`, "", ...perPlatform.map((l) => `- ${mdText(l)}`), ...(perPlatform.length ? [""] : [])];
  lines.push(`| ${m.ui.event} | ${m.ui.bucketCol} | |`, "|---|---|---|");
  for (const e of pcSort(pc)) lines.push(`| ${mdText(platformLabel(e.platform))} \`${mdCode(e.event)}\` | ${m.ui.bucket[e.bucket]} | ${mdText((e.details ?? []).join(" ")).replace(/\|/g, "\\|")} |`);
  lines.push("");
  return lines;
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
