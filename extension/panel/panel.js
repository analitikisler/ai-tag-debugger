// The side panel's flow: which site and recording it shows, the state machine (onboarding → setup → recording →
// stopped, or an older recording opened from History), the header, the tabs, the keyboard, and what Start, Stop and
// Start over do. The tabs themselves are in views/; every string comes from core/i18n.js (src/i18n.js).
import { LANGUAGES } from "../core/i18n.js";
import { buildRun, labelsFor } from "../lib/run.js";
import { analyze, captureJson, readPlan, reportHtml } from "../lib/analyze.js";
import { deleteRecording, getEvents, getRecording, listRecordings, putRecording } from "../lib/store.js";
import { canonicalEvent } from "../core/checks.js";
import { buildModel, OFFERED } from "./model.js";
import { platformsInPage } from "./detect.js";
import { state, m, setRender, actions, load, save } from "./state.js";
import { $, el, icon, button, clock, hostOf, isWeb, send, download, when, favicon, announceNew, closeTip, toast, coachMark } from "./ui.js";
import { onboardingView, SITES } from "./views/onboarding.js";
import { setupView } from "./views/setup.js";
import { eventsToolbar, eventsList, notSelectedPopover, visibleRows } from "./views/events.js";
import { dataLayerToolbar, dataLayerList, visiblePushes } from "./views/datalayer.js";
import { consentView, consentDot } from "./views/consent.js";
import { findingsView, findingCards, coverageOf } from "./views/findings.js";
import { historyView } from "./views/history.js";
import { menu, resetSheet, shortcutsSheet, notWebView } from "./views/layers.js";
import { installKeys } from "./keys.js";

const TABS = ["events", "dataLayer", "consent", "findings", "history"];
const SEVERITIES = ["broken", "risk", "warning", "info"];
// Checks about an event or a setup that is missing: there is no hit to jump to.
const ABSENT = new Set(["missing_event", "ga4_automatic_event", "planned_out_of_scope", "journey_incomplete", "consent_default_missing", "page_blocked", "page_crashed", "container_not_run", "container_failed", "container_held"]);
const DEFAULT_PLATFORMS = ["ga4", "google_ads", "meta"];
// Opened as a page (panel.html?tab=<id>) instead of in the side panel, it follows that tab: for a separate window,
// and for the end-to-end test, which cannot open Chrome's side panel.
const PINNED_TAB = Number(new URLSearchParams(location.search).get("tab")) || null;

// ---------- the model, built once per change ----------

let modelCache = { key: null, model: null };
function model() {
  const key = `${state.rec}|${state.events.length}|${(state.recording?.providers ?? []).join(",")}|${state.recording?.plan?.name ?? ""}`;
  if (modelCache.key !== key) {
    const plan = state.recording?.plan?.plan ?? null;
    const built = buildModel(state.events, { platforms: state.recording?.providers ?? null, plan });
    built.plan = plan;
    modelCache = { key, model: built };
  }
  return modelCache.model;
}
const EMPTY = buildModel([], {});

// ---------- which site the panel is about ----------

/**
 * The tab the panel shows: a tab of this window that is recording wins, so opening the report or another tab keeps
 * the recording on screen; otherwise the active tab when it is a website; otherwise the one it already showed when
 * an extension page (the report) is in front.
 */
async function resolveTab() {
  if (PINNED_TAB) return chrome.tabs.get(PINNED_TAB).catch(() => null);
  const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { active = {} } = await send({ type: "active" });
  for (const id of Object.keys(active)) {
    const t = await chrome.tabs.get(Number(id)).catch(() => null);
    if (t && t.windowId === current?.windowId) return t;
  }
  if (isWeb(current?.url)) return current;
  if (state.tab && isWeb(state.tab.url) && current?.url?.startsWith(chrome.runtime.getURL(""))) return state.tab;
  return current ?? state.tab ?? null;
}

/** The recording a site shows when nothing is live: the one its last Stop left, until Start over. Per browser session. */
async function currentFor(host) {
  try { return (await chrome.storage.session.get("current")).current?.[host] ?? null; } catch { return null; }
}
async function setCurrent(host, rec) {
  try {
    const { current = {} } = await chrome.storage.session.get("current");
    if (rec) current[host] = rec; else delete current[host];
    await chrome.storage.session.set({ current });
  } catch { /* the panel then opens on setup next time, nothing worse */ }
}

