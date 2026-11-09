// How each Google container got onto the page: GTM (gtm.js) and Google tag (gtag/js) scripts, with what
// inserted them. The browser records every container script as it is added (see CONTAINER_HOOK in page-hook.js):
// parser-inserted from the HTML, or set by a script, with the scripts on the call stack at that moment. This
// module turns that into a load source: the snippet, a script tag in the HTML, another script on the page,
// a tag or Zone in another container, or a gtag config or send_to command the Google tag acted on.

// Container and destination IDs gtm.js and gtag/js are loaded with.
const CONTAINER_ID = /^(GTM|G|GT|AW|DC|MC|HA)-[A-Z0-9]+$/;

/** Whether a string is a container or Google tag ID: GTM-…, G-…, GT-…, AW-…, DC-… and the like. */
export const isContainerId = (id) => CONTAINER_ID.test(String(id));

/**
 * The container a script URL loads, or null: its ID, gtm or gtag, the dataLayer it reads (`l`), the host it
 * came from (Google's, or the site's own through the Google tag gateway or a server container) and the GTM
 * environment when one is named (`gtm_preview`). gtm_auth, the environment's token, is never kept.
 */
export function containerOf(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const id = (u.searchParams.get("id") ?? "").toUpperCase();
  if (!CONTAINER_ID.test(id)) return null;
  const script = /\/gtm\.js$/.test(u.pathname) ? "gtm" : /\/gtag\/js$/.test(u.pathname) ? "gtag" : null;
  if (!script) return null;
  // A container served from the site's own domain fetches Google's copy with gtg_health=1 to check that serving
  // works. That copy is a probe, not a second install of the container.
  if (u.searchParams.has("gtg_health")) return null;
  const environment = u.searchParams.get("gtm_preview") || (u.searchParams.has("gtm_auth") ? "unnamed" : null);
  return {
    id,
    script,
    layer: u.searchParams.get("l") || "dataLayer",
    host: u.hostname,
    served: /(^|\.)googletagmanager\.com$/.test(u.hostname) ? "google" : "site",
    ...(environment ? { environment } : {}),
  };
}

/**
 * The container version a gtm.js or gtag/js script was published as: its data opens with
 * `var data = { "resource": { "version": "153", ...`. Null when the script says nothing of the kind.
 */
export function containerVersion(text) {
  return String(text ?? "").match(/"resource"\s*:\s*\{\s*"version"\s*:\s*"(\d+)"/)?.[1] ?? null;
}

/** Whether a container script's answer means it never ran: the request failed or the server answered with an error. */
export const scriptFailed = (script) => script.status === "failed" || (typeof script.status === "number" && script.status >= 400);

/**
 * The answer to a load's script request (see recordScript in browser.js): the first one for the same container and
 * host from the load's step on, else the last before it. Null for runs saved by older versions.
 */
export function scriptOf(run, load) {
  const same = (run.containerScripts ?? []).filter((s) => s.id === load.id && s.host === load.host);
  return same.find((s) => s.step >= (load.step ?? 0)) ?? same.at(-1) ?? null;
}

/** What a row or load shows of its script's answer: { version?, bytes?, transferBytes?, ms?, failed? }. */
export function scriptFacts(script) {
  if (!script) return {};
  // A load that already carries the facts (from loadSources) passes them on as they are.
  if (!("status" in script)) return Object.fromEntries(["version", "bytes", "transferBytes", "ms", "failed"].filter((k) => script[k] != null).map((k) => [k, script[k]]));
  return {
    ...(script.version ? { version: script.version } : {}),
    ...(script.bytes ? { bytes: script.bytes } : {}),
    ...(script.transferBytes ? { transferBytes: script.transferBytes } : {}),
    ...(script.ms != null ? { ms: script.ms } : {}),
    ...(scriptFailed(script) ? { failed: String(script.status) } : {}),
  };
}

/** origin + path, so a caller's query string (which may carry user data) is never kept. */
export function scriptPath(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.origin + u.pathname : null;
  } catch {
    return null;
  }
}

/**
 * The call stack the browser captured, as callers from the innermost out: { inline: true } for script in the
 * page itself (the page's address, or "inline" for code injected without one) (the snippet, or a Custom HTML tag GTM injected), { container: id } for a container script and
 * { script: url } for any other script. Repeats in a row are folded.
 */
