// The Findings tab (§8): the verdict with its score, the finding cards worst first, the checks that passed, plan
// coverage, the platforms recorded but not checked, and the report and exports. Before Stop: the live warnings.
import { state, m, all, render, actions } from "../state.js";
import { el, icon, button, upper } from "../ui.js";
import { PROVIDERS } from "../../core/parsers.js";
import { stepNo } from "./common.js";

const SEVERITIES = ["broken", "risk", "warning", "info"];
const firstSentence = (s) => String(s ?? "").match(/^.*?[.!?](?=\s|$)/s)?.[0] ?? String(s ?? "");

function beforeStop(model) {
  const t = m().findings;
  const d = m().detail;
  const warnings = model.rows.filter((r) => r.check && r.check.state !== "ok");
  return el("div", { class: "before" }, el("p", { class: "p", text: t.before }), el("p", { class: "small", style: { marginTop: "10px" }, text: t.liveWarnings }),
    warnings.length ? el("ul", {}, warnings.map((r) => el("li", {}, button(`${r.name}: ${r.check.problems.map((p) => (p.kind === "missing" ? d.problems.missing(p.param) : p.kind === "valueTotal" ? d.problems.valueTotal(p.value, p.total) : d.problems.noCurrency)).join("; ")}`, () => actions.showRow(r.key), { cls: "linkbtn", title: null }))))
      : el("p", { class: "small", text: t.noLive }));
}

function verdictBlock(a) {
  const t = m().findings;
  const sev = all().severity;
  const v = a.verdict;
  const tone = v.status === "pass" ? "ok" : v.status === "fail" ? "broken" : "warning";
  const pills = [...SEVERITIES, "ok"].map((s) => {
    const n = a.counts[s] ?? 0;
    const label = s === "ok" ? t.passedPill(n) : `${n} ${sev[s]}`;
    return el("button", { type: "button", class: `sv ${n ? s : "zero"}`, "aria-pressed": String(state.findingsFilter === s), disabled: !n,
      onclick: () => { state.findingsFilter = state.findingsFilter === s ? null : s; if (s === "ok") state.passedOpen = true; render(); } }, label);
  });
  return el("div", { class: "verdict", id: "verdict" },
    el("div", { class: "ring", style: { background: `conic-gradient(var(--${tone}) ${v.score ?? 0}%, var(--line) 0)` }, role: "img", "aria-label": `${v.score ?? "–"} ${t.of100}` },
      el("div", {}, el("div", {}, el("b", { text: String(v.score ?? "–") }), el("small", { text: t.of100 })))),
    el("div", {}, el("div", { class: "vstat", style: { color: `var(--${tone})` } }, icon(v.status === "pass" ? "check" : "warn", "l"), t.status[v.status] ?? v.statusText),
      el("div", { class: "vhead", text: v.headline }), el("div", { class: "sevs" }, pills)));
}

function findingCard(f, a, model) {
  const t = m().findings;
  const sev = all().severity;
  const step = model.steps.find((s) => s.label === f.step) ?? null;
  const where = el("span", { class: "where" }, step ? stepNo(step) : null, [step ? (step.action === "manual" ? step.label : (step.title || step.label)) : f.step ?? t.whole, f.platform ? PROVIDERS[f.platform] ?? f.platform : null].filter(Boolean).join(" · "));
  const row = actions.rowForFinding(f);
  const title = firstSentence(f.detail);
  const rest = String(f.detail ?? "").slice(title.length).trim() || all().consequence[f.check] || "";
  const fix = all().fix[f.check];
  return el("article", { class: `find ${f.severity}` },
    el("div", { class: "top" }, el("span", { class: `sevlab ${f.severity}`, text: upper(sev[f.severity]) }), where,
      row ? el("button", { class: "goto", type: "button", onclick: () => actions.showRow(row.key) }, t.showHit, icon("chev-r", "s")) : null),
    el("h4", { text: title }), rest ? el("p", { text: rest }) : null,
    fix ? el("div", { class: "fix" }, el("b", { text: t.fix }), ` ${fix}`) : null);
}

