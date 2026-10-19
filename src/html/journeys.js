// The Journeys section: journey tabs with a desktop/mobile switch, then per run a status line, the step list grouped by
// page and one step pane with Hits, Data Layer and Requests tabs. Generic markup only ([data-tabs], [data-inspector],
// [data-vp-switch], details.card), so shell.js drives it; the JOURNEYS script in script.js only keeps the viewport
// when the journey changes. Ids come from lib.js (stepAnchor, hitId, pushId, requestId) so Findings links land here.
import { canonicalEvent } from "../checks.js";
import { parseTrackingRequest, providerOf, PROVIDERS } from "../parsers.js";
import { decodeGa4Item, isEventParam, paramTip } from "../glossary.js";
import { SEVERITY_RANK, isConsentEntry } from "../report-shared.js";
import {
  sectionBlock, use, plat, platIcon, badge, chip, n, esc, secs, pathOf, hostPath, safeKey, platformLabel, sortPlatforms, detailHtml,
  whereTarget, missingParamRows, pageTitle, stepTitle, stepAnchor, hitsOf, pushesOf, requestsOf, hitId, pushId, requestId,
  hitFinding,
} from "./lib.js";

const VP_ORDER = ["desktop", "mobile"];
const worstOf = (sevs) => sevs.filter((s) => s in SEVERITY_RANK).sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b])[0] ?? null;
const rankOf = (sev) => SEVERITY_RANK[sev] ?? 9;
const trunc = (s, max = 40) => { const t = String(s ?? ""); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };
const money = (v, c) => (v !== undefined && v !== null && v !== "" ? `${v}${c ? ` ${c}` : ""}` : null);
const cell = (v) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
const vpIcon = (vp) => (vp === "mobile" ? "ui-mobile" : "ui-desktop");

/* ---------- dataLayer pairing, moved from the 0.17 renderer: a hit shows the push and the request behind it ---------- */

// Pixel event names and their GA4 / dataLayer counterparts, so a Meta or TikTok hit can be shown next to the push behind it.
const EVENT_ALIASES = {
  pageview: "pageview", viewcontent: "viewitem", addtocart: "addtocart", addtowishlist: "addtowishlist", initiatecheckout: "begincheckout",
  addpaymentinfo: "addpaymentinfo", purchase: "purchase", completepayment: "purchase", placeanorder: "purchase", lead: "generatelead",
  completeregistration: "signup", search: "search", contact: "generatelead", submitform: "generatelead", subscribe: "subscribe", starttrial: "starttrial",
  viewbasket: "viewcart", tracktransaction: "purchase",
};
const normName = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const eventKey = (s) => EVENT_ALIASES[normName(s)] ?? normName(s);
// GTM-style pushes are objects ({event: "add_to_cart"}); gtag.js records arrays (["event", "add_to_cart", {...}]).
const pushEvent = (value) => (Array.isArray(value) ? (value[0] === "event" ? value[1] : undefined) : value && typeof value === "object" ? value.event : undefined);
const pushText = (value) => (Array.isArray(value) && typeof value[0] === "string" ? `gtag(${value.map((v) => JSON.stringify(v, null, 2)).join(", ")})` : JSON.stringify(value, null, 2));

// Per run: step index -> event key -> the pushes with that event name. Built once so rendering stays linear.
const pushIndexCache = new WeakMap();
function pushIndex(run) {
  let index = pushIndexCache.get(run);
  if (!index) {
    index = new Map();
    for (const e of run.dataLayerLog ?? []) {
      const name = pushEvent(e.value);
      if (typeof name !== "string" || !eventKey(name)) continue;
      if (!index.has(e.step)) index.set(e.step, new Map());
      const byKey = index.get(e.step);
      const key = eventKey(name);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(e);
    }
    pushIndexCache.set(run, index);
  }
  return index;
}

/** The push behind the hit. When the same event fires as often as it was pushed (duplicates), they are paired in order. */
function pushesForHit(run, hit) {
  const pushes = pushIndex(run).get(hit.step)?.get(eventKey(hit.name)) ?? [];
  const key = eventKey(hit.name);
  const twins = run.hits.filter((h) => h.step === hit.step && h.platform === hit.platform && eventKey(h.name) === key);
  return twins.length > 1 && pushes.length === twins.length ? [pushes[twins.indexOf(hit)]] : pushes;
}

/** The network request that carried the hit. Identical hits (duplicates) are paired with identical requests in order. */
function callsForHit(run, hit) {
  const calls = (run.network ?? []).filter((c) => c.step === hit.step && c.url === hit.url);
  const twins = run.hits.filter((h) => h.step === hit.step && h.url === hit.url);
  return twins.length > 1 && calls.length === twins.length ? [calls[twins.indexOf(hit)]] : calls;
}

