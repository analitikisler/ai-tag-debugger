// The side panel. It stays with the site being recorded (or last recorded) while you look at other tabs, shows each
// page as a step with its hits in the order they happened, and runs the CLI's checks when the recording stops.
// Every string comes from core/i18n.js (src/i18n.js).
import { LANGUAGES, messages } from "../core/i18n.js";
import { parseTrackingRequest, PROVIDERS, providerOf, vendorOf } from "../core/parsers.js";
import { redactParams, redactPush, redactUrl } from "../core/redact.js";
import { decodeGa4Item } from "../core/glossary.js";
import { buildRun, labelsFor } from "../lib/run.js";
import { analyze, captureJson, readPlan, reportHtml } from "../lib/analyze.js";
import { deleteRecording, getEvents, getRecording, listRecordings, putRecording } from "../lib/store.js";

const $ = (id) => document.getElementById(id);
const SEVERITIES = ["broken", "risk", "warning", "info"];
// GA4 parameters about the page rather than the event; shown apart, under "Page and session".
const PAGE_KEYS = new Set(["page_location", "page_referrer", "page_title", "language", "screen_resolution", "document_location", "document_referrer", "document_title"]);
const BADGES = ["_fv", "_ss", "_nsi"];
// Opened as a page (panel.html?tab=<id>) instead of in the side panel, it follows that tab: for a separate window,
// and for the end-to-end test, which cannot open Chrome's side panel.
const PINNED_TAB = Number(new URLSearchParams(location.search).get("tab")) || null;

const state = {
  lang: "en", tab: null, live: null, rec: null, recording: null, events: [], view: "events",
  filter: null, hideGtm: true, mask: false, plan: null, open: new Set(), closed: new Set(), analysis: null, notice: null,
};
const m = () => messages(state.lang).extension;

// ---------- helpers ----------

const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) n.append(c);
  return n;
};
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
const isWeb = (url) => /^https?:\/\//.test(url ?? "");
const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => ({}));
const clock = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
/** Seconds since the step began, as Analytics Debugger times rows within a page. */
const since = (t, from) => `+${Math.max(0, (t - (from ?? state.recording?.startedAt ?? t)) / 1000).toFixed(1)}s`;
const shown = (v) => (typeof v === "string" ? v : JSON.stringify(v));
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------- which site the panel is about ----------

