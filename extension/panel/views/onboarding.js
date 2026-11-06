// First-run onboarding, three screens: what the panel does, language and look, and the site access Chrome will ask
// for. Replayable from ⋯ › Show the tour. Skip and Allow access both lead to setup.
import { state, m, actions } from "../state.js";
import { el, icon, button } from "../ui.js";
import { messages } from "../../core/i18n.js";

const SITES = { origins: ["http://*/*", "https://*/*"] };

function brand() {
  return el("div", { class: "brand" }, el("span", { class: "logo" }, el("i")), m().name, el("span", { class: "tag", text: `· ${m().label}` }));
}

function seg(options, value, onpick, label) {
  return el("div", { class: "seg", role: "group", "aria-label": label },
    options.map(([v, text]) => el("button", { type: "button", "aria-pressed": String(v === value), text, onclick: () => onpick(v) })));
}

export function onboardingView() {
  const t = m().onboarding;
  const step = state.tour ?? 0;
  const dots = el("div", { class: "dots", style: { marginBottom: "18px" }, "aria-hidden": "true" }, [0, 1, 2].map((i) => el("i", { class: i <= step ? "on" : null })));
  const title = (text) => el("h1", { class: "h1", tabindex: "-1", id: "obTitle", text });
  let body;
  let next;
  if (step === 0) {
    body = [title(t.title1), el("p", { class: "p", style: { marginTop: "8px" }, text: t.body1(m().name) }),
      el("ol", { class: "flow", style: { listStyle: "none", padding: 0 } }, t.steps.map(([h, s], i) => el("li", { class: "fs" }, el("div", { class: "num", text: String(i + 1) }), el("div", {}, el("b", { text: h }), el("span", { text: s })))))];
    next = button(t.next, () => actions.tourTo(1), { cls: "btn primary lg", id: "obNext" });
  } else if (step === 1) {
    body = [title(t.title2), el("p", { class: "p", style: { marginTop: "8px" }, text: t.body2 }),
      // The heading names the setting in the other language too, for someone who can't read the current one.
      el("h2", { class: "h3", text: `${t.language} · ${messages(state.lang === "tr" ? "en" : "tr").extension.onboarding.language}` }),
      seg([["en", m().languages.en], ["tr", m().languages.tr]], state.lang, (v) => actions.setLang(v), t.language),
      el("h2", { class: "h3", text: t.theme }),
      seg(["system", "light", "dark"].map((v) => [v, m().theme[v]]), state.theme, (v) => actions.setTheme(v), t.theme),
      el("h2", { class: "h3", text: t.privacy }),
      el("label", { class: "opt" }, el("input", { type: "checkbox", checked: state.mask, onchange: (e) => actions.setMask(e.target.checked) }), el("span", { class: "cb" }, icon("check")),
        el("span", {}, el("b", { text: t.mask }), el("span", { class: "small", text: t.maskHelp })))];
    next = button(t.next, () => actions.tourTo(2), { cls: "btn primary lg", id: "obNext" });
  } else {
    body = [title(t.title3), el("p", { class: "p", style: { marginTop: "8px" }, text: t.body3(m().name) }),
      el("div", { class: "perm-list" }, t.points.map((p) => el("div", {}, icon("check"), el("span", { text: p })))),
      el("div", { class: "chrome-mock" }, el("div", { class: "small", text: t.chromeSays }), el("b", { style: { display: "block", margin: "6px 0 4px" }, text: t.chromeWants(m().name) }), el("div", { class: "p", text: t.chromePrompt }))];
    next = button(t.allow, async () => {
      // Asked from the click, as Chrome requires.
      const granted = await chrome.permissions.request(SITES).catch(() => false);
      await actions.finishTour(granted);
    }, { cls: "btn primary lg", id: "obNext" });
  }
  return el("div", { class: "ob", role: "dialog", "aria-modal": "false", "aria-labelledby": "obTitle" },
    el("div", { class: "ob-top" }, brand(), button(t.skip, () => actions.finishTour(null), { cls: "btn ghost", id: "obSkip" })),
    el("div", { class: "ob-body" }, dots, body),
    el("div", { class: "ob-foot" }, step > 0 ? button(t.back, () => actions.tourTo(step - 1), { cls: "btn" }) : el("span", { class: "small", text: t.local }), next));
}

export { SITES };
