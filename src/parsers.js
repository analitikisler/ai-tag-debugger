// Turns raw network requests into normalized tracking hits.
import { isUserDataKey } from "./redact.js";
// Each parser returns an array of hits (one request can carry several events,
// e.g. a batched GA4 POST) or null when the request is not for that vendor.

/** @typedef {{ platform: string, name: string, params: Record<string,string>, id?: string, consent?: Record<string,string>, url: string }} Hit */

const GA4_PARAM_ALIASES = { cu: "currency", dl: "page_location", dt: "page_title", dr: "page_referrer" };

function ga4ParamsFrom(searchParams) {
  const params = {};
  for (const [key, value] of searchParams) {
    if (key.startsWith("ep.")) params[key.slice(3)] = value;
    else if (key.startsWith("epn.")) params[key.slice(4)] = value;
    else if (key in GA4_PARAM_ALIASES) params[GA4_PARAM_ALIASES[key]] = value;
    else if (/^pr\d+$/.test(key)) params.items = (params.items ? params.items + "|" : "") + value;
  }
  return params;
}

// gcs=G1xy: x = ad_storage, y = analytics_storage (1 granted, 0 denied).
function ga4Consent(searchParams) {
  const gcs = searchParams.get("gcs");
  if (!gcs || !/^G1[01-]{2}$/.test(gcs)) return undefined;
  const state = (c) => (c === "1" ? "granted" : c === "0" ? "denied" : "unknown");
  return { ad_storage: state(gcs[2]), analytics_storage: state(gcs[3]) };
}

