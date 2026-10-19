// The Summary section (SPEC §2): the scorecard with its status chips, then six "about this run" cards. Nothing here is
// collapsible and nothing is counted twice: the chips read ctx.tally and ctx.rows as the rail and Findings do, the
// headline is verdictHeadline's (the CLI's, the alerts' and the Markdown title's), and the cost lines are the score's
// own deductions.
import { VERSION, summaryParts } from "../report-shared.js";
import { PLATFORM_ART, UI_SYMBOLS, chip, esc, fmt, platformLabel, safeKey, sectionBlock, sortPlatforms, use } from "./lib.js";

const PROBLEMS = ["broken", "risk", "warning"];
const SEVERITIES = [...PROBLEMS, "info", "ok"];
const VERDICT_SEV = { fail: "broken", attention: "warning", pass: "ok" };
// Screen readers read the cost line's parts as one sentence; the separator keeps them apart.
const SEP = '<span class="sr"> · </span>';
const same = (a, b) => (a ?? null) === (b ?? null);
const code = (s) => `<code>${esc(s)}</code>`;
// GA4 lists the money parameters first; the line names them in the order a reader fixes them.
const PARAM_ORDER = ["value", "currency", "transaction_id", "items"];
const byParamOrder = (a, b) => (PARAM_ORDER.indexOf(a) + 1 || 99) - (PARAM_ORDER.indexOf(b) + 1 || 99);
/** A sentence's first letter in capitals; the locale keeps Turkish "i" as "İ". */
const sentence = (s, lang) => (s ? s[0].toLocaleUpperCase(lang) + s.slice(1) : s);

/** A platform's artwork, or its initials on a neutral square for a platform without artwork. Decorative: the name follows. */
function platArt(key, size) {
  const k = safeKey(key);
  if (PLATFORM_ART[k]) return use(`p-${k}`, size);
  const initials = platformLabel(key).split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return `<span class="plat-fb s${size <= 13 ? 12 : size <= 15 ? 14 : 16}" aria-hidden="true">${esc(initials)}</span>`;
}
const platChip = (key) => chip("plat", key, `${platArt(key, 13)}${esc(platformLabel(key))}`);
/** A run as a chip: the journey with the viewport's glyph, coloured by viewport. */
const runChip = (journey, viewport) => {
  const vp = safeKey(viewport);
  return chip("vp", vp, `${UI_SYMBOLS[`ui-${vp}`] ? use(`ui-${vp}`, 13) : ""}${esc(journey)} · ${esc(viewport)}`);
};
const runsChip = (t, n) => `<span class="chip plain">${use("ui-journeys", 13)}${esc(t.runs(n))}</span>`;

/** The step every unfinished run stopped at (its last step; step 0 is the start), or null when they differ. */
function stopStep(runs) {
  const stops = [...new Set(runs.filter((r) => !r.completed).map((r) => (r.steps ?? []).length - 1))];
  return stops.length === 1 ? stops[0] : null;
}

/**
 * The score's deductions folded into the groups a reader fixes together: same check and the same event name compared
 * case-insensitively (GA4 purchase and Meta Purchase are one fix), most points first. Each group keeps the row of its
 * largest deduction, whose card the line links to, and every place any of its rows was seen.
 */
function costGroups(ctx) {
  const { metrics, rows } = ctx;
  const map = new Map();
  for (const d of metrics.score?.deductions ?? []) {
    const key = `${d.check}|${String(d.event ?? "").toLowerCase()}`;
    if (!map.has(key)) map.set(key, { check: d.check, event: d.event, points: 0, items: [] });
    const g = map.get(key);
    g.points += d.points;
    g.items.push(d);
  }
  const groups = [...map.values()];
  for (const g of groups) {
    g.top = g.items.reduce((a, d) => (d.points > a.points ? d : a));
    g.severity = g.top.severity;
    g.platforms = sortPlatforms(new Set(g.items.map((d) => d.platform).filter(Boolean)));
    g.rows = rows.filter((r) => r.severity !== "ok" && g.items.some((d) => d.check === r.check && same(d.platform, r.platform) && same(d.event, r.event)));
    g.row = g.rows.find((r) => same(r.platform, g.top.platform) && same(r.event, g.top.event)) ?? g.rows[0];
    g.places = [...new Map(g.rows.flatMap((r) => r.where).map((w) => [`${w.journey}|${w.viewport}`, w])).values()];
  }
  return groups.sort((a, b) => b.points - a.points);
}

