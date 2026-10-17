// Reads a GTM container export (Admin → Export container) to name the tag and trigger
// behind a hit. Matching is deterministic: no API call and no AI model.

import { canonicalEvent } from "./checks.js";

// GTM's built-in "All Pages" trigger has no entry in the export's trigger list.
const BUILT_IN_TRIGGERS = { 2147479553: { name: "All Pages", type: "PAGEVIEW" } };
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

/** Adds `gtm` to each finding about one platform event: the tags that send it, or an empty list when none does. */
export function annotateFindings(findings, container) {
  if (!container) return findings;
  const tags = containerTags(container);
  if (!tags.length) return findings;
  for (const f of findings) {
    if (!f.platform || !f.event || f.severity === "ok") continue;
    f.gtm = tagsForEvent(tags, f.platform, f.event).map(({ name, type, paused, consent, triggers, blocking }) => ({ name, type, paused, consent, triggers, blocking }));
  }
  return findings;
}