async function loadRecording(id) {
  if (id === state.rec && (state.recording || !id)) return;
  state.rec = id;
  state.recording = id ? await getRecording(id) : null;
  state.events = id && state.recording ? (await getEvents(id)).sort((a, b) => a.t - b.t || a.seq - b.seq) : [];
  if (!state.recording) state.rec = null;
  state.analysis = null;
  state.analysisError = false;
  state.open.clear(); state.openSteps.clear(); state.closedSteps.clear(); state.openItems.clear(); state.dl.open.clear();
  state.findingsFilter = null;
  state.routesOpen = undefined;
  state.newKeys = new Set();
}

const filters = new Map(); // host -> the platform filter, kept for the browser session
async function enterHost(host) {
  if (state.setup.host === host) return;
  if (state.setup.host) filters.set(state.setup.host, { ...state.filter });
  state.setup.host = host;
  state.filter = filters.get(host) ?? { search: "", on: null, extra: new Set(), sentTo: "any" };
  const { platforms = {}, plans = {}, setupOptions = {} } = await load(["platforms", "plans", "setupOptions"]);
  state.setup.plan = plans[host] ?? null;
  state.setup.planError = null;
  state.setup.reload = setupOptions.reload ?? true;
  state.setup.clear = setupOptions.clear ?? false;
  state.setup.denied = false;
  state.setup.detected = [];
  state.setup.remembered = Array.isArray(platforms[host]);
  state.setup.platforms = state.setup.remembered ? platforms[host].filter((k) => OFFERED.includes(k)) : [...DEFAULT_PLATFORMS];
  await detect();
}

/** "on page": the platforms the page's globals give away, read once with site access; nothing without it. */
async function detect() {
  const tab = state.tab;
  state.setup.granted = await chrome.permissions.contains(SITES).catch(() => false);
  if (!state.setup.granted || !isWeb(tab?.url)) return;
  const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, world: "MAIN", func: platformsInPage }).catch(() => []);
  const found = Array.isArray(res?.result) ? res.result.filter((k) => OFFERED.includes(k)) : [];
  state.setup.detected = found;
  // A first visit to a site starts from what is on the page; a remembered choice is never overridden.
  if (!state.setup.remembered && found.length) state.setup.platforms = OFFERED.filter((k) => found.includes(k));
}

let refreshing = null;
function refresh() {
  // Tab events come in bursts; one refresh at a time, the last request re-runs once the current one is done.
  if (refreshing) { refreshing.again = true; return refreshing.done; }
  const job = { again: false };
  job.done = (async () => {
    do { job.again = false; await refreshOnce(); } while (job.again);
    refreshing = null;
  })();
  refreshing = job;
  return job.done;
}

async function refreshOnce() {
  const tab = await resolveTab();
  state.tab = tab;
  const web = isWeb(tab?.url);
  const { recording: live = null } = web ? await send({ type: "state", tabId: tab.id }) : {};
  const wasLive = state.live;
  state.live = live;
  state.history.list = await listRecordings().catch(() => []);
  if (live) {
    state.viewing = null;
    await enterHost(live.host);
    await loadRecording(live.rec);
    state.current = live.rec;
  } else if (web) {
    const host = hostOf(tab.url);
    await enterHost(host);
    state.current = await currentFor(host);
    if (wasLive && state.rec) state.current = state.rec;
    const want = state.viewing ?? state.current;
    if (want !== state.rec) await loadRecording(want);
    else if (state.rec) state.recording = await getRecording(state.rec);
    if (!state.recording) { state.current = null; state.viewing = null; }
  } else if (!state.historyOnly && !state.viewing) {
    await loadRecording(null);
  }
  // The recording stopped without the Stop button: the tab was closed, so the result is shown at once.
  if (wasLive && !live && state.recording) {
    state.tabClosed = !state.stopping;
    state.view = "findings";
  }
  if (live) state.tabClosed = false;
  state.leftSite = live && web && hostOf(tab.url) !== live.host ? live.host : null;
  render();
}

// ---------- the state machine ----------

/** onboarding | not-web | setup | workspace */
function mode() {
  if (state.tour !== null) return "onboarding";
  if (state.recording || state.historyOnly) return "workspace";
  if (isWeb(state.tab?.url)) return "setup";
  return "not-web";
}

