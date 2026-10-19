// Consent scenarios: the start page opened in a fresh browser once per consent choice
// (accept all, reject all, analytics only), to show which tags each choice lets through.
// Runs on its own with every audit when the page shows a consent banner.
import { AuditSession, CMP_BANNER_SELECTORS } from "./browser.js";
import { runPool } from "./pool.js";

export const CONSENT_STATES = ["accept", "reject", "analytics"];
// Tags that are advertising, so an "analytics only" choice should keep them quiet.
export const AD_PLATFORMS = new Set(["google_ads", "meta", "tiktok", "pinterest", "snapchat", "x"]);

// Runs in the page: makes the choice through the consent platform's own API when it has one,
// otherwise by clicking the banner's accept or reject button. Returns how, or null when it could not.
const applyInPage = ({ state, selectors }) => {
  const w = window;
  try {
    if (w.OneTrust?.AllowAll) {
      if (state === "accept") w.OneTrust.AllowAll();
      else {
        w.OneTrust.RejectAll();
        // C0002 is OneTrust's performance (analytics) group.
        if (state === "analytics") w.OneTrust.UpdateConsent?.("Category", "C0002:1");
      }
      return "OneTrust";
    }
    if (w.Cookiebot?.submitCustomConsent) {
      // preferences, statistics, marketing
      w.Cookiebot.submitCustomConsent(state === "accept", state !== "reject", state === "accept");
      return "Cookiebot";
    }
    if (state !== "analytics") {
      if (w.UC_UI?.acceptAllConsents) {
        state === "accept" ? w.UC_UI.acceptAllConsents() : w.UC_UI.denyAllConsents();
        return "Usercentrics";
      }
      if (w.Didomi?.setUserAgreeToAll) {
        state === "accept" ? w.Didomi.setUserAgreeToAll() : w.Didomi.setUserDisagreeToAll();
        return "Didomi";
      }
    }
  } catch {
    // An API that throws falls back to the banner's buttons.
  }
  if (state === "analytics") return null;
  const words = state === "accept"
    ? /^(accept|allow|agree|ok|got it|kabul|tümünü kabul|izin ver|onayla|alle akzeptieren|tout accepter)/i
    : /^(reject|decline|deny|refuse|necessary only|only necessary|reddet|kabul etme|ablehnen|tout refuser)/i;
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const banners = [...document.querySelectorAll(selectors)].filter(visible);
  for (const n of document.querySelectorAll("body *")) {
    const label = `${n.id} ${typeof n.className === "string" ? n.className : ""}`;
    if (/(cookie|consent|gdpr|kvkk)/i.test(label) && visible(n) && !banners.some((b) => b.contains(n))) banners.push(n);
  }
  for (const banner of banners) {
    const button = [...banner.querySelectorAll("button, a, [role=button], input[type=button], input[type=submit]")]
      .filter(visible)
      .find((b) => words.test((b.innerText || b.value || b.getAttribute("aria-label") || "").trim()));
    if (button) {
      button.click();
      return "banner";
    }
  }
  return null;
};

// A Google hit that says storage is denied is a cookieless Consent Mode ping, which a "no" allows.
const cookieless = (h) => !!h.consent && h.consent.ad_storage !== "granted" && h.consent.analytics_storage !== "granted";
const isAnalyticsOnlyOk = (h) => !!h.consent && h.consent.ad_storage !== "granted";

/** Hits per platform and event: { n, quiet } where quiet counts the ones sent with storage denied. */
const countBy = (hits) => {
  const out = {};
  for (const h of hits) {
    const c = ((out[h.platform] ??= {})[h.name] ??= { n: 0, cookieless: 0, adDenied: 0 });
    c.n++;
    if (cookieless(h)) c.cookieless++;
    if (isAnalyticsOnlyOk(h)) c.adDenied++;
  }
  return out;
};

