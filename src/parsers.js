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

/** @returns {Hit[] | null} */
export function parseGa4(url, postData) {
  const u = new URL(url);
  // Matched on the GA4 protocol rather than the host, so server-side GTM
  // endpoints on first-party domains are captured too.
  if (!u.pathname.endsWith("/g/collect") || u.searchParams.get("v") !== "2") return null;
  const base = new URLSearchParams(u.search);
  const lines = postData ? postData.split("\n").filter(Boolean) : [""];
  return lines.map((line) => {
    const merged = new URLSearchParams(base);
    for (const [k, v] of new URLSearchParams(line)) merged.set(k, v);
    const items = [...merged].filter(([k]) => /^pr\d+$/.test(k)).map(([, v]) => v);
    const user = [...merged].filter(([k]) => isUserDataKey(k));
    return {
      platform: "ga4",
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
  return [{ platform: "meta", name: u.searchParams.get("ev") || "(unnamed)", id: u.searchParams.get("id") || undefined, params, url }];
}

/** @returns {Hit[] | null} */
export function parseGoogleAds(url) {
  const u = new URL(url);
  const isAds =
    (u.hostname === "www.googleadservices.com" && u.pathname.startsWith("/pagead/conversion/")) ||
    (/(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.pathname.startsWith("/pagead/1p-conversion/"));
  if (!isAds) return null;
  const conversionId = u.pathname.split("/").filter(Boolean)[2];
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
  return [{ platform: "tiktok", name: body.event || "(unnamed)", id: body.context?.pixel?.code, params, ...(user.length ? { userFields: Object.fromEntries(user.map(([k, v]) => [`context.user.${k}`, String(v)])) } : {}), url }];
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

const PARSERS = [parseGa4, parseMeta, parseGoogleAds, parseTikTok, parseX];

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
  [/(^|\.)google\.[a-z.]+$/, /^\/ccm\/collect/],
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
  clarity: "Microsoft Clarity",
  hotjar: "Hotjar",
  doubleclick: "DoubleClick",
  adsense: "Google AdSense",
};
export const DEFAULT_PROVIDERS = ["ga4", "google_ads", "meta", "tiktok"];
// Tag managers and consent platforms are always shown: they explain how the tags loaded.
const ALWAYS_SHOWN = { gtm: "Google Tag Manager", consent: "Consent platform" };

const HOSTS = [
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
  [/(^|\.)(cookiebot\.com|cookielaw\.org|onetrust\.com|usercentrics\.eu|cookieyes\.com)$/, "consent"],
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
  for (const [pattern, key] of HOSTS) if (pattern.test(host)) return of(key);
  if (u.pathname.endsWith("/g/collect")) return of("ga4");
  if (u.pathname.startsWith("/pagead/")) return of("google_ads");
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
  if (p.key === "ga4") return /(^|\.)(google-analytics|analytics\.google|googletagmanager)\.com$/.test(new URL(url).hostname) ? "Google Analytics" : "Google Analytics (server-side)";
  return p.label;
}