function unselectedCard(model) {
  const t = m().findings;
  const keys = model.chosen ? Object.keys(model.counts).filter((k) => !model.chosen.includes(k)) : [];
  if (!keys.length) return null;
  const names = keys.map((k) => PROVIDERS[k] ?? k);
  return el("article", { class: "find info" },
    el("div", { class: "top" }, el("span", { class: "sevlab info", text: upper(all().severity.info) }), el("span", { class: "where", text: t.whole })),
    el("h4", { text: t.unselectedTitle(names) }), el("p", { text: t.unselectedBody }),
    button(t.addPlatforms, () => keys.forEach((k) => actions.addPlatform(k)), { cls: "linkbtn" }));
}

export function findingsView(model) {
  const t = m().findings;
  if (state.live) return beforeStop(model);
  if (!state.recording) return el("div", { class: "before" }, el("p", { class: "p", text: t.before }));
  if (state.analysisError) return el("div", { class: "before" }, el("div", { class: "note danger", role: "alert" }, icon("warn"), el("span", { text: m().errors.analysis })));
  const a = actions.analysis();
  if (!a) return el("div", { class: "checking", role: "status" }, el("span", { class: "spinner" }), t.checking);
  const problems = a.findings.filter((f) => SEVERITIES.includes(f.severity))
    .sort((x, y) => SEVERITIES.indexOf(x.severity) - SEVERITIES.indexOf(y.severity) || (model.steps.findIndex((s) => s.label === x.step) - model.steps.findIndex((s) => s.label === y.step)));
  const passed = a.findings.filter((f) => f.severity === "ok");
  const list = state.findingsFilter && state.findingsFilter !== "ok" ? problems.filter((f) => f.severity === state.findingsFilter) : state.findingsFilter === "ok" ? [] : problems;
  const cov = a.metrics?.coverage;
  let coverage = null;
  if (cov && cov.planned) {
    const seen = cov.checkable - (cov.counts.missing ?? 0);
    const missing = (cov.events ?? []).filter((e) => e.bucket === "missing").map((e) => e.name);
    coverage = el("div", { class: "coverage" },
      el("div", { class: "row" }, el("span", {}, el("b", { text: t.coverage }), state.recording.plan?.name ? el("span", { class: "small", text: ` · ${state.recording.plan.name}` }) : null), el("span", { class: "small", text: t.seen(seen, cov.checkable) })),
      el("div", { class: "bar" }, el("i", { style: { width: `${cov.checkable ? Math.round((seen / cov.checkable) * 100) : 0}%` } })),
      missing.length ? el("div", { class: "small", text: t.notReached(missing.join(", ")) }) : null);
  }
  const passedBtn = el("button", { class: "passed", type: "button", "aria-expanded": String(state.passedOpen), onclick: () => { state.passedOpen = !state.passedOpen; render(); } },
    icon("check"), t.checksPassed(passed.length), el("span", { class: "chev" }, icon(state.passedOpen ? "chev-d" : "chev-r", "s")));
  const passList = state.passedOpen ? el("ul", { class: "passlist" }, passed.map((f) => el("li", { text: `✓ ${firstSentence(f.detail)}` }))) : null;
  return el("div", { class: "findings", role: "region", "aria-label": m().tabs.findings },
    verdictBlock(a),
    list.map((f) => findingCard(f, a, model)),
    state.findingsFilter ? null : unselectedCard(model),
    !problems.length ? el("div", { class: "passed", text: t.none }) : null,
    passedBtn, passList, coverage,
    el("div", { class: "actions" },
      button(t.openReport, () => actions.openReport(), { cls: "btn primary lg block", ico: "ext" }),
      el("div", { class: "two" }, button(t.exportHtml, () => actions.exportHtml(), { cls: "btn", ico: "download" }), button(t.exportJson, () => actions.exportJson(), { cls: "btn", ico: "download" })),
      el("p", { class: "small", style: { textAlign: "center", margin: 0 }, text: t.exportNote })));
}

