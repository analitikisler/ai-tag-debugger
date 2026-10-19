// Reads a GTM container export (Admin → Export container) to name the tag and trigger
// behind a hit. Matching is deterministic: no API call and no AI model.

import { canonicalEvent, isConsentCommand } from "./checks.js";
import { messages } from "./i18n.js";

// GTM's built-in "All Pages" trigger has no entry in the export's trigger list.
const BUILT_IN_TRIGGERS = { 2147479553: { name: "All Pages", type: "PAGEVIEW" } };
// The dataLayer events GTM raises for page triggers; the init script records them like any push.
const PAGE_EVENTS = { PAGEVIEW: "gtm.js", DOM_READY: "gtm.dom", WINDOW_LOADED: "gtm.load" };
// Triggers GTM evaluates from what happens in the page. Their events reach the dataLayer only
// while such a trigger is listening, so the dataLayer can confirm one but not rule it out.
const PAGE_ACTION_EVENTS = {
  CLICK: "gtm.click", LINK_CLICK: "gtm.linkClick", FORM_SUBMIT: "gtm.formSubmit", FORM_SUBMISSION: "gtm.formSubmit", HISTORY_CHANGE: "gtm.historyChange",
  ELEMENT_VISIBILITY: "gtm.elementVisibility", TIMER: "gtm.timer", SCROLL_DEPTH: "gtm.scrollDepth", JS_ERROR: "gtm.pageError", YOU_TUBE_VIDEO: "gtm.video",
};
// Older exports write the custom event filter's operators in short form.
const SHORT_OPS = { _eq: "EQUALS", _cn: "CONTAINS", _sw: "STARTS_WITH", _ew: "ENDS_WITH", _re: "MATCH_REGEX", _lt: "LESS", _le: "LESS_OR_EQUALS", _gt: "GREATER", _ge: "GREATER_OR_EQUALS", _css: "CSS_SELECTOR", _um: "URL_MATCHES" };
const PAGE_VARIABLES = { "Page URL": "URL", "Page Path": "PATH", "Page Hostname": "HOST" };
const EVENT_PARAMS = ["eventName", "event_name", "event", "eventType", "standardEventName", "customEventName", "eventTypeStandard", "eventTypeCustom"];

/** A tag parameter list as a flat { key: value } map; nested lists and maps are kept as JSON text. */
function params(list = []) {
  const out = {};
  for (const p of list) out[p.key] = p.value ?? (p.list || p.map ? JSON.stringify(p.list ?? p.map) : undefined);
  return out;
}