/* ---------- request parameters, moved from the 0.17 renderer ---------- */

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
function paramSets(call) {
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
    return trimmed.split("\n").filter(Boolean).map((line) => {
      const merged = new Map(query);
      for (const [k, v] of new URLSearchParams(line)) merged.set(k, v);
      return [...merged];
    });
  }
  return [query];
}

/** Parameter rows with a glossary tip: the "?" shows the tip on hover and takes no focus; screen readers read the hidden span. */
function paramRows(lang, entries) {
  return entries.map(([k, v]) => {
    const tip = paramTip(k, lang);
    const isItem = /^pr\d+$/.test(k);
    return `<tr${isItem ? ' class="pr"' : ""}><th scope="row"><span class="pk">${esc(k)}</span>${tip ? `<span class="q" aria-hidden="true" data-tip="${esc(tip)}">?</span><span class="sr">${esc(tip)}</span>` : ""}</th><td>${isItem ? `<span class="muted">${esc(tip ?? "")}</span>` : esc(v)}</td></tr>`;
  }).join("");
}

/**
 * What a hit card shows as its parameters: the request's own parameter set (raw keys, with glossary tips), split
 * into the event's parameters and the session, device, page and consent ones. A GA4 batch carries one set per
 * event; the hit takes the set with its name. Without a captured request, the hit's parsed parameters.
 */
function hitParams(run, hit) {
  const call = callsForHit(run, hit)[0] ?? null;
  if (!call) return { call, batch: null, event: Object.entries(hit.params ?? {}).filter(([k]) => !(k === "items" && hit.items?.length)).map(([k, v]) => [k, cell(v)]), context: [] };
  const sets = paramSets(call);
  let i = 0;
  if (sets.length > 1) {
    const names = (parseTrackingRequest(call.url, call.postData ?? null) ?? []).map((h) => h.name);
    i = Math.max(0, names.indexOf(hit.name));
  }
  const entries = sets[i] ?? [];
  return { call, batch: sets.length > 1 ? [i + 1, sets.length] : null, event: entries.filter(([k]) => isEventParam(k)), context: entries.filter(([k]) => !isEventParam(k)) };
}

/* ---------- items: GA4 item strings and dataLayer item objects as one table ---------- */

const STANDARD_ITEM_KEYS = new Set(["item_id", "item_name", "affiliation", "coupon", "discount", "index", "item_brand", "item_category", "item_category2", "item_category3", "item_category4", "item_category5", "item_list_id", "item_list_name", "item_variant", "location_id", "price", "quantity", "promotion_id", "promotion_name", "creative_name", "creative_slot"]);
const ECOMMERCE_EVENTS = new Set(["view_item", "view_item_list", "select_item", "add_to_cart", "remove_from_cart", "view_cart", "begin_checkout", "add_shipping_info", "add_payment_info", "purchase", "refund", "add_to_wishlist", "view_promotion", "select_promotion"]);
const MAIN_ITEM_KEYS = ["item_id", "item_name", "price", "quantity"];

/** dataLayer ecommerce.items objects as { fields, custom } pairs, the shape decodeGa4Item gives. */
const objectItems = (list) =>
  list.filter((it) => it && typeof it === "object").map((it) => {
    const entries = Object.entries(it).map(([k, v]) => [k, cell(v)]);
    return { fields: entries.filter(([k]) => STANDARD_ITEM_KEYS.has(k)), custom: entries.filter(([k]) => !STANDARD_ITEM_KEYS.has(k)) };
  });
/** The items array of a GTM-style ({ecommerce: {items}}) or gtag.js-style (["event", name, {items}]) push. */
function pushItems(value) {
  const items = Array.isArray(value) ? value[2]?.items : value?.ecommerce?.items ?? value?.items;
  return Array.isArray(items) ? items : [];
}

