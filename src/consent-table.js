// The consent scenario tables and their constants, apart from src/consent.js (which drives the browser), so the
// HTML report and the Chrome extension can show them without Playwright.
import { CONSENT_SIGNALS, providerLabel } from "./parsers.js";
import { TRACKING_COOKIE } from "./checks.js";

export const CONSENT_STATES = ["accept", "reject", "analytics"];
// The visitor who leaves the banner unanswered and opens the next page. Browsing on is no consent under the GDPR or
// KVKK, so a tag that sends with cookies then is as wrong as after "reject all".
export const IGNORE = "ignore";
/** The scenario columns, in the order the reports show them. */
export const SCENARIO_COLUMNS = ["before", IGNORE, ...CONSENT_STATES];
// Tags that are advertising, so an "analytics only" choice should keep them quiet.
export const AD_PLATFORMS = new Set(["google_ads", "meta", "tiktok", "pinterest", "snapchat", "x"]);

/**
 * The per-state tag table: one row per platform and event, one cell per state (hit count, or null when
 * the state did not run). A cell is a problem when a tag sent hits a choice should have kept quiet:
 * anything after "reject all" or no choice except cookieless Consent Mode pings, and ad tags after "analytics only"
 * unless they were sent with ad storage denied.
 */
export function consentTable(scenarios) {
  const keys = new Set();
  const add = (counts) => Object.entries(counts ?? {}).forEach(([p, events]) => Object.keys(events).forEach((e) => keys.add(`${p}\u0000${e}`)));
  add(scenarios.before);
  for (const s of Object.values(scenarios.states)) add(s.after);
  // Captures from before the no-choice scenario existed have no column for it.
  const cols = SCENARIO_COLUMNS.filter((col) => col !== IGNORE || scenarios.states?.[IGNORE]);
  const rows = [...keys].sort().map((k) => {
    const [platform, event] = k.split("\u0000");
    const cells = cols.map((col) => {
      const s = col === "before" ? { after: scenarios.before } : scenarios.states[col];
      if (!s?.after) return { state: col, count: null, problem: false };
      const c = s.after[platform]?.[event] ?? { n: 0, cookieless: 0, adDenied: 0 };
      const problem = ((col === "reject" || col === IGNORE) && c.n > c.cookieless) || (col === "analytics" && AD_PLATFORMS.has(platform) && c.n > c.adDenied);
      return { state: col, count: c.n, problem };
    });
    return { platform, event, cells };
  });
  return { cols, rows };
}

/**
 * The consent matrix: one row per fact, one cell per scenario column, from the facts each scenario recorded.
 * Every cell is { text, problem }, where problem marks what should not happen with that choice: tracking cookies
 * set before a choice, without one or after "reject all", a client id that changes when the visitor accepts, and a
 * UTM parameter lost from the first hit. Null for captures from before the scenarios recorded facts.
 * @returns {null | { landing: string|null, cols: string[], rows: { key: string, label: string, cells: { text: string, problem: boolean }[] }[] }}
 */
export function consentMatrix(m, scenarios) {
  const t = m.ui.matrix;
  const factsFor = (col) => (col === "before" ? scenarios.beforeFacts : scenarios.states?.[col]?.facts) ?? null;
  const cols = SCENARIO_COLUMNS.filter((col) => col === "before" || scenarios.states?.[col]);
  if (!cols.some(factsFor)) return null;
  const signals = (c) => CONSENT_SIGNALS.filter((k) => c?.[k]).map((k) => `${t.signals[k]} ${c[k] === "granted" ? "✓" : c[k] === "denied" ? "✗" : "?"}`).join(" ");
  // No choice yet, no choice and on, and "reject all" may not leave tracking cookies; accepting must not lose the visitor.
  const strict = (col) => col === "before" || col === IGNORE || col === "reject";
  const cell = (text, problem = false) => ({ text, problem });
  const clientId = (f, col) => {
    if (col === "before") return cell(f.cookieClientId ? t.cid.cookie : f.clientId ? t.cid.cookieless : t.cid.none, Boolean(f.cookieClientId));
    const after = f.cookieClientId ?? f.clientId;
    if (!after) return cell(t.cid.none);
    if (!f.clientIdBefore) return cell(t.cid.new);
    if (after === f.clientIdBefore) return cell(t.cid.kept);
    // Without a cookie every page load gets a new id, which is what declining asks for.
    return cell(t.cid.changed, !strict(col) && Boolean(f.cookieClientId));
  };
  const rows = {
    firstHit: (f) => cell(f.firstHit ? `${f.firstHit.event}${f.firstHit.consent ? ` · ${signals(f.firstHit.consent)}` : ""}` : t.none),
    campaign: (f) => (!f.campaign ? cell(t.notRun) : f.campaign.lost.length
      ? cell(t.lost(f.campaign.lost), f.campaign.lost.some((n) => n.startsWith("utm_")) || f.firstHit?.consent?.ad_storage === "granted")
      : cell(t.kept)),
    clientId,
    gclAw: (f) => cell(t.gcl[f.gclAw ?? "none"]),
    cookies: (f, col) => cell(t.cookies(f.cookies.length, f.cookies.slice(0, 10)), strict(col) && f.cookies.some((n) => TRACKING_COOKIE.test(n))),
    loaded: (f) => cell(Object.entries(f.loaded).sort((a, b) => a[1] - b[1]).slice(0, 8).map(([p, ms]) => `${providerLabel(p)} ${t.ms(ms)}`).join(" · ") || t.none),
    tagConsent: (f) => cell(f.tagConsent ? signals(f.tagConsent) || t.none : t.notRun),
  };
  return {
    landing: scenarios.landing ?? null,
    cols,
    rows: Object.entries(rows).map(([key, fn]) => ({ key, label: t.rows[key], cells: cols.map((col) => (factsFor(col) ? fn(factsFor(col), col) : cell(t.notRun))) })),
  };
}

/** The consent matrix as a Markdown table with its legend, for report.md and MCP. */
export function consentMatrixMarkdown(m, scenarios) {
  const matrix = consentMatrix(m, scenarios);
  if (!matrix) return [];
  const esc = (x) => String(x).replace(/\|/g, "\\|");
  return [
    ...(matrix.landing ? [m.ui.matrix.intro(matrix.landing), ""] : []),
    `| | ${matrix.cols.map((c) => m.ui.scenarioCols[c]).join(" | ")} |`,
    `|${" --- |".repeat(matrix.cols.length + 1)}`,
    ...matrix.rows.map((r) => `| ${r.label} | ${r.cells.map((c) => `${esc(c.text)}${c.problem ? " ⚠" : ""}`).join(" | ")} |`),
    "",
    m.ui.matrix.legend,
  ];
}
