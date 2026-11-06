// Turns a recording's raw events into the run object the CLI's checks read (see collect() in src/agent.js), so
// checkRun, the metrics and the HTML report work on a hand-made recording unchanged. Values are kept as captured,
// the way --keep-bodies keeps them in the CLI: user data is marked (userData: { fields, plain }) but not replaced.
// redactRun() replaces it on the way out: exports and anything sent to a model.
import { parseTrackingRequest, providerOf, vendorOf } from "../core/parsers.js";
import { redactBody, redactParams, redactPush, redactUrl, siteOf } from "../core/redact.js";
import { splitRun } from "../core/frames.js";
import { callersOf, containerOf } from "../core/containers.js";
import { messages } from "../core/i18n.js";

/** The same caps as AuditSession's LOG_LIMITS and body budget, so a long recording cannot grow without bound. */
export const LIMITS = { hits: 5000, dataLayerLog: 5000, network: 10000, containerLoads: 500, frameMessages: 1000, cookieLog: 500, cookieChanges: 2000 };
export const MAX_BODY = 32 * 1024;
export const MAX_TOTAL_BODIES = 2 * 1024 * 1024;

const hostOf = (url) => {
  try { return new URL(url).hostname || null; } catch { return null; }
};
const originOf = (url) => {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.origin : null; } catch { return null; }
};
/** Where a page is, without query or fragment, as the CLI keeps container load pages. */
export const pagePath = (href) => {
  try { const u = new URL(href); return /^https?:$/.test(u.protocol) ? u.origin + u.pathname : null; } catch { return null; }
};

/** The iframe something came from, as src/frames.js frameInfo() describes one; null for the page itself. */
function frameOf(frameUrl, topUrl) {
  const o = originOf(frameUrl);
  const top = (() => { try { return new URL(topUrl); } catch { return null; } })();
  if (!o || !top || !/^https?:$/.test(top.protocol)) return null;
  return { origin: o, party: siteOf(new URL(o).hostname) === siteOf(top.hostname) ? "site" : "third", parent: top.origin + top.pathname };
}

/** userData { fields, plain } for what redaction would replace in a hit, or null; the hit itself is left as it is. */
function userDataOfHit(hit, userFields, site) {
  const found = { fields: [], plain: [] };
  redactUrl(hit.url, found, site);
  redactParams(hit.params, found, site);
  redactParams(userFields, found, site);
  return found.fields.length ? { fields: [...new Set(found.fields)], plain: [...new Set(found.plain)] } : null;
}

function userDataOfPush(value, site) {
  const found = redactPush(value, { fields: [], plain: [] }, site);
  return found.fields.length ? { fields: [...new Set(found.fields)], plain: [...new Set(found.plain)] } : null;
}

/** The run's own words (the start step, the journey's goal and note) in a report language. */
export const labelsFor = (lang) => {
  const m = messages(lang).extension;
  return { start: m.stepStart, goal: m.runGoal, note: m.runNote };
};

/** Event kinds a recording stores; see extension/worker.js and extension/bridge.js. */
export const KINDS = ["step", "request", "status", "push", "load", "message", "cookies", "error"];

/**
 * The run for one recording.
 * @param {object[]} events the recording's events in the order they were stored ({ t, seq, kind, ... })
 * @param {{ site: string, startedAt?: number, labels?: { start: string, goal: string, note: string } }} info labels: the
 *   start step's name and the journey's goal and note in the report's language (messages(lang).extension).
 */
