// The service worker: sees the recorded tab's tracking requests (webRequest), its page loads and route changes
// (webNavigation) and its cookies, takes the page hook's events from bridge.js, and writes each one to IndexedDB as
// it arrives. Chrome stops an idle worker after about 30 seconds, so nothing that matters lives only in memory:
// which tabs are recording is in chrome.storage.session, the events are in IndexedDB.
import { providerOf } from "./core/parsers.js";
import { siteOf } from "./core/redact.js";
import { messages } from "./core/i18n.js";
import { containersInPage, googleConsentStateInPage, pageProblemInPage } from "./core/page-hook.js";
import { bodyText } from "./lib/body.js";
import { addEvents, prune, putRecording, getRecording } from "./lib/store.js";

const SCRIPT_IDS = ["aitd-bridge", "aitd-hook"];

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

// ---------- which tabs are recording ----------

/**
 * { [tabId]: { rec, origin, host } }, kept in session storage so a restarted worker still knows, and in memory so the
 * request listener, which sees every request of every tab, doesn't read storage each time.
 */
let activeCache = null;
async function active() {
  activeCache ??= (await chrome.storage.session.get("active")).active ?? {};
  return { ...activeCache };
}
async function setActive(map) {
  activeCache = { ...map };
  await chrome.storage.session.set({ active: map });
  await syncScripts(map);
}
async function recordingFor(tabId) {
  if (tabId === undefined || tabId < 0) return null;
  return (await active())[tabId] ?? null;
}
async function language() {
  return (await chrome.storage.local.get("lang")).lang ?? (chrome.i18n.getUILanguage().toLowerCase().startsWith("tr") ? "tr" : "en");
}

/** The page hook and its bridge run on the recorded sites only, in every frame, before the site's own scripts. */
async function syncScripts(map) {
  const origins = [...new Set(Object.values(map).map((a) => a.origin))];
  await chrome.scripting.unregisterContentScripts({ ids: SCRIPT_IDS }).catch(() => {});
  if (!origins.length) return;
  const matches = origins.map((o) => `${o}/*`);
  await chrome.scripting.registerContentScripts([
    { id: "aitd-bridge", matches, js: ["bridge.js"], runAt: "document_start", allFrames: true, world: "ISOLATED", persistAcrossSessions: false },
    { id: "aitd-hook", matches, js: ["core/page-hook-main.js"], runAt: "document_start", allFrames: true, world: "MAIN", persistAcrossSessions: false },
  ]);
}

// ---------- events ----------

let seq = 0;
const counts = new Map(); // rec -> { hits, pushes, steps }

async function record(rec, event, tabId) {
  const e = { t: Date.now(), seq: ++seq, ...event };
  await addEvents(rec, [e]);
  const c = counts.get(rec) ?? { requests: 0, pushes: 0, steps: 0 };
  if (event.kind === "request") c.requests += 1;
  if (event.kind === "push") c.pushes += 1;
  if (event.kind === "step") c.steps += 1;
  counts.set(rec, c);
  if (event.kind === "request" && tabId !== undefined) chrome.action.setBadgeText({ tabId, text: String(Math.min(c.requests, 999)) }).catch(() => {});
  // The panel shows hits as they land; it may be closed, which is fine.
  chrome.runtime.sendMessage({ type: "recorded", rec, event: e }).catch(() => {});
}

async function hashOf(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).slice(0, 16);
}

/** The site's cookies by name and domain, with a short hash of each value so a change shows but the value never leaves. */
async function snapshotCookies(rec, tabId, url) {
  let host;
  try { host = new URL(url).hostname; } catch { return; }
  const cookies = await chrome.cookies.getAll({ domain: siteOf(host) }).catch(() => []);
  const out = [];
  for (const c of cookies) out.push({ name: c.name, domain: c.domain, hash: await hashOf(c.value) });
  await record(rec, { kind: "cookies", cookies: out }, tabId);
}

/**
 * What the CLI reads after every step (AuditSession.observe): the containers Google's registry holds (the ones that
 * ran), the preload hints, the Google tag's consent state and whether the page is a bot challenge or crashed. Read
 * in the page itself, top frame only, with the same functions the CLI uses.
 */
async function readPage(rec, tabId) {
  const run = (func) => chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: "MAIN", func })
    .then(([r]) => r?.result ?? null, () => null);
  const [found, tagConsent, problem] = await Promise.all([run(containersInPage), run(googleConsentStateInPage), run(pageProblemInPage)]);
  if (!found && !tagConsent && !problem) return;
  await record(rec, { kind: "page", registry: found?.registry ?? [], preloads: found?.preloads ?? [], tagConsent, problem }, tabId);
}

/** Reads the page now and again a little later: GTM often registers after the load event. */
function readPageSoon(rec, tabId) {
  readPage(rec, tabId).catch(() => {});
  setTimeout(() => readPage(rec, tabId).catch(() => {}), 2500);
}

const pathOf = (url) => {
  try { const u = new URL(url); return u.pathname + (u.search ? "?…" : ""); } catch { return url; }
};

// ---------- network ----------

