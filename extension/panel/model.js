// What the side panel shows, worked out from a recording's raw events with no DOM: steps with their rows (one per
// hit, a GA4 batch being several), the consent changes between them, the dataLayer pushes and which hits each one
// fired, a plan check per hit, and the counts the platform filter needs. Pure, so it is tested in Node.
import { CONSENT_SIGNALS, parseTrackingRequest, providerOf, vendorOf } from "../core/parsers.js";
import { canonicalEvent, hasParam, hitMatchesEvent, persistedClientIds } from "../core/checks.js";
import { decodeGa4Item } from "../core/glossary.js";
import { siteOf } from "../core/redact.js";

const pathname = (href) => {
  try { return new URL(href).pathname; } catch { return String(href ?? ""); }
};

/** Platforms the setup offers, in its order and groups. DoubleClick and AdSense are recorded but never offered. */
export const PLATFORM_GROUPS = [
  ["analytics", ["ga4", "adobe", "matomo", "piwik_pro"]],
  ["advertising", ["google_ads", "meta", "tiktok", "microsoft_ads", "linkedin", "pinterest", "snapchat", "x", "criteo"]],
  ["behaviour", ["clarity", "hotjar", "klaviyo"]],
];
export const OFFERED = PLATFORM_GROUPS.flatMap(([, keys]) => keys);
/** The short badge label per platform; the full name is PROVIDERS[key]. */
export const BADGE = {
  ga4: "GA4", google_ads: "G Ads", meta: "Meta", tiktok: "TikTok", adobe: "Adobe", matomo: "Matomo", piwik_pro: "Piwik",
  linkedin: "LinkedIn", microsoft_ads: "MS Ads", pinterest: "Pinterest", snapchat: "Snap", x: "X", criteo: "Criteo",
  klaviyo: "Klaviyo", clarity: "Clarity", hotjar: "Hotjar",
};
/** GA4 events GA4 sends by itself next to another one; shown muted, since nobody tagged them. */
const AUTO = new Set(["user_engagement", "scroll"]);
const GOOGLE = new Set(["ga4", "google_ads"]);

/** Every key=value pair a request carried, as sent: the query, then the POST line that made this hit. */
export function wirePairs(url, body, index = 0) {
  const pairs = [];
  try { for (const p of new URL(url).searchParams) pairs.push(p); } catch { /* not a URL */ }
  const text = typeof body === "string" ? body.trim() : "";
  if (text && !text.startsWith("{") && !text.startsWith("[")) {
    const line = text.split("\n").filter(Boolean)[index];
    if (line) for (const [k, v] of new URLSearchParams(line)) {
      const at = pairs.findIndex(([pk]) => pk === k);
      if (at >= 0) pairs[at] = [k, v];
      else pairs.push([k, v]);
    }
  }
  return pairs;
}

/** A GA4 item string's fields as an object, with its custom item parameters under custom. */
export function itemOf(raw) {
  const { fields, custom } = decodeGa4Item(raw);
  return { ...Object.fromEntries(fields), custom };
}

/** Σ price × quantity of a hit's items, or null when no item has a price. */
export function itemsTotal(items) {
  let total = 0;
  let priced = false;
  for (const it of items) {
    const price = Number(it.price);
    if (!Number.isFinite(price)) continue;
    priced = true;
    const qty = Number(it.quantity ?? 1);
    total += price * (Number.isFinite(qty) ? qty : 1);
  }
  return priced ? Math.round(total * 100) / 100 : null;
}

/** The consent signals a dataLayer push sets, or null when it is no consent command. */
export function consentCommand(value) {
  if (!Array.isArray(value) || value[0] !== "consent" || !["default", "update"].includes(value[1])) return null;
  const all = value[2] && typeof value[2] === "object" ? value[2] : {};
  const signals = Object.fromEntries(Object.entries(all).filter(([, v]) => v === "granted" || v === "denied"));
  return { mode: value[1], signals };
}