export function buildRun(events, info) {
  const labels = { ...labelsFor("en"), ...info.labels };
  const sorted = [...events].sort((a, b) => (a.t ?? 0) - (b.t ?? 0) || (a.seq ?? 0) - (b.seq ?? 0));
  const steps = [];
  const hits = [];
  const dataLayerLog = [];
  const network = [];
  const containerLoads = [];
  const containerPreloads = new Map();
  const frameMessages = [];
  const cookieLog = [];
  const cookieChanges = [];
  const pageErrors = [];
  const providers = [];
  const calls = new Map();
  const statuses = new Map();
  let cookieHashes = null;
  let topUrl = info.site;
  let seq = 0;
  let bodyBytes = 0;
  let bodyBudgetStep = null;
  const full = new Set();
  const current = () => Math.max(0, steps.length - 1);
  const add = (log, list, entry) => {
    if (list.length >= LIMITS[log]) {
      if (!full.has(log)) pageErrors.push({ step: current(), message: `Recording limit reached (${LIMITS[log]} ${log} entries); later entries were dropped.` });
      full.add(log);
      return false;
    }
    list.push(entry);
    return true;
  };
  const step = (label, extra = {}) => steps.push({ index: steps.length, label, ...extra });

  for (const e of sorted) if (e.kind === "status") statuses.set(e.requestId, e.status);

  for (const e of sorted) {
    if (e.kind === "step") {
      if (e.url) topUrl = e.url;
      // Two navigations to the same address in a row (a reload as recording starts) stay one step.
      const last = steps.at(-1);
      if (last && e.action !== "manual" && last.url === e.url && last.action === e.action && e.t - last.t < 2000) continue;
      step(String(e.label ?? "").slice(0, 120) || `Step ${steps.length}`, { t: e.t, action: e.action ?? "manual", ...(e.url ? { url: e.url } : {}) });
      continue;
    }
    if (!steps.length) step(labels.start, { t: e.t, action: "start", url: topUrl });
    const site = hostOf(topUrl);
    if (e.kind === "request") {
      const provider = providerOf(e.url);
      if (!provider) continue;
      const frame = e.frameId && e.frameId !== 0 ? frameOf(e.initiator ?? e.frameUrl, topUrl) : null;
      const parsed = parseTrackingRequest(e.url, e.body ?? null) ?? [];
      for (const { userFields, ...hit } of parsed) {
        if (!providers.includes(hit.platform)) providers.push(hit.platform);
        const userData = userDataOfHit(hit, userFields, hostOf(hit.params?.page_location) ?? site);
        add("hits", hits, { ...hit, ...(userData ? { userData } : {}), step: current(), pageUrl: topUrl, t: e.t, seq: ++seq, ...(frame ? { frame } : {}) });
      }
      let body = {};
      if (e.body != null && e.method === "POST" && parsed.length) {
        const text = String(e.body).slice(0, MAX_BODY);
        if (bodyBytes + text.length > MAX_TOTAL_BODIES) {
          bodyBudgetStep ??= current();
          body = { bodyDropped: true };
        } else {
          bodyBytes += text.length;
          body = { postData: text };
        }
      }
      const call = {
        step: current(), pageUrl: topUrl, t: e.t, method: e.method ?? "GET", url: e.url, type: e.type ?? "other",
        vendor: vendorOf(e.url), provider: provider.key, ...body, blocked: false,
        status: statuses.has(e.requestId) ? statuses.get(e.requestId) : null, ...(frame ? { frame } : {}),
      };
      if (add("network", network, call)) calls.set(e.requestId, call);
      continue;
    }
    if (e.kind === "push") {
      const frame = e.top === false ? frameOf(e.frameUrl, topUrl) : null;
      const entry = e.entry ?? {};
      const userData = userDataOfPush(entry.value, site);
      add("dataLayerLog", dataLayerLog, { url: entry.url ?? e.frameUrl ?? topUrl, value: entry.value, ...(entry.layer ? { layer: entry.layer } : {}), ...(userData ? { userData } : {}), ...(frame ? { frame } : {}), step: current(), t: e.t, seq: ++seq });
      continue;
    }
    if (e.kind === "load") {
      const entry = e.entry ?? {};
      const container = containerOf(entry.src);
      if (!container) continue;
      const frame = e.top === false ? frameOf(e.frameUrl, topUrl) : null;
      if (entry.how === "preload") {
        const k = `${container.id}|${container.host}`;
        if (!frame && !containerPreloads.has(k)) containerPreloads.set(k, { id: container.id, host: container.host, step: current(), page: pagePath(entry.page) });
        continue;
      }
      add("containerLoads", containerLoads, {
        ...container, how: entry.how === "parser" ? "parser" : "script",
        ...(entry.how === "parser" ? {} : { callers: callersOf(entry.frames, entry.documentUrl) }),
        page: pagePath(entry.page), doc: String(entry.doc ?? "").slice(0, 16), step: current(), t: e.t, ...(frame ? { frame } : {}),
      });
      continue;
    }
    if (e.kind === "message") {
      if (e.top === false) continue;
      const m = e.entry ?? {};
      let party = "third";
      try { party = siteOf(new URL(m.origin).hostname) === siteOf(new URL(topUrl).hostname) ? "site" : "third"; } catch { /* an opaque origin */ }
      add("frameMessages", frameMessages, {
        origin: String(m.origin).slice(0, 200), party, name: String(m.name ?? "").slice(0, 80), ...(m.nameKey ? { nameKey: String(m.nameKey).slice(0, 20) } : {}),
        keys: (Array.isArray(m.keys) ? m.keys : []).slice(0, 20).map((k) => String(k).slice(0, 40)), step: current(), t: e.t, seq: ++seq,
      });
      continue;
    }
    if (e.kind === "cookies") {
      // Names and a short hash of each value only, as AuditSession.trackCookies keeps them.
      const seen = new Set(cookieLog.map((c) => `${c.domain}|${c.name}`));
      const now = new Map();
      for (const c of e.cookies ?? []) {
        const k = `${c.domain}|${c.name}`;
        now.set(k, c.hash);
        if (!seen.has(k) && cookieLog.length < LIMITS.cookieLog) cookieLog.push({ name: c.name, domain: c.domain, step: current() });
        if (cookieHashes) {
          const before = cookieHashes.get(k);
          const change = before === undefined ? "added" : before !== c.hash ? "changed" : null;
          if (change && cookieChanges.length < LIMITS.cookieChanges) cookieChanges.push({ step: current(), name: c.name, domain: c.domain, change });
        } else if (cookieChanges.length < LIMITS.cookieChanges) cookieChanges.push({ step: current(), name: c.name, domain: c.domain, change: "added" });
      }
      for (const k of cookieHashes?.keys() ?? []) {
        if (now.has(k) || cookieChanges.length >= LIMITS.cookieChanges) continue;
        const [domain, ...name] = k.split("|");
        cookieChanges.push({ step: current(), name: name.join("|"), domain, change: "removed" });
      }
      cookieHashes = now;
      continue;
    }
    if (e.kind === "error") pageErrors.push({ step: current(), message: String(e.message ?? "").slice(0, 300) });
  }
  if (!steps.length) step(labels.start, { t: info.startedAt ?? Date.now(), action: "start", url: topUrl });
  for (const [id, call] of calls) if (call.status === null && statuses.has(id)) call.status = statuses.get(id);

  return {
    journeyId: "recording",
    viewport: "desktop",
    goal: labels.goal,
    completed: true,
    note: labels.note,
    ...splitRun({ hits, containerLoads, dataLayerLog }),
    steps,
    consentStep: null,
    rejectStep: null,
    loginStep: null,
    cookieLog,
    cookieChanges,
    // A hand recording lets every hit through to the site's real accounts; the report says so.
    live: true,
    containerLoads,
    containerScripts: [],
    containersRunning: [],
    containerPreloads: [...containerPreloads.values()],
    frameMessages,
    network,
    providers,
    skipped: {},
    bodyBudgetStep,
    startedAt: info.startedAt ?? steps[0]?.t ?? Date.now(),
    pageErrors,
    landing: null,
    source: "extension",
  };
}

