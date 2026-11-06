// Setup (state "ready"): which platforms are being tested, the measurement plan, the start options and Start
// recording. The selection and the plan are remembered per site; Start asks for site access from the click.
import { state, m, actions } from "../state.js";
import { el, icon, button } from "../ui.js";
import { PLATFORM_GROUPS } from "../model.js";
import { PROVIDERS } from "../../core/parsers.js";

// Clarity is called by its short name in the picker, as the people who use it do.
export const platformName = (key) => (key === "clarity" ? "Clarity" : PROVIDERS[key] ?? key);

function pick(key) {
  const on = state.setup.platforms.includes(key);
  const detected = state.setup.detected.includes(key);
  return el("button", {
    class: `pick${on ? " on" : ""}`, type: "button", "aria-pressed": String(on), "data-platform": key,
    onclick: () => actions.togglePlatform(key),
  }, el("span", { class: "bx" }, on ? icon("check") : null), platformName(key), detected ? el("span", { class: "det", text: m().setup.onPage }) : null);
}

function planSection() {
  const t = m().setup;
  const input = el("input", { id: "planFile", type: "file", accept: ".json,application/json", hidden: true, onchange: async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await actions.loadPlanFile(file);
  } });
  const plan = state.setup.plan;
  let body;
  if (plan) {
    body = el("div", { class: "file" },
      el("span", { class: "ficon" }, icon("file")),
      el("div", { class: "fn" }, el("b", { text: plan.name }), el("span", { class: "small", text: t.planCard(plan.plan.events.length) })),
      el("label", { class: "btn ghost", for: "planFile", tabindex: "0", text: t.change, onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } } }),
      button("", () => actions.removePlan(), { cls: "btn ghost icon", ico: "x", title: t.remove }));
    body.lastChild.setAttribute("aria-label", t.remove);
  } else {
    body = el("div", { class: "drop" },
      el("span", { class: "ficon", style: { color: "var(--fg-3)" } }, icon("file", "l")),
      el("span", { class: "small", style: { flex: 1 }, text: t.drop }),
      el("label", { class: "btn", for: "planFile", tabindex: "0", text: t.chooseFile, onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } } }));
    body.addEventListener("dragover", (e) => { e.preventDefault(); body.classList.add("over"); });
    body.addEventListener("dragleave", () => body.classList.remove("over"));
    body.addEventListener("drop", async (e) => {
      e.preventDefault();
      body.classList.remove("over");
      const file = e.dataTransfer?.files?.[0];
      if (file) await actions.loadPlanFile(file);
    });
  }
  return el("section", { class: "setup-sec" },
    el("h2", { class: "h3" }, `2 · ${t.q2} `, el("span", { style: { textTransform: "none", letterSpacing: 0, fontWeight: 400, color: "var(--fg-3)" }, text: t.optional })),
    input, body,
    state.setup.planError ? el("div", { class: "note danger", role: "alert" }, icon("warn"), el("span", { text: m()[state.setup.planError] ?? state.setup.planError })) : null,
    el("p", { class: "small", style: { marginTop: "8px" }, text: t.planHelp }));
}

function option(id, label, help, checked, onchange) {
  return el("label", { class: "opt", for: id },
    el("input", { id, type: "checkbox", checked, onchange: (e) => onchange(e.target.checked) }),
    el("span", { class: "cb" }, icon("check")),
    el("span", {}, el("b", { text: label }), el("span", { class: "small", text: help })));
}

export function setupView() {
  const t = m().setup;
  const s = state.setup;
  const e = m().errors;
  const denied = s.denied ? el("div", { class: "setup-sec", style: { borderBottom: 0, paddingBottom: 0 } },
    el("div", { class: "note danger", role: "alert", style: { marginTop: 0 } }, icon("lock"),
      el("div", {}, el("b", { style: { display: "block", color: "var(--fg)" }, text: e.deniedTitle }), el("span", { text: e.deniedBody(m().name) }),
        el("div", { class: "acts" }, button(m().onboarding.allow, () => actions.askAccess(), { cls: "btn primary" }), button(e.why, () => actions.tourTo(2), { cls: "linkbtn muted" }))))) : null;
  const platforms = el("section", { class: "setup-sec" },
    el("div", { class: "row" }, el("h2", { class: "h3", text: `1 · ${t.q1}` }),
      s.detected.length ? button(t.selectDetected, () => actions.selectDetected(), { cls: "linkbtn" }) : null),
    PLATFORM_GROUPS.map(([group, keys]) => el("div", { class: "grp", role: "group", "aria-label": t.groups[group] }, el("div", { class: "gl", text: t.groups[group] }), el("div", { class: "picks" }, keys.map(pick)))),
    s.platforms.length ? null : el("p", { class: "hintline", role: "status", text: t.pickOne }),
    el("div", { class: "note" }, icon("info"), el("span", { text: t.note })));
  const options = el("section", { class: "setup-sec" },
    option("optReload", t.reload, t.reloadHelp, s.reload, (v) => actions.setOption("reload", v)),
    option("optClear", t.clear, t.clearHelp, s.clear, (v) => actions.setOption("clear", v)));
  const start = el("button", { id: "record", class: "btn rec lg block", type: "button", disabled: !s.platforms.length, onclick: () => actions.start() },
    el("span", { class: "dotw" }), t.start, el("span", { class: "kbd", text: "Alt R" }));
  return el("div", { class: "setup" }, denied, platforms, planSection(), options,
    el("div", { class: "cta" }, start, el("p", { class: "small summary-line", text: t.summary(s.platforms.length, s.plan ? s.plan.plan.events.length : null) })));
}