/** What a group costs, in at most eight words. The raw findings carry the missing parameters; the grouped rows do not. */
function costText(ctx, g) {
  const t = ctx.m.html.summary.cost;
  const ev = g.event ? code(g.event) : "";
  switch (g.check) {
    case "missing_params": {
      const params = [...new Set(ctx.findings.filter((f) => f.check === g.check && g.items.some((d) => same(d.platform, f.platform) && same(d.event, f.event))).flatMap((f) => f.params ?? []))].sort(byParamOrder);
      return params.length ? t.missingParams(ev, params.map(code).join(", ")) : t.missingParamsAny(ev);
    }
    case "before_consent": return t.beforeConsent(ev);
    case "after_reject": return t.afterReject(ev);
    case "duplicate": {
      // The count is only in the finding's sentence ("sent 2 times"); the quoted event name may hold digits of its own.
      const n = Number(String(g.row?.detail ?? "").replace(/"[^"]*"/g, "").match(/\d+/)?.[0]) || null;
      return t.duplicate(ev, n);
    }
    case "missing_event": return t.missingEvent(ev);
    case "journey_incomplete": return esc(t.stopped(stopStep(ctx.runs), ctx.runs.filter((r) => !r.completed).length));
    case "consent_default_missing": return esc(t.noConsentDefault);
    default: {
      // Any other check: the first sentence of the finding itself, which checks.js wrote in the report's language.
      const first = String(g.row?.detail ?? g.check.replace(/_/g, " ")).split(/(?<=\.)\s/)[0].replace(/\.$/, "");
      return esc(first).replace(/&quot;([^&]+?)&quot;/g, "<code>$1</code>");
    }
  }
}

/** Where a group was seen: one or two runs as run chips, more as "n runs". */
function whereChips(ctx, g) {
  const t = ctx.m.html.summary;
  if (g.places.length > 2 || (g.places.length === ctx.runs.length && g.places.length > 1)) return runsChip(t, g.places.length);
  return g.places.map((w) => runChip(w.journey, w.viewport)).join("");
}

function costLines(ctx, noScore) {
  const { m, tally, ids } = ctx;
  const t = m.html.summary;
  const groups = costGroups(ctx);
  const score = tally.score;
  // SPEC 2.1: a perfect score has no line; 90–99 one line and "· n more"; below, up to three, the third summing the rest.
  let shown = [];
  let inline = "";
  let tail = null;
  if (noScore || score < 90) {
    if (groups.length > 3) {
      shown = groups.slice(0, 2);
      const rest = groups.slice(2);
      tail = { points: rest.reduce((a, g) => a + g.points, 0), severity: rest[0].severity, text: t.moreInFindings(rest.length) };
    } else shown = groups;
  } else if (score < 100) {
    shown = groups.slice(0, 1);
    if (groups.length > 1) inline = ` <span class="muted">· ${esc(t.more(groups.length - 1))}</span>`;
  }
  if (!shown.length) return "";
  // A site that never loaded has no score, so its lines carry no points either.
  const pts = (p) => (noScore ? "" : `<span class="pts">−${p}</span>`);
  const lines = shown.map((g, i) => {
    const id = g.row ? ids.get(g.row) : null;
    const plats = g.platforms.map(platChip).join("");
    return `<li class="sev-${g.severity}"><a href="#${id ?? "findings"}">${pts(g.points)}<span class="what">${costText(ctx, g)}${i === 0 ? inline : ""}</span>${SEP}<span class="pl">${plats}</span>${plats ? SEP : ""}<span class="wh">${whereChips(ctx, g)}</span></a></li>`;
  });
  if (tail) lines.push(`<li class="sev-${tail.severity}"><a href="#findings">${pts(tail.points)}<span class="what">${esc(tail.text)}</span></a></li>`);
  return `<ul class="sc-costs${noScore ? " nopts" : ""}">${lines.join("")}</ul>`;
}

/** The model's summary as one muted line under the headline: its headline, or an older capture's plain text. */
function aiLine(ctx) {
  const s = summaryParts(ctx.explained?.summary);
  const text = s ? (s.text ?? s.headline) : "";
  if (!text) return "";
  return `<p class="sc-ai muted" title="${esc(text)}"><span class="ai-l">${esc(ctx.m.html.aiSummary)}</span> ${fmt(text)}</p>`;
}

/** Five severity chips counted as Findings counts them: problem rows per severity, Info = Unverified, OK = Passed. */
function statusChips(ctx) {
  const { m, rows, tally } = ctx;
  const counted = rows.filter((f) => !f.accepted);
  const count = { info: tally.unverified, ok: tally.passed };
  for (const s of PROBLEMS) count[s] = counted.filter((f) => f.severity === s).length;
  const chips = SEVERITIES.map((s) => {
    const inner = `${use(`sev-${s}`, 15)}<b>${count[s]}</b> ${esc(m.severity[s])}`;
    // A zero keeps the row's shape but leads nowhere: Findings would show an empty list.
    return count[s] ? `<a class="chip chip-sev ${s} lg" href="#findings?sev=${s}">${inner}</a>` : `<span class="chip chip-sev ${s} lg zero" aria-disabled="true">${inner}</span>`;
  }).join("");
  return `<div class="sc-chips chips" role="group" aria-label="${esc(m.html.countsLabel)}">${chips}</div>`;
}

function scorecard(ctx) {
  const { m, lang, tally, verdict, accepted } = ctx;
  const shell = m.html.shell;
  const score = tally.score;
  const noScore = score === null;
  // The ring is banded by score as the top-bar chip is (0–49 red, 50–89 amber, 90–100 green); the word by verdict.
  const band = noScore || score < 50 ? "fail" : score < 90 ? "mid" : "pass";
  const sev = VERDICT_SEV[verdict.status] ?? "warning";
  const ring = noScore
    ? `<div class="sc-ring" role="img" aria-label="${esc(shell.noScore(verdict.statusText))}"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="trk" cx="60" cy="60" r="52"/></svg><span class="sc-num sm-none">–</span></div>`
    : `<div class="sc-ring" role="img" aria-label="${esc(shell.scoreLabel(score, verdict.statusText))}"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="trk" cx="60" cy="60" r="52"/>${score > 0 ? `<circle class="arc" cx="60" cy="60" r="52" pathLength="100" style="--score:${score}"/>` : ""}</svg><span class="sc-num">${score}</span><span class="sc-of">${esc(shell.outOf)}</span></div>`;
  const headline = verdict.headline ? `${sentence(verdict.headline, lang)}.` : "";
  return `<div class="scorecard band-${band}">${ring}
<p class="sc-verdict sev-${sev}">${use(`sev-${sev}`, 26)}${esc(verdict.statusText)}</p>
<p class="sc-head">${esc(headline)}</p>
${aiLine(ctx)}${costLines(ctx, noScore)}
${statusChips(ctx)}${accepted > 0 ? `\n<p class="meta accepted-line">${esc(m.ui.acceptedLine(accepted))}</p>` : ""}
</div>`;
}

/* ---------- about this run ---------- */

/** One card: icon, the label linking to the section that has the detail, the value and at most one secondary line. */
const card = (icon, label, href, val, sub, cls = "") => `<div class="info${cls}"><span class="ic-plate">${use(icon, 15)}</span><a class="lbl" href="#${href}">${esc(label)}${use("ui-chevron", 12)}</a><span class="val">${val}</span>${sub ? `<span class="sub">${sub}</span>` : ""}</div>`;

function vendorsCard(ctx) {
  const { m, tally } = ctx;
  const t = m.html.summary;
  const seen = new Set(tally.vendors.seen);
  const checked = sortPlatforms(tally.vendors.checked);
  const chips = checked.map((p) => {
    const word = seen.has(p) ? t.seen : t.notSeen;
    return `<span class="chip chip-plat ${safeKey(p)}${seen.has(p) ? "" : " sm-unseen"}" title="${esc(word)}">${platArt(p, 13)}${esc(platformLabel(p))}<span class="sr"> (${esc(word)})</span></span>`;
  }).join("");
  const val = checked.length ? `<span class="chips">${chips}</span>` : '<span class="muted">–</span>';
  return card("ui-vendors", m.html.platformsChecked, "inventory", val, checked.length ? esc(t.seenOf(seen.size, checked.length)) : "", " sm-chipval");
}

/** Problem rows that point at a run, as the 0.17 journeys table counted them. */
const problemsIn = (rows, run) => rows.filter((f) => PROBLEMS.includes(f.severity) && !f.accepted && f.where.some((w) => w.journey === run.journeyId && w.viewport === run.viewport)).length;

function journeysCard(ctx) {
  const { m, runs, rows, tally } = ctx;
  const t = m.html.summary;
  if (!runs.length) return card("ui-journeys", m.ui.tabJourneys, "journeys", `<span class="muted">${esc(t.noRuns)}</span>`, "", " sm-matrixval");
  const platformsIn = (r) => sortPlatforms(new Set((r.hits ?? []).map((h) => h.platform)));
  const journeys = [...new Set(runs.map((r) => r.journeyId))];
  const viewports = [...new Set(runs.map((r) => r.viewport))];
  const cell = (j, vp) => {
    const ri = runs.findIndex((r) => r.journeyId === j && r.viewport === vp);
    if (ri < 0) return "<td></td>";
    const r = runs[ri];
    const state = r.completed ? "completed" : "incomplete";
    // The cell shows a glyph and logos; the numbers the 0.17 journeys table showed are read out, not drawn.
    const said = [`${j} · ${vp}: ${t.runState[state]}`, t.steps((r.steps ?? []).filter((s) => s.index > 0).length), t.hits((r.hits ?? []).length), t.problems(problemsIn(rows, r))].join(" · ");
    const logos = platformsIn(r).map((p) => `<span class="sm-logo">${platArt(p, 15)}</span>`).join("");
    return `<td><a href="#j${ri}">${chip("run", state, use(r.completed ? "sev-ok" : "sev-warning", 13))}${logos}<span class="sr">${esc(said)}</span></a></td>`;
  };
  const head = viewports.map((vp) => `<th scope="col">${UI_SYMBOLS[`ui-${safeKey(vp)}`] ? `${use(`ui-${safeKey(vp)}`, 14)}<span class="sr">${esc(vp)}</span>` : esc(vp)}</th>`).join("");
  const body = journeys.map((j) => `<tr><th scope="row">${esc(j)}</th>${viewports.map((vp) => cell(j, vp)).join("")}</tr>`).join("");
  const matrix = `<table class="sm-matrix"><caption class="sr">${esc(m.ui.tabJourneys)}</caption><thead><tr><td></td>${head}</tr></thead><tbody>${body}</tbody></table>`;
  const stop = stopStep(runs);
  const sub = tally.completed
    ? [t.completedOf(tally.completed, tally.runs), t.steps(runs.reduce((a, r) => a + (r.steps ?? []).filter((s) => s.index > 0).length, 0)), t.hits(runs.reduce((a, r) => a + (r.hits ?? []).length, 0))]
    : [t.completedOf(0, tally.runs), ...(stop !== null ? [t.stoppedAt(stop)] : [])];
  return card("ui-journeys", m.ui.tabJourneys, "journeys", matrix, esc(sub.join(" · ")), " sm-matrixval");
}

function eventsCard(ctx) {
  const t = ctx.m.html.summary;
  const cov = ctx.metrics.coverage;
  // Without a plan there is nothing to count against; say so instead of showing zeros.
  if (!cov) return card("ui-events", t.events, "coverage", `<span class="sm-note">${esc(t.noPlan)}</span>`, "");
  // Seen = sent, with or without its required parameters; the secondary line says how many had them all.
  return card("ui-events", t.events, "coverage", t.plannedSeen(cov.planned, cov.counts.implemented + cov.counts.missing_params), esc(t.withParams(cov.percent.implemented)));
}

/** The state of the first Consent Mode default pushed: denied or granted when every key agrees, mixed otherwise. */
function defaultState(runs) {
  const push = runs.flatMap((r) => r.dataLayerLog ?? []).map((e) => e.value).find((v) => Array.isArray(v) && v[0] === "consent" && v[1] === "default");
  const states = Object.values(push?.[2] ?? {});
  if (!states.length) return null;
  return states.every((s) => s === "denied") ? "denied" : states.every((s) => s === "granted") ? "granted" : "mixed";
}

function consentCard(ctx) {
  const { m, metrics, runs, consentScenarios, tally } = ctx;
  const t = m.html.summary;
  const cm = metrics.consent?.consentMode ?? {};
  const ms = (cm.runs ?? []).map((r) => r.ms).filter((x) => typeof x === "number");
  const range = ms.length ? (Math.min(...ms) === Math.max(...ms) ? `${ms[0]}` : `${Math.min(...ms)}–${Math.max(...ms)}`) : null;
  const state = defaultState(runs);
  const stateChip = state ? ` ${chip("consent", state === "mixed" ? "none" : state, esc(state === "mixed" ? t.mixed : state))}` : "";
  const val = cm.defaultPresent ? t.defaultAt(stateChip, range) : esc(t.noDefault);
  // Scenarios: no choice, then each state the banner reached (accept, reject), as the Consent section lists them.
  const sc = consentScenarios;
  const scenarios = sc ? 1 + Object.values(sc.states ?? {}).filter((s) => s?.after).length : 0;
  const cmp = sc ? (sc.cmp === "banner" ? sentence(m.html.cmpBanner, ctx.lang) : String(sc.cmp ?? "")) : "";
  const sub = sc ? `${esc(cmp)} · ${esc(m.html.scenariosRun(scenarios))}` : esc(tally.completed ? t.noBanner : t.bannerNotReached);
  return card("ui-consent", m.ui.consent, "consent", val, sub);
}

function aiCard(ctx) {
  const { m, ai } = ctx;
  const t = m.html.summary;
  const val = ai ? `${esc(ai.name ?? "")}${ai.model ? ` <small>· ${esc(ai.model)}</small>` : ""}` : esc(t.scripted);
  return card("ui-ai", m.ui.runAi, "run", val, esc(ai ? t.explains : t.deterministic));
}

function runCard(ctx) {
  const { m, generatedAt, metrics } = ctx;
  const t = m.html.summary;
  // generatedAt arrives formatted ("2026-10-19 09:13 UTC"); the zone is set small, as in the mockup.
  const at = /^(.*\S)\s+(UTC)$/.exec(String(generatedAt ?? ""));
  const when = at ? `${esc(at[1])} <small>${esc(at[2])}</small>` : esc(generatedAt ?? "–");
  const ms = (metrics.timing ?? []).reduce((a, r) => a + (r.durationMs ?? 0), 0);
  const sub = [ms ? t.seconds((ms / 1000).toFixed(1)) : "", `v${VERSION}`].filter(Boolean).join(" · ");
  return card("ui-clock", m.html.shell.sections.run, "run", when, esc(sub));
}

function about(ctx) {
  const cards = [vendorsCard, journeysCard, eventsCard, consentCard, aiCard, runCard].map((f) => f(ctx)).join("");
  return `<div class="grid sm-about" role="group" aria-label="${esc(ctx.m.html.summary.about)}">${cards}</div>`;
}

/** @param {import("./shell.js").Ctx} ctx */
export function render(ctx) {
  return sectionBlock("summary", esc(ctx.m.html.shell.sections.summary), `${scorecard(ctx)}\n${about(ctx)}`, "sm");
}

