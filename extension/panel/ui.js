// Small DOM helpers the views share: element building, the icon sprite, times, copying, toasts, the ⓘ tooltip and
// the polite live region. Strings come from the callers; nothing here is user-visible text of its own.
import { state, m } from "./state.js";

export const $ = (id) => document.getElementById(id);

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
  use.setAttribute("href", `#${name}`);
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
export const since = (t, from) => `+${secs(t, from)}s`;
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

// ---------- the ⓘ tooltip ----------

let tipEl = null;
let tipFor = null;
let pinned = false;
let hoverTimer = null;
export function closeTip() {
  tipEl?.remove();
  tipEl = null;
  tipFor?.classList.remove("act");
  tipFor?.removeAttribute("aria-describedby");
  tipFor = null;
  pinned = false;
}
function openTip(btn, content) {
  closeTip();
  tipFor = btn;
  btn.classList.add("act");
  tipEl = el("div", { class: "tip below", role: "tooltip", id: "tip" }, content());
  btn.setAttribute("aria-describedby", "tip");
  document.body.append(tipEl);
  const r = btn.getBoundingClientRect();
  const w = Math.min(250, window.innerWidth - 16);
  tipEl.style.width = `${w}px`;
  const left = Math.max(8, Math.min(r.left - 14, window.innerWidth - w - 8));
  tipEl.style.left = `${left}px`;
  let top = r.bottom + 8;
  if (top + tipEl.offsetHeight > window.innerHeight - 8) { top = r.top - tipEl.offsetHeight - 8; tipEl.className = "tip above"; }
  tipEl.style.top = `${top}px`;
  tipEl.style.setProperty("--arrow", `${r.left - left + 2}px`);
}
/**
 * The ⓘ button next to a parameter label. Hover (after 300 ms) and keyboard focus open it, a click pins it until Esc,
 * an outside click or another ⓘ.
 */
export function infoButton(key, content) {
  const b = el("button", { class: "ii", type: "button", "aria-label": m().params.about(key), text: "i" });
  b.addEventListener("mouseenter", () => { if (!pinned) hoverTimer = setTimeout(() => openTip(b, content), 300); });
  b.addEventListener("mouseleave", () => { clearTimeout(hoverTimer); if (!pinned && tipFor === b) closeTip(); });
  b.addEventListener("focus", () => { if (!pinned) openTip(b, content); });
  b.addEventListener("blur", () => { if (!pinned && tipFor === b) closeTip(); });
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    if (pinned && tipFor === b) return closeTip();
    openTip(b, content);
    pinned = true;
  });
  return b;
}
document.addEventListener("click", (e) => { if (pinned && tipEl && !tipEl.contains(e.target)) closeTip(); });

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