const kvList = (pairs) => pairs.map(([k, v]) => `<span class="jr-ikv"><code>${esc(k)}</code> ${esc(v === "" ? "–" : v)}</span>`).join("");
function itemsTable(m, t, items) {
  const get = (it, k) => it.fields.find(([f]) => f === k)?.[1];
  const rest = items.map((it) => it.fields.filter(([k]) => !MAIN_ITEM_KEYS.includes(k)));
  const anyRest = rest.some((r) => r.length);
  const anyCustom = items.some((it) => it.custom.length);
  const head = `<tr><th scope="col" class="num">#</th><th scope="col">${esc(t.colId)}</th><th scope="col">${esc(t.colName)}</th><th scope="col" class="num">${esc(t.colPrice)}</th><th scope="col" class="num">${esc(t.colQty)}</th>${anyRest ? `<th scope="col">${esc(t.itemMore)}</th>` : ""}${anyCustom ? `<th scope="col">${esc(m.ui.customItemParams)}</th>` : ""}</tr>`;
  const body = items.map((it, i) => `<tr><td class="num">${i + 1}</td><td class="mono">${esc(get(it, "item_id") ?? "")}</td><td>${esc(get(it, "item_name") ?? "")}</td><td class="num">${esc(get(it, "price") ?? "–")}</td><td class="num">${esc(get(it, "quantity") ?? "1")}</td>${anyRest ? `<td>${kvList(rest[i])}</td>` : ""}${anyCustom ? `<td>${kvList(it.custom)}</td>` : ""}</tr>`).join("");
  return `<div class="jr-ts"><table class="tbl jr-it" aria-label="${esc(m.ui.items)}"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

/* ---------- chips ---------- */

const glyph = (m, sev, size = 13) => `<span class="jr-g sev-${sev}" title="${esc(m.severity[sev])}">${use(`sev-${sev}`, size)}<span class="sr"> ${esc(m.severity[sev])}</span></span>`;
const platChip = (key, size = 14) => chip("plat", key, plat(key, size));
const vpChip = (vp, label = vp) => chip("vp", vp, `${use(vpIcon(vp), 13)}${esc(label)}`);
/** One consent chip per signal: ✓ granted, ✕ denied; the full signal name for screen readers and in the title. */
function consentChip(t, key, v) {
  const mark = v === "granted" ? "✓" : v === "denied" ? "✕" : esc(v);
  return `<span class="chip chip-consent ${safeKey(v)}" title="${esc(`${key}: ${v}`)}"><span class="k" aria-hidden="true">${esc(t.signals[key] ?? key)}</span><span aria-hidden="true">${mark}</span><span class="sr">${esc(`${key} ${v}`)}</span></span>`;
}
const hitConsent = (t, c) => {
  const keys = c ? ["ad_storage", "analytics_storage"].filter((k) => typeof c[k] === "string") : [];
  return keys.length ? keys.map((k) => consentChip(t, k, c[k])).join("") : `<span class="chip chip-consent none" title="${esc(t.noSignalTitle)}">${esc(t.noSignal)}</span>`;
};
const missingChip = (m, k) => `<span class="chip chip-sev broken jr-miss"><span class="k">${esc(k)}</span>${esc(m.ui.missing)}</span>`;
const kv = (k, v) => `<span class="jr-kv">${k ? `<span class="k">${esc(k)}</span>` : ""}<span class="v">${esc(trunc(v))}</span></span>`;

/* ---------- severities: which steps and runs a finding points at ---------- */

/** The worst problem severity per step index of the run, from each row's places (whereTarget: repeated labels resolve to one step). */
function flaggedSteps(rows, runs, run) {
  const out = new Map();
  for (const f of rows) {
    if (!(f.severity in SEVERITY_RANK)) continue;
    for (const w of f.where) {
      if (w.journey !== run.journeyId || w.viewport !== run.viewport) continue;
      const step = whereTarget(runs, w, f)?.step;
      if (step && rankOf(f.severity) < rankOf(out.get(step.index))) out.set(step.index, f.severity);
    }
  }
  return out;
}

/** Everything a run's markup needs about its findings: the step severities, the run's worst, the step opened on load. */
function runState(ctx, rows, run) {
  const steps = (run.steps ?? []).filter((s) => s.index > 0);
  const flagged = flaggedSteps(rows, ctx.runs, run);
  const sevOf = new Map(steps.map((s) => [s.index, worstOf([flagged.get(s.index), ...hitsOf(run, s.index).map((h) => hitFinding(rows, run, s, h)?.severity)])]));
  // A run-level problem (journey incomplete, no consent default) has no step but still marks the run.
  const runSev = worstOf([...sevOf.values(), ...rows.filter((f) => f.where.some((w) => w.journey === run.journeyId && w.viewport === run.viewport)).map((f) => f.severity)]);
  const selected = steps.reduce((best, s) => (sevOf.get(s.index) && (!best || rankOf(sevOf.get(s.index)) < rankOf(sevOf.get(best.index))) ? s : best), null) ?? steps[0] ?? null;
  return { steps, sevOf, runSev, selected };
}

/* ---------- step pane: hits ---------- */

/** The 1–3 parameters a practitioner scans first: missing required ones, value, items, the order id; a page title when there is nothing else. */
function keyBits(ctx, t, hit, flag) {
  const { m } = ctx;
  const p = hit.params ?? {};
  const out = [];
  if (flag?.check === "missing_params") for (const k of [...missingParamRows(ctx.plan, flag, p)].sort()) out.push(missingChip(m, k));
  const mny = money(p.value, p.currency);
  if (mny) out.push(kv("value", mny));
  if (hit.items?.length) out.push(kv("items", hit.items.length));
  else if (hit.platform === "ga4" && ECOMMERCE_EVENTS.has(hit.name)) out.push(`<span class="muted">${esc(m.ui.noItems)}</span>`);
  if (p.transaction_id) out.push(kv("transaction_id", p.transaction_id));
  if (hit.delivery === "server") out.push(`<span class="chip plain">${esc(m.ui.serverSideTag)}</span>`);
  if (!out.length && p.page_title) out.push(kv("", p.page_title));
  if (!out.length) return `<span class="muted">${esc(m.ui.noParameters)}</span>`;
  return out.slice(0, 3).join("");
}

/** The readable form of a request: the URL with one parameter per line, then its body. */
function rawText(url, postData) {
  let u = String(url ?? "");
  try { u = decodeURIComponent(u); } catch { /* keep the encoded form */ }
  return u.replace(/[?&]/g, "\n$&") + (postData ? `\n\n${postData}` : "");
}

function hitCard(ctx, t, rows, run, ri, step, hit, k) {
  const { m, lang, ids } = ctx;
  const flag = hitFinding(rows, run, step, hit);
  const sev = flag?.severity;
  const id = hitId(ri, step.index, k);
  const { call, batch, event, context } = hitParams(run, hit);
  const missing = flag?.check === "missing_params" ? [...missingParamRows(ctx.plan, flag, hit.params ?? {})].sort() : [];
  const items = hit.items?.length ? hit.items.map(decodeGa4Item) : event.filter(([key]) => /^pr\d+$/.test(key)).map(([, v]) => decodeGa4Item(v));
  const missRows = missing.map((key) => `<tr class="jr-mr"><th scope="row"><span class="pk">${esc(key)}</span></th><td>${chip("sev", "broken", esc(m.ui.missing))}</td></tr>`).join("");
  const paramTable = event.length || missing.length
    ? `<table class="tbl jr-kvt" aria-label="${esc(m.ui.eventParams)}"><tbody>${paramRows(lang, event)}${missRows}</tbody></table>`
    : `<p class="muted xs">${esc(m.ui.noParameters)}</p>`;
  const ctxTable = context.length ? `<details class="card jr-ctx"><summary><span class="t">${esc(m.ui.contextParams)} ${n(context.length)}</span></summary><div class="body"><table class="tbl jr-kvt" aria-label="${esc(m.ui.contextParams)}"><tbody>${paramRows(lang, context)}</tbody></table></div></details>` : "";
  const pushes = pushesForHit(run, hit);
  const stepPushes = pushesOf(run, step.index);
  const stepCalls = requestsOf(run, step.index);
  const pushLine = pushes.length
    ? pushes.map((e) => `<a class="mono" href="#${pushId(ri, step.index, stepPushes.indexOf(e))}">${esc(pushEvent(e.value) ?? "")} · ${esc(secs(run, e.t))}</a>`).join("")
    : `<span class="muted">${esc(m.ui.noMatchingPush)}</span>`;
  const label = PROVIDERS[safeKey(hit.platform)] ?? platformLabel(hit.platform);
  const calls = callsForHit(run, hit);
  const reqLine = calls.length
    ? calls.map((c) => `<a class="mono" href="#${requestId(ri, step.index, stepCalls.indexOf(c))}">${esc(c.method ?? "")} ${esc(hostPath(c.url))} ${esc(c.status ?? "")}</a>${c.blocked ? `<span class="muted">${esc(m.html.blockedBy(label))}</span>` : ""}`).join("")
    : `<span class="mono">${esc(hostPath(hit.url))}</span>`;
  const card = flag ? ids.get(flag) : null;
  return `<details class="card jr-hit${sev ? ` sev-${sev}` : ""}" id="${id}"${sev ? ` data-flagged="${sev}" data-print-open` : ""}><summary><span class="jr-c-p">${platChip(hit.platform)}</span><code class="jr-ev">${esc(hit.name)}</code><span class="jr-c-k">${keyBits(ctx, t, hit, flag)}</span><span class="jr-c-c">${hitConsent(t, hit.consent)}</span><span class="jr-c-s">${sev ? badge(sev, m.severity[sev]) : ""}</span><span class="jr-tm">${esc(secs(run, hit.t))}</span></summary>
<div class="body">${flag ? `<p class="jr-flag sev-${sev}">${use(`sev-${sev}`, 14)}<span>${detailHtml(flag.detail)}</span>${card ? `<a href="#${card}">${esc(m.html.findingLink)}</a>` : ""}</p>` : ""}
<div class="jr-hb"><div><h4 class="jr-h">${esc(m.ui.parameters)}${n(event.length + missing.length)}</h4>${batch ? `<p class="muted xs jr-batch">${esc(m.ui.inBatch(batch[0], batch[1]))}</p>` : ""}${paramTable}${ctxTable}</div>
${items.length ? `<div><h4 class="jr-h">${esc(m.ui.items)}${n(items.length)}</h4>${itemsTable(m, t, items)}</div>` : ""}
<div><h4 class="jr-h">${esc(m.ui.source)}</h4><ul class="jr-src"><li><span class="lbl">${esc(t.dataLayer)}</span>${pushLine}</li><li><span class="lbl">${esc(m.ui.request)}</span>${reqLine}</li></ul></div></div>
<details class="card jr-raw"><summary><span class="t">${esc(m.ui.rawRequest)}</span><span class="end mono xs muted">${esc(hostPath(call?.url ?? hit.url))}</span></summary><div class="body"><pre>${esc(rawText(call?.url ?? hit.url, call?.postData))}</pre></div></details>
</div></details>`;
}

/* ---------- step pane: dataLayer ---------- */

function pushCard(ctx, t, run, ri, step, e, k) {
  const { m } = ctx;
  const v = e.value;
  const name = isConsentEntry(v) ? `consent ${v[1]}` : pushEvent(v) ?? trunc(JSON.stringify(v) ?? String(v), 48);
  const items = objectItems(pushItems(v));
  let bits = "";
  if (isConsentEntry(v) && v[2] && typeof v[2] === "object") bits = Object.entries(v[2]).filter(([, x]) => typeof x === "string").map(([s, x]) => consentChip(t, s, x)).join("");
  else {
    const ec = Array.isArray(v) ? v[2] : v?.ecommerce;
    const out = [];
    const mny = money(ec?.value, ec?.currency);
    if (mny) out.push(kv("value", mny));
    if (items.length) out.push(kv("items", items.length));
    if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && v.ecommerce === null) out.push(`<span class="muted">${esc(t.clear)}</span>`);
    bits = out.join("");
  }
  return `<details class="card jr-push" id="${pushId(ri, step.index, k)}"><summary><code class="jr-ev">${esc(name)}</code><span class="jr-c-k">${bits}</span><span class="jr-tm">${esc(secs(run, e.t))}</span></summary>
<div class="body">${items.length ? `<h4 class="jr-h">${esc(m.ui.items)}${n(items.length)}</h4>${itemsTable(m, t, items)}` : ""}<pre>${esc(pushText(v))}</pre></div></details>`;
}

/* ---------- step pane: requests ---------- */

const skippedOf = (run, si) => Object.entries(run.skipped?.[si] ?? {}).sort((a, b) => b[1] - a[1]);

function requestTable(ctx, t, run, ri, step, calls) {
  const { m } = ctx;
  const rows = calls.map((c, k) => {
    const key = safeKey(c.provider ?? providerOf(c.url)?.key ?? c.vendor);
    const label = PROVIDERS[key] ?? c.vendor ?? key;
    const sets = paramSets(c);
    const names = (parseTrackingRequest(c.url, c.postData ?? null) ?? []).map((h) => h.name);
    const events = sets.map((_, i) => names[i] ?? (names.length === 1 ? names[0] : "")).map((name, i) => (name || sets.length > 1 ? `<span class="jr-rev">${name ? `<code>${esc(name)}</code>` : ""}${sets.length > 1 ? `<span class="muted">${esc(m.ui.inBatch(i + 1, sets.length))}</span>` : ""}</span>` : "")).join("");
    const blocked = c.blocked ? ` <span class="chip" title="${esc(m.html.blockedBy(label))}">${esc(t.blocked)}<span class="sr"> ${esc(m.html.blockedBy(label))}</span></span>` : "";
    return `<tr id="${requestId(ri, step.index, k)}"><td>${chip("plat", key, plat(key, 14, label))}</td><td class="mono">${esc(c.method ?? "")}</td><td>${events}</td><td class="mono jr-url" title="${esc(c.url)}"><span>${esc(hostPath(c.url))}</span></td><td><span class="jr-st-c"><span class="mono">${esc(c.status ?? "")}</span>${blocked}</span></td><td class="num">${esc(secs(run, c.t))}</td></tr>`;
  }).join("");
  return `<div class="tscroll"><table class="tbl jr-req" aria-label="${esc(m.ui.tabNetwork)}"><thead><tr><th scope="col">${esc(m.ui.platform)}</th><th scope="col">${esc(m.ui.method)}</th><th scope="col">${esc(m.ui.event)}</th><th scope="col">${esc(t.colUrl)}</th><th scope="col">${esc(m.ui.status)}</th><th scope="col" class="num">${esc(m.html.timeCol)}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* ---------- step pane ---------- */

/** What the step did, as the replay will do it: the action and the selector it targets. Typed values are never shown. */
function actionText(m, step) {
  const r = step.replay;
  const parts = [];
  if (r?.action === "goto") parts.push(`goto ${pathOf(r.url)}`);
  else if (r) parts.push([r.action, r.selector ?? (r.text ? `"${r.text}"` : "")].filter(Boolean).join(" "));
  else if (step.action) parts.push(step.action);
  if (step.forced) parts.push(m.ui.clickedThrough);
  return parts;
}

/** The platform-parity line for a step: the events of this step whose platforms disagree (count, value, currency). */
function parityNote(m, run, step, parity) {
  const events = new Set(hitsOf(run, step.index).map((h) => canonicalEvent(h.name)));
  const lines = (parity?.shared ?? []).filter((s) => s.mismatch.length && events.has(s.event));
  return lines.map((s) => {
    const per = sortPlatforms(Object.keys(s.platforms)).map((k) => { const p = s.platforms[k]; return `<span class="jr-pp">${platChip(k, 13)}<code>${esc(p.names.join(" / "))}</code><span class="mono">${p.count}×${p.value !== null ? ` · ${esc(money(p.value, p.currency))}` : ""}</span></span>`; }).join("");
    return `<p class="jr-par">${use("sev-warning", 14)}<span class="jr-par-h">${esc(m.html.parity)}</span>${per}<b>${esc(s.mismatch.map((x) => m.html.mismatch[x] ?? x).join(", "))}</b></p>`;
  }).join("");
}

function stepPane(ctx, t, rows, run, ri, step, sev, selected) {
  const { m } = ctx;
  const id = stepAnchor(ri, step.index);
  const hits = hitsOf(run, step.index);
  const pushes = pushesOf(run, step.index);
  const calls = requestsOf(run, step.index);
  const skipped = skippedOf(run, step.index);
  const skippedN = skipped.reduce((a, [, c]) => a + c, 0);
  const meta = [step.pagePath ? pathOf(step.pagePath) : null, ...actionText(m, step), secs(run, step.t)].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join("");
  const reqNotes = `${skippedN ? `<p class="muted xs jr-note-s">${esc(m.ui.skippedInStep(skipped.map(([v, c]) => `${v} ${c}`).join(", "), skippedN))}</p>` : ""}${calls.some((c) => c.bodyDropped) ? `<p class="muted xs jr-note-s">${esc(m.ui.bodyDropped)}</p>` : ""}`;
  const tabs = [
    ["hits", esc(m.html.hitsCol), m.html.hitsInStep, hits.length, hits.length ? `<div class="jr-list">${hits.map((h, k) => hitCard(ctx, t, rows, run, ri, step, h, k)).join("")}</div>` : `<p class="muted xs jr-empty">${esc(m.ui.noHits)}</p>`],
    ["dl", esc(t.dataLayer), t.dataLayer, pushes.length, pushes.length ? `<div class="jr-list">${pushes.map((e, k) => pushCard(ctx, t, run, ri, step, e, k)).join("")}</div>` : `<p class="muted xs jr-empty">${esc(m.ui.noPushes)}</p>`],
    ["req", esc(m.ui.tabNetwork), m.ui.tabNetwork, calls.length, `${calls.length ? requestTable(ctx, t, run, ri, step, calls) : `<p class="muted xs jr-empty">${esc(m.ui.noRequests)}</p>`}${reqNotes}`],
  ];
  // A tab with nothing in it is shown but disabled; the requests tab stays open when it only has the skipped-requests note.
  const live = (k, c) => c > 0 || (k === "req" && Boolean(reqNotes));
  const first = tabs.find(([k, , , c]) => live(k, c));
  const body = first
    ? `<div class="tabs jr-tabs" data-tabs><div role="tablist" aria-label="${esc(t.stepOf(step.index))}">${tabs.map(([k, label, , c]) => `<button type="button" role="tab" aria-controls="${id}-${k}" aria-selected="${first[0] === k}"${live(k, c) ? "" : " disabled"}>${label} ${n(c)}</button>`).join("")}</div>
${tabs.map(([k, , dataLabel, c, html]) => `<div role="tabpanel" id="${id}-${k}" data-label="${esc(dataLabel)}"${live(k, c) ? "" : ' class="jr-none"'}>${html}</div>`).join("")}</div>`
    : `<p class="muted xs jr-empty">${esc(t.nothing)}</p>`;
  return `<article class="card jr-pane${sev ? ` sev-${sev}` : ""}" id="${id}" data-select-pane data-step="${step.index}"${sev ? ` data-flagged="${sev}"` : ""}${selected ? " data-selected" : ""} tabindex="-1" aria-labelledby="${id}-t">
<header class="jr-ph"><h3 id="${id}-t"><span class="jr-n">${step.index}</span><span>${esc(stepTitle(run, step))}</span></h3><span class="jr-ph-e">${sev ? badge(sev, m.severity[sev]) : ""}${vpChip(run.viewport)}</span><p class="jr-ph-m">${meta}</p></header>
${parityNote(m, run, step, ctx.metrics.parity?.[ri])}${body}
</article>`;
}

/* ---------- one run: status line, plan line, step list, panes ---------- */

/** Expected versus observed for the run, as one line: the funnel sentence, then a chip per planned event that failed (three at most). */
function planLine(ctx, run, ri) {
  const { m } = ctx;
  const fu = ctx.metrics.funnel?.[ri];
  if (!fu?.events?.length) return "";
  const bad = fu.events.filter((r) => r.status !== "ok");
  const chips = bad.slice(0, 3).map((r) => {
    // The chip names the event; what is wrong with it is its title (and read out), so the line stays one line at 1280.
    const why = r.status === "missing_params" ? m.html.params(r.missingParams) : m.html.notSent;
    const label = `${platIcon(r.platform, 13)}<code>${esc(r.event)}</code><span class="sr"> ${esc(why)}</span>`;
    if (r.step === null) return `<span class="chip chip-sev broken" title="${esc(why)}">${label}</span>`;
    const k = hitsOf(run, r.step).findIndex((h) => safeKey(h.platform) === safeKey(r.platform) && String(h.name).toLowerCase() === String(r.event).toLowerCase());
    return `<a class="chip chip-sev broken" href="#${k >= 0 ? hitId(ri, r.step, k) : stepAnchor(ri, r.step)}" title="${esc(why)}">${label}</a>`;
  }).join("");
  const more = bad.length > 3 ? `<span class="chip plain">+${bad.length - 3}</span>` : "";
  // The chips come in plan order, so the first "not sent" one is where the funnel breaks; no sentence repeats it.
  const lead = m.html.funnelLead(fu.observed, fu.expected, fu.ok);
  return `<p class="jr-plan"><span class="jr-plan-h">${esc(m.html.funnel)}</span><span class="jr-plan-t">${use(bad.length ? "sev-broken" : "sev-ok", 13, bad.length ? "jr-bad" : "jr-good")}${esc(lead)}</span>${chips}${more}</p>`;
}

function runPanel(ctx, t, rows, run, ri, state) {
  const { m } = ctx;
  const { steps, sevOf, selected } = state;
  const plats = sortPlatforms(new Set((run.hits ?? []).map((h) => h.platform)));
  const groups = [];
  for (const s of steps) {
    const key = s.pagePath ? pathOf(s.pagePath) : "";
    if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, title: pageTitle(run, s.index), steps: [] });
    groups[groups.length - 1].steps.push(s);
  }
  const list = groups.map((g) => `<li class="jr-pg"><span class="jr-pg-i">${use("ui-page", 12)}</span><span class="jr-pg-t">${esc(g.title)}</span>${g.key ? `<code class="jr-pg-p">${esc(g.key)}</code>` : ""}</li>${g.steps.map((s) => {
    const sev = sevOf.get(s.index);
    const hs = hitsOf(run, s.index);
    const id = stepAnchor(ri, s.index);
    const counts = !plats.length ? '<span class="jr-hc"></span>' : plats.map((p) => { const c = hs.filter((h) => h.platform === p).length; return `<span class="jr-hc">${c ? `<span class="chip chip-plat ${safeKey(p)}" title="${esc(t.hitsOf(c, platformLabel(p)))}">${platIcon(p, 12)}${c}</span>` : ""}</span>`; }).join("");
    return `<li class="jr-st${hs.length ? "" : " zero"}${sev ? ` sev-${sev}` : ""}"${sev ? ` data-flagged="${sev}"` : ""}><button type="button" data-select-target="#${id}" data-step="${s.index}" aria-controls="${id}"><span class="jr-n">${s.index}</span><span class="jr-t">${esc(stepTitle(run, s))}</span>${counts}<span class="jr-gs">${sev ? glyph(m, sev) : ""}</span></button></li>`;
  }).join("")}`).join("");
  const ms = ctx.metrics.timing?.[ri]?.durationMs ?? null;
  const runChip = run.completed
    ? `<span title="${esc(run.note ?? "")}">${chip("run", "completed", `${use("sev-ok", 13)}${esc(m.ui.completed)}`)}</span>`
    : chip("run", "incomplete", `${use("sev-warning", 13)}${esc(m.ui.notCompleted)}`);
  const status = `<p class="jr-status"><span class="jr-runh">${vpChip(run.viewport, `${run.journeyId} · ${run.viewport}`)}</span>${runChip}<span class="jr-nums">${esc(t.stats(steps.length, (run.hits ?? []).length, ms === null ? null : (ms / 1000).toFixed(1)))}</span>${run.goal ? `<span class="jr-goal" title="${esc(run.goal)}">${esc(run.goal)}</span>` : ""}</p>`;
  // Why an incomplete run stopped is the first thing to read about it, so it gets its own line.
  const note = !run.completed && run.note ? `<p class="jr-stop">${use("sev-warning", 14)}<span>${esc(run.note)}</span></p>` : "";
  const inspector = steps.length
    ? `<div class="jr-insp" style="--jr-plats:${Math.max(1, plats.length)}">
<nav class="jr-steps" aria-label="${esc(t.steps)}"><ul data-select>${list}</ul></nav>
<div class="jr-panes">${steps.map((s) => stepPane(ctx, t, rows, run, ri, s, sevOf.get(s.index), s === selected)).join("")}</div>
</div>`
    : `<p class="muted">${esc(m.ui.noSteps)}</p>`;
  return `<div class="jr-run" id="j${ri}" data-inspector>
${status}${note}${planLine(ctx, run, ri)}
${inspector}</div>`;
}