/** "denied" / "granted" when the four tracking signals a command sets agree, "partly" when they differ, null when it sets none. */
export function consentSummary(signals) {
  const states = CONSENT_SIGNALS.filter((k) => k in signals).map((k) => signals[k]);
  if (!states.length) return null;
  return states.every((s) => s === "denied") ? "denied" : states.every((s) => s === "granted") ? "granted" : "partly";
}

/**
 * The plan's verdict on one hit: { state: "ok"|"warning"|"broken", problems: [{ kind, param?, value?, total? }] },
 * or null when nothing applies. Without a plan only the checks that need none run: value against the items' total,
 * and value sent without currency.
 */
export function planCheck(hit, plan, items) {
  const problems = [];
  const planned = plan?.events?.find((e) => hitMatchesEvent({ ...e, platform: String(e.platform ?? "").toLowerCase() }, hit)) ?? null;
  for (const p of planned?.required_params ?? []) if (!hasParam(hit, p)) problems.push({ kind: "missing", param: p });
  const value = Number(hit.params?.value);
  const total = items.length ? itemsTotal(items) : null;
  if (Number.isFinite(value) && total !== null && Math.abs(value - total) > 0.01) problems.push({ kind: "valueTotal", value, total });
  if (hit.params?.value !== undefined && hit.params?.value !== "" && !hasParam(hit, "currency") && hit.platform === "ga4") problems.push({ kind: "noCurrency" });
  if (!planned && !problems.length) return null;
  const state = problems.some((p) => p.kind === "missing") ? "broken" : problems.length ? "warning" : "ok";
  return { state, problems, planned: Boolean(planned) };
}

/**
 * The model for a recording.
 * @param {object[]} events stored events, any order
 * @param {{ platforms?: string[]|null, plan?: object|null }} opts platforms: the ones chosen in setup (null = all)
 */
