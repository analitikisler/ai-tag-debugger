// Small DOM helpers the views share: element building, the icon sprite, times, copying, toasts, the ⓘ tooltip and
// the polite live region. Strings come from the callers; nothing here is user-visible text of its own.
import { state, m, render } from "./state.js";

export const $ = (id) => document.getElementById(id);

let soon = null;
/** A render after typing pauses (120 ms), so a long list is filtered once per word, not once per key. */
export function renderSoon() {
  clearTimeout(soon);
  soon = setTimeout(render, 120);
}

/** An element: attributes (class, text, on* handlers, data-*, aria-*), then children (nodes, strings, arrays, null). */
export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) n.append(c);
  return n;
}

const SVG = "http://www.w3.org/2000/svg";
/** An icon from the sprite in panel.html. size: "s" (12 px), "" (14 px) or "l" (18 px). */
export function icon(name, size = "") {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", `i ${size}`.trim());
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG, "use");
  // Sprite ids carry an "i-" prefix so they never clash with an element id (an input called "search").
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

export const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
export const pathOf = (url) => { try { const u = new URL(url); return u.pathname + (u.search ? "?…" : ""); } catch { return url ?? ""; } };
export const isWeb = (url) => /^https?:\/\//.test(url ?? "");
export const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => ({}));

/** m:ss for a duration. */
export const clock = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
/** Seconds since a moment, one decimal, the way rows are timed within their step. */
export const secs = (t, from) => Math.max(0, (t - from) / 1000).toFixed(1);
/** "+2.3s", or "+12 ms" under a second: a page load's hits all land in its first second, where tenths say nothing. */
export const since = (t, from) => {
  const ms = Math.max(0, Math.round(t - from));
  return ms < 1000 ? m().units.ms(ms) : m().units.s(secs(t, from));
};
export const locale = () => (state.lang === "tr" ? "tr-TR" : "en-GB");
/** Today 14:32 / Yesterday 11:05 / 5 Nov 17:48 in the panel's language. */
export function when(t) {
  const d = new Date(t);
  const time = d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  const day = (x) => new Date(x).toDateString();
  if (day(t) === day(Date.now())) return `${m().history.today} ${time}`;
  if (day(t) === day(Date.now() - 864e5)) return `${m().history.yesterday} ${time}`;
  return `${d.toLocaleDateString(locale(), { day: "numeric", month: "short" })} ${time}`;
}
/** Today / Yesterday / 5 Nov, for lists that only need the day. */
export function day(t) {
  const same = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  if (same(t, Date.now())) return m().history.today;
  if (same(t, Date.now() - 864e5)) return m().history.yesterday;
  return new Date(t).toLocaleDateString(locale(), { day: "numeric", month: "short" });
}
/** Uppercase for section headings in the panel's language ("ÜRÜNLER", never "İTEMS"). */
export const upper = (s) => String(s).toLocaleUpperCase(state.lang === "tr" ? "tr" : "en");

export function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

let toastTimer = null;
/** A short message at the bottom; with an action, a button in it (Undo). */
export function toast(text, action = null, ms = 2000) {
  document.querySelector(".toast")?.remove();
  clearTimeout(toastTimer);
  const t = el("div", { class: "toast", role: "status" }, el("span", { text }), action ? el("button", { class: "linkbtn", type: "button", text: action.label, onclick: () => { t.remove(); action.run(); } }) : null);
  document.body.append(t);
  toastTimer = setTimeout(() => t.remove(), ms);
}

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); } catch {
    // Clipboard access can be refused in a popup window; a hidden textarea still works there.
    const ta = el("textarea", { style: { position: "fixed", opacity: "0" } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast(m().detail.copied);
}

/** A button with an icon and a label. */
export const button = (label, onclick, { cls = "btn", ico = null, id = null, kbd = null, title = null, type = "button", disabled = false } = {}) =>
  el("button", { class: cls, type, id, title, disabled, onclick }, ico ? icon(ico) : null, label, kbd ? el("span", { class: "kbd", text: kbd }) : null);

// ---------- the ⓘ explanation ----------

/**
 * The ⓘ button next to a parameter label. It opens the explanation inline, under its own row, so it never covers
 * other rows; a click or Enter toggles it, Esc closes it. id names the row (the hit and the key).
 */
export function infoButton(key, id) {
  const open = state.tipOpen === id;
  return el("button", { class: `ii${open ? " act" : ""}`, type: "button", "aria-label": m().params.about(key), "aria-expanded": String(open), "aria-controls": open ? "tipline" : null, text: "i",
    onclick: (e) => { e.stopPropagation(); state.tipOpen = open ? null : id; render(); } });
}
export function closeTip() {
  if (state.tipOpen) { state.tipOpen = null; render(); }
}

/** A one-time hint next to the control it explains; any click or key dismisses it. */
export function coachMark(anchor, text) {
  const r = anchor.getBoundingClientRect();
  const tip = el("div", { class: "hinttip", role: "status", style: { left: `${Math.max(8, r.left)}px`, bottom: `${window.innerHeight - r.top + 8}px`, maxWidth: `${Math.min(260, r.width)}px` }, text });
  document.body.append(tip);
  const done = () => { tip.remove(); document.removeEventListener("pointerdown", done, true); document.removeEventListener("keydown", done, true); };
  setTimeout(() => { document.addEventListener("pointerdown", done, true); document.addEventListener("keydown", done, true); }, 0);
  setTimeout(done, 8000);
}

// ---------- the live region ----------

let lastSaid = 0;
let pendingCount = 0;
let sayTimer = null;
/** "3 new events", at most once every 5 s, so a screen reader is told without being flooded. */
export function announceNew(n) {
  pendingCount += n;
  const sayNow = () => {
    const live = $("live");
    if (live) live.textContent = m().events.jump(pendingCount);
    pendingCount = 0;
    lastSaid = Date.now();
    sayTimer = null;
  };
  if (sayTimer) return;
  const wait = Math.max(0, 5000 - (Date.now() - lastSaid));
  sayTimer = setTimeout(sayNow, wait);
}

/** A stable hue per host for the letter favicon. */
export function hueOf(host) {
  let h = 0;
  for (const c of String(host)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
/** The site's favicon through Chrome's _favicon service, falling back to its first letter on a coloured square. */
export function favicon(url, size = 20, hasIcon = false) {
  const host = hostOf(url);
  const box = el("span", { class: "fav", style: { width: `${size}px`, height: `${size}px`, background: `hsl(${hueOf(host)} 45% 38%)` }, "aria-hidden": "true" }, (host[0] ?? "?").toLocaleUpperCase(state.lang));
  // Chrome's favicon service answers with a generic globe for a site without an icon; the letter says more.
  if (isWeb(url) && hasIcon) {
    const img = el("img", { src: chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`), alt: "", width: size, height: size });
    img.addEventListener("load", () => { box.textContent = ""; box.style.background = "transparent"; box.append(img); });
  }
  return box;
}
