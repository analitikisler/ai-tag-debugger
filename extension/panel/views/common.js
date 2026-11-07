// Pieces several tabs share: the step header, platform badges, consent words, and the per-row summary sentence.
import { state, m, render } from "../state.js";
import { el, icon, pathOf, since, upper } from "../ui.js";
import { BADGE, itemsTotal } from "../model.js";
import { CONSENT_SIGNALS } from "../../core/parsers.js";

export const badge = (platform, small = false) => el("span", { class: `pb ${platform in BADGE ? platform : "other"}`, style: small ? { minWidth: "0", height: "16px", fontSize: "9px", padding: "0 4px" } : null, text: BADGE[platform] ?? m().events.other });
export const GOOGLE = new Set(["ga4", "google_ads"]);

/** A page title without the site name after it: "Lina Yemek Masası | Örnek Mobilya" → "Lina Yemek Masası". */
// One rule for the panel and the report: the run builder names steps after the same cleaned title.
import { cleanTitle } from "../../lib/run.js";
export { cleanTitle };

/** The step's title, path and kind, as the step header and the findings' location chips show them. */
export function stepInfo(step) {
  const k = m().events.kinds;
  const path = step.url ? pathOf(step.url) : "";
  const title = step.action === "manual" ? step.label : step.action === "start" ? k.start : cleanTitle(step.title) || path || step.label;
  return { title, path: step.action === "manual" || step.action === "start" || title === path ? "" : path, kind: k[step.action] ?? "", named: step.action === "manual" };
}

/** The 18 px step badge: filled for a step the user named, outlined for one the page made. */
export const stepNo = (step) => el("span", { class: `sno${step.action === "manual" ? " named" : ""}`, text: String(step.index + 1) });

/** A collapsible step: sticky header with its count and status, then its children. */
export function stepBlock(step, { collapsed, count, countClass, onToggle, children, status = true }) {
  const info = stepInfo(step);
  const st = step.docStatus;
  const sc = status && step.action === "navigate" && typeof st === "number" ? el("span", { class: `sc${st >= 400 ? " bad" : st >= 300 ? " redir" : ""}`, text: String(st) }) : null;
  const head = el("div", {
    class: "step-h", role: "treeitem", "aria-level": "1", "aria-expanded": String(!collapsed), tabindex: "-1", "data-step": String(step.index), title: step.url ?? null,
    onclick: onToggle,
  },
  el("span", { class: "chev" }, icon("chev-d")), stepNo(step),
  el("span", { class: "step-title" }, el("b", { text: info.title }), info.path ? el("span", { class: "path", text: info.path }) : null, info.kind ? el("span", { class: "kind", text: info.kind }) : null),
  el("span", { class: `step-meta${countClass ? ` ${countClass}` : ""}`, text: count }), sc);
  return el("div", { class: `step${collapsed ? " collapsed" : ""}`, role: "none" }, head, collapsed ? null : el("div", { role: "group" }, children));
}

/** "all denied" / "all granted" / "ad_storage, ad_user_data denied; analytics_storage granted". */
export function consentWords(signals) {
  const t = m().events;
  const keys = CONSENT_SIGNALS.filter((k) => k in signals);
  const denied = keys.filter((k) => signals[k] === "denied");
  const granted = keys.filter((k) => signals[k] === "granted");
  if (keys.length && !granted.length) return t.allDenied;
  if (keys.length && !denied.length) return t.allGranted;
  return t.someDenied(denied.join(", "), granted.join(", "));
}

/** A Granted / Denied / Not set pill: icon, word and colour together. */
export function statePill(value) {
  const d = m().detail;
  const [cls, ico, word] = value === "granted" ? ["g", "check", d.granted] : value === "denied" ? ["d", "x", d.denied] : ["u", null, d.unset];
  return el("span", { class: `cs ${cls}` }, ico ? icon(ico) : el("span", { text: "–" }), word);
}

/** Whether a hit went out while the visitor had not allowed what it needs. */
export function sentBeforeConsent(row) {
  if (!row.hit || !row.consentAt || !row.beforeGrant) return false;
  if (GOOGLE.has(row.platform)) return row.consentAt.ad_storage === "denied" && Object.values(row.hit.consent ?? {}).some((v) => v === "granted");
  return row.consentAt.ad_storage === "denied";
}
export const cookieless = (row) => GOOGLE.has(row.platform) && row.hit?.consent && Object.values(row.hit.consent).every((v) => v !== "granted");

const wire = (row, key) => row.wire?.find(([k]) => k === key)?.[1];

/** The most useful fact about a row, for its summary (§5.3): items and value, the path, the conversion, the consent. */
export function summaryOf(row, match) {
  const t = m().events;
  if (row.kind === "call") return { text: row.callKind ? t.setCookie : [row.vendor, row.en].filter(Boolean).join(" · ") };
  if (match) return { text: t.matched(match), cls: "match" };
  if (row.auto) return { text: t.auto };
  if (sentBeforeConsent(row)) return { text: t.beforeConsent, cls: "risk" };
  const p = row.hit.params ?? {};
  const gcs = wire(row, "gcs");
  if (cookieless(row) && row.consentAt?.ad_storage === "denied") return { text: [t.cookieless, gcs].filter(Boolean).join(" · ") };
  if (row.items.length) {
    const value = p.value ?? wire(row, "epn.value");
    const second = value !== undefined ? `${value} ${p.currency ?? ""}`.trim() : p.item_list_name ?? "";
    return { text: [t.items(row.items.length), second].filter(Boolean).join(" · ") };
  }
  if (row.platform === "google_ads") return { text: [p.label, row.hit.id ? `AW-${row.hit.id}` : null].filter(Boolean).join(" · ") };
  if (p.value !== undefined) return { text: `${p.value} ${p.currency ?? ""}`.trim() };
  const dl = wire(row, "dl") ?? p.page_location ?? wire(row, "url");
  if (dl) return { text: pathOf(dl) };
  if (gcs && GOOGLE.has(row.platform)) return { text: gcs };
  return { text: "" };
}

/** The hit's value against its items' total, for the Items card's check line. */
export const valueCheck = (row) => {
  const v = Number(row.hit?.params?.value);
  const total = itemsTotal(row.items);
  return Number.isFinite(v) && total !== null ? { value: v, total, ok: Math.abs(v - total) <= 0.01 } : null;
};

/** A section card with an uppercase heading, a count and a right-hand note; collapsible when key is given. */
export function card(title, { count = null, right = null, key = null, openDefault = true, body }) {
  const open = key ? (state.openSecs.has(key) ? true : state.openSecs.has(`!${key}`) ? false : openDefault) : true;
  const toggle = () => {
    state.openSecs.delete(key);
    state.openSecs.delete(`!${key}`);
    state.openSecs.add(open ? `!${key}` : key);
    render();
  };
  const head = key
    ? el("button", { class: "sec-h toggle", type: "button", "aria-expanded": String(open), onclick: toggle }, el("span", { class: "chev" }, icon("chev-d", "s")), upper(title), count !== null ? el("span", { class: "c", text: String(count) }) : null, right ? el("span", { class: "r" }, right) : null)
    : el("div", { class: "sec-h" }, upper(title), count !== null ? el("span", { class: "c", text: String(count) }) : null, right ? el("span", { class: "r" }, right) : null);
  return el("section", { class: `sec${open ? "" : " closed"}` }, head, open ? (typeof body === "function" ? body() : body) : null);
}

export { since };