export function buildModel(events, { platforms = null, plan = null } = {}) {
  const sorted = [...events].sort((a, b) => a.t - b.t || (a.seq ?? 0) - (b.seq ?? 0));
  const status = new Map(sorted.filter((e) => e.kind === "status").map((e) => [e.requestId, e.status]));
  const chosen = platforms?.length ? new Set(platforms) : null;
  const steps = [];
  const rows = [];
  const pushes = [];
  const consent = [];
  const cookies = new Map(); // name|domain -> first seen t
  const containers = new Set();
  let cmp = null;
  let cur = null;
  let pageHost = null; // the recorded page's host, so a first-party server container can be told from a third-party one
  const open = (e, label, action) => {
    cur = { index: steps.length, label, action, url: e?.url ?? null, t: e?.t ?? 0, title: null, docStatus: null, entries: [], pushes: [] };
    steps.push(cur);
  };
  for (const e of sorted) {
    if (e.kind === "step") {
      // A route change that keeps the path (query or hash only) is the same page, as the run builder does it.
      if (cur && e.action === "route" && cur.url && pathname(e.url) === pathname(cur.url)) continue;
      // A reload as recording starts commits the same page twice; one step, as the run builder does it.
      if (cur && e.action !== "manual" && cur.url === e.url && cur.action === e.action && e.t - cur.t < 2000) continue;
      if (cur && cur.action === "start" && !cur.entries.length && !cur.pushes.length) steps.pop();
      open(e, e.label, e.action ?? "manual");
      if (cur.action === "manual" && steps.length > 1) cur.url = steps[steps.length - 2].url;
      continue;
    }
    if (!cur) open(e, null, "start");
    if (cur.url) pageHost = hostOf(cur.url) ?? pageHost;
    if (e.kind === "doc") {
      if (cur.url === e.url || !cur.docStatus) cur.docStatus = e.status;
    } else if (e.kind === "page") {
      if (e.title && !cur.title) cur.title = e.title;
      if (e.cmp?.vendor) cmp ??= e.cmp.vendor;
      for (const c of e.registry ?? []) if (c?.id) containers.add(c.id);
    } else if (e.kind === "request") {
      const hits = parseTrackingRequest(e.url, e.body ?? null) ?? [];
      const st = status.get(e.requestId);
      const provider = providerOf(e.url);
      if (hits.length) {
        hits.forEach((hit, i) => {
          const items = (hit.items ?? []).map(itemOf);
          const row = {
            key: `${e.requestId}:${i}`, kind: "hit", platform: hit.platform, name: hit.name, hit, items, e, status: st, t: e.t, step: cur.index,
            batch: hits.length > 1 ? { index: i + 1, size: hits.length } : null,
            auto: hit.platform === "ga4" && i > 0 && AUTO.has(hit.name),
            flags: ["_fv", "_ss", "_nsi"].filter((f) => hit.protocol?.[f] !== undefined),
            selected: !chosen || chosen.has(hit.platform),
            wire: wirePairs(e.url, e.body, i),
            check: planCheck(hit, plan, items),
            route: routeOf(hit, e.url, hostOf(e.initiator) ?? pageHost),
            endpoint: endpointOf(hit, e.url),
          };
          row.userProps = row.platform === "ga4" ? row.wire.filter(([k]) => k === "uid" || /^upn?\./.test(k)) : [];
          rows.push(row);
          cur.entries.push(row);
        });
      } else {
        // Not a hit the parsers read (a Google tag consent ping, a tag manager or consent platform script):
        // kept under "other requests", never mixed in with the hits by default.
        let path = e.url;
        try { path = new URL(e.url).pathname; } catch { /* keep the address */ }
        let en = null;
        try { en = new URL(e.url).searchParams.get("en"); } catch { /* no name */ }
        const row = {
          key: e.requestId, kind: "call", platform: "other", provider: provider?.key ?? null, vendor: vendorOf(e.url) ?? provider?.label ?? (isSetCookie(e.url) ? hostOf(e.url) : null),
          callKind: isSetCookie(e.url) ? "setCookie" : null,
          name: path, en, e, status: st, t: e.t, step: cur.index, selected: false, flags: [], items: [], wire: wirePairs(e.url, e.body, 0), check: null,
        };
        rows.push(row);
        cur.entries.push(row);
      }
    } else if (e.kind === "push") {
      const v = e.entry?.value;
      const cmd = consentCommand(v);
      const name = Array.isArray(v) ? v.slice(0, 2).filter((x) => typeof x === "string").join(" ") : v?.event ?? (v && typeof v === "object" ? `${Object.keys(v).slice(0, 3).join(", ")}` : String(v));
      const push = { key: `p${e.seq}`, index: pushes.length, name: name || "(push)", value: v, layer: e.entry?.layer ?? "dataLayer", e, t: e.t, step: cur.index, gtag: Array.isArray(v), clear: v && typeof v === "object" && !Array.isArray(v) && "ecommerce" in v && v.ecommerce === null, fired: [] };
      pushes.push(push);
      cur.pushes.push(push);
      if (cmd && Object.keys(cmd.signals).length) {
        const divider = { key: `c${e.seq}`, kind: "consent", mode: cmd.mode, signals: cmd.signals, summary: consentSummary(cmd.signals), t: e.t, step: cur.index };
        consent.push(divider);
        cur.entries.push(divider);
      }
    } else if (e.kind === "cookies") {
      for (const c of e.cookies ?? []) {
        const k = `${c.name}|${c.domain}`;
        if (!cookies.has(k)) cookies.set(k, { name: c.name, domain: c.domain, t: e.t, step: cur.index, httpOnly: c.httpOnly === true, expires: c.expirationDate ?? null });
      }
    }
  }
  // Which hits a push fired: the same event name within 1.5 s after it on the same step ("fired"), else the first
  // hit of each platform in that window ("after"). A heuristic, and labelled as one.
  const hitRows = rows.filter((r) => r.kind === "hit");
  for (const p of pushes) {
    const name = p.gtag ? (p.value[0] === "event" ? p.value[1] : null) : p.value?.event;
    if (!name || String(name).startsWith("gtm.")) continue;
    const window = hitRows.filter((r) => r.step === p.step && r.t >= p.t && r.t - p.t <= 1500);
    const seen = new Set();
    for (const r of window) {
      const same = canonicalEvent(r.name) === canonicalEvent(name);
      if (!same && seen.has(r.platform)) continue;
      seen.add(r.platform);
      p.fired.push({ key: r.key, platform: r.platform, name: r.name, ms: r.t - p.t, same });
      if (same) r.push = p.key;
    }
  }
  // The consent each hit was sent under, as far as the dataLayer says (Google hits also carry their own gcs/gcd).
  // Before or after the visitor first accepted: sites push a denied default on every page load and restore the
  // stored choice a moment later, so a hit on a later page is not "before consent" just because it beat that restore.
  const firstGrant = consent.find((c) => c.mode === "update" && (c.signals.ad_storage === "granted" || c.signals.analytics_storage === "granted"));
  for (const r of hitRows) {
    r.consentAt = consentAt(consent, r.t);
    r.beforeGrant = !firstGrant || r.t < firstGrant.t;
  }
  // A user property that changes value between hits (guest, then premium after login) is worth pointing at.
  const lastProp = new Map();
  for (const r of hitRows) {
    for (const [k, v] of r.userProps ?? []) {
      const was = lastProp.get(k);
      if (was && was.value !== v) (r.propChanges ??= {})[k] = { was: was.value, step: was.step };
      lastProp.set(k, { value: v, step: r.step });
    }
  }
  // Elevar's own dataLayer events (dl_add_to_cart) name the server container behind a first-party endpoint.
  const elevar = pushes.some((p) => /^dl_/.test(String(p.value?.event ?? "")));
  // A hit sent straight to Google is only a leak when the same property also goes through a server route.
  const served = new Set(hitRows.filter((r) => r.route && r.route.kind !== "google").map((r) => r.hit.id).filter(Boolean));
  for (const r of hitRows) {
    if (!r.route) continue;
    if (r.route.kind === "sgtm" && elevar) r.route.kind = "elevar";
    if (r.route.kind === "google") r.route = served.has(r.hit.id) ? { ...r.route, kind: "direct" } : null;
    // A Google path under a prefix on the site's own host is the tag gateway, not a server container.
    if (r.route?.kind === "gateway" && r.endpoint?.kind === "server") r.endpoint = { kind: "gateway", to: r.platform === "ga4" ? "www.google-analytics.com/g/collect" : "www.googleadservices.com/pagead/" };
  }
  const counts = {};
  const other = {};
  for (const r of rows) {
    if (r.kind === "hit") counts[r.platform] = (counts[r.platform] ?? 0) + 1;
    else other[r.vendor ?? "other"] = (other[r.vendor ?? "other"] ?? 0) + 1;
  }
  // The tracking IDs each platform sent to: when there are several (two Meta pixels, two GA4 properties) rows say which.
  const ids = {};
  for (const r of rows) if (r.kind === "hit" && r.hit.id) (ids[r.platform] ??= new Set()).add(r.hit.id);
  const multiId = Object.fromEntries(Object.entries(ids).filter(([, set]) => set.size > 1).map(([k, set]) => [k, [...set]]));
  return { multiId, steps, rows, pushes, consent, cookies: [...cookies.values()], counts, other, chosen: chosen ? [...chosen] : null, cmp, containers: [...containers] };
}

