// The dataLayer tab (§6): every push by step, oldest first, with the hits it fired; gtm.* events hidden by default.
import { state, m, render, actions } from "../state.js";
import { el, icon, button, copy, since, upper, renderSoon } from "../ui.js";
import { fold } from "../model.js";
import { redactPush } from "../../core/redact.js";
import { PROVIDERS } from "../../core/parsers.js";
import { badge, stepBlock } from "./common.js";
import { stepCollapsed, toggleStep, orderToggle } from "./events.js";

const isGtm = (p) => /^gtm\./.test(String(p.name));
const shownValue = (v) => (state.mask ? redactPush(v).value : v);

/** The pushes after the search and the gtm.* switch, and how many gtm.* pushes the switch hides. */
function filtered(model) {
  const q = fold(state.dl.search).trim();
  const gtm = model.pushes.filter(isGtm).length;
  const list = model.pushes.filter((p) => !(state.dl.hideGtm && isGtm(p)) && (!q || fold(p.name).includes(q) || fold(JSON.stringify(p.value)).includes(q)));
  return { list, gtm };
}
export const visiblePushes = (model) => filtered(model).list.length;

export function dataLayerToolbar(model) {
  const t = m().dataLayer;
  const { gtm } = filtered(model);
  const sw = (id, label, checked, onchange) => el("label", { class: "switch", for: id }, el("input", { id, type: "checkbox", checked, onchange: (e) => onchange(e.target.checked) }), el("i"), label);
  return el("div", { class: "toolbar" },
    el("div", { class: "toprow" }, el("label", { class: "search" }, icon("search"), el("input", { id: "dlSearch", type: "search", placeholder: t.search, "aria-label": t.search, value: state.dl.search,
      oninput: (e) => { state.dl.search = e.target.value; renderSoon(); }, onkeydown: (e) => { if (e.key === "Escape") { state.dl.search = ""; render(); } } }), el("span", { class: "kbd", text: "/" })), orderToggle()),
    el("div", { class: "toggle-row" },
      sw("hideGtm", t.hideGtm(gtm), state.dl.hideGtm, (v) => { state.dl.hideGtm = v; render(); }),
      sw("showFired", t.showFired, state.dl.showFired, (v) => { state.dl.showFired = v; render(); })));
}

// ---------- JSON with colours ----------

function json(value, changed = new Set(), indent = 0) {
  const pad = "  ".repeat(indent);
  const p = (s) => el("span", { class: "jp", text: s });
  if (value === null) return el("span", { class: "jb", text: "null" });
  if (typeof value === "string") return el("span", { class: "js", text: JSON.stringify(value) });
  if (typeof value === "number") return el("span", { class: "jn", text: String(value) });
  if (typeof value === "boolean") return el("span", { class: "jb", text: String(value) });
  if (Array.isArray(value)) {
    if (!value.length) return p("[]");
    // Long arrays (24 list items) would bury the push; the first two show the shape, the count says the rest.
    const head = value.slice(0, 2);
    return [p("[\n"), head.map((v, i) => [pad, "  ", json(v, undefined, indent + 1), i < head.length - 1 || value.length > 2 ? p(",") : "", "\n"]),
      value.length > 2 ? [pad, "  ", p(m().dataLayer.more(value.length - 2)), "\n"] : null, pad, p("]")];
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) return p("{}");
    return [p("{\n"), entries.map(([k, v], i) => {
      const line = [el("span", { class: "jk", text: JSON.stringify(k) }), p(": "), json(v, undefined, indent + 1)];
      return [pad, "  ", indent === 0 && changed.has(k) ? el("span", { class: "chg" }, line) : line, i < entries.length - 1 ? p(",") : "", "\n"];
    }), pad, p("}")];
  }
  return el("span", { text: String(value) });
}

/** Top-level keys whose value differs from the dataLayer's merged state before this push. */
function changedKeys(model, push) {
  if (!push.value || typeof push.value !== "object" || Array.isArray(push.value)) return new Set();
  const merged = {};
  for (const p of model.pushes) {
    if (p === push) break;
    if (p.layer === push.layer && p.value && typeof p.value === "object" && !Array.isArray(p.value)) Object.assign(merged, p.value);
  }
  // A key cleared with null (ecommerce: null before each ecommerce push) is not "changed" when set again: that is the pattern.
  return new Set(Object.keys(push.value).filter((k) => k !== "event" && merged[k] != null && JSON.stringify(merged[k]) !== JSON.stringify(push.value[k])));
}

