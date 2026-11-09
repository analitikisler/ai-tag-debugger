// Google's server-side GTM, through its preview mode. Opening the preview link (<server>/gtm/debug?id=…&gtm_auth=…
// &gtm_preview=env-…, the address Tag Manager opens on Preview) sets three cookies on the server's domain; hits the
// browser sends with them run in preview, and <server>/gtm/get_memo returns what the container did with them: the
// client that claimed each request, every tag's status and each outgoing request. Only requests that carry this
// browser's preview cookies appear there, never other visitors'. Pure, so it is tested in Node.

/**
 * The preview link's parts, or null when it is not one: https (http only for this computer), the /gtm/debug path, a
 * GTM- container ID, gtm_auth and an env-N gtm_preview.
 * @param {string} input
 * @returns {{ url: string, id: string, auth: string, env: string } | null}
 */
export function previewLink(input) {
  let u;
  try { u = new URL(String(input ?? "").trim()); } catch { return null; }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
  if (!/\/gtm\/debug\/?$/.test(u.pathname)) return null;
  const id = u.searchParams.get("id") ?? "";
  const auth = u.searchParams.get("gtm_auth") ?? "";
  const env = u.searchParams.get("gtm_preview") ?? "";
  if (!/^GTM-[A-Z0-9]{4,12}$/.test(id) || !/^[\w-]{6,64}$/.test(auth) || !/^env-\d{1,6}$/.test(env)) return null;
  // A container behind a path prefix keeps it: <origin>/<prefix>/gtm/debug.
  return { url: u.origin + u.pathname.replace(/\/gtm\/debug\/?$/, ""), id, auth, env };
}

/** The query /gtm/debug and /gtm/get_memo take. */
export const previewQuery = (p) => new URLSearchParams({ id: p.id, gtm_auth: p.auth, gtm_preview: p.env }).toString();

/** The preview session /gtm/debug opened, from its page; null when the address is no server container with that ID. */
export function sessionOf(html) {
  return /<meta name="sgtm:debug-session" content="([\w-]{6,64})"/.exec(String(html ?? ""))?.[1] ?? null;
}

/** The messages in a /gtm/get_memo answer: JSON after Google's )]}' guard, keyed by container ID. */
export function parseMemo(text) {
  const body = String(text ?? "").replace(/^\)\]\}'[^\n]*\n?/, "").trim();
  if (!body) return [];
  try {
    const json = JSON.parse(body);
    return Object.values(json ?? {}).flatMap((list) => (Array.isArray(list) ? list : []));
  } catch { return []; }
}

const text = (v, n = 300) => (typeof v === "string" ? v.slice(0, n) : null);
const hostPath = (url) => {
  try { const u = new URL(url); return `${u.host}${u.pathname}`; } catch { return String(url ?? "").split("?")[0].slice(0, 200); }
};
const cookieNames = (headers) => {
  const list = headers?.["set-cookie"] ?? headers?.["Set-Cookie"] ?? [];
  return (Array.isArray(list) ? list : [list]).map((c) => String(c).split("=")[0].trim()).filter((n) => /^[\w.-]{1,64}$/.test(n));
};

/**
 * Adds messages to the requests they belong to (one per groupId), kept as plain data so the worker can store it
 * between polls: a request's messages can arrive over several polls.
 * @param {Record<string, object>} groups groupId -> what is known of that request so far
 * @param {object[]} messages
 * @returns {string[]} the groupIds that changed
 */
