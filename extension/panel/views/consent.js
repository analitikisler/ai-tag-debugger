// The Consent tab (§7): what the visitor chose (state, in words) and whether the tags obeyed (compliance, per
// platform in sentences) are two separate questions, answered in two separate places. Never "OK" or "mixed".
import { state, m, actions } from "../state.js";
import { el, icon, button, upper } from "../ui.js";
import { consentReport, routesOf } from "../model.js";
import { CONSENT_SIGNALS, PROVIDERS } from "../../core/parsers.js";
import { card, consentWords, statePill } from "./common.js";

// The cookies the "no ids stored" sentence names per Google platform.
const STORAGE_NAMES = { ga4: "_ga", google_ads: "_gcl_*" };

const at = (model, c) => ({ step: c.step + 1, time: ((c.t - (model.steps[c.step]?.t ?? c.t)) / 1000).toFixed(1) });

/** The Consent tab's dot: ok (nothing sent against consent), bad (something was) or none (no consent mode seen). */
export function consentDot(model) {
  const r = consentReport(model, model.chosen);
  if (r.platforms.some((p) => p.verdict === "violated")) return "bad";
  // Green only once something was checked: hits went out and the visitor answered (or the recording ended).
  // While the default is still denied and nothing broke it yet, there is nothing to call good.
  const hits = model.rows.some((x) => x.kind === "hit" && (!model.chosen || model.chosen.includes(x.platform)));
  if (!r.default || !hits || (state.live && !r.grantAt)) return "none";
  return "ok";
}

/** The updates that changed something: a CMP repeating the same choice on every page adds no column. */
function changes(r) {
  let cur = { ...(r.default?.signals ?? {}) };
  return r.updates.filter((u) => {
    const next = { ...cur, ...u.signals };
    const changed = Object.keys(next).some((k) => next[k] !== cur[k]);
    cur = next;
    return changed;
  });
}

function lead(model, r) {
  const p = leadText(model, r);
  if (r.default?.source !== "tag") return p;
  return [p, el("p", { class: "small", text: m().consent.fromTag })];
}

function leadText(model, r) {
  const c = m().consent;
  if (!r.default) return el("p", { class: "lead" }, el("span", { class: "muted", text: c.none }));
  const s = r.default.summary;
  const first = r.updates[0];
  if (s === "denied" && !first) return el("p", { class: "lead", text: c.leadNoUpdate });
  if (s === "denied" && first?.summary === "granted") {
    const { step, time } = at(model, first);
    return el("p", { class: "lead" }, c.leadAcceptedParts(step, time).map((part, i) => (i === 1 ? el("em", { class: "d", text: part }) : i === 3 ? el("em", { class: "g", text: part }) : part)));
  }
  if (s === "granted") return el("p", { class: "lead", text: c.leadGranted });
  const parts = [s === "denied" ? c.leadDenied : c.leadPartlyWhat(consentWords(r.default.signals))];
  if (first) { const { step, time } = at(model, first); parts.push(" ", c.leadUpdated(step, time, consentWords(first.signals))); }
  return el("p", { class: "lead", text: parts.join("") });
}

function flowLine(model, r) {
  const c = m().consent;
  if (!r.default) return null;
  const pill = (summary) => (summary === "denied" ? statePill("denied") : summary === "granted" ? statePill("granted") : el("span", { class: "cs u", text: c.partly }));
  const label = (summary) => { const p = pill(summary); p.lastChild.textContent = summary === "denied" ? c.allDeniedPill : summary === "granted" ? c.allGrantedPill : c.partly; return p; };
  return el("div", { class: "flowline" }, c.default, label(r.default.summary),
    r.updates.slice(0, 3).map((u) => [el("span", { class: "arrow" }, icon("route", "s")), `${c.update} ${m().units.s(at(model, u).time)}`, label(u.summary)]));
}

function stateTable(model, r) {
  const c = m().consent;
  const d = m().detail;
  if (!r.default) return null;
  const cols = [r.default, ...r.updates.slice(0, 3)];
  // A signal keeps its value until an update changes it, so each column shows the state in force after that command.
  const states = [];
  let cur = {};
  for (const col of cols) { cur = { ...cur, ...col.signals }; states.push(cur); }
  const head = el("tr", {}, el("th", { text: c.signal }), cols.map((col, i) => el("th", {}, i ? c.update : c.default, el("small", { text: m().events.stepAt(at(model, col).step, at(model, col).time) }))));
  const body = CONSENT_SIGNALS.map((k) => el("tr", {}, el("td", { class: "sig" }, d.signals[k], el("span", { class: "w", text: k })), states.map((s) => el("td", {}, statePill(s[k])))));
  const others = ["functionality_storage", "personalization_storage", "security_storage"].filter((k) => cols.some((col) => k in col.signals));
  const otherLine = others.length ? el("tr", {}, el("td", { colspan: String(cols.length + 1), class: "small", text: `+ ${others.map((k) => {
    const vals = [...new Set(cols.map((col) => col.signals[k]).filter(Boolean))];
    return `${k} (${vals.map((v) => (v === "granted" ? d.granted : d.denied).toLocaleLowerCase(state.lang)).join(" → ")})`;
  }).join(", ")}` })) : null;
  const mis = r.mismatch ? el("tr", { class: "warnrow" }, el("td", { colspan: String(cols.length + 1), text: `⚠ ${c.mismatch(r.mismatch.signal, ((r.mismatch.row.t - model.steps[r.mismatch.row.step].t) / 1000).toFixed(1))}` })) : null;
  return card(c.state, { body: el("div", { style: { overflowX: "auto" } }, el("table", { class: "ct" }, el("thead", {}, head), el("tbody", {}, body, otherLine, mis))) });
}