const recorded = new Set(); // request ids recorded, so their status is too

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // Returning nothing keeps the request untouched; the work happens after.
    (async () => {
      const a = await recordingFor(details.tabId);
      if (!a || !providerOf(details.url)) return;
      recorded.add(details.requestId);
      const body = details.method === "POST" ? await bodyText(details.requestBody) : null;
      await record(a.rec, {
        kind: "request", requestId: details.requestId, url: details.url, method: details.method,
        type: details.type === "xmlhttprequest" ? "xhr" : details.type === "main_frame" || details.type === "sub_frame" ? "document" : details.type,
        frameId: details.frameId, initiator: details.initiator ?? null, ...(body !== null ? { body } : {}),
      }, details.tabId);
    })().catch(() => {});
  },
  { urls: ["http://*/*", "https://*/*"] },
  ["requestBody"],
);

const onDone = (details, status) => {
  if (!recorded.has(details.requestId)) return;
  recorded.delete(details.requestId);
  recordingFor(details.tabId).then((a) => a && record(a.rec, { kind: "status", requestId: details.requestId, status })).catch(() => {});
};
chrome.webRequest.onCompleted.addListener((d) => onDone(d, d.statusCode), { urls: ["http://*/*", "https://*/*"] });
chrome.webRequest.onErrorOccurred.addListener((d) => onDone(d, "failed"), { urls: ["http://*/*", "https://*/*"] });

// ---------- navigation ----------

chrome.webNavigation.onCommitted.addListener(async (d) => {
  if (d.frameId !== 0) return;
  const a = await recordingFor(d.tabId);
  if (!a) return;
  const m = messages(await language()).extension;
  await record(a.rec, { kind: "step", action: "navigate", url: d.url, label: m.stepOpened(pathOf(d.url)) }, d.tabId);
});

// A single-page app changes its route without a page load; each route is its own step, as Analytics Debugger shows it.
chrome.webNavigation.onHistoryStateUpdated.addListener(async (d) => {
  if (d.frameId !== 0) return;
  const a = await recordingFor(d.tabId);
  if (!a) return;
  const m = messages(await language()).extension;
  await record(a.rec, { kind: "step", action: "route", url: d.url, label: m.stepRoute(pathOf(d.url)) }, d.tabId);
  setTimeout(() => readPage(a.rec, d.tabId).catch(() => {}), 1500);
});

chrome.webNavigation.onCompleted.addListener(async (d) => {
  if (d.frameId !== 0) return;
  const a = await recordingFor(d.tabId);
  if (!a) return;
  await snapshotCookies(a.rec, d.tabId, d.url);
  readPageSoon(a.rec, d.tabId);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const a = await recordingFor(tabId);
  if (a) await stop(tabId);
});

// ---------- the panel and the page hook ----------

async function start(tabId, url) {
  const u = new URL(url);
  const map = await active();
  if (map[tabId]) return { rec: map[tabId].rec };
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const host = u.hostname.replace(/^www\./, "");
  const rec = `${host}/${stamp}`;
  const { plans = {} } = await chrome.storage.local.get("plans");
  await putRecording({ id: rec, host, site: u.origin, startedAt: now.getTime(), stoppedAt: null, lang: await language(), plan: plans[host] ?? null });
  await prune(host);
  map[tabId] = { rec, origin: u.origin, host };
  await setActive(map);
  await snapshotCookies(rec, tabId, url);
  // A reload records the page from its first request, with the hook in place before the site's scripts run.
  await chrome.tabs.reload(tabId);
  return { rec };
}

async function stop(tabId) {
  const map = await active();
  const a = map[tabId];
  if (!a) return { rec: null };
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab?.url) await snapshotCookies(a.rec, tabId, tab.url);
  await readPage(a.rec, tabId).catch(() => {});
  delete map[tabId];
  await setActive(map);
  const recording = await getRecording(a.rec);
  if (recording) await putRecording({ ...recording, stoppedAt: Date.now() });
  chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  return { rec: a.rec };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const fromExtensionPage = sender.id === chrome.runtime.id && String(sender.url ?? "").startsWith(chrome.runtime.getURL(""));
  // From bridge.js: an event the page hook saw. The page could send the same, so it is stored as data only.
  if (msg?.type === "page" && sender.tab && !fromExtensionPage) {
    recordingFor(sender.tab.id).then((a) => {
      if (!a || !["push", "load", "message"].includes(msg.kind)) return;
      return record(a.rec, { kind: msg.kind, entry: msg.entry, frameUrl: String(msg.frameUrl ?? ""), top: sender.frameId === 0 }, sender.tab.id);
    }).catch(() => {});
    return false;
  }
  // From the panel, an extension page: only those may start or stop a recording, never a web page's content script.
  if (!fromExtensionPage) return false;
  const run = async () => {
    if (msg.type === "start") return start(msg.tabId, msg.url);
    if (msg.type === "stop") return stop(msg.tabId);
    if (msg.type === "step") {
      const a = await recordingFor(msg.tabId);
      if (!a) return { ok: false };
      // The step that ends gets the page's state as it was, the way the CLI reads it at the end of each step.
      await readPage(a.rec, msg.tabId).catch(() => {});
      await record(a.rec, { kind: "step", action: "manual", label: String(msg.label ?? "").slice(0, 120) }, msg.tabId);
      return { ok: true };
    }
    if (msg.type === "state") return { recording: await recordingFor(msg.tabId) };
    if (msg.type === "active") return { active: await active() };
    return { error: "unknown message" };
  };
  run().then(reply, (err) => reply({ error: String(err?.message ?? err) }));
  return true;
});