function statusText() {
  const s = m().status;
  const r = state.recording;
  if (state.live && r) return s.recording(clock(Date.now() - r.startedAt), model().steps.length);
  if (state.tabClosed && r) return s.tabClosed;
  if (r && state.viewing) return s.viewing(when(r.startedAt));
  if (r) {
    const mdl = model();
    return s.done(clock((r.stoppedAt ?? Date.now()) - r.startedAt), mdl.steps.length, mdl.rows.filter((x) => x.kind === "hit").length);
  }
  return isWeb(state.tab?.url) ? s.ready : s.notWeb;
}

function renderHeader(md) {
  const hdr = $("hdr");
  hdr.hidden = md === "onboarding";
  if (hdr.hidden) return;
  const url = state.recording?.site && !isWeb(state.tab?.url) ? state.recording.site : state.tab?.url;
  const web = isWeb(url);
  const fav = $("fav");
  const favKey = web ? `${hostOf(url)}|${Boolean(state.tab?.favIconUrl)}` : "-";
  if (fav.dataset.host !== favKey) {
    fav.dataset.host = favKey;
    const hasIcon = Boolean(state.tab?.favIconUrl) && hostOf(state.tab?.url) === hostOf(url);
    fav.replaceChildren(web ? favicon(url, 20, hasIcon) : el("span", { class: "fav globe" }, icon("globe", "s")));
  }
  $("host").textContent = state.live ? state.live.host : web ? hostOf(url) : state.tab?.title || "—";
  $("status").className = `status${state.live ? " rec" : state.recording ? " done" : ""}`;
  $("statusText").textContent = statusText();
  $("stop").hidden = !state.live;
  $("stopLabel").textContent = m().stop;
  const so = $("startOver");
  so.hidden = Boolean(state.live) || !state.recording;
  so.replaceChildren(icon("restart"), state.viewing ? m().newRecording : m().startOver);
  const more = $("more");
  if (!more.firstChild) more.append(icon("dots"));
  more.setAttribute("aria-label", m().menu.label);
  more.setAttribute("aria-expanded", String(state.layer?.kind === "menu"));
}

function renderBanner() {
  const parts = [];
  if (state.viewing && state.recording) {
    parts.push(el("div", { class: "banner" }, icon("info"), el("span", { class: "grow", text: m().history.viewingBanner(when(state.recording.startedAt)) }),
      button(m().history.back, () => actions.backToLatest(), { cls: "linkbtn" })));
  }
  if (state.leftSite) parts.push(el("div", { class: "banner warn" }, icon("warn"), el("span", { class: "grow", text: m().errors.leftSite(state.leftSite) })));
  $("banner").replaceChildren(...parts);
}

function renderTabs(md, mdl) {
  const nav = $("tabs");
  nav.hidden = md !== "workspace";
  if (nav.hidden) return;
  const t = m().tabs;
  nav.setAttribute("aria-label", t.label);
  const count = (text, cls = "") => el("span", { class: `cnt ${cls}`.trim(), text: String(text) });
  const extras = {};
  if (state.recording) {
    // One source per number: the hits on screen, and out of how many captured when the filter hides some.
    const { rows, total } = visibleRows(mdl);
    const shown = [...rows.keys()].filter((k) => mdl.rows.find((r) => r.key === k)?.kind === "hit").length;
    extras.events = count(shown === total ? total : `${shown}/${total}`);
    extras.dataLayer = count(visiblePushes(mdl));
    const dot = consentDot(mdl);
    extras.consent = el("span", { class: `tabdot ${dot}`, role: "img", "aria-label": m().consent.dot[dot] });
    const a = state.analysis?.result;
    if (a && !state.live) {
      // The problem cards the tab shows (broken, risk, warning), counted from the same list.
      const { counts } = findingCards(a, mdl);
      const n = counts.broken + counts.risk + counts.warning;
      const worst = SEVERITIES.find((s) => counts[s]);
      if (n) extras.findings = count(n, worst);
    }
  }
  nav.replaceChildren(...TABS.map((k, i) => el("button", {
    class: "tab", role: "tab", id: `tab-${k}`, type: "button", "data-tab": k, "aria-selected": String(state.view === k), "aria-controls": "main", tabindex: state.view === k ? "0" : "-1",
    title: `${t[k]} (${i + 1})`, onclick: () => actions.showTab(k),
  }, t[k], extras[k] ?? null)));
}

