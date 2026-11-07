// The connection to an ai tagging server: its admin API keeps a trace of every hit it ran (which client claimed it,
// which tags fired or why not, what it sent onward). The worker polls that list while recording and keeps only the
// traces of requests this tab sent, so other visitors' hits never enter a recording. Pure, so it is tested in Node.

/** Most traces one poll asks for; the server keeps 200 by default (TRACE_BUFFER). */
export const POLL_LIMIT = 100;
/** How far a trace's time may be from the request's, for clock differences between the browser and the server. */
export const MATCH_WINDOW_MS = 60_000;

/**
 * The server's origin from what was typed: https anywhere, http only for this computer. Null for anything else.
 * @param {string} input
 */
export function serverOrigin(input) {
  let u;
  try { u = new URL(String(input ?? "").trim()); } catch { return null; }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
  return u.origin;
}

/** Whether a reply to GET /admin/api/traces is the ai tagging server's: a list of traces and the last id. */
export function isTraceList(json) {
  return Boolean(json && Array.isArray(json.traces) && Number.isInteger(json.latest));
}

const paramsOf = (query) => {
  try { return new URLSearchParams(String(query ?? "")); } catch { return new URLSearchParams(); }
};

/**
 * The request a trace belongs to, among the ones this recording sent to the server and has no trace for yet.
 * The same path, and the same query, or for GA4 the same client id, page load and hit number (the server masks
 * user data in the query it keeps, so the query alone can differ).
 * @param {object} detail GET /admin/api/traces/{id}
 * @param {{ requestId: string, path: string, query: string, t: number }[]} pending
 */
export function matchTrace(detail, pending) {
  const req = detail?.request;
  if (!req) return null;
  const at = Number(detail.at);
  const q = paramsOf(req.query);
  const ga = (p) => (p.get("cid") && p.get("_p") && p.get("_s") ? `${p.get("cid")}|${p.get("_p")}|${p.get("_s")}` : null);
  const key = ga(q);
  return pending.find((p) => {
    if (p.path !== req.path) return false;
    if (Number.isFinite(at) && Math.abs(at - p.t) > MATCH_WINDOW_MS) return false;
    if (p.query === req.query) return true;
    return key !== null && ga(paramsOf(p.query)) === key;
  }) ?? null;
}

/** Whether a trace summary could be one of these requests, before its detail is fetched. */
export function mayMatch(summary, pending) {
  return pending.some((p) => p.path === summary.path && (!Number.isFinite(Number(summary.at)) || Math.abs(Number(summary.at) - p.t) <= MATCH_WINDOW_MS));
}

const hostPath = (url) => {
  try { const u = new URL(url); return `${u.host}${u.pathname}`; } catch { return String(url ?? "").split("?")[0]; }
};

/**
 * What the panel shows of a trace: the client, each event's name, each tag's outcome and why it skipped or failed,
 * the tags whose conditions did not match, and each outgoing send by host and path. Send queries and bodies are
 * left out: they carry the visitor's (hashed) user data, which the panel has no need to keep.
 */
export function slimTrace(detail) {
  const r = detail?.result ?? null;
  const text = (v, n = 300) => (typeof v === "string" ? v.slice(0, n) : null);
  if (!r) return { id: detail?.id ?? null, at: detail?.at ?? null, status: detail?.status ?? null, error: text(detail?.error), client: null, events: [], tags: [], notFired: [], sends: [] };
  return {
    id: detail.id ?? null,
    at: detail.at ?? null,
    status: detail.status ?? r.response?.status ?? null,
    error: null,
    client: text(r.claimed_by, 80),
    clientError: text(r.client_error),
    events: (r.events ?? []).slice(0, 50).map((e) => String(e?.event_name ?? "")),
    tags: (r.tags ?? []).slice(0, 100).map((t) => ({ tag: text(t.tag, 120), event: t.event ?? 0, outcome: text(t.outcome, 20), error: text(t.error), skip: text(t.skip) })),
    notFired: (r.triggers ?? []).filter((x) => !x.fired).slice(0, 100).map((x) => ({ tag: text(x.tag, 120), event: x.event ?? 0, enabled: x.enabled !== false })),
    sends: (r.sends ?? []).slice(0, 50).map((s) => ({
      from: text(s.from, 120), method: text(s.method, 10), to: hostPath(s.url),
      status: Number.isInteger(s.result?.Ok) ? s.result.Ok : null, error: typeof s.result?.Err === "string" ? s.result.Err.slice(0, 300) : null,
    })),
  };
}

/** A trace's part for one event of a batch: its tags, the tags that did not fire, and the sends those tags made. */
export function traceForEvent(trace, index) {
  if (!trace) return null;
  if (trace.events.length <= 1) return { ...trace, event: trace.events[0] ?? null };
  const tags = trace.tags.filter((t) => t.event === index);
  // A send names the tag that made it, not the event; a tag that ran for several events keeps its sends on each.
  const names = new Set(tags.map((t) => t.tag));
  return { ...trace, event: trace.events[index] ?? null, tags, notFired: trace.notFired.filter((t) => t.event === index), sends: trace.sends.filter((s) => names.has(s.from)) };
}