function respect(model, r) {
  const c = m().consent;
  const lines = r.platforms.map((p) => {
    const name = PROVIDERS[p.platform] ?? p.platform;
    if (p.verdict === "unknown") return el("div", { class: "resp" }, el("span", { class: "ri", style: { background: "var(--unset-tint)", color: "var(--unset)" }, text: "–" }), el("div", {}, el("b", { text: name }), el("div", { class: "sub", text: c.cantTell })));
    // The reasons behind the verdict, each as its own sentence, so "respected" says what it rests on.
    const kept = p.persisted ? c.persistedBody(p.persisted.cid, p.persisted.pages) : null;
    const stored = p.storedCookies?.length ? c.storedCookies(p.storedCookies.join(", ")) : null;
    const seeRow = (row) => (row ? [" ", button(c.seeHit, () => actions.showRow(row.key), { cls: "linkbtn" })] : null);
    if (p.verdict === "violated") {
      const first = p.violations[0];
      const title = first ? c.violated(name) : p.persisted ? c.persistedTitle(name) : c.storedTitle(name);
      const lead = first ? c.violatedBody(first.name, ((first.t - model.steps[first.step].t) / 1000).toFixed(1), p.violations.length, r.cookiesBefore.filter((ck) => owner(ck.name) === p.platform).map((ck) => ck.name).join(", ")) : null;
      const body = [lead, kept, stored].filter(Boolean).join(" ");
      return el("div", { class: "resp" }, el("span", { class: "ri bad" }, icon("x")), el("div", {}, el("b", { text: title }),
        el("div", { class: "sub" }, body, seeRow(first ?? p.persisted?.row))));
    }
    const evidence = [p.cookieless ? c.cookielessBody(p.cookieless) : c.nothingBefore];
    if (STORAGE_NAMES[p.platform]) evidence.push(c.noStoredCookies(STORAGE_NAMES[p.platform]));
    if (p.platform === "ga4" && p.cookieless) evidence.push(p.pageLoads > 1 ? c.freshIds(p.pageLoads) : c.onePageLoad);
    if (p.after) evidence.push(c.afterHits(p.after));
    return el("div", { class: "resp" }, el("span", { class: "ri ok" }, icon("check")), el("div", {}, el("b", { text: c.respected(name) }), el("div", { class: "sub", text: evidence.join(" ") })));
  });
  if (!lines.length) return null;
  const n = r.platforms.filter((p) => p.verdict === "violated").length;
  const right = !r.default ? el("span", { text: c.cantTell }) : n ? el("span", { style: { color: "var(--risk)" }, text: c.problems(n) }) : el("span", { style: { color: "var(--ok)" }, text: c.allRespected });
  return card(c.respect, { right, body: lines });
}

// Which platform a cookie belongs to, for the chip tooltips.
function owner(name) {
  if (/^_ga|^_gid|^FPID|^FPLC/.test(name)) return "ga4";
  if (/^_gcl|^FPGCL/.test(name)) return "google_ads";
  if (/^_fb[pc]$|^fr$/.test(name)) return "meta";
  if (/^_tt|^_ttp/.test(name)) return "tiktok";
  if (/^_cl[ck]|^_clsk/.test(name)) return "clarity";
  if (/^_hj/.test(name)) return "hotjar";
  if (/^_uet/.test(name)) return "microsoft_ads";
  if (/^_pin/.test(name)) return "pinterest";
  return null;
}

function cookieChips(list, bad, serverNames) {
  return el("div", { class: "cookies" }, list.map((c) => el("span", { class: `ck${bad ? " bad" : ""}`, title: PROVIDERS[owner(c.name)] ?? null }, `${c.name} · ${c.domain}`,
    serverNames.has(c.name) ? el("span", { class: "srv", text: m().consent.server }) : null)));
}

export function consentView(model) {
  const c = m().consent;
  const full = consentReport(model, model.chosen);
  const r = { ...full, updates: changes(full) };
  const routes = routesOf(model);
  const serverNames = new Set((routes?.blocks ?? []).flatMap((b) => b.cookies.map((ck) => ck.name)));
  const overline = [r.default || model.consent.length ? c.mode : null, model.cmp ? c.cmp(model.cmp) : null].filter(Boolean).join(" · ");
  const hero = el("div", { class: "c-hero" }, overline ? el("div", { class: "small", text: overline }) : null, lead(model, r), flowLine(model, r));
  const cookies = r.cookiesBefore.length || r.cookiesAfter.length ? el("section", { class: "sec" },
    el("div", { class: "sec-h" }, upper(c.cookiesBefore), el("span", { class: "c", text: String(r.cookiesBefore.length) })),
    r.cookiesBefore.length ? cookieChips(r.cookiesBefore, true, serverNames) : el("div", { class: "cookies small", text: "—" }),
    el("div", { class: "sec-h", style: { borderTop: "1px solid var(--line)" } }, upper(c.cookiesAfter), el("span", { class: "c", text: String(r.cookiesAfter.length) })),
    r.cookiesAfter.length ? cookieChips(r.cookiesAfter, false, serverNames) : el("div", { class: "cookies small", text: "—" })) : null;
  const gloss = card(c.gloss, { key: "consent-gloss", openDefault: false, body: el("div", { class: "gloss" }, c.glossLines.map(([b, rest]) => el("p", {}, el("b", { text: b }), ` ${rest}`))) });
  return el("div", { class: "consent-body", role: "region", "aria-label": m().tabs.consent }, hero, stateTable(model, r), respect(model, r), cookies, gloss);
}