// Only www.google.<tld> and doubleclick.net: analytics.google.com is a primary GA4 endpoint.
const GOOGLE_COMPANION_HOST = /^(www\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$|(^|\.)doubleclick\.net$/;

/**
 * Google tag gateway serves Google's endpoints from a path on the site's own domain, with
 * short names: /<prefix>/ag/g/c or /<prefix>/ga/g/c for GA4's /g/collect. Only accepted with a
 * GA4 measurement id, since "/g/c" alone is too common a path.
 */
const isGa4Path = (u) => u.pathname.endsWith("/g/collect") || (/\/g\/c$/.test(u.pathname) && /^G-[A-Z0-9]+$/.test(u.searchParams.get("tid") ?? ""));

const GOOGLE_PRIMARY_HOST = /(^|\.)(google-analytics\.com|analytics\.google\.com|googletagmanager\.com)$/;

/**
 * Where a GA4 hit goes. "browser": Google's own hosts, or the short /g/c path of Google tag gateway
 * (which only forwards to Google). "server": /g/collect on any other host, which is a server
 * container (server-side GTM, Stape, Elevar) answering for the site.
 */
function ga4Delivery(u) {
  return GOOGLE_PRIMARY_HOST.test(u.hostname) || /\/g\/c$/.test(u.pathname) ? "browser" : "server";
}

/** @returns {Hit[] | null} */
export function parseGa4(url, postData) {
  const u = new URL(url);
  // Matched on the GA4 protocol rather than the host, so server-side GTM
  // endpoints on first-party domains are captured too.
  if (!isGa4Path(u) || u.searchParams.get("v") !== "2") return null;
  // gtag.js resends a hit to www.google.com/g/collect when the first send seems lost, and
  // copies some to doubleclick.net. GA4 doesn't count these twice, so they aren't hits.
  // (Primary hits can carry gaf too, e.g. gaf=2, so the host decides, not the parameter.)
  if (GOOGLE_COMPANION_HOST.test(u.hostname)) return null;
  const base = new URLSearchParams(u.search);
  const lines = postData ? postData.split("\n").filter(Boolean) : [""];
  return lines.map((line) => {
    const merged = new URLSearchParams(base);
    for (const [k, v] of new URLSearchParams(line)) merged.set(k, v);
    const items = [...merged].filter(([k]) => /^pr\d+$/.test(k)).map(([, v]) => v);
    const user = [...merged].filter(([k]) => isUserDataKey(k));
    return {
      platform: "ga4",
      delivery: ga4Delivery(u),
      name: merged.get("en") || "(unnamed)",
      id: merged.get("tid") || undefined,
      params: ga4ParamsFrom(merged),
      consent: ga4Consent(merged),
      ...(items.length ? { items } : {}),
      ...(user.length ? { userFields: Object.fromEntries(user) } : {}),
      url,
    };
  });
}

/** @returns {Hit[] | null} */
export function parseMeta(url) {
  const u = new URL(url);
  if (!/(^|\.)facebook\.com$/.test(u.hostname) || u.pathname !== "/tr" && u.pathname !== "/tr/") return null;
  const params = {};
  for (const [k, v] of u.searchParams) {
    const m = k.match(/^cd\[(.+)\]$/);
    if (m) params[m[1]] = v;
  }
  // eid is the event ID a server-side (Conversions API) copy of the event must repeat for Meta to count it once.
  const eventId = u.searchParams.get("eid") || undefined;
  if (eventId) params.event_id = eventId;
  const user = [...u.searchParams].filter(([k]) => isUserDataKey(k));
  return [{ platform: "meta", delivery: "browser", name: u.searchParams.get("ev") || "(unnamed)", id: u.searchParams.get("id") || undefined, ...(eventId ? { eventId } : {}), params, ...(user.length ? { userFields: Object.fromEntries(user) } : {}), url }];
}

/** @returns {Hit[] | null} */
export function parseGoogleAds(url) {
  const u = new URL(url);
  // Google tag gateway serves /pagead/conversion/<id>/ as /<prefix>/as/p/c/<id>/ on the site's own domain.
  const gateway = u.pathname.match(/\/as\/p\/c\/(\d+)\/?$/);
  const isAds =
    (u.hostname === "www.googleadservices.com" && u.pathname.startsWith("/pagead/conversion/")) ||
    (/(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.pathname.startsWith("/pagead/1p-conversion/")) ||
    (gateway && u.searchParams.has("cv"));
  if (!isAds) return null;
  const conversionId = gateway ? gateway[1] : u.pathname.split("/").filter(Boolean)[2];
  const params = {};
  for (const key of ["label", "value", "currency_code", "oid"]) {
    if (u.searchParams.has(key)) params[key === "currency_code" ? "currency" : key === "oid" ? "transaction_id" : key] = u.searchParams.get(key);
  }
  return [{ platform: "google_ads", name: params.label ? `conversion:${params.label}` : "conversion", id: conversionId, params, url }];
}

/** @returns {Hit[] | null} */
export function parseTikTok(url, postData) {
  const u = new URL(url);
  if (u.hostname !== "analytics.tiktok.com" || !u.pathname.startsWith("/api/v2/pixel")) return null;
  let body = {};
  try { body = postData ? JSON.parse(postData) : {}; } catch { /* not JSON */ }
  const props = body.properties || body.context?.properties || {};
  const params = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, String(v)]));
  const user = Object.entries(body.context?.user ?? {}).filter(([k, v]) => isUserDataKey(`context.user.${k}`) && v);
  const eventId = body.event_id ? String(body.event_id) : undefined;
  return [{ platform: "tiktok", delivery: "browser", name: body.event || "(unnamed)", id: body.context?.pixel?.code, ...(eventId ? { eventId } : {}), params, ...(user.length ? { userFields: Object.fromEntries(user.map(([k, v]) => [`context.user.${k}`, String(v)])) } : {}), url }];
}

/**
 * X (Twitter) pixel. Basic: the event name comes from event_id (conversion events,
 * "tw-…") or the first entry of "events" (e.g. pageview); value and quantity are kept.
 * @returns {Hit[] | null}
 */
export function parseX(url) {
  const u = new URL(url);
  if (!/^(analytics\.twitter\.com|t\.co)$/.test(u.hostname) || !/^\/(1\/)?i\/adsct/.test(u.pathname)) return null;
  const q = u.searchParams;
  let name = q.get("event_id") || "";
  if (!name) {
    try { name = JSON.parse(q.get("events") ?? "[]")?.[0]?.[0] ?? ""; } catch { /* not JSON */ }
  }
  const params = {};
  for (const [from, to] of [["tw_sale_amount", "value"], ["tw_order_quantity", "quantity"], ["tw_document_href", "page_location"]]) {
    if (q.has(from)) params[to] = q.get(from);
  }
  return [{ platform: "x", name: name || "(unnamed)", id: q.get("txn_id") || undefined, params, url }];
}