export function callersOf(frames, documentUrl) {
  const doc = String(documentUrl ?? "").split("#")[0];
  const out = [];
  for (const f of frames ?? []) {
    const url = String(f).split("#")[0];
    const c = containerOf(url);
    const caller = url === doc || url === "inline" ? { inline: true } : c ? { container: c.id } : scriptPath(url) ? { script: scriptPath(url) } : null;
    if (!caller) continue;
    const last = out.at(-1);
    if (last && JSON.stringify(last) === JSON.stringify(caller)) continue;
    out.push(caller);
  }
  return out;
}

const pathOf = (href) => scriptPath(href);

/** Whether a gtag command in the dataLayer names this ID: ["config", id] or ["event", name, { send_to }]. */
function commandFor(load, pushes) {
  const earlier = pushes.filter((e) => Array.isArray(e.value) && (e.t ?? 0) <= (load.t ?? Infinity) && (!load.page || pathOf(e.url) === load.page));
  if (earlier.some((e) => e.value[0] === "config" && String(e.value[1]).toUpperCase() === load.id)) return "config";
  const sendsTo = (e) => {
    const to = e.value[0] === "event" ? e.value[2]?.send_to : undefined;
    const list = Array.isArray(to) ? to : String(to ?? "").split(",");
    return list.some((s) => String(s).trim().toUpperCase().split("/")[0] === load.id);
  };
  return earlier.some(sendsTo) ? "send_to" : null;
}

/**
 * Where one recorded load came from, as { kind, by? }:
 * - html: a script tag in the page's HTML (the gtag.js snippet, or gtm.js referenced directly)
 * - inline: code in the page itself (the GTM snippet, or a hand-written loader)
 * - script: another script on the page; by is its address (a consent platform, the site's bundle)
 * - custom_html: a Custom HTML tag in the GTM container `by`
 * - google_tag: a Google tag or template in the GTM container `by`, through GTM's load_google_tags
 * - nested: GTM container `by` loaded another GTM container itself, as a Zone or a tag template does
 * - config / send_to: a gtag('config') or an event's send_to naming the ID, acted on by `by`
 * - destination: the Google tag `by` loaded it as one of its destinations, with no command in the page
 */
export function sourceOf(load, pushes = []) {
  if (load.how === "parser") return { kind: "html" };
  const callers = load.callers ?? [];
  const at = callers.findIndex((c) => c.container && c.container !== load.id);
  if (at >= 0) {
    const by = callers[at].container;
    const command = commandFor(load, pushes);
    if (command) return { kind: command, by };
    if (by.startsWith("GTM-")) {
      // Code in the page between the call and the container is a Custom HTML tag the container injected.
      if (callers.slice(0, at).some((c) => c.inline)) return { kind: "custom_html", by };
      return { kind: load.id.startsWith("GTM-") ? "nested" : "google_tag", by };
    }
    return { kind: "destination", by };
  }
  const other = callers.find((c) => c.script);
  if (other) return { kind: "script", by: other.script };
  return { kind: "inline" };
}

/** A run's container loads with their sources and their scripts' answers (scriptFacts), in the order they happened. Runs saved by older versions have none. */
export function loadSources(run) {
  const pushes = run.dataLayerLog ?? [];
  return (run.containerLoads ?? []).map((load) => ({ ...load, ...sourceOf(load, pushes), ...scriptFacts(scriptOf(run, load)) }));
}

/**
 * One row per container and source across runs, in the order first seen: { id, script, layer, served, host,
 * environment?, kind, by?, frame?, version?, bytes?, transferBytes?, ms?, failed?, ran?, pages, journeys }. frame is
 * the iframe it loaded in; version to failed are its script's answer (see scriptFacts), from the first load in the
 * row; ran says whether Google's registry held it on some step (left out for captures that didn't record it).
 * Containers the page asked for without the tool seeing a script added are rows too (see unseenContainers).
 */
export function containerRows(runs) {
  const rows = new Map();
  for (const run of runs) {
    const ran = Array.isArray(run.containersRunning) ? new Set(run.containersRunning.map((c) => c.id)) : null;
    for (const l of [...loadSources(run), ...unseenContainers(run)]) {
      const k = [l.id, l.kind, l.by ?? "", l.host, l.layer, l.environment ?? "", l.frame?.origin ?? ""].join("|");
      const row = rows.get(k) ?? {
        id: l.id, script: l.script, layer: l.layer, served: l.served, host: l.host,
        ...(l.environment ? { environment: l.environment } : {}), kind: l.kind, ...(l.by ? { by: l.by } : {}),
        ...(l.frame ? { frame: { origin: l.frame.origin, party: l.frame.party } } : {}),
        ...scriptFacts(l),
        pages: new Set(), journeys: new Set(),
      };
      if (l.page) row.pages.add(l.page);
      row.journeys.add(`${run.journeyId} (${run.viewport})`);
      // Whether it ran (Google's registry held it) in any run that recorded the registry; unknown for older captures.
      if (ran) row.ran = Boolean(row.ran) || ran.has(l.id);
      rows.set(k, row);
    }
  }
  return [...rows.values()].map((r) => ({ ...r, pages: [...r.pages].sort(), journeys: [...r.journeys] }));
}

