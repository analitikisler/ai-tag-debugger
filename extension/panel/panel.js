// The side panel: starts and stops a recording of the current tab, shows hits as they land, runs the checks when
// the recording stops, and opens or exports the report. All strings come from core/i18n.js (src/i18n.js).
import { LANGUAGES, messages } from "../core/i18n.js";
import { parseTrackingRequest, PROVIDERS } from "../core/parsers.js";
import { redactParams, redactPush } from "../core/redact.js";
import { buildRun, labelsFor } from "../lib/run.js";
import { analyze, captureJson, readPlan, reportHtml } from "../lib/analyze.js";
import { deleteRecording, getEvents, getRecording, listRecordings, putRecording } from "../lib/store.js";

const $ = (id) => document.getElementById(id);
const MAX_GROUPS = 50;
const MAX_ROWS = 300;
const SEVERITIES = ["broken", "risk", "warning", "info"];

const state = { lang: "en", tab: null, rec: null, recording: null, counts: { requests: 0, pushes: 0, steps: 0 }, mask: false, plan: null, rows: new Map(), group: null, shown: null };
const m = () => messages(state.lang).extension;

// ---------- small helpers ----------

const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const c of children) if (c != null) n.append(c);
  return n;
};
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
const isWeb = (url) => /^https?:\/\//.test(url ?? "");
const send = (msg) => chrome.runtime.sendMessage(msg);
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------- language ----------

async function loadLanguage() {
  const { lang } = await chrome.storage.local.get("lang");
  state.lang = lang && LANGUAGES[lang] ? lang : chrome.i18n.getUILanguage().toLowerCase().startsWith("tr") ? "tr" : "en";
  const select = $("lang");
  select.replaceChildren(...Object.entries(LANGUAGES).map(([code, l]) => el("option", { value: code, text: code === "tr" ? "Türkçe" : l.name })));
  select.value = state.lang;
}

function applyStrings() {
  document.documentElement.lang = state.lang;
  for (const n of document.querySelectorAll("[data-t]")) n.textContent = m()[n.dataset.t];
  $("record").textContent = m().record;
  $("stop").textContent = m().stop;
  $("stepName").placeholder = m().stepPlaceholder;
}

// ---------- plan ----------

async function loadPlan() {
  const host = hostOf(state.tab?.url);
  const { plans = {} } = await chrome.storage.local.get("plans");
  state.plan = host ? plans[host] ?? null : null;
  $("planInfo").textContent = state.plan ? m().planLoaded(state.plan.name, state.plan.plan.events.length) : m().planNone;
  $("planClear").hidden = !state.plan;
}

async function savePlan(entry) {
  const host = hostOf(state.tab?.url);
  if (!host) return;
  const { plans = {} } = await chrome.storage.local.get("plans");
  if (entry) plans[host] = entry;
  else delete plans[host];
  await chrome.storage.local.set({ plans });
  await loadPlan();
}

// ---------- the live feed ----------

function counts() {
  const c = m().counts;
  $("cHits").textContent = c.hits(state.counts.requests);
  $("cPushes").textContent = c.pushes(state.counts.pushes);
  $("cSteps").textContent = c.steps(state.counts.steps);
  $("feedEmpty").hidden = $("feed").children.length > 0;
}

