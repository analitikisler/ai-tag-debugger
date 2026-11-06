// The panel's keyboard (§10): Alt+R, Alt+N, / to search, 1–5 for tabs, the tree's arrow keys and j/k, c to copy a
// row, v to switch the open hit's view, i for a parameter's tip, ? for the list and Esc to close.
import { state, actions, render, save } from "./state.js";
import { $, closeTip, copy } from "./ui.js";


const typing = (e) => e.target.closest?.("input, textarea, select, [contenteditable]");
function moveIn(list, current, delta) {
  const i = list.indexOf(current);
  const next = list[Math.max(0, Math.min(list.length - 1, i + delta))];
  if (!next) return;
  list.forEach((n) => { n.tabIndex = -1; });
  next.tabIndex = 0;
  next.focus();
}

export function installKeys({ mode, model, tabs: TABS }) {
  document.addEventListener("keydown", (e) => onKey(e, mode, model, TABS));
}

function onKey(e, mode, model, TABS) {
  const md = mode();
  if (md === "onboarding") {
    if (e.key === "Escape") { e.preventDefault(); actions.finishTour(null); }
    else if (e.key === "Enter" && !e.target.closest("button, input")) { e.preventDefault(); $("obNext")?.click(); }
    return;
  }
  if (e.key === "Escape") {
    if (state.layer) { state.layer = null; render(); $("more").focus(); return; }
    closeTip();
    return;
  }
  if (state.layer?.kind === "reset" || state.layer?.kind === "shortcuts") return;
  if (e.altKey && e.code === "KeyR") { e.preventDefault(); if (state.live) actions.stop(); else if (md === "setup") actions.start(); return; }
  if (e.altKey && e.code === "KeyN") { e.preventDefault(); actions.askStartOver(); return; }
  if (typing(e) || e.ctrlKey || e.metaKey) return;
  const tab = e.target.closest?.('[role="tab"]');
  if (tab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
    e.preventDefault();
    const i = TABS.indexOf(tab.dataset.tab);
    const next = e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    actions.showTab(TABS[next]);
    requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector(`[data-tab="${TABS[next]}"]`)?.focus()));
    return;
  }
  if (e.key === "/") { const s = $("search") ?? $("dlSearch"); if (s) { e.preventDefault(); s.focus(); } return; }
  if (e.key === "?") { state.layer = { kind: "shortcuts" }; render(); return; }
  if (md === "workspace" && /^[1-5]$/.test(e.key) && !e.altKey) { actions.showTab(TABS[Number(e.key) - 1]); return; }
  if ((e.key === "m" || e.key === "M") && state.live && !e.altKey) { e.preventDefault(); $("stepName").focus(); return; }
  const item = e.target.closest?.('[role="treeitem"]');
  if (item) {
    const list = [...$("main").querySelectorAll('[role="treeitem"]')];
    if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); moveIn(list, item, 1); return; }
    if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); moveIn(list, item, -1); return; }
    const key = item.dataset.key;
    const open = item.getAttribute("aria-expanded") === "true";
    if (["ArrowRight", "ArrowLeft", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      if ((e.key === "ArrowLeft" && !open) || (e.key === "ArrowRight" && open)) return;
      if (item.dataset.step !== undefined || state.view === "dataLayer") item.click();
      else if (key && item.classList.contains("ev")) actions.toggleRow(key, e.shiftKey);
      return;
    }
    if (e.key === "c" && key) {
      const r = model().rows.find((x) => x.key === key);
      if (r) copy(JSON.stringify(r.hit ? { platform: r.platform, name: r.name, params: r.hit.params, items: r.items, url: r.e.url } : { url: r.e.url }, null, 2));
      return;
    }
  }
  if (e.key === "v" && state.open.size && state.view === "events") {
    const views = ["readable", "all", "raw"];
    state.detailView = views[(views.indexOf(state.detailView) + 1) % views.length];
    save({ detailView: state.detailView });
    render();
    return;
  }
  if (e.key === "i") e.target.closest?.(".lab")?.querySelector(".ii")?.click();
}
