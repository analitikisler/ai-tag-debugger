// Deterministic checks that compare captured hits with the measurement plan.
// They run without any API call; the AI model only explains the results.

import { messages } from "./i18n.js";
import { isOwnAddress } from "./redact.js";
import { campaignParamsIn } from "./campaign.js";
import { CONSENT_SIGNALS, PROVIDERS } from "./parsers.js";
import { containersNotRun, duplicateLoads, loadSources, scriptFailed, splitLayers } from "./containers.js";
import { messageOutcomes, widgetSummaries, widgetsOf } from "./frames.js";

const platformName = (p) => PROVIDERS[p] ?? p;
// Ad pixels with no consent signal of their own: a hit before consent or after a reject is a problem whatever it says.
export const NON_GOOGLE_AD_PLATFORMS = new Set(["meta", "tiktok", "pinterest", "snapchat", "x", "linkedin", "microsoft_ads", "criteo"]);
const GOOGLE_PLATFORMS = new Set(["ga4", "google_ads"]);

/** Whether a happened before b: an earlier step, or the same step and an earlier time when both have one. */
const sentBefore = (a, b) => a.step < b.step || (a.step === b.step && a.t != null && b.t != null && a.t < b.t);

const EMAIL = /[A-Z0-9._%+-]+(@|%40)[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Consent Mode v2 added two signals to ad_storage and analytics_storage. Google requires them for EEA/UK traffic.
const V2_SIGNALS = ["ad_user_data", "ad_personalization"];
// The signals a "reject all" must keep denied. functionality_storage and security_storage cover what
// the site needs to work, and personalization_storage its own features, so CMPs grant them on reject too.
const TRACKING_SIGNALS = CONSENT_SIGNALS;
/** Whether a Google hit says it was sent with any of the tracking signals granted (from gcs, and gcd for the v2 ones). */
const claimsGranted = (hit) => TRACKING_SIGNALS.some((k) => hit.consent?.[k] === "granted");
// The analytics and ad cookies of the vendors the tag inventory names (COOKIE_VENDORS in inventory.js lists the same ones by vendor).
export const TRACKING_COOKIE = /^(_ga(_.+)?|_gid|_gat(_.+)?|_gcl_.+|_gac_.+|_fbp|_fbc|_ttp|_tt_.+|ttclid|_uet(sid|vid|msclkid)|MUID|_clck|_clsk|_hj.+|_pin_.+|_pinterest_.+|_scid|sc_at|_cto_.+|cto_.+|__kla_id|IDE|test_cookie|fr|li_.+|_li_.+|bcookie|lidc|UserMatchHistory|_dc_gtm_.+)$/;
const SEVERITY_ORDER = { broken: 0, risk: 1, warning: 2, info: 3, ok: 4 };

/**
 * @typedef {{ platform: string, name: string, aliases?: string[], required_params?: string[], journeys?: string[], allow_multiple?: boolean }} PlanEvent
 * @typedef {{ consent_mode?: boolean, events: PlanEvent[] }} Plan
 * @typedef {{ severity: "broken"|"risk"|"warning"|"info"|"ok", check: string, journey: string, viewport: string, platform?: string, event?: string, step?: string, detail: string, evidence?: string }} Finding
 */

/** Hosts of server containers seen in the run's network calls, the site's own or Stape's. */
function serverEndpoints(run) {
  const hosts = new Set();
  for (const c of run.network ?? []) {
    let u;
    try { u = new URL(c.url); } catch { continue; }
    if (/(^|\.)(google-analytics\.com|analytics\.google\.com|googletagmanager\.com|google\.[a-z.]+|doubleclick\.net)$/.test(u.hostname)) continue;
    const ga4Server = c.provider === "ga4" && u.pathname.endsWith("/g/collect");
    const loader = (c.provider === "gtm" || c.provider === "ga4") && /\/(gtm\.js|gtag\/js)$/.test(u.pathname);
    if (ga4Server || loader) hosts.add(u.hostname);
  }
  return [...hosts];
}

const key = (platform, name) => `${platform}:${name}`;

// Sites name events in their own way: Elevar's dl_add_to_cart, UA-style addToCart, Add To Cart.
// Names are compared without case, spaces, dashes, underscores and a leading "dl", then through
// SYNONYMS to one canonical name. A plan event can add its own names with "aliases".
const SYNONYMS = {
  viewitem: ["productview", "productdetail", "productdetails", "detail", "viewproduct", "viewcontent"],
  viewitemlist: ["productlist", "viewproductlist", "productimpressions", "viewcollection", "viewcategory"],
  addtocart: ["add", "addtobasket", "addtobag", "cartadd"],
  removefromcart: ["remove", "removefrombasket", "removefrombag", "cartremove"],
  viewcart: ["cartview", "viewbasket", "viewbag"],
  begincheckout: ["checkout", "initiatecheckout", "checkoutstart", "checkoutbegin"],
  addshippinginfo: ["checkoutshipping", "shippinginfo"],
  addpaymentinfo: ["checkoutpayment", "paymentinfo", "addpayment"],
  // completepayment is TikTok's name for it.
  purchase: ["transaction", "ordercomplete", "ordercompleted", "orderconfirmation", "checkoutcomplete", "checkoutcompleted", "completepayment"],
};
const CANONICAL = new Map(Object.entries(SYNONYMS).flatMap(([c, list]) => list.map((a) => [a, c])));

/** One comparable form of an event name. */
export function canonicalEvent(name) {
  let n = String(name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (n.startsWith("dl") && n.length > 2) n = n.slice(2);
  return CANONICAL.get(n) ?? n;
}

// GA4 makes these itself: first_visit and session_start from flags on its other hits, user_engagement
// when the page is hidden or left. No tag sends them, so they are never unplanned, and a run can end
// before user_engagement goes out. Keyed by canonicalEvent, like every comparison of event names here.
const GA4_AUTOMATIC = new Set(["first_visit", "session_start", "user_engagement"].map(canonicalEvent));
// Enhanced measurement events, which GA4 sends with no tag when the web stream's setting is on.
// The value names the setting that sends it.
const GA4_ENHANCED = new Map(Object.entries({
  page_view: "pageViews", scroll: "scrolls", click: "outboundClicks", view_search_results: "siteSearch",
  video_start: "videoEngagement", video_progress: "videoEngagement", video_complete: "videoEngagement",
  file_download: "fileDownloads", form_start: "formInteractions", form_submit: "formInteractions",
}).map(([name, setting]) => [canonicalEvent(name), setting]));
const isGa4Automatic = (platform, name) => platform === "ga4" && GA4_AUTOMATIC.has(canonicalEvent(name));
/** Whether GA4 sends this event by itself, so a plan need not list it. */
const isGa4Builtin = (platform, name) => isGa4Automatic(platform, name) || (platform === "ga4" && GA4_ENHANCED.has(canonicalEvent(name)));

/** Whether a planned event was sent on a run: by name, or for GA4's first_visit and session_start, as a flag on another hit. */
function eventFired(ev, hits) {
  return hits.some((h) => hitMatchesEvent(ev, h)) || hits.some((h) => carriesAutoEvent(ev, h));
}

/** Whether a GA4 hit carries the planned event as a flag (first_visit as _fv, session_start as _ss) instead of by name. */
export function carriesAutoEvent(ev, hit) {
  const name = canonicalEvent(ev.name);
  return ev.platform === "ga4" && hit.platform === "ga4" && (hit.autoEvents ?? []).some((a) => canonicalEvent(a) === name);
}

/** Whether a captured hit is the planned event, by its exact name, an alias or a common variant. */
export function hitMatchesEvent(ev, hit) {
  if (hit.platform !== ev.platform) return false;
  if (hit.name === ev.name) return true;
  const h = canonicalEvent(hit.name);
  return h === canonicalEvent(ev.name) || (ev.aliases ?? []).some((a) => canonicalEvent(a) === h);
}

// Ecommerce parameters sites send under another name (UA-style products/revenue, order ids).
const PARAM_ALIASES = {
  items: ["products", "item_list", "contents"],
  value: ["revenue", "total"],
  transaction_id: ["order_id", "orderid", "oid"],
  currency: ["currency_code", "cu"],
};

/** Whether a hit carries a required parameter, under its own name or a common alias. */
export function hasParam(hit, name) {
  return [name, ...(PARAM_ALIASES[name] ?? [])].some((n) => hit.params?.[n] !== undefined && hit.params[n] !== "");
}

/** A hit's parameter under its own name or the first common alias it carries. */
function paramOf(hit, name) {
  for (const n of [name, ...(PARAM_ALIASES[name] ?? [])]) {
    if (hit.params?.[n] !== undefined && hit.params[n] !== "") return hit.params[n];
  }
  return undefined;
}

const isPurchase = (hit) => canonicalEvent(hit.name) === "purchase";
const EMPTY_LIST = /^\s*(\[\s*\])?\s*$/;

/** The page load a hit came from: GA4's page load id (_p) when it has one, else the page address. */
function pageOf(hit) {
  try {
    const p = new URL(hit.url).searchParams.get("_p");
    if (p) return p;
  } catch { /* no URL */ }
  return hit.params?.page_location ?? hit.pageUrl ?? "";
}

// Just before an address: a mailto: link or a link field (link_url=..., "link_text":"...").
const LINK_BEFORE = /(mailto:|\b(link_url|link_text|click_url|click_text)(=|":"))$/i;

/**
 * Whether text holds an email address that could be a visitor's. The site's own address in a
 * mailto: link or a link field is a contact link it shows; anywhere else it still counts.
 */
function visitorEmailIn(text, hit) {
  let site = null;
  try {
    site = new URL(hit.params?.page_location ?? hit.pageUrl).hostname;
  } catch { /* no page address */ }
  return [...text.matchAll(EMAIL)].some((m) => {
    // "logo@2x.png" has the shape of an address and is a file name.
    if (/\.(png|jpe?g|gif|webp|avif|svg|ico|css|js|woff2?)$/i.test(m[0])) return false;
    const link = LINK_BEFORE.test(text.slice(Math.max(0, m.index - 16), m.index));
    return !(link && isOwnAddress(m[0].replace(/%40/i, "@"), site));
  });
}

function expectedIn(planEvent, journeyId) {
  return !planEvent.journeys || planEvent.journeys.includes(journeyId);
}

export function isConsentCommand(entry, kind) {
  return Array.isArray(entry.value) && entry.value[0] === "consent" && entry.value[1] === kind;
}

/** The step at which the visitor gave ad consent, from the run or from Consent Mode updates. */
export function consentGrantedStep(run) {
  const fromUpdate = run.dataLayerLog.find(
    (e) => isConsentCommand(e, "update") && e.value[2]?.ad_storage === "granted",
  );
  // A consent platform's GTM template updates the Google tag without a dataLayer command; the tag's own state shows it.
  const fromTag = tagConsentStates(run).find((st) => st.entries.ad_storage?.update === "granted");
  const candidates = [run.consentStep, fromUpdate?.step, fromTag?.step].filter((s) => s !== null && s !== undefined);
  return candidates.length ? Math.min(...candidates) : null;
}

/** The Google tag's own consent states a run recorded (google_tag_data.ics, kept on the steps where it changed), as { step, ...state }. */
export function tagConsentStates(run) {
  return (run.steps ?? []).filter((st) => st.tagConsent).map((st) => ({ step: st.index, ...st.tagConsent }));
}

/**
 * @param {Plan} plan
 * @param {{ journeyId: string, viewport: string, completed: boolean, note?: string, hits: any[], steps: any[], consentStep: number|null, dataLayerLog: any[] }} run
 * @param {{ lang?: string }} [opts] Report language for the finding texts.
 * @returns {Finding[]}
 */
export function checkRun(plan, run, { lang = "en" } = {}) {
  const d = messages(lang).detail;
  const findings = [];
  const base = { journey: run.journeyId, viewport: run.viewport };
  // Platforms are compared in lower case ("GA4" in a plan is ga4). Planned events for
  // providers the user chose not to check are left out, and listed in one info line.
  plan = { ...plan, events: plan.events.map((e) => ({ ...e, platform: String(e.platform ?? "").toLowerCase() })) };
  const hasPlan = plan.events.length > 0;
  if (run.providers) {
    const skipped = plan.events.filter((e) => !run.providers.includes(e.platform) && expectedIn(e, run.journeyId));
    plan = { ...plan, events: plan.events.filter((e) => run.providers.includes(e.platform)) };
    if (skipped.length) findings.push({ ...base, severity: "info", check: "planned_out_of_scope", detail: d.plannedOutOfScope(skipped.map((e) => key(e.platform, e.name))) });
  }
  const stepLabel = (i) => run.steps[i]?.label ?? `step ${i}`;
  // Embedded widgets' hits (run.widgetHits, see src/frames.js) count for consent and personal data only: the site
  // answers for what the widgets it embeds collect, but they say nothing about its own tracking plan.
  const legalHits = [...run.hits, ...(run.widgetHits ?? [])].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  const legalKey = (hit) => `${key(hit.platform, hit.name)}${hit.frame?.party === "third" ? `|${hit.frame.origin}` : ""}`;
  const fromWidget = (hit, text) => ((run.widgetHits ?? []).includes(hit) ? d.fromWidget(hit.frame.origin, text) : text);
  const planEventFor = (hit) => plan.events.find((e) => hitMatchesEvent(e, hit));
  const planKeyOf = (hit) => { const e = planEventFor(hit); return e ? key(e.platform, e.name) : key(hit.platform, hit.name); };

  if (!run.completed) {
    findings.push({ ...base, severity: "warning", check: "journey_incomplete", detail: d.journeyIncomplete(run.note) });
  }

  // A page that was a bot challenge or crashed in the browser: the tags there may never have run, so what the run
  // did not see there is unverified rather than missing.
  const troubled = (run.steps ?? []).filter((st) => st.pageProblem);
  const challenge = troubled.find((st) => st.pageProblem.kind === "challenge");
  if (challenge) findings.push({ ...base, severity: "warning", check: "page_blocked", step: stepLabel(challenge.index), detail: d.pageBlocked(challenge.pageProblem.vendor) });
  const crash = troubled.find((st) => st.pageProblem.kind === "crash");
  if (crash) findings.push({ ...base, severity: "warning", check: "page_crashed", step: stepLabel(crash.index), detail: d.pageCrashed(crash.pageProblem.vendor, crash.pageProblem.refusedScripts ?? 0) });

  // Expected events that never fired.
  for (const ev of plan.events) {
    if (!expectedIn(ev, run.journeyId)) continue;
    if (eventFired(ev, run.hits)) continue;
    if (isGa4Automatic(ev.platform, ev.name)) {
      findings.push({ ...base, severity: "info", check: "ga4_automatic_event", platform: ev.platform, event: ev.name, detail: d.missingAutomatic(ev.name) });
      continue;
    }
    // page_view is enhanced measurement too, but a missing one means the GA4 tag itself did not send.
    const name = canonicalEvent(ev.name);
    const setting = ev.platform === "ga4" && name !== canonicalEvent("page_view") ? GA4_ENHANCED.get(name) : undefined;
    findings.push({
      ...base,
      severity: run.completed && !troubled.length ? "broken" : "info",
      check: "missing_event",
      platform: ev.platform,
      event: ev.name,
      detail: troubled.length ? d.missingEventUnverified(ev.name) : !run.completed ? d.missingEventEarly(ev.name) : setting ? d.missingEnhanced(ev.name, setting) : d.missingEvent(ev.platform, ev.name),
    });
  }

  // Required parameters missing on events that did fire (reported once per event).
  const paramsReported = new Set();
  for (const hit of run.hits) {
    const ev = planEventFor(hit);
    if (!ev?.required_params?.length) continue;
    const missing = ev.required_params.filter((p) => !hasParam(hit, p));
    const reportKey = `${key(hit.platform, hit.name)}|${missing.join(",")}`;
    if (missing.length && !paramsReported.has(reportKey)) {
      paramsReported.add(reportKey);
      findings.push({
        ...base,
        severity: "broken",
        check: "missing_params",
        platform: hit.platform,
        event: hit.name,
        step: stepLabel(hit.step),
        // The parameter names are kept apart from the detail text, so a baseline can match them in any language.
        params: missing,
        detail: d.missingParams(hit.name, missing),
        evidence: JSON.stringify(hit.params),
      });
    }
  }

  // The same event sent more than once by a single action on one page. A step that loads a
  // new page can also carry the previous page's last hits, so the page is part of the key. So is the
  // account: one event to each of two GA4 properties or two pixels is counted once by each.
  const perStep = new Map();
  for (const hit of run.hits) {
    const k = `${hit.step}|${planKeyOf(hit)}|${pageOf(hit)}|${hit.id ?? ""}`;
    perStep.set(k, [...(perStep.get(k) ?? []), hit]);
  }
  for (const [, hits] of perStep) {
    const ev = planEventFor(hits[0]);
    if (hits.length < 2 || ev?.allow_multiple) continue;
    // TikTok sends unnamed pings (no event name) on its own schedule, so their count varies between runs.
    if (hits[0].platform === "tiktok" && hits[0].name === "(unnamed)") continue;
    // Hits that repeat an event ID are one event to the platform (it keeps the first), so only
    // distinct IDs, and hits without an ID, count as separate sends.
    const sends = new Set(hits.map((h, i) => (h.eventId ? `id:${h.eventId}` : `n:${i}`))).size;
    if (sends < 2) continue;
    findings.push({
      ...base,
      severity: "warning",
      check: "duplicate",
      platform: hits[0].platform,
      event: hits[0].name,
      step: stepLabel(hits[0].step),
      // The count the sentence names, so the reports show the same number without counting again.
      sends,
      detail: d.duplicate(hits[0].name, sends),
    });
  }

  // Purchase values: a value that is 0, negative or not a number, a currency that isn't an ISO
  // code, and an empty items list (reported once per platform and event).
  const purchaseReported = new Set();
  const reportPurchase = (hit, check, severity, detail) => {
    const k = `${check}|${key(hit.platform, hit.name)}`;
    if (purchaseReported.has(k)) return;
    purchaseReported.add(k);
    findings.push({ ...base, severity, check, platform: hit.platform, event: hit.name, step: stepLabel(hit.step), detail, evidence: JSON.stringify(hit.params) });
  };
  const purchases = run.hits.filter(isPurchase);
  for (const hit of purchases) {
    const value = paramOf(hit, "value");
    if (value !== undefined) {
      const n = Number(value);
      if (!Number.isFinite(n) || String(value).trim() === "") reportPurchase(hit, "purchase_value_invalid", "broken", d.purchaseValueNaN(hit.platform, hit.name, value));
      else if (n <= 0) reportPurchase(hit, "purchase_value_invalid", "broken", d.purchaseValueZero(hit.platform, hit.name, value));
    }
    const currency = paramOf(hit, "currency");
    if (currency !== undefined && !/^[A-Z]{3}$/.test(currency)) reportPurchase(hit, "purchase_currency_invalid", "broken", d.purchaseCurrency(hit.platform, hit.name, currency));
    // GA4 sends items as pr1, pr2...; Meta as contents or content_ids. Items left out of a GA4
    // purchase count as empty, unless the plan requires them and missing_params already says so.
    const listed = ["items", "contents", "content_ids"].filter((n) => hit.params?.[n] !== undefined);
    const requiresItems = planEventFor(hit)?.required_params?.includes("items");
    const empty = listed.length
      ? listed.every((n) => EMPTY_LIST.test(hit.params[n]))
      : hit.platform === "ga4" && !requiresItems && !hasParam(hit, "items");
    if (empty) reportPurchase(hit, "purchase_items_empty", "warning", d.purchaseItemsEmpty(hit.platform, hit.name));
  }

  // GA4 and Meta reporting the same order with a different value or currency. Purchases are paired
  // by order ID; without IDs, a run with one purchase on each platform is taken as one order.
  const ga4Buys = purchases.filter((h) => h.platform === "ga4");
  const metaBuys = purchases.filter((h) => h.platform === "meta");
  const orderId = (h) => paramOf(h, "transaction_id");
  const pairs = [];
  for (const g of ga4Buys) {
    const m = orderId(g) !== undefined && metaBuys.find((h) => orderId(h) === orderId(g));
    if (m) pairs.push([g, m]);
  }
  if (!pairs.length && ga4Buys.length === 1 && metaBuys.length === 1) {
    const [g, m] = [ga4Buys[0], metaBuys[0]];
    if (orderId(g) === undefined || orderId(m) === undefined) pairs.push([g, m]);
  }
  const mismatchSeen = new Set();
  for (const [g, m] of pairs) {
    const [gv, mv] = [paramOf(g, "value"), paramOf(m, "value")];
    const [gc, mc] = [paramOf(g, "currency"), paramOf(m, "currency")];
    const diffs = [];
    if (gv !== undefined && mv !== undefined && Number.isFinite(Number(gv)) && Number.isFinite(Number(mv)) && Math.abs(Number(gv) - Number(mv)) > 0.005) diffs.push(["value", gv, mv]);
    if (gc !== undefined && mc !== undefined && gc.toUpperCase() !== mc.toUpperCase()) diffs.push(["currency", gc, mc]);
    const k = `${orderId(g) ?? ""}|${diffs.map((x) => x.join("=")).join(",")}`;
    if (!diffs.length || mismatchSeen.has(k)) continue;
    mismatchSeen.add(k);
    findings.push({ ...base, severity: "warning", check: "purchase_mismatch", platform: "meta", event: m.name, step: stepLabel(m.step), detail: d.purchaseMismatch(orderId(g) ?? orderId(m), diffs), evidence: JSON.stringify({ ga4: g.params, meta: m.params }) });
  }

  // Server-side tagging. Only what the browser can see: a GA4 hit to a server container, and requests
  // to Stape or Elevar. Meta's and TikTok's server-side copies never pass through the browser.
  const serverHits = run.hits.filter((h) => h.delivery === "server");
  if (serverHits.length) {
    const names = (list) => [...new Set(list.map((h) => h.name))];
    const byPlatform = [...new Set(run.hits.map((h) => h.platform))].map((platform) => {
      const own = run.hits.filter((h) => h.platform === platform);
      return { platform, server: names(own.filter((h) => h.delivery === "server")), browser: names(own.filter((h) => h.delivery !== "server")) };
    }).filter((p) => p.server.length);
    // Only name the platforms whose server-side copies this run would have checked.
    const unseenServer = ["meta", "tiktok"].filter((p) => !run.providers || run.providers.includes(p)).map(platformName);
    for (const p of byPlatform) findings.push({ ...base, severity: "info", check: "server_side", platform: p.platform, detail: d.serverSide(p.platform, p.server, p.browser, unseenServer) });
  }
  const serverVendors = [...new Set((run.network ?? []).map((c) => c.provider).filter((p) => p === "stape" || p === "elevar"))];
  // Server containers the browser talked to: GA4 hits on a non-Google host, and GTM or gtag.js
  // loaded from one (a custom loader, which only a server container serves).
  const endpoints = serverEndpoints(run);
  if (endpoints.length && !serverHits.length) findings.push({ ...base, severity: "info", check: "server_endpoint", detail: d.serverEndpoint(endpoints) });
  const serverSeen = serverVendors.length || serverHits.length || endpoints.length;
  if (serverSeen) {
    const noId = new Map();
    for (const hit of run.hits) {
      if ((hit.platform === "meta" || hit.platform === "tiktok") && !hit.eventId && !noId.has(key(hit.platform, hit.name))) noId.set(key(hit.platform, hit.name), hit);
    }
    for (const [, hit] of noId) {
      findings.push({ ...base, severity: "info", check: "dedup_id_missing", platform: hit.platform, event: hit.name, step: stepLabel(hit.step), detail: d.dedupIdMissing(hit.platform, hit.name) });
    }
  }

  // Google containers and how each got onto the page (src/containers.js). Runs saved by older versions have none.
  const ui = messages(lang).ui.containers;
  const source = (l) => ui.kinds[l.kind](l.by);
  for (const dup of duplicateLoads(run).filter((x, i, all) => all.findIndex((y) => y.id === x.id) === i)) {
    findings.push({ ...base, severity: "warning", check: "container_duplicate", step: stepLabel(dup.loads[1].step), detail: d.containerDuplicate(dup.id, dup.loads.map(source), stepLabel(dup.loads[1].step)), evidence: dup.loads.map((l) => `${l.id} ${l.kind}${l.by ? ` ${l.by}` : ""} ${l.page ?? ""}`).join("\n") });
  }
  const loads = loadSources(run);
  for (const l of loads.filter((x, i, all) => x.environment && all.findIndex((y) => y.environment && y.id === x.id) === i)) {
    findings.push({ ...base, severity: "warning", check: "container_environment", step: stepLabel(l.step), detail: d.containerEnvironment(l.id, l.environment) });
  }
  const split = splitLayers(run)[0];
  if (split) findings.push({ ...base, severity: "info", check: "datalayer_split", step: stepLabel(split.step), detail: d.dataLayerSplit(split.layers.map((x) => `${x.id} → ${x.layer}`), stepLabel(split.step)) });
  for (const l of loads.filter((x, i, all) => x.kind === "send_to" && !all.some((y) => y.id === x.id && y.kind !== "send_to") && all.findIndex((y) => y.kind === "send_to" && y.id === x.id) === i)) {
    findings.push({ ...base, severity: "info", check: "container_send_to_only", platform: l.id.startsWith("G-") ? "ga4" : "google_ads", step: stepLabel(l.step), detail: d.sendToOnly(l.id, l.by) });
  }

  // A container script that failed to load: none of its tags ran. Said once per container and host.
  for (const sc of (run.containerScripts ?? []).filter((x, i, all) => scriptFailed(x) && all.findIndex((y) => scriptFailed(y) && y.id === x.id && y.host === x.host) === i)) {
    findings.push({ ...base, severity: "warning", check: "container_failed", step: stepLabel(sc.step), detail: d.containerFailed(sc.id, sc.host, String(sc.status)) });
  }

  // A GTM container downloaded or asked for that never ran. Expected while a consent platform holds it back and the
  // run never consented; otherwise none of its tags fired.
  const consented = consentGrantedStep(run) !== null;
  for (const c of containersNotRun(run)) {
    findings.push(run.cmp?.vendor && !consented
      ? { ...base, severity: "info", check: "container_held", step: stepLabel(c.step), detail: d.containerHeld(c.id, run.cmp.vendor) }
      : { ...base, severity: "warning", check: "container_not_run", step: stepLabel(c.step), detail: d.containerNotRun(c.id, c.kind) });
  }

  // Logged in with the test account: GA4 hits from then on should carry the site's user ID.
  if (Number.isInteger(run.loginStep)) {
    const after = run.hits.filter((h) => h.platform === "ga4" && h.step > run.loginStep);
    if (after.length && !after.some((h) => h.hasUserId)) {
      findings.push({ ...base, severity: "info", check: "user_id_missing", platform: "ga4", step: stepLabel(after[0].step), detail: d.userIdMissing(after.length) });
    }
  }

  // Widgets that tracked on their own, left out of the plan checks: said once per widget, so nothing goes missing silently.
  for (const w of widgetsOf(run.widgetHits ?? [])) {
    const first = (run.widgetHits ?? []).find((h) => h.frame.origin === w.origin);
    findings.push({ ...base, severity: "info", check: "widget_tracking", step: stepLabel(first.step), detail: d.widgetTracking(w.origin, w.platforms) });
  }
  // Events a widget pushed to its own dataLayer that never reached the site's accounts: the page's tags can't see them.
  for (const w of widgetSummaries([run], (a, b) => canonicalEvent(a) === canonicalEvent(b)).filter((x) => x.unshared.length)) {
    findings.push({ ...base, severity: "info", check: "widget_events_unshared", step: stepLabel(w.step), detail: d.widgetEventsUnshared(w.origin, w.unshared.slice(0, 10)) });
  }
  // An event an iframe posted to the page that the page never acted on: no push, no hit, not even under another name.
  const unhandled = new Set();
  for (const msg of messageOutcomes(run, (a, b) => canonicalEvent(a) === canonicalEvent(b)).filter((x) => x.outcome === "nothing")) {
    const k = `${msg.origin}|${canonicalEvent(msg.name)}`;
    if (unhandled.has(k)) continue;
    unhandled.add(k);
    findings.push({ ...base, severity: "info", check: "iframe_message_unhandled", event: msg.name, step: stepLabel(msg.step), detail: d.iframeMessageUnhandled(msg.origin, msg.name, msg.party) });
  }
  // A container in a same-site iframe beside one in the page: two documents, two dataLayers.
  const iframeLoad = loads.find((l) => l.frame?.party === "site" && loads.some((t) => !t.frame && t.step <= l.step));
  if (iframeLoad) findings.push({ ...base, severity: "info", check: "iframe_container", step: stepLabel(iframeLoad.step), detail: d.iframeContainer(iframeLoad.id, iframeLoad.frame.origin, iframeLoad.frame.parent) });

  // One event ID on two different events: the platform keeps the first and drops the other as its
  // duplicate, so a real event is lost (usually an ID set once per page instead of once per event).
  const byId = new Map();
  for (const hit of run.hits) {
    if (!hit.eventId) continue;
    const k = `${hit.platform}|${hit.eventId}`;
    byId.set(k, [...(byId.get(k) ?? []), hit]);
  }
  for (const [, hits] of byId) {
    const events = [...new Set(hits.map((h) => `${h.step}|${canonicalEvent(h.name)}`))];
    if (events.length < 2) continue;
    const names = [...new Set(hits.map((h) => h.name))];
    findings.push({ ...base, severity: "warning", check: "event_id_reused", platform: hits[0].platform, event: names.join(", "), events: names, step: stepLabel(hits[1].step), detail: d.eventIdReused(platformName(hits[0].platform), hits[0].eventId, names, events.length), evidence: hits.map((h) => h.url).join("\n") });
  }

  // With a server container, the Conversions API copy is usually built from the GA4 hit, so the
  // GA4 hit has to carry the same event_id as the Meta pixel event for Meta to deduplicate them.
  if (serverSeen) {
    const ga4ToServer = run.hits.filter((h) => h.platform === "ga4" && h.delivery === "server");
    const reported = new Set();
    for (const m of run.hits.filter((h) => h.platform === "meta" && h.eventId)) {
      const g = ga4ToServer.find((h) => h.step === m.step && canonicalEvent(h.name) === canonicalEvent(m.name));
      if (!g) continue;
      const gid = g.params?.event_id;
      const k = key("meta", m.name);
      if (reported.has(k) || (gid !== undefined && String(gid) === m.eventId)) continue;
      reported.add(k);
      findings.push(gid === undefined
        ? { ...base, severity: "info", check: "event_id_not_forwarded", platform: "meta", event: m.name, step: stepLabel(m.step), detail: d.eventIdNotForwarded(m.name, g.name) }
        : { ...base, severity: "warning", check: "event_id_mismatch", platform: "meta", event: m.name, step: stepLabel(m.step), detail: d.eventIdMismatch(m.name, m.eventId, g.name, gid), evidence: JSON.stringify({ meta: m.eventId, ga4: gid }) });
    }
  }

  // Campaign parameters (gclid, fbclid, UTM) on the landing address: they must survive redirects and reach the hits.
  const landing = run.landing;
  const sent = landing ? campaignParamsIn(landing.requested) : {};
  if (landing && Object.keys(sent).length) {
    const kept = campaignParamsIn(landing.final);
    const lost = Object.keys(sent).filter((n) => kept[n] !== sent[n]);
    const hop = landing.chain.length > 1 ? landing.chain : null;
    if (lost.length) {
      findings.push({ ...base, severity: "broken", check: "campaign_lost_redirect", step: stepLabel(landing.step), detail: d.campaignLost(lost, landing.final), evidence: hop ? hop.join(" -> ") : undefined });
    }
    // Hits the landing page sent whose page address leaves out a parameter the page still had.
    const missing = new Map();
    for (const hit of run.hits) {
      const loc = hit.params?.page_location;
      if (hit.step !== landing.step || !loc || hit.platform === "google_ads") continue;
      const here = campaignParamsIn(loc);
      const gone = Object.keys(kept).filter((n) => kept[n] === sent[n] && here[n] !== sent[n] && hit.params?.[n] !== sent[n]);
      if (gone.length && !missing.has(hit.platform)) missing.set(hit.platform, { hit, gone });
    }
    for (const [platform, { hit, gone }] of missing) {
      findings.push({ ...base, severity: "broken", check: "campaign_missing_in_hits", platform, event: hit.name, step: stepLabel(hit.step), detail: d.campaignMissingInHits(platform, hit.name, gone), evidence: hit.params.page_location });
    }
    if (!lost.length && !missing.size) {
      findings.push({ ...base, severity: "ok", check: "campaign_params", step: stepLabel(landing.step), detail: d.campaignOk(Object.keys(sent)) });
    }
  }

  // Cookies that carry the visit from page to page. Captures from before cookies were tracked per step have no cookieChanges.
  if (run.cookieChanges) {
    // A Google Ads tag keeps the landing gclid in _gcl_aw, so a later conversion can be tied to the click. GA4 alone
    // never writes it, and with ad storage denied the cookie is rightly not written: only Ads, with storage granted.
    const gclid = landing ? campaignParamsIn(landing.final ?? landing.requested).gclid : undefined;
    const adsTag = run.hits.some((h) => h.platform === "google_ads") || (run.network ?? []).some((c) => c.provider === "google_ads");
    const googleHits = run.hits.filter((h) => GOOGLE_PLATFORMS.has(h.platform));
    // Without Consent Mode, no hit carries ad_storage at all, and nothing holds the cookie back.
    const adStorage = googleHits.some((h) => h.consent?.ad_storage === "granted") || (googleHits.length > 0 && googleHits.every((h) => !h.consent?.ad_storage));
    if (gclid && adsTag && adStorage && !run.steps.some((st) => st.identity?.gcl_aw === "landing")) {
      findings.push({ ...base, severity: "warning", check: "gclid_not_stored", platform: "google_ads", step: stepLabel(landing.step), detail: d.gclidNotStored() });
    }
    // A GA4 client id that changes mid-visit splits it into two users. A reject in between may rightly clear the cookie.
    let seen = null;
    for (const st of run.steps) {
      const cid = st.identity?.ga_client_id;
      if (!cid) continue;
      const rejectedBetween = run.rejectStep != null && run.rejectStep > seen?.step && run.rejectStep <= st.index;
      if (seen && cid !== seen.cid && !rejectedBetween) {
        findings.push({ ...base, severity: "warning", check: "client_id_changed", platform: "ga4", step: stepLabel(st.index), detail: d.clientIdChanged(stepLabel(seen.step), stepLabel(st.index)), evidence: `_ga ${seen.cid} -> ${cid}` });
        break;
      }
      seen = { cid, step: st.index };
    }
  }

  // Consent.
  const granted = consentGrantedStep(run);
  // Consent Mode only governs Google tags. Within one step, the push and hit times decide which came first.
  const firstGoogleHit = run.hits.filter((h) => GOOGLE_PLATFORMS.has(h.platform)).reduce((a, h) => (!a || sentBefore(h, a) ? h : a), null);
  // The Google tag's own state also counts: a consent platform's GTM template sets the default and the update inside
  // GTM, where the dataLayer never shows them.
  const tagStates = tagConsentStates(run);
  const tagDefault = tagStates.find((st) => st.usedDefault) ?? null;
  const defaultEntry = run.dataLayerLog.find((e) => isConsentCommand(e, "default"));
  if (plan.consent_mode) {
    if (!defaultEntry && !tagDefault) {
      findings.push({ ...base, severity: "risk", check: "consent_default_missing", detail: d.consentDefaultMissing() });
    } else if ((defaultEntry && firstGoogleHit && sentBefore(firstGoogleHit, defaultEntry)) || tagStates.some((st) => st.wasSetLate)) {
      findings.push({ ...base, severity: "risk", check: "consent_default_late", detail: d.consentDefaultLate() });
    }
  }
  // A default the page pushed that the Google tag never applied: pushed as a plain array instead of through gtag(), to
  // another dataLayer, or from a frame. Tag Assistant then says Consent Mode is not configured.
  if (defaultEntry && tagStates.length && !tagDefault) {
    findings.push({ ...base, severity: "warning", check: "consent_default_not_applied", step: stepLabel(defaultEntry.step), detail: d.consentDefaultNotApplied() });
  }
  const defaults = run.dataLayerLog.filter((e) => isConsentCommand(e, "default"));
  const declared = defaults.length
    ? new Set(defaults.flatMap((e) => Object.keys(e.value[2] ?? {})))
    : tagDefault ? new Set(Object.entries(tagDefault.entries).filter(([, e]) => e.default).map(([k]) => k)) : null;
  if (plan.consent_mode && declared) {
    const missing = V2_SIGNALS.filter((k) => !declared.has(k));
    if (missing.length) findings.push({ ...base, severity: "risk", check: "consent_v2_missing", detail: d.consentV2Missing(missing) });
  }
  if (granted !== null) {
    const updates = run.dataLayerLog.filter((e) => isConsentCommand(e, "update"));
    const tagGrant = tagStates.find((st) => st.entries.ad_storage?.update === "granted");
    const grantedKeys = updates.length
      ? new Set(updates.flatMap((e) => Object.entries(e.value[2] ?? {}).filter(([, v]) => v === "granted").map(([k]) => k)))
      : tagGrant ? new Set(Object.entries(tagGrant.entries).filter(([, e]) => e.update === "granted").map(([k]) => k)) : null;
    const missing = grantedKeys ? V2_SIGNALS.filter((k) => !grantedKeys.has(k)) : [];
    if (missing.length) findings.push({ ...base, severity: "warning", check: "consent_v2_update", detail: d.consentV2Update(missing) });
  }

  // Declining: nothing may be sent or stored for ads after the visitor said no.
  const rejectStep = run.rejectStep ?? null;
  if (rejectStep !== null) {
    const reject = run.steps.find((s) => s.index === rejectStep);
    const regranted = run.dataLayerLog.find(
      (e) => e.step >= rejectStep && isConsentCommand(e, "update") && TRACKING_SIGNALS.some((k) => e.value[2]?.[k] === "granted"),
    ) ?? tagStates.find((st) => st.step >= rejectStep && TRACKING_SIGNALS.some((k) => st.entries[k]?.update === "granted"));
    if (regranted) findings.push({ ...base, severity: "broken", check: "reject_ignored", step: stepLabel(regranted.step), detail: d.rejectIgnored() });
    else if (reject?.bannerOpenAfter) findings.push({ ...base, severity: "broken", check: "reject_button_failed", step: stepLabel(rejectStep), detail: d.rejectButtonFailed() });
    const afterReject = new Map();
    for (const hit of legalHits) {
      if (hit.step < rejectStep) continue;
      if (NON_GOOGLE_AD_PLATFORMS.has(hit.platform) || claimsGranted(hit)) {
        const k = legalKey(hit);
        if (!afterReject.has(k)) afterReject.set(k, hit);
      }
    }
    for (const [, hit] of afterReject) {
      findings.push({ ...base, severity: "broken", check: "after_reject", platform: hit.platform, event: hit.name, step: stepLabel(hit.step), detail: fromWidget(hit, d.afterReject(hit.platform, hit.name)) });
    }
  }

  // Cookies set before the visitor chose (or after they said no).
  const cookieCutoff = rejectStep ?? granted;
  const earlyCookies = (run.cookieLog ?? []).filter((c) => TRACKING_COOKIE.test(c.name) && (cookieCutoff === null || c.step < cookieCutoff));
  if (earlyCookies.length) {
    const names = [...new Set(earlyCookies.map((c) => c.name))];
    findings.push({ ...base, severity: "risk", check: "cookies_before_consent", step: stepLabel(Math.min(...earlyCookies.map((c) => c.step))), detail: granted === null && rejectStep === null ? d.cookiesNeverConsent(names) : d.cookiesBeforeConsent(names) });
  }
  if (rejectStep !== null) {
    const lateCookies = (run.cookieLog ?? []).filter((c) => TRACKING_COOKIE.test(c.name) && c.step >= rejectStep);
    if (lateCookies.length) {
      const names = [...new Set(lateCookies.map((c) => c.name))];
      findings.push({ ...base, severity: "broken", check: "cookies_after_reject", step: stepLabel(Math.min(...lateCookies.map((c) => c.step))), detail: d.cookiesAfterReject(names) });
    }
  }

  const beforeConsent = new Map();
  for (const hit of legalHits) {
    // Hits from the reject click on are covered by the after_reject check.
    if (rejectStep !== null && hit.step >= rejectStep) continue;
    const early = granted === null || hit.step < granted;
    if (!early) continue;
    const adPlatform = NON_GOOGLE_AD_PLATFORMS.has(hit.platform);
    if (adPlatform || claimsGranted(hit)) {
      const k = legalKey(hit);
      if (!beforeConsent.has(k)) beforeConsent.set(k, hit);
    }
  }
  for (const [, hit] of beforeConsent) {
    findings.push({
      ...base,
      severity: "risk",
      check: "before_consent",
      platform: hit.platform,
      event: hit.name,
      step: stepLabel(hit.step),
      detail: fromWidget(hit, granted === null ? d.beforeConsentNever(hit.platform, hit.name) : d.beforeConsent(hit.platform, hit.name)),
    });
  }

  // Personal data in hits.
  const piiSeen = new Set();
  for (const hit of legalHits) {
    if (piiSeen.has(legalKey(hit))) continue;
    let url = hit.url;
    try {
      url = decodeURIComponent(hit.url);
    } catch { /* malformed % sequence, e.g. "50%": search the raw URL */ }
    // User data for ad matching is redacted at capture; userData.plain lists the fields that were not hashed.
    if (hit.userData?.plain?.length) {
      piiSeen.add(legalKey(hit));
      findings.push({ ...base, severity: "risk", check: "pii", platform: hit.platform, event: hit.name, step: stepLabel(hit.step), detail: fromWidget(hit, d.piiUnhashed(hit.platform, hit.name, hit.userData.plain)) });
    } else if (visitorEmailIn(url + " " + JSON.stringify(hit.params), hit)) {
      piiSeen.add(legalKey(hit));
      findings.push({ ...base, severity: "risk", check: "pii", platform: hit.platform, event: hit.name, step: stepLabel(hit.step), detail: fromWidget(hit, d.pii(hit.platform, hit.name)) });
    }
  }

  // Unhashed user data in the dataLayer. Valid for GTM enhanced conversions (Google hashes it
  // before sending), but every other tag on the page can read it too.
  const plainPush = run.dataLayerLog.find((e) => e.userData?.plain?.length);
  if (plainPush) {
    findings.push({ ...base, severity: "warning", check: "pii_datalayer", step: stepLabel(plainPush.step), detail: d.piiDataLayer(plainPush.userData.plain) });
  }

  // Events that are not in the plan. Without a plan every event would be listed, which says nothing.
  const unplanned = hasPlan ? [...new Set(run.hits.filter((h) => !planEventFor(h) && !isGa4Builtin(h.platform, h.name)).map((h) => key(h.platform, h.name)))] : [];
  if (unplanned.length) {
    findings.push({ ...base, severity: "info", check: "unplanned_events", detail: d.unplanned(unplanned) });
  }

  // Planned events that fired cleanly.
  // A finding about several events at once (a reused event ID) names each in `events`.
  const problemKeys = new Set(findings.filter((f) => f.event).flatMap((f) => (f.events ?? [f.event]).map((name) => key(f.platform, name))));
  const okKeys = [...new Set(run.hits.filter((h) => planEventFor(h)).map((h) => key(h.platform, h.name)))].filter((k) => !problemKeys.has(k));
  if (okKeys.length) {
    findings.push({ ...base, severity: "ok", check: "matches_plan", detail: d.matches(okKeys) });
  }

  return findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** Counts per severity. Findings a baseline accepted are left out, so the counts say what is new. */
export function summarize(findings) {
  const counts = { broken: 0, risk: 0, warning: 0, info: 0, ok: 0 };
  for (const f of findings) if (!f.accepted) counts[f.severity] += 1;
  return counts;
}

/**
 * Merges the same problem seen on several journeys or viewports into one
 * finding with a list of places, so the report reads as a list of problems.
 */
export function groupFindings(findings) {
  const groups = new Map();
  for (const f of findings) {
    const k = f.severity === "ok" ? `ok|${f.journey}|${f.viewport}` : [f.severity, f.check, f.platform, f.event, f.detail].join("|");
    const where = { journey: f.journey, viewport: f.viewport, step: f.step };
    // A problem counts as accepted only when the baseline accepts it in every place it was seen.
    if (groups.has(k)) {
      const group = groups.get(k);
      group.where.push(where);
      if (!f.accepted) delete group.accepted;
    } else groups.set(k, { severity: f.severity, check: f.check, platform: f.platform, event: f.event, detail: f.detail, evidence: f.evidence, ...(f.gtm ? { gtm: f.gtm } : {}), ...(f.accepted ? { accepted: true } : {}), where: [where] });
  }
  return [...groups.values()].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

const WRONG_VALUE_CHECKS = new Set(["purchase_value_invalid", "purchase_currency_invalid", "purchase_items_empty", "purchase_mismatch"]);
export const PLAN_BUCKETS = ["implemented", "missing", "missing_params", "wrong_values", "unplanned", "not_checked"];

/**
 * Sorts every planned event into one bucket from the runs and the findings checkRun gave them:
 * implemented, missing, missing_params, wrong_values or not_checked, plus one unplanned entry per
 * event that fired but is not in the plan. Coverage = implemented / planned events that were checkable.
 * @param {Plan} plan
 * @param {any[]} runs
 * @param {Finding[]} findings
 */
export function planCheck(plan, runs, findings) {
  const events = (plan?.events ?? []).map((e) => ({ ...e, platform: String(e.platform ?? "").toLowerCase() }));
  const entries = [];
  for (const ev of events) {
    const walked = runs.filter((r) => expectedIn(ev, r.journeyId) && (!r.providers || r.providers.includes(ev.platform)));
    const entry = { platform: ev.platform, event: ev.name, bucket: "not_checked", journeys: [...new Set(walked.map((r) => r.journeyId))] };
    if (walked.length) {
      const own = findings.filter((f) => f.event && walked.some((r) => r.journeyId === f.journey && r.viewport === f.viewport) && hitMatchesEvent(ev, { platform: f.platform, name: f.event }));
      const params = own.filter((f) => f.check === "missing_params");
      const values = own.filter((f) => WRONG_VALUE_CHECKS.has(f.check));
      const fired = walked.some((r) => eventFired(ev, r.hits));
      if (params.length) entry.bucket = "missing_params";
      else if (values.length) entry.bucket = "wrong_values";
      else if (fired) entry.bucket = "implemented";
      // GA4 makes these without a tag, so not seeing one says nothing about the site's setup.
      else entry.bucket = isGa4Automatic(ev.platform, ev.name) ? "not_checked" : "missing";
      const details = [...new Set([...params, ...values].map((f) => f.detail))];
      if (details.length) entry.details = details;
    }
    entries.push(entry);
  }
  // Unplanned events, from the runs whose unplanned_events finding survived the --event filter.
  const seen = new Set();
  for (const r of runs) {
    if (!findings.some((f) => f.check === "unplanned_events" && f.journey === r.journeyId && f.viewport === r.viewport)) continue;
    for (const h of r.hits) {
      if (events.some((e) => hitMatchesEvent(e, h)) || isGa4Builtin(h.platform, h.name) || seen.has(key(h.platform, h.name))) continue;
      seen.add(key(h.platform, h.name));
      entries.push({ platform: h.platform, event: h.name, bucket: "unplanned", journeys: [r.journeyId] });
    }
  }
  const score = (list) => {
    const planned = list.filter((e) => e.bucket !== "unplanned");
    const checkable = planned.filter((e) => e.bucket !== "not_checked").length;
    const implemented = planned.filter((e) => e.bucket === "implemented").length;
    return { implemented, checkable, not_checked: planned.length - checkable, percent: checkable ? Math.round((implemented / checkable) * 100) : null };
  };
  const platforms = [...new Set(entries.filter((e) => e.bucket !== "unplanned").map((e) => e.platform))];
  const counts = Object.fromEntries(PLAN_BUCKETS.map((b) => [b, entries.filter((e) => e.bucket === b).length]));
  return {
    coverage: { ...score(entries), platforms: Object.fromEntries(platforms.map((p) => [p, score(entries.filter((e) => e.platform === p))])) },
    counts,
    events: entries,
  };
}