/**
 * The run with user data replaced, for anything that leaves the extension: exported files and model requests.
 * Hits, pushes and network calls go through src/redact.js the way AuditSession redacts at capture in the CLI.
 */
export function redactRun(run) {
  const siteFor = (url) => hostOf(url);
  const hit = (h) => {
    const site = hostOf(h.params?.page_location) ?? siteFor(h.pageUrl);
    return { ...h, url: redactUrl(h.url, undefined, site).url, params: redactParams(h.params, undefined, site), pageUrl: redactUrl(h.pageUrl).url };
  };
  const push = (p) => ({ ...p, url: redactUrl(p.url).url, value: redactPush(p.value, undefined, siteFor(p.url)).value });
  return {
    ...run,
    hits: run.hits.map(hit),
    widgetHits: (run.widgetHits ?? []).map(hit),
    dataLayerLog: run.dataLayerLog.map(push),
    widgetDataLayerLog: (run.widgetDataLayerLog ?? []).map(push),
    network: run.network.map((c) => ({ ...c, url: redactUrl(c.url).url, pageUrl: redactUrl(c.pageUrl).url, ...(c.postData != null ? { postData: redactBody(c.postData).text } : {}) })),
    steps: run.steps.map((s) => (s.url ? { ...s, url: redactUrl(s.url).url } : s)),
  };
}
