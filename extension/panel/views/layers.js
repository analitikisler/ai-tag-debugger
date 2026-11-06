// What floats over the panel: the ⋯ menu, the Start over sheet, the keyboard shortcut sheet, and the not-a-website
// empty state with its recent sites.
import { state, m, render, actions } from "../state.js";
import { el, icon, button, favicon, day } from "../ui.js";

function trap(node) {
  // Focus stays inside a modal sheet: Tab from the last control goes to the first and back.
  node.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const f = [...node.querySelectorAll("button, input, [tabindex='0']")].filter((x) => !x.disabled);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });
  return node;
}

export function menu() {
  const t = m().menu;
  const ob = m().onboarding;
  const item = (ico, label, run, right = null, kbd = null) => el("button", { class: "mi", type: "button", role: "menuitem", onclick: () => { state.layer = null; run(); } },
    icon(ico), label, right ? el("span", { class: "r", text: right }) : null, kbd ? el("span", { class: "kbd", text: kbd }) : null);
  const langs = Object.keys(m().languages);
  const themes = ["system", "light", "dark"];
  return [el("div", { class: "scrim", style: { background: "transparent" }, onclick: () => { state.layer = null; render(); } }),
    el("div", { class: "menu", role: "menu", "aria-label": t.label, style: { position: "fixed" } },
      item("restart", m().startOver, () => actions.askStartOver(), null, "Alt N"),
      item("filter", t.platforms, () => actions.toSetup()),
      item("list", t.history, () => actions.showTab("history")),
      el("div", { class: "sep" }),
      item("globe", ob.language, () => actions.setLang(langs[(langs.indexOf(state.lang) + 1) % langs.length]), m().languages[state.lang]),
      item("moon", ob.theme, () => actions.setTheme(themes[(themes.indexOf(state.theme) + 1) % themes.length]), m().theme[state.theme]),
      item("eye-off", t.mask, () => actions.setMask(!state.mask), state.mask ? t.on : t.off),
      el("div", { class: "sep" }),
      item("keyboard", t.shortcuts, () => { state.layer = { kind: "shortcuts" }; render(); }, null, "?"),
      item("help", t.tour, () => actions.tourTo(0)),
      item("ext", t.window, () => actions.openWindow()))];
}

export function resetSheet() {
  const r = m().reset;
  const live = Boolean(state.live);
  const model = actions.model();
  const hits = model.rows.filter((x) => x.kind === "hit").length;
  const opt = (id, label, help, checked) => el("label", { class: "opt", for: id }, el("input", { id, type: "checkbox", checked }), el("span", { class: "cb" }, icon("check")),
    el("span", {}, el("b", { text: label }), el("span", { class: "small", text: help })));
  const sheet = trap(el("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-labelledby": "resetTitle" },
    el("h2", { class: "h2", id: "resetTitle", text: live ? r.titleLive : r.title }),
    el("p", { class: "p", style: { fontSize: "var(--fs-s)" }, text: r.body }),
    el("div", { style: { marginTop: "12px" } }, opt("resetKeep", r.keep, r.keepHelp(hits, model.steps.length), true), opt("resetCookies", r.cookies, r.cookiesHelp, state.setup.clear)),
    el("div", { class: "acts" }, button(r.cancel, () => { state.layer = null; render(); }, { cls: "btn", id: "resetCancel" }),
      button(m().startOver, () => actions.startOver({ keep: document.getElementById("resetKeep").checked, clearCookies: document.getElementById("resetCookies").checked }), { cls: "btn primary", ico: "restart", id: "resetGo" }))));
  return [el("div", { class: "scrim", onclick: () => { state.layer = null; render(); } }), sheet];
}

export function shortcutsSheet() {
  const sheet = trap(el("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-labelledby": "keysTitle" },
    el("h2", { class: "h2", id: "keysTitle", text: m().menu.shortcuts }),
    el("table", { class: "keys" }, m().shortcuts.map(([k, v]) => el("tr", {}, el("td", {}, el("span", { class: "kbd", text: k })), el("td", { text: v })))),
    el("div", { class: "acts" }, button(m().close, () => { state.layer = null; render(); }, { cls: "btn primary" }))));
  return [el("div", { class: "scrim", onclick: () => { state.layer = null; render(); } }), sheet];
}

export function notWebView() {
  const e = m().errors;
  const sites = [];
  const seen = new Set();
  for (const r of state.history.list) {
    if (!r.stoppedAt || seen.has(r.host)) continue;
    seen.add(r.host);
    sites.push(r);
    if (sites.length === 5) break;
  }
  const tone = (r) => (r.summary?.status === "pass" ? "ok" : r.summary?.status === "fail" ? "broken" : "warning");
  return el("div", { class: "empty" },
    el("div", { class: "ill" }, icon("globe")),
    el("h2", { class: "h2", text: e.notWebTitle }),
    el("p", { class: "p", style: { marginTop: "6px", fontSize: "var(--fs-s)" }, text: e.notWebBody(m().name) }),
    sites.length ? el("div", { class: "recent" }, el("h3", { class: "h3", text: e.recent }),
      sites.map((r) => el("button", { class: "rr", type: "button", style: { width: "100%", border: 0, borderBottom: "1px solid var(--line)", background: "none", cursor: "pointer", textAlign: "left" }, onclick: () => actions.openSite(r) },
        favicon(r.site, 18), el("span", { class: "g", text: r.host }),
        r.summary?.score != null ? el("span", { class: `score-chip ${tone(r)}`, text: String(r.summary.score) }) : null,
        el("span", { class: "small", text: day(r.startedAt) })))) : null);
}
