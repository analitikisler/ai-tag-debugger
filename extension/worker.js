// The service worker: sees the recorded tab's tracking requests (webRequest), its page loads and route changes
// (webNavigation) and its cookies, takes the page hook's events from bridge.js, and writes each one to IndexedDB as
// it arrives. Chrome stops an idle worker after about 30 seconds, so nothing that matters lives only in memory:
// which tabs are recording is in chrome.storage.session, the events are in IndexedDB.
import { providerOf } from "./core/parsers.js";
import { siteOf } from "./core/redact.js";
import { messages } from "./core/i18n.js";
import { containersInPage, googleConsentStateInPage, pageProblemInPage } from "./core/page-hook.js";
import { detectCmpInPage } from "./core/cmp.js";
import { bodyText } from "./lib/body.js";
import { addEvents, deleteRecording, prune, putRecording, getRecording } from "./lib/store.js";
import { POLL_LIMIT, isTraceList, matchTrace, mayMatch, serverOrigin, slimTrace } from "./lib/server.js";

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
/** The reloaded page committed: from now on its requests and pushes are recorded. */
async function arm(tabId) {
  const map = await active();
  if (!map[tabId]) return;
  map[tabId] = { ...map[tabId], armed: true };
  activeCache = { ...map };
  await chrome.storage.session.set({ active: map });
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

/**
 * The site's cookies by name and domain, with a short hash of each value so a change shows but the value never leaves.
 * HttpOnly and the expiry come along: a server container's cookies (FPID) are HttpOnly, which is how the panel tells
 * them from the ones a tag wrote in the page.
 */
async function snapshotCookies(rec, tabId, url) {
  let host;
  try { host = new URL(url).hostname; } catch { return; }
  const cookies = await chrome.cookies.getAll({ domain: siteOf(host) }).catch(() => []);
  const out = [];
  for (const c of cookies) {
    out.push({ name: c.name, domain: c.domain, hash: await hashOf(c.value), httpOnly: c.httpOnly, secure: c.secure, ...(c.expirationDate ? { expirationDate: Math.round(c.expirationDate) } : {}) });
  }
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
  const [found, tagConsent, problem, title, cmp] = await Promise.all([run(containersInPage), run(googleConsentStateInPage), run(pageProblemInPage), run(() => document.title), run(detectCmpInPage)]);
  if (!found && !tagConsent && !problem) return;
  // Only the consent platform's name is kept: the panel says "Efilli banner detected", nothing more.
  await record(rec, { kind: "page", registry: found?.registry ?? [], preloads: found?.preloads ?? [], tagConsent, problem, title: String(title ?? "").slice(0, 200), ...(cmp?.vendor ? { cmp: { vendor: String(cmp.vendor).slice(0, 60) } } : {}) }, tabId);
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
      // Until the reloaded page commits, requests are the old page's goodbye (its user_engagement, sent under its
      // consent), not part of the visit being recorded.
      if (a?.armed === false) return;
      // A server container's or the tag gateway's /_/set_cookie call is kept too: it is how first-party cookies get set.
      if (!a || (!providerOf(details.url) && !/\/_\/set_cookie\/?(\?|$)/.test(details.url))) return;
      recorded.add(details.requestId);
      const body = details.method === "POST" ? await bodyText(details.requestBody) : null;
      await record(a.rec, {
        kind: "request", requestId: details.requestId, url: details.url, method: details.method,
        type: details.type === "xmlhttprequest" ? "xhr" : details.type === "main_frame" || details.type === "sub_frame" ? "document" : details.type,
        frameId: details.frameId, initiator: details.initiator ?? null, ...(body !== null ? { body } : {}),
      }, details.tabId);
      if (a.server && new URL(details.url).origin === a.server) await expectTrace(a.rec, details);
    })().catch(() => {});
  },
  { urls: ["http://*/*", "https://*/*"] },
  ["requestBody"],
);

// The page's own HTTP status, for the step header (a 404 or 500 page explains a step that sent nothing).
chrome.webRequest.onCompleted.addListener((d) => {
  if (d.type !== "main_frame") return;
  recordingFor(d.tabId).then((a) => a && record(a.rec, { kind: "doc", url: d.url, status: d.statusCode }, d.tabId)).catch(() => {});
}, { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] });

// A server container that names itself (the ai tagging server's x-tagging-server header): the name only.
const softwareOf = (headers) => {
  const v = headers?.find((h) => h.name.toLowerCase() === "x-tagging-server")?.value ?? "";
  return /^[\w.-]{1,40}$/.test(v) ? v : null;
};
const onDone = (details, status, software = null) => {
  if (!recorded.has(details.requestId)) return;
  recorded.delete(details.requestId);
  recordingFor(details.tabId).then((a) => a && record(a.rec, { kind: "status", requestId: details.requestId, status, ...(software ? { software } : {}) })).catch(() => {});
};
chrome.webRequest.onCompleted.addListener((d) => onDone(d, d.statusCode, softwareOf(d.responseHeaders)), { urls: ["http://*/*", "https://*/*"] }, ["responseHeaders"]);
chrome.webRequest.onErrorOccurred.addListener((d) => onDone(d, "failed"), { urls: ["http://*/*", "https://*/*"] });

