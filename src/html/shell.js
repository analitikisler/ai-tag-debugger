// The new HTML report: the head, the top bar, the rail, the seven sections and the footer around them. Each section
// module (summary.js, findings.js, journeys.js, consent.js, scope.js) renders from the one context built here, so the
// numbers on the rail, the top bar and the sections come from the same rows. src/report.js still exports the 0.17
import { messages } from "../i18n.js";
import { summarize } from "../checks.js";
import { computeMetrics } from "../metrics.js";
import { LOGOS } from "../brand.js";
import { VERSION, attachExplanations, escapeHtml, verdictHeadline } from "../report-shared.js";
import { cardIds, logo, passedRows, sprite, use } from "./lib.js";
import { CSS, brandCss } from "./css.js";
import { SCRIPT, scriptCspSource } from "./script.js";
import * as summary from "./summary.js";
import * as findingsSection from "./findings.js";
import * as journeys from "./journeys.js";
import * as consent from "./consent.js";
import * as scope from "./scope.js";

/** The rail's entries in order (1–7 on the keyboard) and their sprite icons. */
export const SECTIONS = ["summary", "findings", "journeys", "consent", "coverage", "inventory", "run"];
const RAIL_ICONS = { summary: "ui-gtm", findings: "ui-cause", journeys: "ui-journeys", consent: "ui-consent", coverage: "ui-events", inventory: "ui-vendors", run: "ui-clock" };
const VERDICT_SEV = { fail: "broken", attention: "warning", pass: "ok" };
const PROBLEM_RANK = { broken: 0, risk: 1, warning: 2 };
const CONSENT_CHECKS = new Set(["before_consent", "after_reject", "consent_default_missing"]);
const ATD_REPO = "https://github.com/analitikisler/ai-tag-debugger";

const worst = (rows) => rows.map((f) => f.severity).filter((s) => s in PROBLEM_RANK).sort((a, b) => PROBLEM_RANK[a] - PROBLEM_RANK[b])[0] ?? null;

/**
 * The numbers more than one place shows, counted once from the grouped rows: the rail, the top bar and the sections
 * read them here so they cannot disagree. Accepted rows (baseline) are not counted, as summarize() does.
 */
function tallyOf(rows, runs, metrics, findings) {
  const counted = rows.filter((f) => !f.accepted);
  const failedRows = counted.filter((f) => f.severity in PROBLEM_RANK);
  const chosen = [...new Set(runs.flatMap((r) => r.providers ?? []))];
  const seen = [...new Set(runs.flatMap((r) => (r.hits ?? []).map((h) => h.platform)))];
  const checked = chosen.length ? chosen : seen;
  return {
    failed: failedRows.length,
    worstFailed: worst(failedRows),
    unverified: counted.filter((f) => f.severity === "info").length,
    passed: passedRows({ findings, metrics }).length,
    consent: worst(counted.filter((f) => CONSENT_CHECKS.has(f.check))) ?? "ok",
    runs: runs.length,
    completed: runs.filter((r) => r.completed).length,
    coverage: metrics.coverage?.percent?.implemented ?? null,
    vendors: { seen: checked.filter((p) => seen.includes(p)), checked },
    // A site that never loaded has no score worth showing: null renders as "–".
    score: runs.some((r) => r.completed) ? (metrics.score?.score ?? null) : null,
  };
}

/**
 * @typedef {object} Ctx  What every section's render(ctx) receives. CONTRACT-IMPL.md describes each field.
 * @property {object} m  messages(lang)
 * @property {string} lang
 * @property {string} title
 * @property {string|null} site
 * @property {string} generatedAt
 * @property {{name: string, model: string}|null} ai
 * @property {object[]} findings  the raw findings, one per place
 * @property {object|null} explained  the model's summary and explanations
 * @property {object[]} rows  the grouped findings with their explanation and accepted flag (attachExplanations)
 * @property {Map<object, string>} ids  problem row -> card id (cardIds)
 * @property {object[]} runs
 * @property {object|null} plan
 * @property {object} metrics  computeMetrics
 * @property {{broken: number, risk: number, warning: number, info: number, ok: number}} counts  summarize(rows)
 * @property {object|null} consentScenarios
 * @property {object|null} planCheck
 * @property {object|null} changes
 * @property {object|null} planChanges
 * @property {object|null} trend
 * @property {string|null} against
 * @property {{name: string|null, logo: string|null, color: string|null}|null} brand
 * @property {boolean} branding  false for a white label too
 * @property {number} accepted  grouped rows the baseline accepted
 * @property {{status: string, statusText: string, headline: string, score: number|null}} verdict  verdictHeadline
 * @property {ReturnType<typeof tallyOf>} tally
 */