function renderFoot(md) {
  const foot = $("foot");
  foot.hidden = !(md === "workspace" && state.live);
  if (foot.hidden) return;
  const input = $("stepName");
  const examples = m().mark.examples;
  input.placeholder = m().mark.placeholder(examples[model().steps.length % examples.length]);
  input.setAttribute("aria-label", m().mark.button);
  if (!$("flagIcon").firstChild) $("flagIcon").append(icon("flag"));
  $("markBtn").replaceChildren(m().mark.button, " ", el("span", { class: "kbd", text: "↵" }));
}

function renderLayers(mdl) {
  document.querySelectorAll(".layer").forEach((n) => n.remove());
  const l = state.layer;
  if (!l) return;
  let nodes = [];
  if (l.kind === "menu") nodes = menu();
  else if (l.kind === "reset") nodes = resetSheet();
  else if (l.kind === "shortcuts") nodes = shortcutsSheet();
  else if (l.kind === "notSelected") nodes = [el("div", { class: "scrim", style: { background: "transparent" }, onclick: () => { state.layer = null; render(); } }), notSelectedPopover(mdl)];
  const wrap = el("div", { class: "layer" }, nodes);
  $("app").append(wrap);
  wrap.querySelector(l.kind === "reset" ? "#resetGo" : ".mi, .sheet button, .popover button")?.focus();
}

/** The focused control, so a render that rebuilds it can put the focus back where it was. */
function focusKey() {
  const a = document.activeElement;
  if (!a || a === document.body || a.closest(".layer")) return null;
  const d = a.dataset ?? {};
  return { id: a.id || null, key: d.key ?? null, step: d.step ?? null, view: d.view ?? null, chip: d.chip ?? null, platform: d.platform ?? null, tab: d.tab ?? null, start: a.selectionStart ?? null };
}
function restoreFocus(f) {
  if (!f || state.layer) return;
  if (document.activeElement && document.activeElement !== document.body && document.contains(document.activeElement)) return;
  const sel = f.id ? `#${CSS.escape(f.id)}` : f.key ? `[data-key="${CSS.escape(f.key)}"]` : f.step ? `[data-step="${f.step}"]` : f.view ? `[data-view="${f.view}"]`
    : f.chip ? `[data-chip="${f.chip}"]` : f.platform ? `[data-platform="${f.platform}"]` : f.tab ? `[data-tab="${f.tab}"]` : null;
  const n = sel ? document.querySelector(sel) : null;
  if (!n) return;
  if (n.matches('[role="treeitem"]')) n.tabIndex = 0;
  n.focus({ preventScroll: true });
  if (f.start !== null && typeof n.setSelectionRange === "function") {
    try { n.setSelectionRange(f.start, f.start); } catch { /* not a text field */ }
  }
}

let unseen = 0;
let lastRowCount = 0;
let lastView = null;
let scheduled = false;
function render() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    draw();
  });
}
setRender(render);

