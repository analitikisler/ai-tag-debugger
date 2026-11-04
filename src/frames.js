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