const hostOf = (url) => {
  try { return new URL(url).hostname || null; } catch { return null; }
};
const GOOGLE_HOST = /(^|\.)(google-analytics\.com|analytics\.google\.com|googletagmanager\.com|googleadservices\.com|doubleclick\.net|googlesyndication\.com|google\.[a-z]{2,3}(\.[a-z]{2})?)$/;
const STAPE = /(^|\.)stape\.(io|net|jp)$/;
const ELEVAR = /(^|\.)getelevar\.com$/;

/**
 * Where a Google hit went: { kind, host, firstParty }. kind "sgtm" (a server container on another host), "gateway"
 * (Google tag gateway: Google's path under a prefix on the site's own host), "stape", "elevar", or "google" (straight
 * to Google, which buildModel turns into "direct" when the same property also has a server route, else no badge).
 * Null for other vendors: their own endpoint is the normal case.
 */
export function routeOf(hit, url, pageHost = null) {
  if (hit.platform !== "ga4" && hit.platform !== "google_ads") return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname;
  const firstParty = Boolean(pageHost) && siteOf(host) === siteOf(pageHost);
  if (GOOGLE_HOST.test(host)) return { kind: "google", host, firstParty: false };
  if (STAPE.test(host)) return { kind: "stape", host, firstParty: false };
  if (ELEVAR.test(host)) return { kind: "elevar", host, firstParty: false };
  const prefixed = /^\/[^/]+\/(g\/collect|pagead\/)/.test(u.pathname);
  if (/\/g\/c$/.test(u.pathname) || /\/as\/p\/c\/\d+\/?$/.test(u.pathname) || (prefixed && host === pageHost)) return { kind: "gateway", host, firstParty: true };
  return { kind: "sgtm", host, firstParty };
}