export function addMessages(groups, messages) {
  const changed = new Set();
  for (const m of messages) {
    const k = m?.key ?? {};
    const gid = typeof k.groupId === "string" ? k.groupId : null;
    if (!gid) continue;
    const g = (groups[gid] ??= { url: null, events: [], client: null, claimed: null, tags: {}, eligible: {}, sends: [], status: null, cookies: [] });
    changed.add(gid);
    g.url ??= text(m.request?.url ?? k.eventName, 4096);
    const eventId = k.eventId != null ? String(k.eventId) : null;
    switch (m.messageType) {
      case "EVENT_STARTED":
        if (eventId && !g.events.some((e) => e.id === eventId)) g.events.push({ id: eventId, name: text(m.eventData?.event_name, 120) ?? "" });
        if (m.clientInfo) { g.client = text(m.clientInfo.name, 120); g.claimed = m.clientInfo.claimed !== false; }
        // The tags this container could run for the event; those that never start had conditions that did not match.
        if (eventId) g.eligible[eventId] = (m.tagInfo ?? []).map((t) => text(t.name, 120)).filter(Boolean).slice(0, 100);
        break;
      case "TAG_STARTED":
      case "TAG_STATUS": {
        const name = text(k.tagName ?? m.tagInfo?.[0]?.name, 120);
        if (!name || !eventId) break;
        const status = m.tagInfo?.[0]?.execute ?? "execute";
        g.tags[`${eventId}|${name}`] = { tag: name, eventId, status: text(status, 40) };
        break;
      }
      case "REQUEST_SUMMARY":
        g.status = Number.isInteger(m.response?.statusCode) ? m.response.statusCode : g.status;
        for (const c of cookieNames(m.response?.headers)) if (!g.cookies.includes(c)) g.cookies.push(c);
        break;
      case "ASYNC_ACTION_RESOLVED": {
        const o = m.asyncActionInfo?.outgoingHttpRequest;
        if (!o || g.sends.length >= 50) break;
        g.sends.push({
          from: text(o.batchedEntities?.tags?.[0], 120), method: text(o.request?.method, 10), to: hostPath(o.request?.url),
          status: Number.isInteger(o.response?.statusCode) ? o.response.statusCode : null, error: text(o.response?.error ?? o.error),
        });
        break;
      }
      default:
        break;
    }
  }
  return [...changed];
}

// Tag Manager's execution states, as the panel's outcomes (the words the ai tagging server uses too).
const OUTCOME = { execute_succeeded: "success", execute_failed: "failure", execute_timed_out: "timeout", execute_running: "running", execute: "running" };

/**
 * A request's preview data in the shape the panel shows for a server trace (see lib/server.js): the client, each
 * event's name, each tag's outcome, the tags that could have run but did not, each send, and the cookies it set.
 */
export function traceOf(g) {
  const index = new Map(g.events.map((e, i) => [e.id, i]));
  const tags = Object.values(g.tags).map((t) => ({ tag: t.tag, event: index.get(t.eventId) ?? 0, outcome: OUTCOME[t.status] ?? t.status, error: null, skip: null }));
  const notFired = g.events.flatMap((e, i) => (g.eligible[e.id] ?? []).filter((name) => !g.tags[`${e.id}|${name}`]).map((name) => ({ tag: name, event: i, enabled: true })));
  return {
    kind: "sgtm", id: null, at: null, status: g.status, error: null,
    client: g.claimed === false ? null : g.client, clientError: null,
    events: g.events.map((e) => e.name), tags, notFired, sends: g.sends, cookies: g.cookies,
  };
}

/**
 * The preview found in the browser's tabs that belongs to a site: its server on the same registrable domain
 * (sgtm.shop.example for shop.example), newest first. Null when none does.
 * @param {{ url: string, id: string, auth: string, env: string, at: number }[]} previews
 * @param {string} host the recorded site's host
 * @param {(host: string) => string} siteOf the registrable domain of a host
 */
export function previewForSite(previews, host, siteOf) {
  if (!host) return null;
  const site = siteOf(host);
  return [...previews].sort((a, b) => b.at - a.at).find((p) => {
    try { return siteOf(new URL(p.url).hostname) === site; } catch { return false; }
  }) ?? null;
}

/**
 * The saved server connections with a newer preview link: pressing Preview again in Tag Manager gives a new
 * gtm_auth or environment, and a connection to the same container on the same server takes it. Null when none
 * changed.
 */
export function freshen(servers, preview) {
  let changed = false;
  const out = {};
  for (const [host, srv] of Object.entries(servers ?? {})) {
    const same = srv?.kind === "sgtm" && srv.id === preview.id && srv.url === preview.url;
    if (same && (srv.auth !== preview.auth || srv.env !== preview.env)) {
      out[host] = { ...srv, auth: preview.auth, env: preview.env };
      changed = true;
    } else out[host] = srv;
  }
  return changed ? out : null;
}

/** The link to paste for a preview, as Tag Manager opened it. */
export const previewUrl = (p) => `${p.url}/gtm/debug?${previewQuery(p)}`;
