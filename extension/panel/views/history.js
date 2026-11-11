// The History tab (§3.5): this site's recordings, newest first (they are separate sessions, not one timeline), with
// Open, Report, Export and Delete. Delete waits 6 s behind an Undo instead of asking first.
import { state, m, render, actions } from "../state.js";
import { el, button, clock, when, hostOf, toast } from "../ui.js";
import { badge } from "./common.js";

const tone = (r) => (r.summary?.status === "pass" ? "ok" : r.summary?.status === "fail" ? "broken" : "warning");

export function historyView() {
  const h = m().history;
  const host = state.setup.host ?? hostOf(state.tab?.url);
  const everything = state.history.list.filter((r) => r.stoppedAt && r.id !== state.history.undo);
  const list = state.history.all ? everything : everything.filter((r) => r.host === host);
  const head = el("div", { class: "hist-h" }, el("span", { class: "small" }, el("b", { style: { color: "var(--fg)" }, text: h.onSite(everything.filter((r) => r.host === host).length) })),
    button(state.history.all ? host || "—" : h.allSites(everything.length), () => { state.history.all = !state.history.all; render(); }, { cls: "linkbtn" }));
  const rows = list.map((r) => {
    const s = r.summary ?? {};
    const viewing = r.id === state.rec;
    const meta = [clock((r.stoppedAt ?? r.startedAt) - r.startedAt), s.steps !== undefined ? h.steps(s.steps) : null, s.hits !== undefined ? h.events(s.hits) : null,
      s.coverage ? h.plan(s.coverage.seen, s.coverage.total) : r.plan ? null : h.noPlan].filter(Boolean).join(" · ");
    const platforms = r.providers ?? s.platforms ?? [];
    return el("div", { class: `hist${viewing ? " cur" : ""}`, role: "listitem" },
      el("div", {}, el("div", { class: "when" }, state.history.all ? el("span", { class: "host2", text: `${r.host} · ` }) : null, when(r.startedAt), viewing ? el("span", { class: "small", style: { fontWeight: 400 }, text: ` · ${h.viewing}` }) : null),
        el("div", { class: "meta", text: meta }), platforms.length ? el("div", { class: "plats" }, platforms.map((p) => badge(p, true))) : null),
      s.score !== undefined && s.score !== null ? el("span", { class: `score-chip ${tone(r)}`, text: String(s.score) }) : el("span"),
      el("div", { class: "acts" },
        viewing ? null : button(h.open, () => actions.openRecording(r.id), {}),
        button(h.report, () => actions.openReport(r.id), {}),
        button(h.export, () => actions.exportJson(r.id), {}),
        button(h.delete, () => {
          state.history.undo = r.id;
          render();
          const timer = setTimeout(() => actions.deleteRecording(r.id), 6000);
          toast(h.deleted, { label: h.undo, run: () => { clearTimeout(timer); state.history.undo = null; render(); } }, 6000);
        }, { cls: "del" })));
  });
  return el("div", { role: "region", "aria-label": m().tabs.history }, head,
    state.history.full ? el("div", { class: "note", style: { margin: "10px 16px 0", background: "var(--warning-tint)" }, text: h.storageFull }) : null,
    rows.length ? el("div", { role: "list" }, rows) : el("div", { class: "empty-list", text: h.none }),
    el("p", { class: "small", style: { padding: "14px 16px" }, text: h.note }));
}