/** A server container's or the tag gateway's cookie call (/_/set_cookie): it sets first-party cookies, it is no event. */
export const isSetCookie = (url) => {
  try { return /\/_\/set_cookie\/?$/.test(new URL(url).pathname); } catch { return false; }
};

/**
 * Which kind of endpoint received a Google hit, as Analytics Debugger names it: "regular" (Google's own collection
 * hosts), "gateway" (Google tag gateway on the site's domain, with the Google endpoint it forwards to) or "server"
 * (a server container: sGTM, Stape, Elevar). Null for other platforms.
 */
export function endpointOf(hit, url) {
  if (hit.platform !== "ga4" && hit.platform !== "google_ads") return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (GOOGLE_HOST.test(u.hostname)) return { kind: "regular" };
  if (/\/ag\/g\/c$/.test(u.pathname)) return { kind: "gateway", to: "analytics.google.com/g/collect" };
  if (/\/g\/c$/.test(u.pathname)) return { kind: "gateway", to: "www.google-analytics.com/g/collect" };
  const ads = u.pathname.match(/\/as\/p\/c\/(\d+)\/?$/);
  if (ads) return { kind: "gateway", to: `www.googleadservices.com/pagead/conversion/${ads[1]}/` };
  return { kind: "server" };
}

// First-party cookies a server container sets (server-managed client ID, linker and click IDs).
const SERVER_COOKIES = /^(FPID|FPLC|FPAU|FPGCLAW|FPGCLDC|FPGCLGB|FPGSID|_sp_.*|stape.*)$/;

/**
 * The "Where hits go" card: one block per destination host, server routes first, then direct leaks, then the
 * vendors' own endpoints. Null when nothing went through a server route.
 */