/**
 * The tab the panel shows: a tab of this window that is recording wins, so opening the report or another tab keeps
 * the recording on screen; otherwise the active tab when it is a website; otherwise the one it already showed
 * (an extension page or chrome:// is never a site).
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
  return state.tab ?? current ?? null;
}

async function loadRecording(id) {
  state.rec = id;
  state.recording = id ? await getRecording(id) : null;
  state.events = id ? (await getEvents(id)).sort((a, b) => a.t - b.t || a.seq - b.seq) : [];
  state.analysis = null;
  state.open.clear();
  state.closed.clear();
}

async function refresh() {
  const tab = await resolveTab();
  const changed = tab?.id !== state.tab?.id || hostOf(tab?.url) !== hostOf(state.tab?.url);
  state.tab = tab;
  const { recording: live = null } = tab && isWeb(tab.url) ? await send({ type: "state", tabId: tab.id }) : {};
  state.live = live;
  if (live && live.rec !== state.rec) await loadRecording(live.rec);
  else if (!live && (changed || !state.rec)) {
    // Not recording here: the site's last recording, so a result stays on screen after Stop or a reload.
    const host = hostOf(tab?.url);
    const last = host ? (await listRecordings()).find((r) => r.host === host && r.stoppedAt) : null;
    if (last?.id !== state.rec) await loadRecording(last?.id ?? null);
  } else if (!live && state.rec) state.recording = await getRecording(state.rec);
  await loadPlan();
  render();
}

// ---------- plan ----------

async function loadPlan() {
  const host = hostOf(state.tab?.url);
  const { plans = {} } = await chrome.storage.local.get("plans");
  state.plan = host ? plans[host] ?? null : null;
}

async function savePlan(entry) {
  const host = hostOf(state.tab?.url);
  if (!host) return;
  const { plans = {} } = await chrome.storage.local.get("plans");
  if (entry) plans[host] = entry;
  else delete plans[host];
  await chrome.storage.local.set({ plans });
  await loadPlan();
  state.analysis = null;
  render();
}

// ---------- the recording as steps and rows ----------

/** Steps with their rows (one per hit; a GA4 batch is several) and pushes, in the order they happened. */
function model() {
  const status = new Map(state.events.filter((e) => e.kind === "status").map((e) => [e.requestId, e.status]));
  const steps = [];
  let cur = null;
  const open = (label, e) => { cur = { index: steps.length, label, url: e?.url ?? null, t: e?.t, rows: [], pushes: [] }; steps.push(cur); };
  for (const e of state.events) {
    if (e.kind === "step") {
      // A reload as recording starts commits the same page twice; one step, as the run builder does it.
      if (cur && e.action !== "manual" && cur.url === e.url && cur.action === e.action && e.t - cur.t < 2000) continue;
      open(e.label, e);
      cur.action = e.action;
      continue;
    }
    if (!cur) open(m().stepStart, e);
    if (e.kind === "request") {
      const hits = parseTrackingRequest(e.url, e.body ?? null) ?? [];
      const st = status.get(e.requestId);
      if (hits.length) hits.forEach((hit, i) => cur.rows.push({ key: `${e.requestId}:${i}`, platform: hit.platform, label: PROVIDERS[hit.platform] ?? hit.platform, name: hit.name, hit, e, status: st }));
      else {
        const p = providerOf(e.url);
        let path = e.url;
        try { path = new URL(e.url).pathname; } catch { /* keep the address */ }
        cur.rows.push({ key: e.requestId, platform: p?.key ?? "other", label: p?.label ?? vendorOf(e.url) ?? hostOf(e.url), name: path, e, status: st });
      }
    } else if (e.kind === "push") {
      const v = e.entry?.value;
      const name = Array.isArray(v) ? v.slice(0, 2).filter((x) => typeof x === "string").join(" ") : v?.event ?? Object.keys(v ?? {}).slice(0, 3).join(", ");
      cur.pushes.push({ key: `p${e.seq}`, name: name || "(push)", value: v, layer: e.entry?.layer ?? "dataLayer", e });
    }
  }
  return steps;
}

const failed = (s) => s === "failed" || (typeof s === "number" && s >= 400);

function kv(entries) {
  const dl = el("dl", { class: "kv" });
  for (const [k, v] of entries) dl.append(el("dt", { text: k }), el("dd", { text: shown(v) }));
  return dl;
}