function shown(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function paramList(params, { push = false } = {}) {
  const safe = !state.mask ? params : push ? redactPush(params).value : redactParams(params);
  const dl = el("dl", { class: "params" });
  for (const [k, v] of Object.entries(safe ?? {}).slice(0, 80)) dl.append(el("dt", { text: k }), el("dd", { text: shown(v) }));
  return dl;
}

/** The newest step's list, created on the first event when no step has come yet. */
function stepList() {
  return state.group ?? newGroup(m().stepStart);
}

/** A step and the rows under it. Newest step first, its rows in the order they happened. */
function newGroup(label) {
  const list = el("ol");
  const group = el("li", { class: "stepGroup" }, el("div", { class: "stepRow", text: label }), list);
  const feed = $("feed");
  feed.prepend(group);
  while (feed.children.length > MAX_GROUPS) feed.lastElementChild.remove();
  state.group = list;
  return list;
}

function addRow(node) {
  const list = stepList();
  list.append(node);
  while (list.children.length > MAX_ROWS) list.firstElementChild.remove();
}

/** One row per hit in a request (a GA4 batch is several), each with its parameters, and the request's status. */
function showEvent(e) {
  if (e.kind === "step") {
    state.counts.steps += 1;
    newGroup(e.label);
  } else if (e.kind === "request") {
    state.counts.requests += 1;
    const hits = parseTrackingRequest(e.url, e.body ?? null) ?? [];
    for (const hit of hits.length ? hits : [null]) {
      const status = el("span", { class: "badge", text: e.method });
      const row = el("details", {},
        el("summary", {}, el("span", { class: "plat", text: hit ? PROVIDERS[hit.platform] ?? hit.platform : hostOf(e.url) }), el("span", { class: "ev", text: hit?.name ?? new URL(e.url).pathname }), status),
        hit ? paramList(hit.params) : el("p", { class: "params", text: e.url }));
      addRow(el("li", {}, row));
      const list = state.rows.get(e.requestId) ?? [];
      list.push(status);
      state.rows.set(e.requestId, list);
    }
  } else if (e.kind === "status") {
    for (const badge of state.rows.get(e.requestId) ?? []) {
      badge.textContent = e.status === "failed" ? m().failed : String(e.status);
      badge.classList.toggle("bad", e.status === "failed" || e.status >= 400);
    }
  } else if (e.kind === "push") {
    state.counts.pushes += 1;
    const v = e.entry?.value;
    const name = Array.isArray(v) ? v.slice(0, 2).filter((x) => typeof x === "string").join(" ") : v?.event ?? Object.keys(v ?? {}).slice(0, 3).join(", ");
    const params = Array.isArray(v) ? Object.fromEntries(v.map((x, i) => [i, x])) : v ?? {};
    addRow(el("li", {}, el("details", {}, el("summary", {}, el("span", { class: "plat", text: e.entry?.layer ?? "dataLayer" }), el("span", { class: "ev", text: name || "(push)" }), el("span", { class: "badge push", text: m().push })), paramList(params, { push: true }))));
  }
  counts();
}

async function replayFeed(rec) {
  $("feed").replaceChildren();
  state.group = null;
  state.rows.clear();
  state.counts = { requests: 0, pushes: 0, steps: 0 };
  const events = await getEvents(rec);
  events.sort((a, b) => a.t - b.t || a.seq - b.seq).forEach(showEvent);
  counts();
}

// ---------- results ----------

async function showResult(rec) {
  const recording = await getRecording(rec);
  if (!recording) return;
  state.shown = rec;
  $("result").hidden = false;
  $("checking").hidden = false;
  $("verdict").textContent = "";
  $("sev").replaceChildren();
  $("findings").replaceChildren();
  const events = await getEvents(rec);
  const run = buildRun(events, { site: recording.site, startedAt: recording.startedAt, labels: labelsFor(state.lang) });
  const plan = recording.plan?.plan ?? null;
  const { findings, counts: c, verdict } = analyze(run, { plan, lang: state.lang });
  $("checking").hidden = true;
  const verdictText = `${verdict.statusText}: ${verdict.headline}`;
  $("verdict").textContent = verdictText;
  const sev = messages(state.lang).severity;
  for (const s of [...SEVERITIES, "ok"]) if (c[s]) $("sev").append(el("span", { class: `s-${s}`, text: `${c[s]} ${sev[s]}` }));
  const problems = findings.filter((f) => SEVERITIES.includes(f.severity)).sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
  if (!problems.some((f) => f.severity !== "info")) $("findings").append(el("li", {}, el("span"), el("span", { text: m().noFindings })));
  for (const f of problems.slice(0, 12)) $("findings").append(el("li", {}, el("span", { class: `tag s-${f.severity}`, text: sev[f.severity] }), el("span", { text: f.detail })));
  if (problems.length > 12) $("findings").append(el("li", {}, el("span"), el("span", { class: "hint", text: m().moreFindings(problems.length - 12) })));
  await putRecording({ ...recording, summary: { counts: c, verdict: verdictText } });

  const opts = { plan, lang: state.lang, site: recording.site };
  const base = `aitd-${recording.id.replace(/[^\w.-]+/g, "_")}`;
  $("openReport").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL(`report/report.html?rec=${encodeURIComponent(rec)}&lang=${state.lang}`) });
  $("exportCapture").onclick = () => download(`${base}-capture.json`, captureJson(run, { ...opts, extensionVersion: chrome.runtime.getManifest().version }), "application/json");
  $("exportHtml").onclick = () => download(`${base}-report.html`, reportHtml(run, opts, { redacted: true }), "text/html");
  await showHistory();
}