const jsonOr = (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } };
const scalars = (obj) => Object.fromEntries(Object.entries(obj && typeof obj === "object" ? obj : {}).filter(([, v]) => v !== null && typeof v !== "object").map(([k, v]) => [k, String(v)]));

/** Pinterest tag: ct.pinterest.com/v3/ with event, tid, ed (event data) and pd (hashed user data). @returns {Hit[] | null} */
export function parsePinterest(url) {
  const u = new URL(url);
  const q = u.searchParams;
  if (u.hostname !== "ct.pinterest.com" || !/^\/v3\/?$/.test(u.pathname) || !q.has("event")) return null;
  const params = scalars(jsonOr(q.get("ed") ?? "{}", {}));
  if (q.has("event_id")) params.event_id = q.get("event_id");
  const user = Object.entries(scalars(jsonOr(q.get("pd") ?? "{}", {}))).filter(([k, v]) => isUserDataKey(k) && v);
  return [{ platform: "pinterest", name: q.get("event"), id: q.get("tid") || undefined, params, ...(user.length ? { userFields: Object.fromEntries(user.map(([k, v]) => [`pd.${k}`, v])) } : {}), url }];
}

/** Snap Pixel: tr.snapchat.com/p (query or form body) with pid, ev, and price/currency/transaction fields. @returns {Hit[] | null} */
export function parseSnapchat(url, postData) {
  const u = new URL(url);
  if (u.hostname !== "tr.snapchat.com" || !/^\/(p|tr)\/?$/.test(u.pathname)) return null;
  const q = new URLSearchParams(u.search);
  if (postData && !postData.trim().startsWith("{")) for (const [k, v] of new URLSearchParams(postData)) q.set(k, v);
  else if (postData) for (const [k, v] of Object.entries(scalars(jsonOr(postData, {})))) q.set(k, v);
  if (!q.has("pid") && !q.has("ev")) return null;
  const params = {};
  for (const [from, to] of [["pr", "value"], ["cur", "currency"], ["tid", "transaction_id"], ["ic", "quantity"], ["ci", "content_ids"], ["u", "page_location"]]) {
    if (q.has(from)) params[to] = q.get(from);
  }
  const user = [...q].filter(([k, v]) => isUserDataKey(k) && v);
  return [{ platform: "snapchat", name: q.get("ev") || "(unnamed)", id: q.get("pid") || undefined, params, ...(user.length ? { userFields: Object.fromEntries(user) } : {}), url }];
}

/**
 * Klaviyo onsite tracking: a JSON:API POST to a.klaviyo.com/client/events/ with the metric
 * name, event properties and the profile it belongs to. Profile fields are user data.
 * @returns {Hit[] | null}
 */
export function parseKlaviyo(url, postData) {
  const u = new URL(url);
  if (u.hostname !== "a.klaviyo.com" || !/^\/client\/events\/?$/.test(u.pathname)) return null;
  const attrs = jsonOr(postData ?? "{}", {})?.data?.attributes ?? {};
  const profile = scalars(attrs.profile?.data?.attributes ?? attrs.profile);
  const user = Object.entries(profile).filter(([k, v]) => isUserDataKey(k) && v);
  return [{
    platform: "klaviyo",
    name: attrs.metric?.data?.attributes?.name ?? attrs.metric?.name ?? "(unnamed)",
    id: u.searchParams.get("company_id") || undefined,
    params: { ...scalars(attrs.properties), ...(attrs.value !== undefined ? { value: String(attrs.value) } : {}) },
    ...(user.length ? { userFields: Object.fromEntries(user.map(([k, v]) => [`profile.${k}`, v])) } : {}),
    url,
  }];
}

/** Hotjar: calls to its in.hotjar.com / .hotjar.io API carry the site id in the path. Only the id is read. @returns {Hit[] | null} */
export function parseHotjar(url) {
  const u = new URL(url);
  if (!/(^|\.)hotjar\.(com|io)$/.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/api\/v\d+\/client\/sites\/(\d+)\/([a-z-]+)/i);
  if (!m) return null;
  return [{ platform: "hotjar", name: m[2], id: m[1], params: {}, url }];
}