/**
 * Containers a run met without seeing a script added for them: a script the page requested or preloaded, or an ID
 * that ran (Google's registry held it), with no load recorded. kind "preload": only a <link rel="preload"> asked for
 * it, which downloads a script without running it; "unseen": something added it in a way the tool couldn't follow,
 * as when a consent platform's auto-blocking replaces the browser's own functions. One per container and host.
 */
export function unseenContainers(run) {
  const loads = run.containerLoads ?? [];
  const loaded = (id, host) => loads.some((l) => l.id === id && (!host || l.host === host));
  const preloads = run.containerPreloads ?? [];
  const out = new Map();
  // The page a step was on: the preload's own, else the step's (see pagePath in browser.js).
  const pageAt = (step, page) => page ?? run.steps?.[step]?.pagePath ?? undefined;
  const add = (id, host, kind, step, facts = {}, page) => {
    const k = `${id}|${host ?? ""}`;
    if (out.has(k) || loaded(id, host)) return;
    const at = pageAt(step, page);
    out.set(k, {
      id, script: id.startsWith("GTM-") ? "gtm" : "gtag", layer: null,
      ...(host ? { host, served: /(^|\.)googletagmanager\.com$/.test(host) ? "google" : "site" } : {}),
      kind, step, ...(at ? { page: at } : {}), ...facts,
    });
  };
  for (const sc of run.containerScripts ?? []) {
    const pre = preloads.find((p) => p.id === sc.id && p.host === sc.host);
    add(sc.id, sc.host, pre ? "preload" : "unseen", pre?.step ?? sc.step, scriptFacts(sc), pre?.page);
  }
  for (const p of preloads) add(p.id, p.host, "preload", p.step, {}, p.page);
  for (const c of run.containersRunning ?? []) {
    if (!loaded(c.id) && ![...out.values()].some((x) => x.id === c.id)) add(c.id, null, "unseen", c.step);
  }
  return [...out.values()];
}

/**
 * GTM containers a run downloaded or asked for that never ran: Google's registry never held them on any step. Only
 * GTM containers, whose registry entry is certain; [] for captures that didn't record the registry.
 */
export function containersNotRun(run) {
  if (!Array.isArray(run.containersRunning)) return [];
  const ran = new Set(run.containersRunning.map((c) => c.id));
  const seen = new Map();
  for (const l of [...loadSources(run), ...unseenContainers(run)]) {
    if (!l.id.startsWith("GTM-") || ran.has(l.id) || l.failed || l.frame?.party === "third" || seen.has(l.id)) continue;
    seen.set(l.id, { id: l.id, kind: l.kind, step: l.step ?? 0 });
  }
  return [...seen.values()];
}

/** The containers loaded more than once into one page, as [{ id, loads }] with the loads in order. */
export function duplicateLoads(run) {
  const byDoc = new Map();
  for (const l of loadSources(run)) {
    const k = `${l.doc ?? l.page}|${l.id}`;
    byDoc.set(k, [...(byDoc.get(k) ?? []), l]);
  }
  return [...byDoc.values()].filter((list) => list.length > 1).map((loads) => ({ id: loads[0].id, loads }));
}

/** Pages where containers read different dataLayers, as [{ page, step, layers: [{ id, layer }] }]. */
export function splitLayers(run) {
  const byDoc = new Map();
  for (const l of loadSources(run)) {
    // A destination a Google tag loaded reads that tag's dataLayer, whatever its own URL says.
    if (["config", "send_to", "destination"].includes(l.kind)) continue;
    const k = l.doc ?? l.page;
    byDoc.set(k, [...(byDoc.get(k) ?? []), l]);
  }
  const out = [];
  for (const loads of byDoc.values()) {
    if (new Set(loads.map((l) => l.layer)).size < 2) continue;
    const seen = new Map(loads.map((l) => [l.id, { id: l.id, layer: l.layer }]));
    out.push({ page: loads[0].page, step: loads[0].step, layers: [...seen.values()] });
  }
  return out;
}
