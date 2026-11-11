// The parameters a hit's request carried, split into the event's own and the session, device, page and
// consent ones. Shared by the HTML report's hit cards and the MCP server's get_hit, so both show the same table.
import { parseTrackingRequest } from "./parsers.js";
import { isEventParam } from "./glossary.js";

const cell = (v) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** The network request that carried the hit. Identical hits (duplicates) are paired with identical requests in order. */
export function callsForHit(run, hit) {
  // A late hit was sent during a later step, so its request is recorded there.
  const sentIn = hit.late?.during ?? hit.step;
  const calls = (run.network ?? []).filter((c) => c.step === sentIn && c.url === hit.url);
  const twins = run.hits.filter((h) => (h.late?.during ?? h.step) === sentIn && h.url === hit.url);
  return twins.length > 1 && calls.length === twins.length ? [calls[twins.indexOf(hit)]] : calls;
}

/** Nested JSON as dotted keys (properties.value); arrays stay JSON text. */
function flatten(obj, prefix = "", out = []) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && prefix.split(".").length < 3) flatten(v, key, out);
    else out.push([key, cell(v)]);
  }
  return out;
}

/** The parameter sets a request carried: one per event in a GA4 batch (query plus each body line), the query plus a flattened JSON body, or just the query. */
export function paramSets(call) {
  let u;
  try {
    u = new URL(call.url);
  } catch {
    return [[]];
  }
  const query = [...u.searchParams];
  const body = call.postData;
  if (!body) return [query];
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    try {
      return [[...query, ...flatten(JSON.parse(trimmed))]];
    } catch { /* not JSON, or cut at the size limit */ }
  }
  if (/^[^\s{]*=/.test(trimmed)) {
    return trimmed.split(/\r?\n/).filter(Boolean).map((line) => {
      const merged = new Map(query);
      for (const [k, v] of new URLSearchParams(line)) merged.set(k, v);
      return [...merged];
    });
  }
  return [query];
}

/**
 * What a hit card shows as its parameters: the request's own parameter set (raw keys, with glossary tips), split
 * into the event's parameters and the session, device, page and consent ones. A GA4 batch carries one set per
 * event; the hit takes the set with its name. Without a captured request, the hit's parsed parameters.
 */
export function hitParams(run, hit) {
  const call = callsForHit(run, hit)[0] ?? null;
  if (!call) return { call, batch: null, event: Object.entries(hit.params ?? {}).filter(([k]) => !(k === "items" && hit.items?.length)).map(([k, v]) => [k, cell(v)]), context: [] };
  const sets = paramSets(call);
  let i = 0;
  if (sets.length > 1) {
    const names = (parseTrackingRequest(call.url, call.postData ?? null) ?? []).map((h) => h.name);
    // A batch can carry one event name twice: the hit takes the set at its own place among the same-named ones.
    const sameName = names.flatMap((name, at) => (name === hit.name ? [at] : []));
    const sentIn = hit.late?.during ?? hit.step;
    const rank = run.hits.filter((h) => (h.late?.during ?? h.step) === sentIn && h.url === hit.url && h.name === hit.name).indexOf(hit);
    i = sameName.length ? sameName[Math.max(0, rank) % sameName.length] : 0;
  }
  const entries = sets[i] ?? [];
  return { call, batch: sets.length > 1 ? [i + 1, sets.length] : null, event: entries.filter(([k]) => isEventParam(k)), context: entries.filter(([k]) => !isEventParam(k)) };
}