/** A hit opened: its event parameters, items, consent, page and session fields, and the request. */
function hitDetail(row) {
  const s = m().sections;
  const out = [];
  const params = state.mask ? redactParams(row.hit?.params ?? {}) : row.hit?.params ?? {};
  if (row.hit) {
    const event = Object.entries(params).filter(([k]) => !PAGE_KEYS.has(k) && k !== "items");
    if (event.length) out.push(el("h4", { text: s.event }), kv(event));
    if (row.hit.items?.length) {
      const c = m().itemCols;
      const table = el("table", { class: "items" }, el("tr", {}, el("th", { text: c.name }), el("th", { text: c.id }), el("th", { class: "num", text: c.price }), el("th", { class: "num", text: c.qty })));
      for (const raw of row.hit.items.slice(0, 50)) {
        const { fields, custom } = decodeGa4Item(raw);
        const f = Object.fromEntries(fields);
        const rest = [...fields.filter(([k]) => !["item_name", "item_id", "price", "quantity"].includes(k)), ...custom].map(([k, v]) => `${k}: ${v}`).join("\n");
        table.append(el("tr", { title: rest || null }, el("td", { text: f.item_name ?? "" }), el("td", { text: f.item_id ?? "" }), el("td", { class: "num", text: f.price ?? "" }), el("td", { class: "num", text: f.quantity ?? "" })));
      }
      out.push(el("h4", { text: s.items }), table);
    }
    if (row.hit.consent) {
      out.push(el("h4", { text: s.consent }), el("div", { class: "consent" }, Object.entries(row.hit.consent).map(([k, v]) => el("span", { class: v, text: `${k} ${v === "granted" ? "✓" : v === "denied" ? "✗" : "?"}` }))));
    }
    const page = [...Object.entries(params).filter(([k]) => PAGE_KEYS.has(k)), ...Object.entries(row.hit.protocol ?? {})];
    if (page.length) out.push(el("h4", { text: s.page }), kv(page));
  }
  const url = state.mask ? redactUrl(row.e.url).url : row.e.url;
  out.push(el("h4", { text: s.request }), el("div", { class: "url", text: `${row.e.method ?? "GET"} ${typeof row.status === "number" ? row.status : row.status ?? ""}` }), el("div", { class: "url", text: url }));
  return el("div", { class: "detail" }, out);
}

function pushDetail(p) {
  const value = state.mask ? redactPush(p.value).value : p.value;
  return el("div", { class: "detail" }, el("pre", { class: "json", text: JSON.stringify(value, null, 2) }));
}

/** A collapsible row; its detail is built when it is first opened, so long recordings stay quick. */
function row(key, summary, detail) {
  const d = el("details", { open: state.open.has(key) }, el("summary", {}, summary));
  if (state.open.has(key)) d.append(detail());
  d.addEventListener("toggle", () => {
    if (d.open) { state.open.add(key); if (d.children.length === 1) d.append(detail()); } else state.open.delete(key);
  });
  return el("li", { class: "row" }, d);
}

function stepCard(st, rows, metaText) {
  const d = el("details", { class: "step", open: !state.closed.has(st.index) },
    el("summary", {}, el("span", { class: "stepno", text: String(st.index) }), el("span", { class: "steplabel", text: st.label, title: st.url ?? null }), el("span", { class: "stepmeta", text: metaText })),
    el("ol", { class: "rows" }, rows));
  d.addEventListener("toggle", () => (d.open ? state.closed.delete(st.index) : state.closed.add(st.index)));
  return d;
}

function renderEvents(steps) {
  const all = steps.flatMap((s) => s.rows);
  const platforms = [...new Map(all.map((r) => [r.platform, r.label])).entries()];
  const filters = $("filters");
  filters.replaceChildren();
  if (platforms.length > 1) {
    const chip = (key, label) => {
      const b = el("button", { class: "chip", type: "button", "aria-pressed": String(state.filter === key), text: label });
      b.onclick = () => { state.filter = state.filter === key || key === null ? null : key; render(); };
      return b;
    };
    filters.append(chip(null, m().filterAll), ...platforms.map(([k, label]) => chip(k, label)));
  }
  const list = $("eventsList");
  list.replaceChildren();
  for (const st of steps) {
    const rows = st.rows.filter((r) => !state.filter || r.platform === state.filter);
    // A page that sent nothing is worth seeing; the moment before the first page load is not.
    if (!rows.length && (state.filter || st.action === "start" || !st.action)) continue;
    list.append(stepCard(st, rows.map((r) => row(r.key, [
      el("span", { class: `plat ${r.platform}`, text: r.label, title: r.label }),
      el("span", { class: "name", title: r.name }, r.name),
      el("span", { class: "right" },
        BADGES.filter((b) => r.hit?.protocol?.[b] !== undefined).map((b) => el("span", { class: "badge", title: m().badges[b], text: b.slice(1).toUpperCase() })),
        failed(r.status) ? el("span", { class: "bad", text: r.status === "failed" ? m().failed : String(r.status) }) : null,
        el("span", { class: "time", text: since(r.e.t, st.t) })),
    ], () => hitDetail(r))), String(rows.length)));
  }
  const empty = !all.length;
  $("eventsEmpty").hidden = !empty;
  $("eventsEmpty").textContent = !isWeb(state.tab?.url) ? m().notWebPage : state.live ? m().emptyRecording : m().emptyIdle;
}