export function routesOf(model) {
  const hits = model.rows.filter((r) => r.kind === "hit");
  const routed = hits.filter((r) => r.route);
  if (!routed.some((r) => r.route.kind !== "direct")) return null;
  const grant = model.consent.find((c) => c.mode === "update" && (c.signals.ad_storage === "granted" || c.signals.analytics_storage === "granted"))?.t ?? Infinity;
  // gtag('config', id, { server_container_url }) or transport_url: the route as the page set it.
  const configs = model.pushes.filter((p) => Array.isArray(p.value) && p.value[0] === "config" && p.value[2] && typeof p.value[2] === "object")
    .map((p) => {
      const key = ["server_container_url", "transport_url"].find((k) => typeof p.value[2][k] === "string");
      return key ? { push: p, key, id: p.value[1], host: hostOf(p.value[2][key]) } : null;
    }).filter(Boolean);
  const blocks = new Map();
  for (const r of routed) {
    const b = blocks.get(r.route.host) ?? { kind: r.route.kind, host: r.route.host, firstParty: r.route.firstParty, rows: [], sends: new Map(), gtm: new Set() };
    b.rows.push(r);
    const ids = b.sends.get(r.platform) ?? new Set();
    if (r.hit.id) ids.add(r.hit.id);
    b.sends.set(r.platform, ids);
    const gtm = r.wire.find(([k]) => k === "gtm")?.[1];
    if (gtm) b.gtm.add(gtm);
    blocks.set(r.route.host, b);
  }
  const order = { sgtm: 0, gateway: 0, stape: 0, elevar: 0, direct: 1 };
  const list = [...blocks.values()].sort((a, b) => order[a.kind] - order[b.kind]).map((b) => {
    const config = configs.find((c) => c.host === b.host) ?? null;
    const noConsent = b.rows.filter((r) => !r.wire.some(([k]) => k === "gcs")).length;
    const cookies = b.kind !== "direct" && b.firstParty
      ? model.cookies.filter((c) => c.httpOnly || SERVER_COOKIES.test(c.name)).map((c) => ({ ...c, beforeConsent: c.t < grant }))
      : [];
    const out = { kind: b.kind, host: b.host, firstParty: b.firstParty, hits: b.rows.length, sends: [...b.sends].map(([platform, ids]) => ({ platform, ids: [...ids] })), gtm: [...b.gtm], config, noConsent, cookies };
    if (b.kind === "direct") {
      const first = b.rows[0];
      const serverConfig = configs.find((c) => c.id === first.hit.id) ?? configs[0] ?? null;
      out.first = first;
      out.beforeConfig = Boolean(serverConfig && first.t < serverConfig.push.t);
    }
    return out;
  });
  const vendor = hits.filter((r) => !r.route && r.platform !== "ga4" && r.platform !== "google_ads");
  const vendorBlock = vendor.length ? {
    kind: "vendor", hosts: [...new Set(vendor.map((r) => hostOf(r.e.url)).filter(Boolean))], hits: vendor.length,
    sends: Object.entries(Object.groupBy(vendor, (r) => r.platform)).map(([platform, rs]) => ({ platform, count: rs.length })),
    metaWithoutEventId: vendor.filter((r) => r.platform === "meta" && !r.hit.eventId).length, meta: vendor.filter((r) => r.platform === "meta").length,
  } : null;
  return { blocks: list, vendor: vendorBlock, routes: list.filter((b) => b.kind !== "direct").length, leaks: routed.filter((r) => r.route.kind === "direct").length };
}

/** Case- and accent-free text for search, so "sepet" finds "Sepet" and "kasim" finds "Kasım". */
export const fold = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/ı/g, "i");

/**
 * Whether a row matches the search, and where: null for no match, "" for a match on its name, else the parameter or
 * item field that matched (shown as "match: item_name" in the row's summary).
 */
export function matchRow(row, query) {
  const q = fold(query).trim();
  if (!q) return "";
  if (fold(row.name).includes(q) || fold(row.en).includes(q)) return "";
  // Items first, by their decoded field: "item_name" says more than the raw pr2 string it came from.
  for (const it of row.items ?? []) {
    for (const [k, v] of Object.entries(it)) if (k !== "custom" && fold(v).includes(q)) return k;
    for (const [k, v] of it.custom ?? []) if (fold(k).includes(q) || fold(v).includes(q)) return k;
  }
  for (const [k, v] of row.wire ?? []) if (!/^pr\d+$/.test(k) && (fold(k).includes(q) || fold(v).includes(q))) return k;
  return null;
}

