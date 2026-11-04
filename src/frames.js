// Whose tracking a hit is: the site's own, or an embedded widget's. Hits, dataLayer pushes, vendor calls and
// container loads from an iframe carry { origin, party, parent }: party "site" when the iframe is on the page's
// own site (a checkout or form on a subdomain), "third" when it is someone else's (a booking or chat widget,
// a payment form, a video). A third-party iframe's hit is still the site's when it goes to an account the
// site's own tags use (a booking engine set up with the site's GA4 ID); otherwise it is the widget's.
import { siteOf } from "./redact.js";

/**
 * A Playwright frame as { origin, party, parent }, or null for a page's main frame and for frames without an
 * http(s) address (about:blank, srcdoc), which the page's own scripts write. parent is the address of the
 * page it is embedded in, without its query.
 */
export function frameInfo(frame) {
  if (!frame) return null;
  let top;
  try {
    top = frame.page()?.mainFrame();
  } catch {
    return null;
  }
  if (!top || frame === top) return null;
  let u;
  let t;
  try {
    u = new URL(frame.url());
    t = new URL(top.url());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || !/^https?:$/.test(t.protocol)) return null;
  return { origin: u.origin, party: siteOf(u.hostname) === siteOf(t.hostname) ? "site" : "third", parent: t.origin + t.pathname };
}

/** Whether a hit, push or load came from the page itself or an iframe on the same site. */
export const isSiteFrame = (x) => !x?.frame || x.frame.party !== "third";

// Account IDs as the hits and the containers name them: GA4's G-…, Google Ads' AW-… (a numeric conversion ID in
// its hits), Meta's pixel ID and so on. Compared per platform family, without the AW- prefix.
const idKey = (id) => String(id).trim().toUpperCase().replace(/^AW-/, "");

/**
 * The account IDs the site's own tags use: the containers loaded in the page or a same-site iframe, the IDs its
 * hits went to, and the destinations its gtag('config') commands name.
 */
export function siteIds({ hits = [], containerLoads = [], dataLayerLog = [] }) {
  const ids = new Set();
  for (const l of containerLoads) if (isSiteFrame(l)) ids.add(idKey(l.id));
  for (const h of hits) if (isSiteFrame(h) && h.id) ids.add(idKey(h.id));
  for (const e of dataLayerLog) {
    if (isSiteFrame(e) && Array.isArray(e.value) && e.value[0] === "config" && typeof e.value[1] === "string") ids.add(idKey(e.value[1]));
  }
  return ids;
}

/** Whether a hit is an embedded widget's: sent from a third-party iframe to an account the site's tags don't use. */
export function isWidgetHit(hit, ids) {
  return !isSiteFrame(hit) && !(hit.id && ids.has(idKey(hit.id)));
}

/**
 * The run's hits and dataLayer pushes split into the site's own and the widgets': { hits, widgetHits,
 * dataLayerLog, widgetDataLayerLog }. Plan, coverage and duplicate checks read only the site's; the consent and
 * personal data checks read both, since the site answers for what the widgets it embeds collect.
 */
export function splitRun({ hits = [], containerLoads = [], dataLayerLog = [] }) {
  const ids = siteIds({ hits, containerLoads, dataLayerLog });
  return {
    hits: hits.filter((h) => !isWidgetHit(h, ids)),
    widgetHits: hits.filter((h) => isWidgetHit(h, ids)),
    dataLayerLog: dataLayerLog.filter(isSiteFrame),
    widgetDataLayerLog: dataLayerLog.filter((e) => !isSiteFrame(e)),
  };
}