function renderPushes(steps) {
  const list = $("pushList");
  list.replaceChildren();
  let total = 0;
  for (const st of steps) {
    const pushes = st.pushes.filter((p) => !(state.hideGtm && p.name.startsWith("gtm.")));
    total += pushes.length;
    if (!pushes.length) continue;
    list.append(stepCard(st, pushes.map((p) => row(p.key, [
      el("span", { class: `plat ${Array.isArray(p.value) ? "gtag" : "push"}`, title: p.layer, text: p.layer !== "dataLayer" ? p.layer : Array.isArray(p.value) ? "gtag" : p.value?.event ? "event" : "object" }),
      el("span", { class: "name", title: p.name }, p.name),
      el("span", { class: "right" }, el("span", { class: "time", text: since(p.e.t, st.t) })),
    ], () => pushDetail(p))), String(pushes.length)));
  }
  $("pushEmpty").hidden = total > 0;
}

// ---------- findings ----------

function runOf() {
  return buildRun(state.events, { site: state.recording.site, startedAt: state.recording.startedAt, labels: labelsFor(state.lang) });
}

function analysis() {
  const key = `${state.rec}|${state.lang}|${state.events.length}|${state.plan?.name ?? ""}`;
  if (state.analysis?.key !== key) {
    const run = runOf();
    state.analysis = { key, run, ...analyze(run, { plan: state.plan?.plan ?? null, lang: state.lang }) };
    // The report tab and the history read the plan and the verdict from the recording.
    putRecording({ ...state.recording, plan: state.plan, summary: { counts: state.analysis.counts, verdict: `${state.analysis.verdict.statusText}: ${state.analysis.verdict.headline}`, hits: run.hits.length, steps: run.steps.length } }).catch(() => {});
  }
  return state.analysis;
}

function renderFindings() {
  const done = state.recording && !state.live && state.recording.stoppedAt;
  $("verdict").hidden = !done;
  $("reportActions").hidden = !done;
  $("findings").replaceChildren();
  $("findingsEmpty").hidden = Boolean(done);
  $("findingsEmpty").textContent = state.recording ? m().findingsBefore : m().emptyIdle;
  const count = $("nFindings");
  count.textContent = "";
  count.className = "count";
  if (!done) return;
  const a = analysis();
  const sev = messages(state.lang).severity;
  const v = a.verdict;
  const ring = v.status === "pass" ? "var(--ok)" : v.status === "fail" ? "var(--broken)" : "var(--warning)";
  const score = $("score");
  score.textContent = v.score ?? "–";
  score.style.setProperty("--pct", String(v.score ?? 0));
  score.style.setProperty("--ring", ring);
  score.title = m().score;
  $("verdictStatus").textContent = v.statusText;
  $("verdictStatus").style.color = ring;
  $("verdictHeadline").textContent = v.headline;
  $("sev").replaceChildren(...[...SEVERITIES, "ok"].filter((s) => a.counts[s]).map((s) => el("span", { class: `s-${s}`, text: `${a.counts[s]} ${sev[s]}` })));
  const problems = a.findings.filter((f) => SEVERITIES.includes(f.severity)).sort((x, y) => SEVERITIES.indexOf(x.severity) - SEVERITIES.indexOf(y.severity));
  const steps = a.run.steps;
  for (const f of problems) {
    const where = [f.step ?? (Number.isInteger(f.stepIndex) ? steps[f.stepIndex]?.label : null), f.platform ? PROVIDERS[f.platform] ?? f.platform : null].filter(Boolean).join(" · ");
    $("findings").append(el("li", { class: `finding ${f.severity}` }, el("div", { class: "meta" }, el("span", { class: `s-${f.severity}`, text: sev[f.severity] }), where ? el("span", { class: "where", text: where }) : null), el("div", { class: "text", text: f.detail })));
  }
  if (!problems.length) $("findings").append(el("li", { class: "finding" }, el("div", { class: "text", text: m().noFindings })));
  const worst = problems.find((f) => f.severity !== "info")?.severity;
  count.textContent = problems.filter((f) => f.severity !== "info").length || "";
  if (worst) count.classList.add(`sev-${worst}`);
}