/** @param {import("./shell.js").Ctx} ctx */
export function render(ctx) {
  const { m, runs } = ctx;
  const t = m.html.journeys;
  const heading = m.html.shell.sections.journeys;
  if (!runs.length) return sectionBlock("journeys", heading, `<p class="muted">${esc(t.noRuns)}</p>`);
  // Accepted rows are known and not counted (tally), so they do not flag steps or hits either.
  const rows = ctx.rows.filter((f) => !f.accepted);
  const states = runs.map((run) => runState(ctx, rows, run));
  // The run opened on load is the one with the worst finding, earliest on ties (demo: checkout · mobile).
  const openRun = runs.map((_, ri) => ri).sort((a, b) => rankOf(states[a].runSev) - rankOf(states[b].runSev) || a - b)[0];
  const journeys = [...new Set(runs.map((r) => r.journeyId))];
  const runsOf = (j) => runs.map((r, ri) => ({ r, ri })).filter((x) => x.r.journeyId === j).sort((a, b) => (VP_ORDER.indexOf(a.r.viewport) + 1 || 9) - (VP_ORDER.indexOf(b.r.viewport) + 1 || 9) || a.ri - b.ri);
  const runGlyph = (ri, size) => (states[ri].runSev ? glyph(m, states[ri].runSev, size) : "");
  const jtabs = journeys.map((j, ji) => `<button type="button" role="tab" aria-controls="jy-${ji}" aria-selected="${j === runs[openRun].journeyId}">${esc(j)}<span class="jr-gl">${runsOf(j).map(({ ri }) => runGlyph(ri, 12)).join("")}</span></button>`).join("");
  const jpanels = journeys.map((j, ji) => {
    const rs = runsOf(j);
    // Each journey's switch starts on its worst run, so switching journeys never lands on a quiet run first.
    const pick = rs.find((x) => x.ri === openRun) ?? [...rs].sort((a, b) => rankOf(states[a.ri].runSev) - rankOf(states[b.ri].runSev) || a.ri - b.ri)[0];
    const vbtns = rs.map(({ r, ri }) => `<button type="button" class="jr-vpb ${safeKey(r.viewport)}" data-vp="${esc(r.viewport)}" data-vp-target="#j${ri}" aria-pressed="${ri === pick.ri}" title="${esc(r.viewport)}">${use(vpIcon(r.viewport), 14)}<span class="jr-vpl">${esc(r.viewport)}</span>${runGlyph(ri, 12)}</button>`).join("");
    return `<div role="tabpanel" id="jy-${ji}" data-label="${esc(j)}"><div class="jr-vp" data-vp-switch role="group" aria-label="${esc(t.pickViewport)}">${vbtns}</div>
${rs.map(({ r, ri }) => runPanel(ctx, t, rows, r, ri, states[ri])).join("\n")}</div>`;
  }).join("");
  return sectionBlock("journeys", heading, `<div class="tabs jr-pick" data-tabs><div role="tablist" aria-label="${esc(m.ui.chooseJourney)}">${jtabs}</div>
${jpanels}</div>`);
}