/** The widgets that sent hits, by iframe origin: [{ origin, parent, platforms: [{ platform, ids, events }] }]. */
export function widgetsOf(widgetHits = []) {
  const byOrigin = new Map();
  for (const h of widgetHits) {
    const w = byOrigin.get(h.frame.origin) ?? { origin: h.frame.origin, parent: h.frame.parent, platforms: new Map() };
    const p = w.platforms.get(h.platform) ?? { platform: h.platform, ids: new Set(), events: new Set() };
    if (h.id) p.ids.add(h.id);
    p.events.add(h.name);
    w.platforms.set(h.platform, p);
    byOrigin.set(h.frame.origin, w);
  }
  return [...byOrigin.values()].map((w) => ({
    origin: w.origin, parent: w.parent,
    platforms: [...w.platforms.values()].map((p) => ({ platform: p.platform, ids: [...p.ids], events: [...p.events] })),
  }));
}

/** The event a dataLayer push names, { event: "x" } or gtag's ["event", "x", ...], or null. GTM's own (gtm.js, gtm.dom...) are left out. */
export function pushedEvent(value) {
  const name = Array.isArray(value) ? (value[0] === "event" ? value[1] : null) : value?.event;
  return typeof name === "string" && name && !name.startsWith("gtm.") ? name : null;
}

const plainName = (n) => String(n).toLowerCase().replace(/[^a-z0-9]/g, "");
const isConsentPush = (v) => Array.isArray(v) && v[0] === "consent";

/**
 * One summary per embedded widget (third-party iframe origin) across runs: { origin, parents, containers,
 * own, shared, pushes, unshared, step }.
 * - parents: the pages it was embedded in; containers: [{ id, script }] it loaded itself
 * - own: [{ platform, id, events }] it sent to its own accounts; shared: the same for what it sent to the site's
 * - pushes: { total, consent, events: [{ name, count }] } of its own dataLayer
 * - unshared: the events it pushed that none of its hits to the site's accounts carried
 * - step: the first step it was seen at, in the first run it was seen in
 * same(a, b) compares event names; checks.js passes canonicalEvent so add_to_cart and addToCart are one event.
 */
export function widgetSummaries(runs, same = (a, b) => plainName(a) === plainName(b)) {
  const byOrigin = new Map();
  const of = (frame, step) => {
    const w = byOrigin.get(frame.origin) ?? {
      origin: frame.origin, parents: new Set(), containers: new Map(), own: new Map(), shared: new Map(),
      total: 0, consent: 0, events: new Map(), step,
    };
    if (frame.parent) w.parents.add(frame.parent);
    byOrigin.set(frame.origin, w);
    return w;
  };
  const addHit = (map, h) => {
    const k = `${h.platform}|${h.id ?? ""}`;
    const e = map.get(k) ?? { platform: h.platform, ...(h.id ? { id: h.id } : {}), events: new Set() };
    e.events.add(h.name);
    map.set(k, e);
  };
  for (const run of runs) {
    for (const l of run.containerLoads ?? []) if (l.frame?.party === "third") of(l.frame, l.step).containers.set(l.id, { id: l.id, script: l.script });
    for (const h of run.widgetHits ?? []) addHit(of(h.frame, h.step).own, h);
    for (const h of run.hits ?? []) if (h.frame?.party === "third") addHit(of(h.frame, h.step).shared, h);
    for (const e of run.widgetDataLayerLog ?? []) {
      if (!e.frame) continue;
      const w = of(e.frame, e.step);
      w.total++;
      if (isConsentPush(e.value)) w.consent++;
      const name = pushedEvent(e.value);
      if (name) w.events.set(name, (w.events.get(name) ?? 0) + 1);
    }
  }
  const list = (map) => [...map.values()].map((e) => ({ ...e, events: [...e.events] }));
  return [...byOrigin.values()].map((w) => {
    const shared = list(w.shared);
    const sent = shared.flatMap((e) => e.events);
    return {
      origin: w.origin,
      parents: [...w.parents].sort(),
      containers: [...w.containers.values()],
      own: list(w.own),
      shared,
      pushes: { total: w.total, consent: w.consent, events: [...w.events].map(([name, count]) => ({ name, count })) },
      unshared: [...w.events.keys()].filter((name) => !sent.some((s) => same(s, name))),
      step: w.step,
    };
  });
}