// ---------- history ----------

async function renderHistory() {
  const host = hostOf(state.tab?.url);
  const list = host ? (await listRecordings()).filter((r) => r.host === host && r.stoppedAt) : [];
  $("recordings").replaceChildren(...list.map((r) => {
    const when = new Date(r.startedAt).toLocaleString(state.lang === "tr" ? "tr-TR" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
    const open = el("button", { class: "link", type: "button", text: m().open });
    open.onclick = async () => { await loadRecording(r.id); state.view = "findings"; render(); };
    const del = el("button", { class: "link", type: "button", text: m().delete });
    del.onclick = async () => {
      await deleteRecording(r.id);
      if (state.rec === r.id) await loadRecording(null);
      render();
    };
    const meta = [r.summary ? m().summaryLine(r.summary.hits ?? 0, r.summary.steps ?? 0) : null, r.summary?.verdict].filter(Boolean).join(" · ");
    return el("li", { class: r.id === state.rec ? "current" : null }, el("div", { class: "what" }, el("div", { class: "when", text: `${when} · ${clock(r.stoppedAt - r.startedAt)}` }), el("div", { class: "meta", text: meta, title: meta })), open, del);
  }));
  $("historyEmpty").hidden = list.length > 0;
}

// ---------- the whole panel ----------

function renderHeader() {
  const web = isWeb(state.tab?.url);
  $("host").textContent = web ? hostOf(state.tab.url) : "—";
  const status = $("status");
  status.classList.toggle("live", Boolean(state.live));
  $("statusText").textContent = state.live && state.recording ? m().recordingFor(clock(Date.now() - state.recording.startedAt))
    : state.recording?.stoppedAt ? m().stopped(clock(state.recording.stoppedAt - state.recording.startedAt))
      : web ? m().ready : m().notWebPage;
  $("record").hidden = Boolean(state.live);
  $("record").disabled = !web;
  $("stop").hidden = !state.live;
  $("stepForm").hidden = !state.live;
  $("planInfo").textContent = state.plan ? m().planShort(state.plan.name, state.plan.plan.events.length) : m().planNone;
  $("planChoose").textContent = state.plan ? m().changePlan : m().addPlan;
  $("planClear").hidden = !state.plan;
  $("notice").hidden = !state.notice;
  $("notice").textContent = state.notice ?? "";
}

let scheduled = false;
function render() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    const main = document.querySelector("main");
    // While recording, a list scrolled to its end follows new rows; one scrolled up stays where it is.
    const follow = state.live && main.scrollHeight - main.scrollTop - main.clientHeight < 40;
    renderHeader();
    for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === state.view));
    for (const v of ["events", "dataLayer", "findings", "history"]) $(`tab-${v}`).hidden = state.view !== v;
    const steps = model();
    $("nEvents").textContent = steps.reduce((n, s) => n + s.rows.length, 0) || "";
    $("nPushes").textContent = steps.reduce((n, s) => n + s.pushes.length, 0) || "";
    if (state.view === "events") renderEvents(steps);
    if (state.view === "dataLayer") renderPushes(steps);
    renderFindings();
    if (state.view === "history") renderHistory();
    if (follow) main.scrollTop = main.scrollHeight;
  });
}

