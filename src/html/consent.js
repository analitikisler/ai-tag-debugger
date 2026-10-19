// The Consent section: one status line per platform, the Consent Mode card and the scenarios card. Denied is red,
// granted green and "no signal" grey, all by token through chip("consent", ...).
import { consentTable } from "../consent.js";
import { isConsentEntry } from "../report-shared.js";
import { chip, esc, plat, safeKey, sectionBlock, sortPlatforms, stepTitle, secs, use, badge } from "./lib.js";

// Google tags carry Consent Mode signals on the hit; every other platform sends none, so its state is "none".
const GOOGLE = new Set(["ga4", "google_ads"]);
const SCENARIOS = ["before", "accept", "reject", "analytics"];
const LINE_CHECKS = new Set(["before_consent", "after_reject", "consent_default_missing"]);
const MODE_CHECKS = new Set(["consent_default_missing", "consent_default_late", "consent_v2_missing", "consent_v2_update"]);
const SEVERITY_RANK = { broken: 0, risk: 1, warning: 2, info: 3 };

/** The worst problem row among these, or null. Accepted rows (the baseline's) do not count, as everywhere else. */
const worstRow = (rows) => rows.filter((f) => !f.accepted && f.severity in SEVERITY_RANK).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])[0] ?? null;

/** denied / granted for a Google platform, none for the rest; null when the tag sent nothing in that scenario. */
function stateOf(platform, c) {
  if (!c?.n) return null;
  if (!GOOGLE.has(platform)) return "none";
  return c.cookieless >= c.n || c.adDenied >= c.n ? "denied" : "granted";
}

/** What was sent after a scenario's choice (before: with no choice yet); undefined when the scenario did not run. */
const afterOf = (sc, s) => (s === "before" ? sc.before : sc.states?.[s]?.after);

/** The consent signals of a Consent Mode command, as the chips a hit carries: key and value, coloured by value. */
function signalChips(m, signals) {
  return Object.entries(signals ?? {}).filter(([, v]) => typeof v === "string")
    .map(([k, v]) => {
      const state = v === "granted" || v === "denied" ? v : "none";
      return chip("consent", state, `<span class="k">${esc(k)}</span>${esc(v)}`);
    }).join("");
}

/** A neutral outlined chip for a plain label or number. */
const plain = (html, cls = "") => `<span class="chip plain${cls ? ` ${cls}` : ""}">${html}</span>`;