/** The context the sections render from, built from renderHtml's argument. Exported so a section's tests can build it. */
export function context({ title, site = null, ai = null, generatedAt, findings, explained, runs, plan = null, lang = "en", branding = true, against = null, planCheck = null, changes = null, planChanges = null, consentScenarios = null, brand = null, metrics = null, trend = null }) {
  const m = messages(lang);
  const rows = attachExplanations(findings, explained);
  metrics ??= computeMetrics({ plan, runs, findings, consentScenarios });
  // A custom name or logo takes the place of the Analitik İşler branding, as branding false does.
  const whiteLabel = Boolean(brand?.logo || brand?.name);
  return {
    m, lang, title, site, generatedAt, ai, findings, explained, rows, ids: cardIds(rows), runs, plan, metrics, counts: summarize(rows),
    consentScenarios, planCheck, changes, planChanges, trend, against, brand, branding: whiteLabel ? false : branding, whiteLabel,
    accepted: rows.filter((f) => f.accepted).length, verdict: verdictHeadline({ findings, runs, metrics, lang }), tally: tallyOf(rows, runs, metrics, findings),
  };
}

/** The token beside a rail entry: a glyph or a short text, and the tone that colours it and the collapsed rail's dot. */
function railToken(ctx, id) {
  const { m, tally, metrics } = ctx;
  if (id === "summary") {
    const sev = VERDICT_SEV[metrics.verdict.status] ?? "info";
    return { glyph: sev, tone: sev, tip: m.verdict.status[metrics.verdict.status] };
  }
  if (id === "findings") return { text: String(tally.failed), tone: tally.worstFailed ?? "ok" };
  if (id === "journeys") return { text: `${tally.completed}/${tally.runs}`, tone: tally.completed === tally.runs ? "completed" : "incomplete" };
  if (id === "consent") return { glyph: tally.consent, tone: tally.consent, tip: m.severity[tally.consent] };
  if (id === "coverage") return tally.coverage === null ? null : { text: `${tally.coverage}%`, tone: "neutral" };
  if (id === "inventory") return tally.vendors.checked.length ? { text: `${tally.vendors.seen.length}/${tally.vendors.checked.length}`, tone: "neutral" } : null;
  return null;
}

function rail(ctx) {
  const t = ctx.m.html.shell;
  const items = SECTIONS.map((id) => {
    const label = t.sections[id];
    const tok = railToken(ctx, id);
    const tip = tok ? t.railTip(label, tok.tip ?? tok.text) : label;
    const token = tok ? `<span class="r-t" data-tone="${tok.tone}">${tok.glyph ? use(`sev-${tok.glyph}`, 14) : escapeHtml(tok.text)}</span>${tok.tone === "neutral" ? "" : `<span class="r-d" data-tone="${tok.tone}"></span>`}` : "";
    return `<li><a href="#${id}" data-tip="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}">${use(RAIL_ICONS[id], 18)}<span class="r-l">${escapeHtml(label)}</span>${token}</a></li>`;
  }).join("");
  return `<nav class="rail" id="rail" aria-label="${escapeHtml(t.railLabel)}"><div class="r-head"><button type="button" class="r-toggle js-only" data-rail-toggle aria-expanded="true" aria-controls="rail" aria-label="${escapeHtml(t.collapse)}" data-tip="${escapeHtml(t.collapse)}" data-collapse="${escapeHtml(t.collapse)}" data-expand="${escapeHtml(t.expand)}">${use("ui-chevron", 18)}</button></div><ul>${items}</ul></nav>`;
}