const PARSERS = [parseGa4, parseMeta, parseGoogleAds, parseTikTok, parseX, parsePinterest, parseSnapchat, parseKlaviyo, parseHotjar];

/** Returns normalized hits for a request, or null when it is not a tracking request. */
export function parseTrackingRequest(url, postData) {
  let parsedUrl;
  try { parsedUrl = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(parsedUrl.protocol)) return null;
  for (const parse of PARSERS) {
    const hits = parse(url, postData);
    if (hits) return hits;
  }
  return null;
}

// Other beacons that report to ad and analytics accounts without being parsed into
// hits: Google Ads remarketing and consent pings, and the other common ad pixels.
const OTHER_BEACONS = [
  [/(^|\.)(doubleclick\.net|googleadservices\.com|google\.[a-z.]+)$/, /^\/pagead\/(viewthroughconversion|1p-user-list|landing)\//],
  [/(^|\.)google\.[a-z.]+$/, /^\/(rmkt\/collect\/|measurement\/conversion|ads\/ga-audiences)/],
  [GOOGLE_COMPANION_HOST, /\/g\/collect$/],
  [/(^|\.)merchant-center-analytics\.goog$/, /^\/mc\/collect/],
  // Google tag pings on any host: consent mode (ccm), the Google tag's own /g/s/collect, and
  // Google tag gateway paths served from the site's own domain (/<id>/gs/ccm/collect).
  [/./, /\/(ccm|ccm\/s|g\/s)\/collect$/],
  [/^td\.doubleclick\.net$/, /^\/td\//],
  [/(^|\.)facebook\.com$/, /^\/privacy_sandbox\/pixel\//],
  [/^bat\.bing\.com$/, /^\/action\//],
  [/^px\.ads\.linkedin\.com$/, /^\/(collect|wa)/],
  [/^ct\.pinterest\.com$/, /^\/(v3|user)/],
  [/^tr\.snapchat\.com$/, /^\//],
];

/**
 * Collection endpoints we answer locally, so audits never send test traffic
 * into the site's real analytics and ad accounts.
 */
export function isCollectionEndpoint(url) {
  if (parseTrackingRequest(url, null) !== null) return true;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  return OTHER_BEACONS.some(([host, pathname]) => host.test(u.hostname) && pathname.test(u.pathname));
}

// Providers the user can choose to check. Requests to the ones not chosen are still
// answered locally, but they are left out of the timeline and only counted.
export const PROVIDERS = {
  ga4: "GA4",
  google_ads: "Google Ads",
  meta: "Meta",
  tiktok: "TikTok",
  x: "X",
  linkedin: "LinkedIn",
  microsoft_ads: "Microsoft Ads",
  pinterest: "Pinterest",
  snapchat: "Snapchat",
  klaviyo: "Klaviyo",
  clarity: "Microsoft Clarity",
  hotjar: "Hotjar",
  doubleclick: "DoubleClick",
  adsense: "Google AdSense",
};
export const DEFAULT_PROVIDERS = ["ga4", "google_ads", "meta", "tiktok"];
// Tag managers and consent platforms are always shown: they explain how the tags loaded.
// Server-side tagging providers are too: their requests show where events are sent from.
const ALWAYS_SHOWN = { gtm: "Google Tag Manager", consent: "Consent platform", stape: "Stape", elevar: "Elevar" };

const HOSTS = [
  [/(^|\.)stape\.(io|jp)$/, "stape"],
  [/(^|\.)getelevar\.com$/, "elevar"],
  [/(^|\.)(google-analytics|analytics\.google)\.com$/, "ga4"],
  [/(^|\.)googleadservices\.com$/, "google_ads"],
  [/(^|\.)googlesyndication\.com$/, "adsense"],
  [/(^|\.)(facebook\.com|facebook\.net)$/, "meta"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)(x\.com|twitter\.com|t\.co|ads-twitter\.com)$/, "x"],
  [/(^|\.)(licdn\.com|ads\.linkedin\.com)$/, "linkedin"],
  [/(^|\.)bing\.com$/, "microsoft_ads"],
  [/(^|\.)clarity\.ms$/, "clarity"],
  [/(^|\.)hotjar\.(com|io)$/, "hotjar"],
  [/(^|\.)(pinterest\.com|pinimg\.com)$/, "pinterest"],
  [/(^|\.)(snapchat\.com|sc-static\.net)$/, "snapchat"],
  [/(^|\.)klaviyo\.com$/, "klaviyo"],
  [/(^|\.)(cookiebot\.com|cookielaw\.org|onetrust\.com|usercentrics\.(eu|com)|cookieyes\.com|didomi\.io|privacy-center\.org|trustarc\.com|truste\.com|consensu\.org|quantcast\.com|osano\.com|iubenda\.com|termly\.io|cookiefirst\.com|axeptio\.eu|sourcepoint\.com|sp-prod\.net|consentmanager\.net|cookiescript\.com|cookie-script\.com|cookieinformation\.com|civiccomputing\.com|piwik\.pro|complianz\.io|cdn\.privacy-mgmt\.com)$/, "consent"],
];

/**
 * The provider a request belongs to, as { key, label, always }, or null for ordinary
 * site traffic. Google Ads paths on google.<tld> and doubleclick.net, gtag.js loads
 * by tag id, and server-side GA4 endpoints on first-party hosts are recognized too.
 */
export function providerOf(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const of = (key) => ({ key, label: PROVIDERS[key] ?? ALWAYS_SHOWN[key], always: key in ALWAYS_SHOWN });
  const host = u.hostname;
  if (/(^|\.)googletagmanager\.com$/.test(host)) {
    const id = u.searchParams.get("id") ?? "";
    return of(u.pathname.startsWith("/gtag/") && id.startsWith("G-") ? "ga4" : u.pathname.startsWith("/gtag/") && /^(AW|DC)-/.test(id) ? "google_ads" : "gtm");
  }
  if (/(^|\.)(doubleclick\.net|google\.[a-z.]+)$/.test(host) && /^\/(pagead|ccm)\//.test(u.pathname)) return of("google_ads");
  if (/(^|\.)doubleclick\.net$/.test(host)) return of("doubleclick");
  // Before the vendor hosts: a GA4 hit to a Stape or Elevar endpoint is still a GA4 hit.
  if (isGa4Path(u) && !GOOGLE_COMPANION_HOST.test(host)) return of("ga4");
  for (const [pattern, key] of HOSTS) if (pattern.test(host)) return of(key);
  if (isGa4Path(u)) return of("ga4");
  if (u.pathname.startsWith("/pagead/") || /\/as\/p\/c\/\d+\/?$/.test(u.pathname)) return of("google_ads");
  // Google Tag Manager and gtag.js served from the site's own domain (server-side GTM, Google tag gateway).
  const id = u.searchParams.get("id") ?? "";
  if (/^GTM-[A-Z0-9]+$/.test(id)) return of("gtm");
  if (/\/gtag\/js$/.test(u.pathname) && id.startsWith("G-")) return of("ga4");
  return null;
}

/**
 * Throws on unknown provider keys; returns the list. When none are given: the default
 * providers plus any known provider the measurement plan names.
 */
export function resolveProviders(list, plan) {
  const keys = (Array.isArray(list) ? list : String(list ?? "").split(",")).map((k) => String(k).trim().toLowerCase()).filter(Boolean);
  if (!keys.length) {
    const planned = (plan?.events ?? []).map((e) => String(e.platform ?? "").toLowerCase()).filter((p) => p in PROVIDERS);
    return [...new Set([...DEFAULT_PROVIDERS, ...planned])];
  }
  const unknown = keys.filter((k) => !(k in PROVIDERS));
  if (unknown.length) throw new Error(`Unknown provider ${unknown.join(", ")}. Choose from: ${Object.keys(PROVIDERS).join(", ")}.`);
  return [...new Set(keys)];
}

/** The vendor's display name for the network timeline, or null for ordinary site traffic. */
export function vendorOf(url) {
  const p = providerOf(url);
  if (!p) return null;
  if (p.key === "ga4") {
    const host = new URL(url).hostname;
    if (/(^|\.)(google-analytics|analytics\.google|googletagmanager)\.com$/.test(host)) return "Google Analytics";
    if (GOOGLE_COMPANION_HOST.test(host)) return "Google Analytics (resend)";
    return ga4Delivery(new URL(url)) === "server" ? "Google Analytics (server-side)" : "Google Analytics (Google tag gateway)";
  }
  return p.label;
}