/** @param {import("./shell.js").Ctx} ctx */
export function render(ctx) {
  const { m, runs, rows, ids, metrics, consentScenarios: sc } = ctx;
  const t = m.html.consent;
  const sevChip = (sev, label) => chip("sev", sev, `${use(`sev-${sev}`, 13)}${esc(label)}`);
  const stateWord = (state) => t.state[state];
  const stateChip = (state, label = stateWord(state)) => chip("consent", state, esc(label));
  const platChip = (key) => chip("plat", key, plat(key, 13));
  const findingLink = (row, cls = "") => (row && ids.get(row) ? `<a${cls ? ` class="${cls}"` : ""} href="#${ids.get(row)}">${esc(m.html.findingLink)}</a>` : "");

  /* ---- one status line per platform ---- */
  const total = (platform, s) => {
    const after = sc ? afterOf(sc, s) : null;
    if (!after) return "";
    const byEvent = after[platform] ?? {};
    const count = Object.values(byEvent).reduce((a, c) => a + c.n, 0);
    if (!count) return `<span class="chip zero">0</span>`;
    const states = new Set(Object.values(byEvent).map((c) => stateOf(platform, c)).filter(Boolean));
    // One state for every event, else the strictest: a mix that holds a denied event reads denied.
    const state = states.size === 1 ? [...states][0] : states.has("denied") ? "denied" : "none";
    return stateChip(state, t.tally(count, stateWord(state)));
  };
  const platforms = sortPlatforms(new Set(metrics.consent.platforms.map((p) => p.platform)));
  const lines = platforms.map((platform) => {
    const own = rows.filter((f) => LINE_CHECKS.has(f.check) && f.platform === platform);
    const row = worstRow(own);
    // The scenarios can show a tag sent after Reject with no finding row for it; with no row at all (not even an
    // accepted one) the metric decides, so the line agrees with the flagged cell below.
    const sev = row?.severity ?? (!own.length && metrics.consent.platforms.find((p) => p.platform === platform)?.status !== "pass" ? "risk" : "ok");
    const cells = SCENARIOS.slice(0, 3).filter((s) => sc && afterOf(sc, s))
      .map((s) => `<span class="cs-p"><span class="cs-k">${esc(t.cols[s])}</span>${total(platform, s)}</span>`).join("");
    return `<li class="card sev-${sev} cs-row" id="consent-${safeKey(platform)}">${platChip(platform)}${sevChip(sev, m.severity[sev])}${cells ? `<span class="cs-cells">${cells}</span>` : ""}${findingLink(row, "cs-go")}</li>`;
  }).join("");
  const list = lines ? `<ul class="cs-list" aria-label="${esc(t.statusLabel)}">${lines}</ul>` : "";

  /* ---- Consent Mode ---- */
  const mode = metrics.consent.consentMode;
  const perRun = runs.map((run, ri) => {
    const cmds = (run.dataLayerLog ?? []).filter((e) => isConsentEntry(e.value) && (e.value[1] === "default" || e.value[1] === "update"));
    const first = cmds.find((e) => e.value[1] === "default");
    const update = cmds.find((e) => e.value[1] === "update" && (!first || e.t >= first.t));
    return { run, info: mode.runs[ri], first, update, resent: cmds.filter((e) => e !== first && e !== update).length };
  });
  const runChip = (run) => chip("vp", run.viewport, `${run.viewport === "desktop" || run.viewport === "mobile" ? use(`ui-${run.viewport}`, 13) : ""}${esc(run.journeyId)}<span class="sr"> ${esc(run.viewport)}</span>`);
  const modeFinding = worstRow(rows.filter((f) => MODE_CHECKS.has(f.check)));
  const withDefault = perRun.filter((p) => p.info?.present);
  const ms = withDefault.map((p) => p.info.ms).filter((x) => x !== null);
  const late = mode.defaultOnTime === false;
  let modeHead;
  if (!runs.length) modeHead = chip("consent", "none", esc(m.ui.notChecked));
  else if (!mode.defaultPresent) modeHead = modeFinding ? sevChip(modeFinding.severity, t.noDefault) : chip("consent", "none", esc(t.noDefault));
  else modeHead = late ? sevChip(modeFinding?.severity ?? "risk", t.defaultLate) : sevChip("ok", t.defaultFirst);
  const modeChips = `${ms.length ? plain(`${use("ui-clock", 13)}<b>${esc(t.timing(Math.min(...ms), Math.max(...ms)))}</b>`, "mono") : ""}${withDefault.length && mode.v2Signals.present ? sevChip("ok", t.v2) : withDefault.length ? sevChip("warning", t.v2Missing) : ""}`;

  // Runs that pushed the same commands on the same steps share one pair of rows; a run that differs gets its own.
  const groups = new Map();
  for (const p of withDefault) {
    const key = JSON.stringify([p.first?.value[2], p.update?.value[2], p.info.stepLabel, p.update?.step]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const commandRow = (label, p, e) => {
    if (!e) return "";
    const step = p.run.steps.find((s) => s.index === e.step);
    const where = `${step ? `${m.ui.step} ${step.index} · ${esc(stepTitle(p.run, step))} · ` : ""}${esc(secs(p.run, e.t))}`;
    return `<li><b class="cm-l">${esc(label)}</b><span class="cm-w">${where}</span><span class="cm-s">${signalChips(m, e.value[2])}</span></li>`;
  };
  const groupHtml = [...groups.values()].map((g) => `${groups.size > 1 ? `<div class="chips cm-runs">${g.map((p) => runChip(p.run)).join("")}</div>` : ""}<ol class="cm-list">${commandRow(m.ui.consentDefault, g[0], g[0].first)}${commandRow(m.ui.consentUpdate, g[0], g[0].update)}</ol>`).join("");
  const timing = withDefault.map((p) => `<li>${runChip(p.run)}<span class="xs">${esc(m.html.consentTiming(p.info.ms, p.info.beforeFirstGoogleHit, p.info.v2Signals.present, p.info.v2Signals.missing))}</span></li>`).join("");
  const resent = Math.max(0, ...withDefault.map((p) => p.resent));
  const modeFindings = rows.filter((f) => MODE_CHECKS.has(f.check) && !f.accepted && ids.get(f)).map((f) => findingLink(f)).join(" ");
  const none = !runs.length ? m.ui.md.consentNotChecked : m.ui.md.consentModeNone;
  const modeBody = withDefault.length
    ? `${timing ? `<ul class="cm-timing">${timing}</ul>` : ""}${groupHtml}${resent ? `<p class="xs muted cm-rep">${use("ui-clock", 12)} ${esc(t.resent(resent))}</p>` : ""}${modeFindings ? `<p class="xs cm-find">${modeFindings}</p>` : ""}`
    : `<p class="muted xs">${esc(none)}</p>${modeFindings ? `<p class="xs cm-find">${modeFindings}</p>` : ""}`;
  const modeCard = `<details class="card" id="consent-mode"><summary><span class="t">${esc(m.html.consentMode)}</span>${modeHead}${modeChips}<span class="end muted xs">${esc(t.runsWith(withDefault.length, runs.length))}</span></summary><div class="body">${modeBody}</div></details>`;

  /* ---- scenarios ---- */
  if (!sc) return sectionBlock("consent", esc(m.html.shell.sections.consent), `${list}\n${modeCard}\n<p class="muted xs cs-none" id="consent-scenarios">${esc(m.ui.md.noScenarios)}</p>`);
  const table = consentTable(sc);
  const cols = table.cols.filter((s) => s !== "analytics" || sc.states?.analytics?.via);
  const before = rows.filter((f) => f.check === "before_consent" && !f.accepted);
  const problemRow = (platform, event) => rows.find((f) => f.platform === platform && f.event === event && !f.accepted && /^(after_reject|before_consent)$/.test(f.check));
  const reasonOf = (c) => (c.cookieless >= c.n ? m.html.cellCookieless : c.adDenied >= c.n ? m.html.cellAdDenied : m.html.cellWithCookies);
  let problemCount = 0;
  const cellHtml = (r, cell) => {
    const after = afterOf(sc, cell.state);
    if (!after || cell.count === null) return `<td class="muted">–<span class="sr"> ${esc(m.ui.scenarioNotRun)}</span></td>`;
    const c = after[r.platform]?.[r.event];
    if (!c?.n) return `<td class="muted">0</td>`;
    const state = stateOf(r.platform, c);
    const reason = reasonOf(c);
    const flagged = cell.problem || (cell.state === "before" && before.some((f) => f.platform === r.platform && f.event === r.event));
    const body = `<b class="num">${c.n}</b><span title="${esc(reason)}">${stateChip(state)}</span><span class="sr"> ${esc(reason)}</span>`;
    if (!flagged) return `<td><span class="cs-c">${body}</span></td>`;
    problemCount++;
    const f = problemRow(r.platform, r.event);
    return `<td class="cs-bad"><span class="cs-c">${body}${badge(f?.severity ?? "risk", t.sent)}<span class="sr"> ${esc(m.html.cellProblem)} ${esc(m.html.cellShouldNot)}</span>${findingLink(f)}</span></td>`;
  };
  const body = table.rows.map((r) => `<tr><th scope="row"><span class="cs-tag">${platChip(r.platform)}<code>${esc(r.event)}</code></span></th>${cols.map((s) => cellHtml(r, r.cells.find((c) => c.state === s))).join("")}</tr>`).join("");
  const supported = (s) => (s === "before" ? true : Boolean(sc.states?.[s]?.after));
  const summaryChips = SCENARIOS.map((s) => (supported(s) ? plain(esc(t.cols[s])) : chip("consent", "none", esc(`${t.cols[s]} · ${t.notSupported}`)))).join("");
  const probChip = problemCount ? sevChip("risk", t.problems(problemCount)) : sevChip("ok", t.noProblems);
  const scenarios = `<details class="card" id="consent-scenarios"><summary><span class="t">${esc(t.scenarios)}</span>${summaryChips}<span class="end">${probChip}</span></summary><div class="body"><div class="tscroll"><table class="tbl cs-tbl"><caption class="sr">${esc(m.ui.scenarios)}</caption><thead><tr><th scope="col">${esc(m.ui.scenarioTag)}</th>${cols.map((s) => `<th scope="col">${esc(t.cols[s])}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div></div></details>`;
  return sectionBlock("consent", esc(m.html.shell.sections.consent), `${list}\n${modeCard}\n${scenarios}`);
}