function topBar(ctx) {
  const { m, site, title, generatedAt, brand, branding, whiteLabel, metrics, tally } = ctx;
  const t = m.html.shell;
  const brandName = brand?.name ? escapeHtml(brand.name) : "";
  const brandLogo = brand?.logo ? `<img src="${brand.logo}" alt="${brandName}" height="26">` : "";
  const product = whiteLabel ? (brandLogo || `<span class="brand-name">${brandName}</span>`) : `${logo("atd-lockup", "ai tag debugger", 22, "l-lockup")}${logo("mark", "ai tag debugger", 24, "l-mark")}`;
  const atdByline = whiteLabel ? `<a href="${ATD_REPO}" class="byline" rel="noopener noreferrer"><span>${m.ui.by}</span>${logo("atd-lockup", "ai tag debugger", 16, "logo-atd")}</a>` : "";
  const aiByline = branding ? `<a href="https://analitikisler.com" class="byline" rel="noopener noreferrer"><span>${m.ui.by}</span>${logo("master", "Analitik İşler", 16, "logo-h")}</a>` : "";
  const word = m.verdict.status[metrics.verdict.status];
  // 0–49 red, 50–89 amber, 90–100 green, as Lighthouse bands its scores; no score reads as a fail.
  const band = tally.score === null || tally.score < 50 ? "fail" : tally.score < 90 ? "mid" : "pass";
  const label = tally.score === null ? t.noScore(word) : t.scoreLabel(tally.score, word);
  const verdict = `<a class="top-verdict v-${band}" href="#summary" aria-label="${escapeHtml(label)}"><span class="sc-l">${escapeHtml(t.score)}</span><b>${tally.score ?? "–"}</b><span class="sc">${escapeHtml(t.outOf)}</span></a>`;
  const theme = `<button type="button" class="icon-btn js-only" id="theme" aria-label="${escapeHtml(t.themeAuto)}" title="${escapeHtml(t.themeAuto)}" data-auto="${escapeHtml(t.themeAuto)}" data-light="${escapeHtml(t.themeLight)}" data-dark="${escapeHtml(t.themeDark)}">${use("ui-theme", 18)}</button>`;
  return `<header class="top"><span class="brand">${product}</span><span class="top-site"><span class="eyebrow">${escapeHtml(t.eyebrow)}</span><b>${escapeHtml(site ?? title)}</b></span><span class="top-date muted">${escapeHtml(generatedAt)}</span>${verdict}<div class="top-end">${atdByline}${aiByline}${theme}</div></header>`;
}

function footer(ctx) {
  const { m, site, title, generatedAt, brand, branding, whiteLabel } = ctx;
  const atd = `<a class="f-atd" href="${ATD_REPO}" rel="noopener noreferrer">${logo("favicon", "", 16, "f-mark")} ai tag debugger</a>`;
  const meta = `<span class="muted">${escapeHtml(site ?? title)} · ${escapeHtml(generatedAt)} · v${VERSION}</span>`;
  if (branding) return `<footer class="footer"><a href="https://analitikisler.com" class="logo-link" aria-label="analitikisler.com" rel="noopener noreferrer">${logo("master", "Analitik İşler", 24, "logo-s")}</a><p class="xs">${m.ui.credit(atd)} ${meta}</p></footer>`;
  const brandName = brand?.name ? escapeHtml(brand.name) : "";
  return `<footer class="footer"><p class="xs">${whiteLabel ? `${brandName}${brandName ? " · " : ""}${m.ui.credit(atd)}` : "ai tag debugger"} ${meta}</p></footer>`;
}

/** The expand / collapse pair under a section's h2, for every section but Summary that holds a details.card. */
function withTools(m, html) {
  const tools = `<div class="sec-tools js-only"><button type="button" class="btn" data-expand-all>${escapeHtml(m.html.shell.expandAll)}</button><button type="button" class="btn" data-collapse-all>${escapeHtml(m.html.shell.collapseAll)}</button></div>`;
  return html.split(/(?=<section\b[^>]*\bclass="sec(?=[ "]))/).map((chunk) => {
    const id = chunk.match(/^<section\b[^>]*\bid="([^"]+)"/)?.[1];
    if (!id || id === "summary" || !/<details\b[^>]*\bclass="[^"]*\bcard\b/.test(chunk)) return chunk;
    return chunk.replace(/<\/h2>/, `</h2>${tools}`);
  }).join("");
}

/**
 * The HTML report, with the same argument as the 0.17 renderHtml. metrics (computeMetrics) and trend (history.js)
 * come from the caller when it has them; metrics is computed here otherwise.
 */
export function renderHtml(report) {
  const ctx = context(report);
  const { m, lang, title, brand } = ctx;
  const t = m.html.shell;
  const sections = withTools(m, [summary, findingsSection, journeys, consent, scope].map((s) => s.render(ctx)).join("\n"));
  const top = topBar(ctx);
  const nav = rail(ctx);
  const foot = footer(ctx);
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src ${scriptCspSource()}">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)}</title><link rel="icon"${brand?.logo ? "" : ' type="image/svg+xml"'} href="${brand?.logo ?? LOGOS["favicon-light"]}">
<style>${CSS}${brandCss(brand?.color)}</style></head><body>
<a class="skip" href="#main">${escapeHtml(t.skip)}</a>
${sprite(`${top}${nav}${sections}${foot}`)}
${top}
<div class="shell">
${nav}
<main id="main" tabindex="-1" data-clear-label="${escapeHtml(t.clear)}" data-filter-count="${escapeHtml(t.filterCount("{n}", "{m}"))}">
<h1 class="sr">${escapeHtml(t.heading(ctx.site ?? title))}</h1>
${sections}
</main>
</div>
${foot}
<script>${SCRIPT}</script>
</body></html>`;
}