/** Which platform a tag sends to, from its type or, for custom HTML and templates, from its code. */
function tagPlatform(tag, p) {
  if (["gaawe", "gaawc", "googtag"].includes(tag.type)) return "ga4";
  if (["awct", "sp", "gclidw"].includes(tag.type)) return "google_ads";
  const text = `${tag.type} ${tag.name ?? ""} ${p.html ?? ""}`.toLowerCase();
  if (/fbq\(|facebook|meta pixel|\bmeta\b/.test(text)) return "meta";
  if (/ttq\.|tiktok/.test(text)) return "tiktok";
  return null;
}

/** The event names a tag sends: its event parameter, a page_view for a GA4 config tag, or the names in fbq/ttq calls. */
function tagEvents(tag, p) {
  if (tag.type === "gaawc" || tag.type === "googtag") return ["page_view"];
  const names = EVENT_PARAMS.map((k) => p[k]).filter((v) => typeof v === "string" && v);
  for (const m of String(p.html ?? "").matchAll(/(?:fbq|ttq)\s*(?:\(\s*['"](?:track|trackCustom)['"]\s*,|\.track\s*\()\s*['"]([^'"]+)['"]/g)) names.push(m[1]);
  if (/fbq\s*\(\s*['"]init['"]/.test(p.html ?? "") || /ttq\.page\s*\(/.test(p.html ?? "")) names.push("PageView", "Pageview");
  return names;
}

/** The custom event names a trigger fires on, from its "Event name equals …" filter. */
function triggerEvents(trigger) {
  return (trigger?.customEventFilter ?? []).map((f) => params(f.parameter).arg1).filter(Boolean);
}

function describeTrigger(id, byId) {
  const t = byId.get(String(id)) ?? BUILT_IN_TRIGGERS[id];
  if (!t) return { id: String(id), name: `#${id}`, type: "unknown" };
  const events = triggerEvents(t);
  return { id: String(id), name: t.name, type: t.type, ...(events.length ? { event: events.join(", ") } : {}) };
}

/**
 * The tags in a container export with their platform, events and triggers.
 * @returns {{ id: string, name: string, type: string, platform: string|null, events: string[], paused: boolean, consent: string[], triggers: any[], blocking: any[] }[]}
 */
export function containerTags(container) {
  const v = container?.containerVersion ?? container ?? {};
  const byId = new Map((v.trigger ?? []).map((t) => [String(t.triggerId), t]));
  return (v.tag ?? []).map((tag) => {
    const p = params(tag.parameter);
    const triggers = (tag.firingTriggerId ?? []).map((id) => describeTrigger(id, byId));
    let events = tagEvents(tag, p);
    // An event name taken from a variable such as {{Event}} is whatever the trigger's custom event is.
    if (events.some((e) => /^\{\{.+\}\}$/.test(e))) events = [...events.filter((e) => !/^\{\{.+\}\}$/.test(e)), ...triggers.flatMap((t) => (t.event ? t.event.split(", ") : []))];
    const cs = tag.consentSettings;
    return {
      id: String(tag.tagId ?? ""),
      name: tag.name,
      type: tag.type,
      platform: tagPlatform(tag, p),
      events,
      paused: tag.paused === true,
      consent: cs?.consentStatus === "NEEDED" ? (cs.consentType?.list ?? []).map((x) => x.value).filter(Boolean) : [],
      triggers,
      blocking: (tag.blockingTriggerId ?? []).map((id) => describeTrigger(id, byId)),
    };
  });
}

/** The tags in the container that send an event to a platform. */
export function tagsForEvent(tags, platform, event) {
  const want = canonicalEvent(event);
  return tags.filter((t) => t.platform === platform && t.events.some((e) => canonicalEvent(e) === want));
}

/** The event name and data a push adds to GTM's data model: an object as it is, a gtag() call as its event and eventModel. */
function pushModel(value) {
  if (Array.isArray(value)) return value[0] === "event" && typeof value[1] === "string" ? { event: value[1], data: { event: value[1], eventModel: value[2] ?? {} } } : null;
  if (value && typeof value === "object") return { event: typeof value.event === "string" ? value.event : undefined, data: value };
  return null;
}

/** Merges a push into the running data layer the way GTM's version 2 model does: objects and arrays merge key by key, so a value persists until it is overwritten or cleared with null. */
function merge(state, push) {
  for (const [k, v] of Object.entries(push)) {
    const same = v && typeof v === "object" && state[k] && typeof state[k] === "object" && Array.isArray(v) === Array.isArray(state[k]);
    if (same) merge(state[k], v);
    else state[k] = v && typeof v === "object" ? structuredClone(v) : v;
  }
  return state;
}

/** A value from the data layer by dot path, as a Data Layer Variable reads it; version 1 reads the key as it is. */
function readPath(state, name, version) {
  if (String(version) === "1") return state[name];
  return String(name).split(".").reduce((v, k) => (v && typeof v === "object" ? v[k] : undefined), state);
}

/** A part of the page address at the push, or undefined when it is not a valid address. */
function urlPart(url, component) {
  try {
    const u = new URL(url);
    return { URL: u.href, PATH: u.pathname, HOST: u.hostname, PROTOCOL: u.protocol.replace(":", ""), PORT: u.port, FRAGMENT: u.hash.replace("#", ""), QUERY: u.search.replace("?", "") }[component];
  } catch {
    return undefined;
  }
}

/**
 * The value of one GTM variable at a push: { value, field } when the dataLayer can give it, where `field` is how the
 * report names it (a Data Layer Variable by its path), or { unknown: name } when only the page could tell.
 */
function resolveVariable(name, ctx, variables) {
  if (name === "_event" || name === "Event") return { value: ctx.event, field: "event" };
  if (PAGE_VARIABLES[name]) return ctx.url ? { value: urlPart(ctx.url, PAGE_VARIABLES[name]), field: name } : { unknown: name };
  const v = variables.find((x) => x.name === name);
  const p = params(v?.parameter);
  if (v?.type === "v" && p.name) return { value: readPath(ctx.state, p.name, p.dataLayerVersion ?? "2"), field: p.name };
  if (v?.type === "c") return { value: p.value, field: name };
  if (v?.type === "u" && ctx.url) return { value: urlPart(ctx.url, p.component ?? "URL"), field: name };
  return { unknown: name };
}

/** A condition argument with its {{variables}} filled in; a lone reference keeps the value's type. */
function resolveArg(text, ctx, variables) {
  const whole = /^\{\{(.+)\}\}$/.exec(String(text ?? ""));
  if (whole) return resolveVariable(whole[1], ctx, variables);
  let unknown = null;
  const value = String(text ?? "").replace(/\{\{(.+?)\}\}/g, (_, n) => {
    const r = resolveVariable(n, ctx, variables);
    if (r.unknown) unknown = r.unknown;
    return r.value ?? "";
  });
  return unknown ? { unknown } : { value, field: String(text ?? "") };
}

/** GTM's comparison for one condition type: true, false, or "unknown" for the ones only the page can answer. */
function compare(type, a, b, ignoreCase) {
  const s = (v) => (ignoreCase ? String(v ?? "").toLowerCase() : String(v ?? ""));
  const n = (v) => (v === "" || v === null || v === undefined || typeof v === "object" ? NaN : Number(v));
  switch (type) {
    case "EQUALS": return s(a) === s(b);
    case "CONTAINS": return s(a).includes(s(b));
    case "STARTS_WITH": return s(a).startsWith(s(b));
    case "ENDS_WITH": return s(a).endsWith(s(b));
    case "MATCH_REGEX":
      try {
        return new RegExp(String(b ?? ""), ignoreCase ? "i" : "").test(String(a ?? ""));
      } catch {
        return "unknown";
      }
    case "LESS": return n(a) < n(b);
    case "LESS_OR_EQUALS": return n(a) <= n(b);
    case "GREATER": return n(a) > n(b);
    case "GREATER_OR_EQUALS": return n(a) >= n(b);
    default: return "unknown";
  }
}

/** A value as the reason shows it: numbers bare, text quoted, objects as JSON. */
const show = (v, m) => (v === undefined || v === null ? m.nothing : typeof v === "object" ? JSON.stringify(v) : typeof v === "string" && !/^-?\d+(\.\d+)?$/.test(v) ? `"${v}"` : String(v));

/** One trigger condition at a push: { ok: true | false | "unknown", reason }, with the reason the report shows when it is not met. */
function condition(c, ctx, variables, trigger, m) {
  const type = SHORT_OPS[c.type] ?? c.type;
  const p = params(c.parameter);
  if (!m.ops[type]) return { ok: "unknown", reason: m.conditionType(trigger, type) };
  const a = resolveArg(p.arg0, ctx, variables);
  const b = resolveArg(p.arg1, ctx, variables);
  const unknown = a.unknown ?? b.unknown;
  if (unknown) return { ok: "unknown", reason: m.conditionUnknown(trigger, unknown) };
  const negate = String(p.negate) === "true";
  let ok = compare(type, a.value, b.value, String(p.ignore_case) === "true");
  if (ok === "unknown") return { ok, reason: m.conditionType(trigger, type) };
  if (negate) ok = !ok;
  return { ok, reason: ok ? "" : m.condition(trigger, a.field, m.ops[type], show(b.value, m), show(a.value, m), negate) };
}

/**
 * Whether a GTM trigger fired in a journey, judged from the recorded dataLayer pushes alone.
 * @param {any} trigger A trigger from the container export.
 * @param {{ value: any, url?: string }[]} pushes The run's dataLayerLog entries, in order.
 * @param {any[]} [variables] The export's variable list, for conditions that read Data Layer Variables.
 * @returns {{ fired: true | false | "unknown", reason: string, matched?: number }} `matched` is the index of the push it fired on.
 */
export function evaluateTrigger(trigger, pushes, variables = [], lang = "en") {
  const m = messages(lang).gtm;
  const name = trigger?.name ?? "?";
  const type = trigger?.type ?? "unknown";
  const custom = type === "CUSTOM_EVENT";
  const event = PAGE_EVENTS[type] ?? PAGE_ACTION_EVENTS[type];
  if (!custom && !event) return { fired: "unknown", reason: m.unknownType(name, type) };
  const state = {};
  let seen = false;
  let failed = null;
  let unknown = null;
  for (let i = 0; i < pushes.length; i++) {
    const model = pushModel(pushes[i]?.value);
    if (!model) continue;
    merge(state, model.data);
    const ctx = { event: model.event, state, url: pushes[i].url };
    // The event conditions decide whether the push concerns this trigger at all; the filter decides whether it fires.
    const events = custom ? (trigger.customEventFilter ?? []).map((c) => condition(c, ctx, variables, name, m)) : [{ ok: model.event === event }];
    if (events.some((r) => r.ok === false)) continue;
    const vague = events.find((r) => r.ok === "unknown");
    if (vague) {
      unknown ??= vague;
      continue;
    }
    seen = true;
    const result = (trigger.filter ?? []).map((c) => condition(c, ctx, variables, name, m)).find((r) => r.ok !== true);
    if (!result) return { fired: true, reason: m.triggerFired(name, model.event ?? event), matched: i };
    if (result.ok === "unknown") unknown ??= result;
    else failed ??= result;
  }
  if (unknown) return { fired: "unknown", reason: unknown.reason };
  if (failed) return { fired: false, reason: failed.reason };
  if (PAGE_ACTION_EVENTS[type] && !seen) return { fired: "unknown", reason: m.pageTrigger(name, type.toLowerCase().replace(/_/g, " ")) };
  if (PAGE_EVENTS[type] && !seen) return { fired: false, reason: m.noPageEvent(name, event) };
  return { fired: false, reason: m.noPush(triggerEvents(trigger).join(", ") || event || name) };
}

/** The Consent Mode state after the pushes up to and including `upTo`; a type nobody set is not denied. */
function consentAt(pushes, upTo) {
  const state = {};
  for (const e of pushes.slice(0, upTo + 1)) if (isConsentCommand(e, "default") || isConsentCommand(e, "update")) Object.assign(state, e.value[2] ?? {});
  return state;
}

/** Why one tag did or did not fire: its pause state, its triggers, its exceptions and its consent needs, in that order. */
function evaluateTag(tag, byId, pushes, variables, m, lang) {
  if (tag.paused) return { fired: false, why: m.paused };
  if (!tag.triggers.length) return { fired: false, why: m.noTrigger };
  const raw = (t) => byId.get(String(t.id)) ?? (BUILT_IN_TRIGGERS[t.id] ? { ...BUILT_IN_TRIGGERS[t.id], triggerId: t.id } : null);
  const evaluate = (t) => (raw(t) ? evaluateTrigger(raw(t), pushes, variables, lang) : { fired: "unknown", reason: m.missingTrigger(t.name) });
  const results = tag.triggers.map(evaluate);
  const hit = results.find((r) => r.fired === true);
  if (!hit) {
    const vague = results.find((r) => r.fired === "unknown");
    return vague ? { fired: "unknown", why: vague.reason } : { fired: false, why: results.map((r) => r.reason).join("; ") };
  }
  // An exception only stops the tag when it fires on the same push as the firing trigger.
  for (const b of tag.blocking) {
    const r = evaluate(b);
    if (r.fired === true && r.matched === hit.matched) return { fired: false, why: m.blocked(b.name) };
  }
  const consent = consentAt(pushes, hit.matched);
  const denied = tag.consent.find((type) => consent[type] === "denied");
  if (denied) return { fired: false, why: m.consentDenied(denied) };
  return { fired: true, why: m.fired };
}

/**
 * Adds `evaluation: { fired, why }` to each tag in `finding.gtm`, judged from the run's dataLayer pushes:
 * whether the tag's triggers fired, whether an exception blocked it, and whether consent allowed it.
 */
export function explainTags(finding, run, container, lang = "en") {
  const m = messages(lang).gtm;
  const v = container?.containerVersion ?? container ?? {};
  const byId = new Map((v.trigger ?? []).map((t) => [String(t.triggerId), t]));
  for (const tag of finding.gtm ?? []) tag.evaluation = evaluateTag(tag, byId, run?.dataLayerLog ?? [], v.variable ?? [], m, lang);
  return finding;
}

/**
 * Adds `gtm` to each finding about one platform event: the tags that send it, or an empty list when none does.
 * With `runs`, each tag also says whether it should have fired in the finding's journey, and why not.
 */
export function annotateFindings(findings, container, runs, { lang = "en" } = {}) {
  if (!container) return findings;
  const tags = containerTags(container);
  if (!tags.length) return findings;
  for (const f of findings) {
    if (!f.platform || !f.event || f.severity === "ok") continue;
    f.gtm = tagsForEvent(tags, f.platform, f.event).map(({ name, type, paused, consent, triggers, blocking }) => ({ name, type, paused, consent, triggers, blocking }));
    const run = runs?.find((r) => r.journeyId === f.journey && r.viewport === f.viewport);
    if (run) explainTags(f, run, container, lang);
  }
  return findings;
}