function applyStrings() {
  document.documentElement.lang = state.lang;
  for (const n of document.querySelectorAll("[data-t]")) n.textContent = n.dataset.t.split(".").reduce((o, k) => o?.[k], m()) ?? "";
  $("record").textContent = m().record;
  $("stop").textContent = m().stop;
  $("stepName").placeholder = m().stepPlaceholder;
  $("lang").title = m().language;
}

// ---------- wiring ----------

$("record").onclick = async () => {
  const tab = state.tab;
  if (!isWeb(tab?.url)) return;
  // Asked here, from the click, as Chrome requires: access to the site's pages and to the tracking hosts they call.
  const granted = await chrome.permissions.request({ origins: ["http://*/*", "https://*/*"] }).catch(() => false);
  state.notice = granted ? null : m().permissionDenied;
  if (!granted) return render();
  const { rec } = await send({ type: "start", tabId: tab.id, url: tab.url });
  await loadRecording(rec ?? null);
  state.view = "events";
  await refresh();
};

$("stop").onclick = async () => {
  await send({ type: "stop", tabId: state.tab.id });
  state.view = "findings";
  await refresh();
};

$("stepForm").onsubmit = async (ev) => {
  ev.preventDefault();
  const label = $("stepName").value.trim();
  if (!label || !state.live) return;
  await send({ type: "step", tabId: state.tab.id, label });
  $("stepName").value = "";
};

$("planFile").onchange = async (ev) => {
  const file = ev.target.files?.[0];
  ev.target.value = "";
  if (!file) return;
  const { plan, error } = readPlan(await file.text());
  state.notice = error ? m()[error] : null;
  if (error) return render();
  await savePlan({ name: file.name, plan });
};
$("planClear").onclick = () => savePlan(null);

for (const b of document.querySelectorAll(".tabs button")) {
  b.onclick = () => { state.view = b.dataset.tab; render(); };
}
$("hideGtm").onchange = (ev) => { state.hideGtm = ev.target.checked; render(); };

$("openReport").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL(`report/report.html?rec=${encodeURIComponent(state.rec)}&lang=${state.lang}`) });
const exportName = () => `aitd-${state.rec.replace(/[^\w.-]+/g, "_")}`;
$("exportCapture").onclick = () => download(`${exportName()}-capture.json`, captureJson(analysis().run, { plan: state.plan?.plan ?? null, lang: state.lang, site: state.recording.site, extensionVersion: chrome.runtime.getManifest().version }), "application/json");
$("exportHtml").onclick = () => download(`${exportName()}-report.html`, reportHtml(analysis().run, { plan: state.plan?.plan ?? null, lang: state.lang, site: state.recording.site }, { redacted: true }), "text/html");

$("lang").onchange = async (ev) => {
  state.lang = ev.target.value;
  await chrome.storage.local.set({ lang: state.lang });
  state.analysis = null;
  applyStrings();
  render();
};
$("mask").onchange = async (ev) => {
  state.mask = ev.target.checked;
  await chrome.storage.local.set({ mask: state.mask });
  for (const d of document.querySelectorAll(".row details")) d.querySelector(".detail")?.remove();
  render();
};

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "recorded" || msg.rec !== state.rec) return;
  state.events.push(msg.event);
  render();
});
chrome.tabs.onActivated.addListener(() => refresh());
chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.url || info.status === "complete") refresh(); });
setInterval(() => { if (state.live) renderHeader(); }, 1000);

// ---------- start ----------

const stored = await chrome.storage.local.get(["lang", "mask"]);
state.lang = stored.lang && LANGUAGES[stored.lang] ? stored.lang : chrome.i18n.getUILanguage().toLowerCase().startsWith("tr") ? "tr" : "en";
state.mask = Boolean(stored.mask);
$("mask").checked = state.mask;
$("lang").replaceChildren(...Object.keys(LANGUAGES).map((code) => el("option", { value: code, text: code === "tr" ? "Türkçe" : "English" })));
$("lang").value = state.lang;
applyStrings();
await refresh();