/** Opens the start page, makes one consent choice, opens the page again, and returns the hits before and after. */
async function runState(config, state, opts) {
  const session = new AuditSession({
    viewport: "desktop", site: config.site, allowedHosts: config.allowed_hosts, providers: config.providers,
    blockHits: config.block_hits !== false, headless: !opts.headed,
  });
  try {
    await session.start();
    const startError = await session.act({ action: "goto", url: config.site, reason: "Open the start page" });
    if (startError) return { state, error: startError };
    session.beginStep(`Choose: ${state}`);
    const via = await session.page.evaluate(applyInPage, { state, selectors: CMP_BANNER_SELECTORS }).catch(() => null);
    if (!via) return { state, via: null, before: countBy(session.hits) };
    await session.settle();
    session.beginStep("Open the start page again");
    await session.page.reload().catch(() => {});
    await session.settle();
    const choice = session.steps.find((s) => s.label.startsWith("Choose:")).index;
    return {
      state, via,
      before: countBy(session.hits.filter((h) => h.step < choice)),
      after: countBy(session.hits.filter((h) => h.step >= choice)),
    };
  } catch (err) {
    return { state, error: err?.message ?? String(err) };
  } finally {
    await session.close().catch(() => {});
  }
}

/**
 * Runs every consent scenario on the site's start page. Returns null when the page has no consent
 * banner the tool can answer (the first choice found nothing to click), so the report leaves the section out.
 * opts.concurrency runs the other choices side by side, each in its own browser; default 1.
 * @returns {Promise<null | { cmp: string, before: object, states: Record<string, { via: string|null, after?: object, error?: string }> }>}
 */
export async function runConsentScenarios(config, opts = {}) {
  const log = opts.log ?? (() => {});
  const first = await runState(config, "accept", opts);
  if (!first.via) return null;
  log(`\n▶ consent scenarios (${first.via})`);
  // The first choice shows whether there is a banner to answer at all; the others don't depend on each other.
  const results = [first, ...(await runPool(CONSENT_STATES.slice(1), opts.concurrency ?? 1, (state) => runState(config, state, opts)))];
  const states = {};
  for (const r of results) {
    states[r.state] = r.error ? { via: null, error: r.error } : { via: r.via, ...(r.after ? { after: r.after } : {}) };
    log(`  ${r.state}: ${r.error ? `✗ ${r.error}` : r.via ? `${Object.values(r.after ?? {}).reduce((s, e) => s + Object.values(e).reduce((a, b) => a + b.n, 0), 0)} tracking hits` : "not supported here"}`);
  }
  return { cmp: first.via, before: first.before, states };
}

/**
 * The per-state tag table: one row per platform and event, one cell per state (hit count, or null when
 * the state did not run). A cell is a problem when a tag sent hits a choice should have kept quiet:
 * anything after "reject all" except cookieless Consent Mode pings, and ad tags after "analytics only"
 * unless they were sent with ad storage denied.
 */
export function consentTable(scenarios) {
  const keys = new Set();
  const add = (counts) => Object.entries(counts ?? {}).forEach(([p, events]) => Object.keys(events).forEach((e) => keys.add(`${p}\u0000${e}`)));
  add(scenarios.before);
  for (const s of Object.values(scenarios.states)) add(s.after);
  const cols = ["before", ...CONSENT_STATES];
  const rows = [...keys].sort().map((k) => {
    const [platform, event] = k.split("\u0000");
    const cells = cols.map((col) => {
      const s = col === "before" ? { after: scenarios.before } : scenarios.states[col];
      if (!s?.after) return { state: col, count: null, problem: false };
      const c = s.after[platform]?.[event] ?? { n: 0, cookieless: 0, adDenied: 0 };
      const problem = (col === "reject" && c.n > c.cookieless) || (col === "analytics" && AD_PLATFORMS.has(platform) && c.n > c.adDenied);
      return { state: col, count: c.n, problem };
    });
    return { platform, event, cells };
  });
  return { cols, rows };
}