function draw() {
  document.documentElement.lang = state.lang;
  const md = mode();
  const mdl = state.recording ? model() : EMPTY;
  const main = $("main");
  // "At the newest end": the bottom when oldest is first, the top when newest is first.
  const atBottom = state.order === "newest" ? main.scrollTop < 40 : main.scrollHeight - main.scrollTop - main.clientHeight < 40;
  const toNewest = () => { main.scrollTop = state.order === "newest" ? 0 : main.scrollHeight; };
  const scroll = lastView === `${md}|${state.view}` ? main.scrollTop : 0;
  lastView = `${md}|${state.view}`;
  const focus = focusKey();
  renderHeader(md);
  renderBanner();
  renderTabs(md, mdl);
  let content;
  let toolbar = null;
  if (md === "onboarding") content = onboardingView();
  else if (md === "setup") content = setupView();
  else if (md === "not-web") content = notWebView();
  else if (state.view === "history") content = historyView();
  else if (!state.recording) content = el("div", { class: "empty-list", text: m().history.pick });
  else if (state.view === "events") { toolbar = eventsToolbar(mdl); content = eventsList(mdl); }
  else if (state.view === "dataLayer") { toolbar = dataLayerToolbar(mdl); content = dataLayerList(mdl); }
  else if (state.view === "consent") content = consentView(mdl);
  else content = findingsView(mdl);
  $("bar").replaceChildren(...(toolbar ? [toolbar] : []));
  main.setAttribute("role", md === "workspace" ? "tabpanel" : "main");
  if (md === "workspace") main.setAttribute("aria-labelledby", `tab-${state.view}`); else main.removeAttribute("aria-labelledby");
  main.replaceChildren(content);
  renderFoot(md);
  renderLayers(mdl);
  // Follow mode: a list scrolled to its end sticks to the end as rows arrive; scrolled up, it stays and counts them.
  const rows = mdl.rows.length;
  const arrived = state.rec === lastRec ? Math.max(0, rows - lastRowCount) : 0;
  lastRec = state.rec;
  lastRowCount = rows;
  const following = state.live && state.view === "events";
  if (state.pendingScroll) {
    const target = main.querySelector(state.pendingScroll);
    state.pendingScroll = null;
    if (target) { target.tabIndex = 0; target.scrollIntoView({ block: "center" }); target.focus({ preventScroll: true }); }
  } else if (following && atBottom && arrived) {
    toNewest();
    unseen = 0;
  } else {
    main.scrollTop = scroll;
    if (following && arrived && !atBottom) unseen += arrived;
  }
  document.querySelector(".jump")?.remove();
  if (unseen && following) {
    $("app").append(el("button", { class: `jump${state.order === "newest" ? " top" : ""}`, type: "button", style: state.order === "newest" ? { top: `${main.offsetTop + 10}px`, bottom: "auto" } : null, onclick: () => { unseen = 0; toNewest(); render(); } }, el("span", { class: state.order === "newest" ? "flip" : null }, icon("arrow-d", "s")), m().events.jump(unseen)));
  }
  // The first row of the tree takes Tab; the others are reached with the arrow keys (roving tabindex).
  const first = main.querySelector('[role="treeitem"]');
  if (first && !main.querySelector('[role="treeitem"][tabindex="0"]')) first.tabIndex = 0;
  state.newKeys = new Set();
  state.flash = null;
  restoreFocus(focus);
  if (md === "onboarding" && !focus) $("obTitle")?.focus();
}
let lastRec = null;

$("main").addEventListener("scroll", () => {
  const main = $("main");
  const atNewest = state.order === "newest" ? main.scrollTop < 40 : main.scrollHeight - main.scrollTop - main.clientHeight < 40;
  if (unseen && atNewest) { unseen = 0; document.querySelector(".jump")?.remove(); }
});

// ---------- analysis ----------

function runAnalysis() {
  const r = state.recording;
  const key = `${state.rec}|${state.lang}|${state.events.length}|${r.plan?.name ?? ""}|${(r.providers ?? []).join(",")}`;
  if (state.analysis?.key === key) return state.analysis.result ?? null;
  state.analysis = { key, result: null };
  // Off the click: the spinner shows first, then the checks run (they usually take well under a second).
  setTimeout(() => {
    if (state.analysis?.key !== key) return;
    try {
      const run = buildRun(state.events, { site: r.site, startedAt: r.startedAt, providers: r.providers ?? null, labels: labelsFor(state.lang) });
      const result = { run, ...analyze(run, { plan: r.plan?.plan ?? null, lang: state.lang }) };
      state.analysis = { key, result };
      state.analysisError = false;
      const cov = result.metrics?.coverage;
      const mdl = model();
      const summary = {
        counts: result.counts, status: result.verdict.status, score: result.verdict.score, verdict: `${result.verdict.statusText}: ${result.verdict.headline}`,
        hits: mdl.rows.filter((x) => x.kind === "hit").length, steps: mdl.steps.length, platforms: Object.keys(mdl.counts),
        ...(cov?.planned ? { coverage: coverageOf(cov) } : {}),
      };
      // The report tab and History read the verdict from the recording.
      if (r.stoppedAt) {
        state.recording = { ...r, summary };
        putRecording(state.recording).then(() => listRecordings()).then((list) => { state.history.list = list; render(); }).catch(() => {});
      }
    } catch (err) {
      console.error(err);
      state.analysisError = true;
    }
    render();
  }, 30);
  return null;
}

// ---------- actions ----------

async function savePlan(entry) {
  const host = state.setup.host;
  if (!host) return;
  const { plans = {} } = await load("plans");
  if (entry) plans[host] = entry; else delete plans[host];
  await save({ plans });
  state.setup.plan = entry;
}