/** The hits a push fired on the platforms being tested; the others' "sent after" links would only add noise. */
const firedShown = (push, model) => push.fired.filter((f) => f.same || !model.chosen || model.chosen.includes(f.platform));

function firedLine(push, model) {
  const t = m().dataLayer;
  const fired = firedShown(push, model);
  if (!fired.length) return null;
  const parts = fired.map((f, i) => [i ? ", " : "", el("b", { text: `${PROVIDERS[f.platform] ?? f.platform} ${f.name}` }), ` ${f.ms < 1000 ? m().units.ms(f.ms) : m().units.s((f.ms / 1000).toFixed(1))}`]);
  const same = fired.every((f) => f.same);
  return el("div", { class: "firedline" }, icon("info", "s"), el("span", {}, `${same ? t.fired : t.after}: `, parts, ". ",
    button(t.showInEvents, () => actions.showRow(fired[0].key), { cls: "linkbtn" })));
}

function pushRow(push, step, model) {
  const t = m().dataLayer;
  const open = state.dl.open.has(push.key);
  const v = shownValue(push.value);
  const gtag = push.gtag;
  const name = gtag ? `gtag ${push.name}` : push.clear ? "ecommerce: null" : push.name;
  const sub = !gtag && push.clear ? t.clear : null;
  const extra = gtag && Array.isArray(v) ? v.slice(2).filter((x) => typeof x === "string").join(" ") : null;
  const row = el("div", { class: `dl${gtag ? " gtag" : ""}${open ? " open" : ""}${state.flash === push.key ? " flash" : ""}`, role: "treeitem", "aria-level": "2", "aria-expanded": String(open), tabindex: "-1", "data-key": push.key,
    onclick: () => { open ? state.dl.open.delete(push.key) : state.dl.open.add(push.key); render(); } },
  el("span", { class: "ix", text: `${push.layer !== "dataLayer" ? `${push.layer} ` : ""}#${push.index + 1}` }),
  el("span", { class: "nm" }, el("b", { text: name }), sub ? el("span", { class: "src", text: sub }) : null, extra ? el("span", { class: "src", text: extra }) : null),
  el("span", { class: "fired" }, state.dl.showFired ? [...new Set(firedShown(push, model).map((f) => f.platform))].map((p) => badge(p, true)) : null, el("span", { class: "t", text: since(push.t, step.t) })));
  if (!open) return [row];
  const kind = gtag ? "gtag" : push.clear ? t.clear : t.object;
  const detail = el("div", { class: "detail", role: "group" },
    el("section", { class: "sec dlcard" },
      el("div", { class: "sec-h" }, upper(t.pushTitle(push.index + 1)), el("span", { class: "c", text: kind }),
        el("span", { class: "r" }, button(t.copy, () => copy(JSON.stringify(v, null, 2)), { cls: "linkbtn" }))),
      el("pre", { class: "json" }, json(v, changedKeys(model, push))),
      firedLine(push, model)));
  return [row, detail];
}

export function dataLayerList(model) {
  const t = m().dataLayer;
  const { list } = filtered(model);
  const keep = new Set(list.map((p) => p.key));
  const out = [];
  const newest = state.order === "newest";
  for (const step of newest ? [...model.steps].reverse() : model.steps) {
    const kept = step.pushes.filter((p) => keep.has(p.key));
    const pushes = newest ? kept.reverse() : kept;
    if (!step.pushes.length && step.action === "start") continue;
    const collapsed = stepCollapsed(step, model);
    out.push(stepBlock(step, { collapsed, count: t.pushes(pushes.length), status: false, onToggle: () => toggleStep(step, model),
      children: collapsed ? [] : pushes.flatMap((p) => pushRow(p, step, model)) }));
  }
  if (!model.pushes.length) out.push(el("div", { class: "empty-list", text: t.none }));
  return el("div", { class: "list", role: "tree", "aria-label": m().tabs.dataLayer }, out);
}