/** Item fields a list of decoded items should all carry: the ones some carry and others don't, per item. */
export function itemGaps(items) {
  const keys = (it) => Object.keys(it).filter((k) => k !== "custom" && it[k] !== "" && it[k] !== undefined);
  return items.map((it) => {
    const own = new Set(keys(it));
    const from = items.findIndex((other) => other !== it && keys(other).some((k) => !own.has(k)));
    if (from < 0) return null;
    const missing = keys(items[from]).filter((k) => !own.has(k));
    return { missing, from };
  });
}

/** The four signals' state at a moment, from the consent commands before it: { ad_storage: "denied", … } or null. */
export function consentAt(consent, t) {
  let state = null;
  for (const c of consent) {
    if (c.t > t) break;
    state = { ...(state ?? {}), ...c.signals };
  }
  return state;
}

/**
 * The Consent tab: the default and the updates, when the visitor first granted ad_storage, and per platform whether
 * its hits respected the state they were sent under.
 * @returns {{ default: object|null, updates: object[], grantAt: object|null, platforms: object[], cookiesBefore: object[], cookiesAfter: object[] }}
 */
export function consentReport(model, platforms = null) {
  const def = model.consent.find((c) => c.mode === "default") ?? null;
  const updates = model.consent.filter((c) => c.mode === "update");
  const grantAt = updates.find((u) => u.signals.ad_storage === "granted" || u.signals.analytics_storage === "granted") ?? null;
  const keys = [...new Set(model.rows.filter((r) => r.kind === "hit" && (!platforms || platforms.includes(r.platform))).map((r) => r.platform))];
  const result = keys.map((platform) => {
    const hits = model.rows.filter((r) => r.kind === "hit" && r.platform === platform);
    // The hit's own gcs says analytics_storage was denied, so this needs no consent command to be seen.
    const kept = platform === "ga4" ? persistedClientIds(hits.map((r) => r.hit))[0] : undefined;
    const persisted = kept ? { cid: kept.cid, pages: kept.pages, row: hits.find((r) => r.hit === kept.second) } : null;
    if (!def) return persisted ? { platform, verdict: "violated", hits: hits.length, violations: [], persisted } : { platform, verdict: "unknown", hits: hits.length };
    const before = hits.filter((r) => !grantAt || r.t < grantAt.t);
    const denied = (r) => (r.consentAt?.ad_storage ?? def.signals.ad_storage) === "denied";
    let violations;
    if (GOOGLE.has(platform)) {
      // A Google hit while denied is fine as a cookieless ping (gcs G100); one that claims granted storage is not.
      violations = before.filter((r) => denied(r) && (r.hit.consent?.ad_storage === "granted" || r.hit.consent?.analytics_storage === "granted"));
    } else violations = before.filter((r) => denied(r));
    const cookieless = GOOGLE.has(platform) ? before.filter((r) => r.hit.consent && Object.values(r.hit.consent).every((s) => s !== "granted")).length : 0;
    return { platform, verdict: violations.length || persisted ? "violated" : "respected", hits: hits.length, before: before.length, cookieless, after: hits.length - before.length, violations, persisted };
  });
  const cut = grantAt?.t ?? Infinity;
  // Hits that say a signal was granted while the commands still said denied: something else updated consent.
  let mismatch = null;
  for (const r of model.rows) {
    if (r.kind !== "hit" || !r.hit.consent || !r.consentAt) continue;
    const signal = ["ad_storage", "analytics_storage"].find((k) => r.hit.consent[k] === "granted" && r.consentAt[k] === "denied");
    if (signal) { mismatch = { row: r, signal }; break; }
  }
  return {
    default: def, updates, grantAt, platforms: result, mismatch,
    cookiesBefore: model.cookies.filter((c) => c.t < cut), cookiesAfter: model.cookies.filter((c) => c.t >= cut),
  };
}
