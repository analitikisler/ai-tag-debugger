// The panel's state, shared by the views. panel.js owns the flow (what is loaded, what runs on Start and Stop); the
// views read this object, change their own corner of it and ask for a render. Nothing here touches the DOM.
import { messages } from "../core/i18n.js";

export const state = {
  lang: "en", theme: "system", mask: false, onboarded: true, tour: null, // tour: the onboarding screen shown (0–2) or null
  tab: null, live: null, rec: null, recording: null, events: [], current: null, // current: the site's latest recording id
  view: "events", leftSite: null, tabClosed: false,
  setup: { host: null, platforms: [], detected: [], granted: false, plan: null, planError: null, reload: true, clear: false, denied: false },
  filter: { search: "", on: null, extra: new Set(), sentTo: "any" }, // on: platforms pressed (null = the selected ones)
  open: new Set(), openSteps: new Set(), closedSteps: new Set(), openItems: new Set(), compare: new Set(), openSecs: new Set(),
  detailView: "readable", groupsOpen: {}, paramFilter: "",
  dl: { search: "", hideGtm: true, showFired: true, open: new Set() },
  findingsFilter: null, passedOpen: false, analysis: null, analysisError: false,
  history: { all: false, list: [], undo: null },
  layer: null, // { kind: "menu" | "reset" | "shortcuts" | "notSelected", ... }
  hints: {}, newKeys: new Set(), flash: null, pendingScroll: null,
};

/** The extension's strings in the panel's language. */
export const m = () => messages(state.lang).extension;
export const all = () => messages(state.lang);

let renderFn = () => {};
export const setRender = (fn) => { renderFn = fn; };
/** Asks for a render on the next frame; several calls in one frame render once. */
export const render = () => renderFn();

/** What panel.js does for the views: start, stop, open a recording, … Filled in by panel.js. */
export const actions = {};

/** chrome.storage.local, with failures treated as empty: the panel works without its remembered settings. */
export async function load(keys) {
  try { return await chrome.storage.local.get(keys); } catch { return {}; }
}
export async function save(values) {
  try { await chrome.storage.local.set(values); } catch { /* the setting is lost, nothing else */ }
}