// ---------- navigation ----------

chrome.webNavigation.onCommitted.addListener(async (d) => {
  if (d.frameId !== 0) return;
  const a = await recordingFor(d.tabId);
  if (!a) return;
  if (a.armed === false) await arm(d.tabId);
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

/** Clears a site's cookies and storage, so a recording starts as a first-time visitor and the consent banner shows. */
async function clearSite(origin) {
  await chrome.browsingData.remove({ origins: [origin] }, { cookies: true, localStorage: true, cacheStorage: true, indexedDB: true, serviceWorkers: true }).catch(() => {});
}

// ---------- the ai tagging server ----------

/** The server connected for a site, { url, token }, kept on this computer only. */
async function serverFor(host) {
  const { servers = {} } = await chrome.storage.local.get("servers");
  return servers[host] ?? null;
}

/** GET on the server's admin API with its token. The token goes to that server only, never anywhere else. */
async function adminGet(srv, path) {
  const res = await fetch(`${srv.url}${path}`, { headers: { authorization: `Bearer ${srv.token}` }, credentials: "omit", cache: "no-store" });
  if (!res.ok) throw Object.assign(new Error(String(res.status)), { status: res.status });
  return res.json();
}

/** Whether these details reach an ai tagging server: the latest trace id, or why not ("401", "404", "network"). */
async function testServer(url, token) {
  const origin = serverOrigin(url);
  if (!origin) return { ok: false, error: "url" };
  try {
    const json = await adminGet({ url: origin, token }, "/admin/api/traces?limit=1");
    return isTraceList(json) ? { ok: true, url: origin, latest: json.latest } : { ok: false, error: "not" };
  } catch (err) {
    return { ok: false, error: err.status ? String(err.status) : "network" };
  }
}

const traceKey = (rec) => `srv:${rec}`;
const polls = new Map(); // rec -> timer
// Requests arrive in bursts while a poll runs; one at a time, so neither overwrites the other's pending list.
let serverQueue = Promise.resolve();
const serially = (fn) => (...args) => (serverQueue = serverQueue.then(() => fn(...args)).catch(() => {}));

/** A request to the server this recording sent: its trace is fetched on the next poll. */
const expectTrace = serially(async (rec, details) => {
  const key = traceKey(rec);
  const s = (await chrome.storage.session.get(key))[key];
  if (!s) return;
  const u = new URL(details.url);
  s.pending = [...s.pending.slice(-199), { requestId: details.requestId, path: u.pathname, query: u.search.slice(1), t: Date.now() }];
  await chrome.storage.session.set({ [key]: s });
  schedulePoll(rec, 1500);
});

function schedulePoll(rec, ms) {
  if (polls.has(rec)) return;
  polls.set(rec, setTimeout(() => { polls.delete(rec); pollTraces(rec).catch(() => {}); }, ms));
}

/**
 * Reads the traces newer than the last one seen and keeps those of this recording's requests, matched by path and
 * query (see matchTrace). Requests still without a trace are asked about again for 30 seconds.
 */
const pollTraces = serially(async (rec) => {
  const key = traceKey(rec);
  const s = (await chrome.storage.session.get(key))[key];
  if (!s?.pending.length) return;
  const srv = await serverFor(s.host);
  if (!srv) return;
  let list;
  try {
    list = await adminGet(srv, `/admin/api/traces?after=${s.last}&limit=${POLL_LIMIT}`);
  } catch (err) {
    return setStatus(rec, s, "error", err.status ? String(err.status) : "network");
  }
  if (!isTraceList(list)) return setStatus(rec, s, "error", "not");
  // Newest first from the server; oldest first here, so a request takes the first trace that fits it.
  for (const summary of [...list.traces].reverse()) {
    if (!mayMatch(summary, s.pending)) continue;
    const detail = await adminGet(srv, `/admin/api/traces/${summary.id}`).catch(() => null);
    const hit = detail && matchTrace(detail, s.pending);
    if (!hit) continue;
    s.pending = s.pending.filter((p) => p !== hit);
    await record(rec, { kind: "server", requestId: hit.requestId, trace: slimTrace(detail) });
  }
  s.last = Math.max(s.last, list.latest);
  s.pending = s.pending.filter((p) => Date.now() - p.t < 30_000);
  if (s.status !== "ok") await setStatus(rec, s, "ok");
  await chrome.storage.session.set({ [key]: s });
  if (s.pending.length) schedulePoll(rec, 2000);
});

async function setStatus(rec, s, status, detail = null) {
  if (s.status === status && s.detail === detail) return;
  s.status = status;
  s.detail = detail;
  await chrome.storage.session.set({ [traceKey(rec)]: s });
  await record(rec, { kind: "serverStatus", url: s.url, state: status, detail });
}

/** At the start of a recording: older traces are not this recording's, so polling starts after the latest. */
async function connectServer(rec, host) {
  const srv = await serverFor(host);
  if (!srv) return null;
  const test = await testServer(srv.url, srv.token);
  const s = { host, url: srv.url, last: test.latest ?? 0, pending: [], status: null, detail: null };
  await chrome.storage.session.set({ [traceKey(rec)]: s });
  await setStatus(rec, s, test.ok ? "ok" : "error", test.ok ? null : test.error);
  return srv.url;
}

async function start(tabId, url, providers = null, { reload = true, clearCookies = false } = {}) {
  const u = new URL(url);
  const map = await active();
  if (map[tabId]) return { rec: map[tabId].rec };
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const host = u.hostname.replace(/^www\./, "");
  const rec = `${host}/${stamp}`;
  const { plans = {} } = await chrome.storage.local.get("plans");
  await putRecording({ id: rec, host, site: u.origin, startedAt: now.getTime(), stoppedAt: null, lang: await language(), plan: plans[host] ?? null, providers: Array.isArray(providers) && providers.length ? providers.map(String) : null });
  await prune(host);
  // With a reload the recording starts when the new page commits (see arm); without one it starts now.
  const server = await connectServer(rec, host).catch(() => null);
  map[tabId] = { rec, origin: u.origin, host, armed: !(reload || clearCookies), ...(server ? { server } : {}) };
  await setActive(map);
  if (clearCookies) await clearSite(u.origin);
  await snapshotCookies(rec, tabId, url);
  // A reload records the page from its first request, with the hook in place before the site's scripts run.
  if (reload || clearCookies) await chrome.tabs.reload(tabId);
  else await record(rec, { kind: "step", action: "navigate", url, label: messages(await language()).extension.stepOpened(pathOf(url)) }, tabId);
  return { rec };
}

async function stop(tabId) {
  const map = await active();
  const a = map[tabId];
  if (!a) return { rec: null };
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab?.url) await snapshotCookies(a.rec, tabId, tab.url);
  await readPage(a.rec, tabId).catch(() => {});
  // The last hits' traces: the server records a hit once its sends are answered, so give it a moment.
  if (a.server) {
    clearTimeout(polls.get(a.rec));
    polls.delete(a.rec);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await pollTraces(a.rec).catch(() => {});
    clearTimeout(polls.get(a.rec));
    polls.delete(a.rec);
    await chrome.storage.session.remove(traceKey(a.rec));
  }
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
      if (!a || a.armed === false || !["push", "load", "message"].includes(msg.kind)) return;
      return record(a.rec, { kind: msg.kind, entry: msg.entry, frameUrl: String(msg.frameUrl ?? ""), top: sender.frameId === 0 }, sender.tab.id);
    }).catch(() => {});
    return false;
  }
  // From the panel, an extension page: only those may start or stop a recording, never a web page's content script.
  if (!fromExtensionPage) return false;
  const run = async () => {
    if (msg.type === "start") return start(msg.tabId, msg.url, msg.providers, { reload: msg.reload !== false, clearCookies: msg.clearCookies === true });
    // Start over: stop, then keep the recording in History or delete it, and optionally clear the site's cookies.
    if (msg.type === "reset") {
      const { rec } = await stop(msg.tabId);
      const id = rec ?? msg.rec;
      if (id && msg.keep === false) await deleteRecording(id);
      if (msg.clearCookies && msg.origin) await clearSite(msg.origin);
      return { rec: null };
    }
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
    // The ai tagging server for a site: test and save, forget, or say which one is saved (never its token).
    if (msg.type === "serverSave") {
      const test = await testServer(msg.url, String(msg.token ?? ""));
      if (!test.ok) return test;
      const { servers = {} } = await chrome.storage.local.get("servers");
      await chrome.storage.local.set({ servers: { ...servers, [String(msg.host)]: { url: test.url, token: String(msg.token) } } });
      return test;
    }
    if (msg.type === "serverRemove") {
      const { servers = {} } = await chrome.storage.local.get("servers");
      delete servers[String(msg.host)];
      await chrome.storage.local.set({ servers });
      return { ok: true };
    }
    if (msg.type === "serverGet") return { url: (await serverFor(String(msg.host)))?.url ?? null };
    if (msg.type === "active") return { active: await active() };
    return { error: "unknown message" };
  };
  run().then(reply, (err) => reply({ error: String(err?.message ?? err) }));
  return true;
});