async function showHistory() {
  const host = hostOf(state.tab?.url);
  const list = (await listRecordings()).filter((r) => r.host === host && r.stoppedAt);
  $("recordings").replaceChildren(...list.map((r) => {
    const when = new Date(r.startedAt).toLocaleString(state.lang === "tr" ? "tr-TR" : "en-GB", { dateStyle: "short", timeStyle: "short" });
    const open = el("button", { type: "button", class: "quiet", text: m().open });
    open.onclick = () => showResult(r.id);
    const del = el("button", { type: "button", class: "quiet", text: m().delete });
    del.onclick = async () => { await deleteRecording(r.id); await showHistory(); };
    return el("li", {}, el("span", {}, el("span", { text: when }), el("br"), el("span", { class: "meta", text: r.summary?.verdict ?? "" })), el("span", {}, open, del));
  }));
  $("historyEmpty").hidden = list.length > 0;
}

// ---------- state ----------

// Opened as a page (panel.html?tab=<id>) instead of in the side panel, it follows that tab: for a separate window,
// and for the end-to-end test, which cannot open Chrome's side panel.
const PINNED_TAB = Number(new URLSearchParams(location.search).get("tab")) || null;

async function refresh() {
  if (PINNED_TAB) state.tab = await chrome.tabs.get(PINNED_TAB).catch(() => null);
  else [state.tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = state.tab?.url ?? "";
  $("host").textContent = hostOf(url) || "—";
  const { recording } = isWeb(url) ? await send({ type: "state", tabId: state.tab.id }) : { recording: null };
  state.recording = recording;
  const on = Boolean(recording);
  $("pill").textContent = on ? m().recording : m().idle;
  $("pill").classList.toggle("on", on);
  $("record").hidden = on;
  $("record").disabled = !isWeb(url);
  $("stop").hidden = !on;
  $("live").hidden = !on;
  $("hint").textContent = !isWeb(url) ? m().notWebPage : on ? m().hintRecording : m().hintIdle;
  if (on && state.rec !== recording.rec) {
    state.rec = recording.rec;
    $("result").hidden = true;
    await replayFeed(recording.rec);
  }
  await loadPlan();
  await showHistory();
}

// ---------- wiring ----------

$("record").onclick = async () => {
  const url = state.tab?.url;
  if (!isWeb(url)) return;
  // Asked here, from the click, as Chrome requires: access to the site's pages and to the tracking hosts they call.
  const granted = await chrome.permissions.request({ origins: ["http://*/*", "https://*/*"] }).catch(() => false);
  if (!granted) {
    $("hint").textContent = m().permissionDenied;
    return;
  }
  $("result").hidden = true;
  const { rec } = await send({ type: "start", tabId: state.tab.id, url });
  state.rec = rec;
  await replayFeed(rec);
  await refresh();
};

$("stop").onclick = async () => {
  const { rec } = await send({ type: "stop", tabId: state.tab.id });
  await refresh();
  $("hint").textContent = m().hintStopped;
  if (rec) await showResult(rec);
};

$("stepForm").onsubmit = async (ev) => {
  ev.preventDefault();
  const label = $("stepName").value.trim();
  if (!label || !state.recording) return;
  await send({ type: "step", tabId: state.tab.id, label });
  $("stepName").value = "";
};

$("planFile").onchange = async (ev) => {
  const file = ev.target.files?.[0];
  ev.target.value = "";
  if (!file) return;
  const { plan, error } = readPlan(await file.text());
  $("planError").hidden = !error;
  if (error) {
    $("planError").textContent = m()[error];
    return;
  }
  await savePlan({ name: file.name, plan });
};
$("planClear").onclick = () => savePlan(null);

$("lang").onchange = async (ev) => {
  state.lang = ev.target.value;
  await chrome.storage.local.set({ lang: state.lang });
  applyStrings();
  counts();
  await refresh();
  // The findings are written in the report language, so the result on screen is checked again in the new one.
  if (state.shown && !$("result").hidden) await showResult(state.shown);
};

$("mask").onchange = async (ev) => {
  state.mask = ev.target.checked;
  await chrome.storage.local.set({ mask: state.mask });
  if (state.rec) await replayFeed(state.rec);
};

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "recorded" && msg.rec === state.rec && state.recording) showEvent(msg.event);
});
chrome.tabs.onActivated.addListener(() => refresh());
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId === state.tab?.id && info.url) refresh();
});

await loadLanguage();
state.mask = Boolean((await chrome.storage.local.get("mask")).mask);
$("mask").checked = state.mask;
applyStrings();
await refresh();
counts();