function applyTheme() {
  if (state.theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = state.theme;
}

Object.assign(actions, {
  model,
  analysis: runAnalysis,

  tourTo(i) { state.tour = i; state.layer = null; render(); requestAnimationFrame(() => requestAnimationFrame(() => $("obTitle")?.focus())); },
  async finishTour(granted) {
    state.tour = null;
    state.onboarded = true;
    await save({ onboarded: true });
    if (granted === false) state.setup.denied = true;
    if (granted) { state.setup.denied = false; await detect(); }
    render();
  },
  async setLang(lang) {
    if (!LANGUAGES[lang]) return;
    state.lang = lang;
    state.analysis = null;
    await save({ lang });
    render();
  },
  async setTheme(theme) {
    state.theme = theme;
    applyTheme();
    await save({ theme });
    render();
  },
  async setMask(on) { state.mask = on; await save({ mask: on }); render(); },
  async setOrder(order) { state.order = order; unseen = 0; $("main").scrollTop = 0; await save({ order }); render(); },
  seenHint(id) { if (!state.hints[id]) { state.hints[id] = true; save({ hints: state.hints }); } },

  togglePlatform(key) {
    const list = state.setup.platforms;
    state.setup.platforms = list.includes(key) ? list.filter((k) => k !== key) : OFFERED.filter((k) => k === key || list.includes(k));
    render();
  },
  selectDetected() { state.setup.platforms = OFFERED.filter((k) => state.setup.platforms.includes(k) || state.setup.detected.includes(k)); render(); },
  async setOption(name, value) {
    state.setup[name] = value;
    await save({ setupOptions: { reload: state.setup.reload, clear: state.setup.clear } });
    render();
  },
  async loadPlanFile(file) {
    const { plan, error } = readPlan(await file.text());
    state.setup.planError = error ?? null;
    if (!error) await savePlan({ name: file.name, plan });
    render();
  },
  async removePlan() { await savePlan(null); render(); },
  async askAccess() {
    const granted = await chrome.permissions.request(SITES).catch(() => false);
    state.setup.denied = !granted;
    if (granted) await detect();
    render();
  },

  async start() {
    const tab = state.tab;
    if (!isWeb(tab?.url) || !state.setup.platforms.length) return;
    // Asked here, from the click, as Chrome requires: access to the site's pages and to the tracking hosts they call.
    const granted = await chrome.permissions.request(SITES).catch(() => false);
    state.setup.denied = !granted;
    if (!granted) return render();
    const host = hostOf(tab.url);
    const { platforms = {} } = await load("platforms");
    platforms[host] = state.setup.platforms;
    await save({ platforms });
    state.setup.remembered = true;
    const { rec } = await send({ type: "start", tabId: tab.id, url: tab.url, providers: state.setup.platforms, reload: state.setup.reload, clearCookies: state.setup.clear });
    if (!rec) return;
    state.viewing = null;
    state.historyOnly = false;
    await setCurrent(host, rec);
    await loadRecording(rec);
    state.view = "events";
    await refresh();
  },
  async stop() {
    if (!state.live) return;
    state.stopping = true;
    await send({ type: "stop", tabId: state.tab.id });
    state.view = "findings";
    await refresh();
    state.stopping = false;
  },
  askStartOver() {
    if (!state.recording) { state.historyOnly = false; state.viewing = null; state.layer = null; return render(); }
    const recorded = state.events.some((e) => e.kind === "request" || e.kind === "push");
    // Nothing to keep or lose: no question to ask.
    if (!recorded && !state.viewing) return actions.startOver({ keep: false, clearCookies: false });
    state.layer = { kind: "reset" };
    render();
  },
  async startOver({ keep, clearCookies }) {
    state.layer = null;
    const host = state.live?.host ?? state.recording?.host ?? hostOf(state.tab?.url);
    // An older recording opened from History is never deleted by Start over: it is not the one being left.
    await send({ type: "reset", tabId: state.tab?.id, rec: state.viewing ? null : state.rec, keep: state.viewing ? true : keep, clearCookies, origin: state.recording?.site ?? null });
    await setCurrent(host, null);
    state.viewing = null;
    state.historyOnly = false;
    state.tabClosed = false;
    state.current = null;
    await loadRecording(null);
    state.view = "events";
    await refresh();
  },
  toSetup() {
    if (state.recording) return actions.askStartOver();
    state.historyOnly = false;
    render();
  },
  showTab(view) {
    if (view === "history" && !state.recording) state.historyOnly = true;
    state.view = view;
    state.layer = null;
    closeTip();
    render();
  },
  toggleRow(key, keepOthers) {
    if (state.open.has(key)) state.open.delete(key);
    else {
      if (!keepOthers) state.open.clear();
      state.open.add(key);
    }
    closeTip();
    render();
  },
  showRow(key) {
    const mdl = model();
    const row = mdl.rows.find((r) => r.key === key);
    if (!row) return;
    state.view = "events";
    // The row must pass the filter to be seen: its platform is shown and the search cleared.
    if (!visibleRows(mdl).rows.has(key)) {
      state.filter.search = "";
      state.filter.sentTo = "any";
      state.filter.extra.add(row.kind === "call" ? "other" : row.platform);
    }
    state.closedSteps.delete(row.step);
    state.openSteps.add(row.step);
    state.open.clear();
    state.open.add(key);
    state.flash = key;
    state.pendingScroll = `[data-key="${CSS.escape(key)}"]`;
    render();
  },
  showPush(key) {
    const p = model().pushes.find((x) => x.key === key);
    if (!p) return;
    state.view = "dataLayer";
    if (/^gtm\./.test(p.name)) state.dl.hideGtm = false;
    state.dl.search = "";
    state.closedSteps.delete(p.step);
    state.openSteps.add(p.step);
    state.dl.open.add(key);
    state.flash = key;
    state.pendingScroll = `[data-key="${CSS.escape(key)}"]`;
    render();
  },
  rowForFinding(f) {
    const mdl = model();
    const step = mdl.steps.find((s) => s.label === f.step);
    // A failed request points at the failed row itself.
    if (f.check === "hit_failed") {
      const bad = mdl.rows.filter((r) => r.kind === "hit" && r.platform === f.platform && (r.status === "failed" || r.status >= 400));
      return (step ? bad.find((r) => r.step === step.index) : null) ?? bad[0] ?? null;
    }
    // Findings about something that never happened have no hit to show.
    if (ABSENT.has(f.check) || (!f.platform && !f.event)) return null;
    const same = (r) => !f.event || canonicalEvent(r.name) === canonicalEvent(f.event) || (r.platform === "google_ads" && /^conversion/.test(r.name) && /conversion/i.test(f.event));
    const hits = mdl.rows.filter((r) => r.kind === "hit" && (!f.platform || r.platform === f.platform) && same(r));
    return (step ? hits.find((r) => r.step === step.index) : null) ?? hits[0] ?? null;
  },
  saveFilter() { if (state.setup.host) filters.set(state.setup.host, { ...state.filter }); },
  async addPlatform(key) {
    const host = state.recording?.host ?? state.setup.host;
    const { platforms = {} } = await load("platforms");
    platforms[host] = [...new Set([...(platforms[host] ?? state.setup.platforms), key])];
    await save({ platforms });
    if (host === state.setup.host) state.setup.platforms = OFFERED.filter((k) => platforms[host].includes(k));
    if (state.recording?.providers && !state.recording.providers.includes(key)) {
      state.recording = { ...state.recording, providers: [...state.recording.providers, key] };
      await putRecording(state.recording).catch(() => {});
      state.analysis = null;
    }
    state.filter.extra.delete(key);
    state.layer = null;
    render();
  },

  async openRecording(id) {
    state.viewing = id === state.current ? null : id;
    state.historyOnly = false;
    await loadRecording(id);
    state.view = "findings";
    render();
  },
  async backToLatest() {
    state.viewing = null;
    await loadRecording(state.current);
    state.view = state.current ? "findings" : "events";
    render();
  },
  async deleteRecording(id) {
    await deleteRecording(id);
    if (state.current === id) { await setCurrent(state.recording?.host ?? state.setup.host, null); state.current = null; }
    if (state.rec === id) { state.viewing = null; await loadRecording(null); }
    state.history.undo = null;
    state.history.list = await listRecordings();
    render();
  },
  openReport(id = state.rec) {
    chrome.tabs.create({ url: chrome.runtime.getURL(`report/report.html?rec=${encodeURIComponent(id)}&lang=${state.lang}`) });
  },
  exportHtml() {
    const a = state.analysis?.result;
    if (!a) return;
    download(`aitd-${state.rec.replace(/[^\w.-]+/g, "_")}-report.html`, reportHtml(a.run, { plan: state.recording.plan?.plan ?? null, lang: state.lang, site: state.recording.site }, { redacted: true }), "text/html");
  },
  async exportJson(id = state.rec) {
    const r = id === state.rec ? state.recording : await getRecording(id);
    if (!r) return;
    const events = id === state.rec ? state.events : await getEvents(id);
    const run = buildRun(events, { site: r.site, startedAt: r.startedAt, providers: r.providers ?? null, labels: labelsFor(state.lang) });
    download(`aitd-${id.replace(/[^\w.-]+/g, "_")}-capture.json`, captureJson(run, { plan: r.plan?.plan ?? null, lang: state.lang, site: r.site, extensionVersion: chrome.runtime.getManifest().version }), "application/json");
  },
  openWindow() {
    const id = state.tab?.id;
    chrome.windows.create({ url: chrome.runtime.getURL(`panel/panel.html${id ? `?tab=${id}` : ""}`), type: "popup", width: 420, height: 820 }).catch(() => {});
  },
  async openSite(r) {
    await setCurrent(r.host, r.id);
    await chrome.tabs.create({ url: r.site });
  },
});

// ---------- the header and footer controls ----------

// The one-time "labels" hint in an opened hit goes away with the next click anywhere.
document.addEventListener("pointerdown", () => { if (state.hintRow) { state.hintRow = null; render(); } }, true);

$("stop").onclick = () => actions.stop();
$("startOver").onclick = () => actions.askStartOver();
$("more").onclick = () => { state.layer = state.layer?.kind === "menu" ? null : { kind: "menu" }; render(); };

let marking = false;
$("stepForm").onsubmit = async (ev) => {
  ev.preventDefault();
  const input = $("stepName");
  const label = input.value.trim();
  if (!label || !state.live || marking) return;
  marking = true;
  const n = model().steps.length + 1;
  await send({ type: "step", tabId: state.tab.id, label });
  marking = false;
  input.value = "";
  toast(m().mark.started(n, label));
};

installKeys({ mode, model, tabs: TABS });

// ---------- live updates ----------

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "recorded" || msg.rec !== state.rec) return;
  const before = new Set(model().rows.map((r) => r.key));
  state.events.push(msg.event);
  if (msg.event.kind === "request") {
    const fresh = model().rows.filter((r) => !before.has(r.key));
    for (const r of fresh) state.newKeys.add(r.key);
    if (fresh.length) announceNew(fresh.length);
  }
  if (msg.event.kind === "step" && msg.event.action === "manual" && !state.hints.mark) {
    // The first named step: one hint on what naming is for, once ever.
    actions.seenHint("mark");
    coachMark($("stepName").closest(".input"), m().hints.mark);
  }
  render();
});
chrome.tabs.onActivated.addListener(() => refresh());
chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.url || info.status === "complete") refresh(); });
chrome.tabs.onRemoved.addListener((tabId) => { if (state.live && tabId === state.tab?.id) setTimeout(refresh, 300); });
setInterval(() => { if (state.live) $("statusText").textContent = statusText(); }, 1000);
// The "Nothing yet?" note appears 15 s into a recording that saw nothing, without an event to trigger a render.
setInterval(() => { if (state.live && state.view === "events" && !model().rows.length) render(); }, 5000);

// ---------- start ----------

const stored = await load(["lang", "theme", "mask", "onboarded", "detailView", "groupsOpen", "hints", "order"]);
state.order = stored.order === "newest" ? "newest" : "oldest";
state.lang = stored.lang && LANGUAGES[stored.lang] ? stored.lang : chrome.i18n.getUILanguage().toLowerCase().startsWith("tr") ? "tr" : "en";
state.theme = ["light", "dark"].includes(stored.theme) ? stored.theme : "system";
state.mask = Boolean(stored.mask);
state.onboarded = stored.onboarded === true;
state.tour = state.onboarded ? null : 0;
state.detailView = ["readable", "all", "raw"].includes(stored.detailView) ? stored.detailView : "readable";
state.groupsOpen = stored.groupsOpen ?? {};
state.hints = stored.hints ?? {};
applyTheme();
navigator.storage?.estimate?.().then(({ usage, quota }) => { state.history.full = quota ? usage / quota > 0.8 : false; }).catch(() => {});
await refresh();
