// Consent scenarios: the start page opened like an ad click in a fresh browser once per consent choice (no choice
// and on to the next page, accept all, reject all, analytics only), to show side by side which tags each choice lets
// through and what they carry: the consent on the first hit, the campaign parameters, the client id, the cookies.
// Runs on its own with every audit when the page shows a consent banner.
import { AuditSession, CMP_BANNER_SELECTORS } from "./browser.js";
import { runPool } from "./pool.js";
import { CONSENT_SIGNALS } from "./parsers.js";
import { CONSENT_STATES, IGNORE } from "./consent-table.js";
import { campaignParamsIn, withCampaignParams } from "./campaign.js";

// Runs in the page: makes the choice through the consent platform's own API when it has one,
// otherwise by clicking the banner's accept or reject button. Returns how, or null when it could not.
const applyInPage = ({ state, selectors }) => {
  const w = window;
  try {
    if (w.OneTrust?.AllowAll) {
      // Analytics only turns on the group OneTrust's Consent Mode setting gives analytics_storage (sites number their
      // groups as they like), or C0002, the usual performance group, without one; not when ads share that group.
      const gc = w.OneTrust.GetDomainData?.()?.GoogleConsent;
      const analytics = gc?.GCEnable && gc.GCAnalyticsStorage ? String(gc.GCAnalyticsStorage) : "C0002";
      if (state === "analytics" && gc?.GCEnable && analytics === String(gc.GCAdStorage)) return null;
      if (state === "accept") w.OneTrust.AllowAll();
      else {
        w.OneTrust.RejectAll();
        if (state === "analytics") w.OneTrust.UpdateConsent?.("Category", `${analytics}:1`);
      }
      return "OneTrust";
    }
    // Cookiebot's newer script names its object CookieConsent only.
    const cookiebot = w.Cookiebot ?? w.CookieConsent;
    if (cookiebot?.submitCustomConsent) {
      // preferences, statistics, marketing
      cookiebot.submitCustomConsent(state === "accept", state !== "reject", state === "accept");
      return "Cookiebot";
    }
    // CookieYes has no public choice function, but its buttons and preference center switches carry fixed names.
    if (w.cookieyes?._ckyStore) {
      const tag = (name) => document.querySelector(`[data-cky-tag="${name}"]`);
      if (state === "accept" || state === "reject") {
        const button = tag(`${state}-button`);
        if (button) {
          button.click();
          return "CookieYes";
        }
      } else {
        tag("settings-button")?.click();
        const switches = [...document.querySelectorAll('input[id^="ckySwitch"]')];
        const save = tag("detail-save-button");
        if (switches.length && save) {
          for (const box of switches) if (box.checked !== (box.id === "ckySwitchanalytics")) box.click();
          save.click();
          return "CookieYes";
        }
        return null;
      }
    }
    const efilli = w.efilliSdk?.consentManager;
    if (efilli?.acceptAll) {
      if (state === "accept") efilli.acceptAll();
      else if (state === "reject") efilli.rejectAll();
      else {
        // Analytics only: the category Efilli's own Consent Mode mapping gives analytics_storage, when that mapping is
        // the one in force and puts ads elsewhere. With Consent Mode run from a GTM template instead, it can't be known.
        const mode = w.efilliSdk.configManager?.getLanguage?.()?.consentMode;
        const analytics = mode?.active ? mode.mapping?.analytics_storage : null;
        if (!analytics || analytics === mode.mapping?.ad_storage) return null;
        for (const category of Object.keys(efilli.getCategories?.() ?? {})) efilli.setCategoryConsent(category, category === "essential" || category === analytics);
        efilli.saveConsent();
      }
      return "Efilli";
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
    : /^(reject|decline|deny|refuse|necessary only|only necessary|reddet|tümünü reddet|kabul etme|ablehnen|tout refuser)/i;
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  // Banners drawn inside open shadow roots (Efilli's) count too.
  const roots = [document];
  for (let i = 0; i < roots.length; i++) for (const n of roots[i].querySelectorAll("*")) if (n.shadowRoot) roots.push(n.shadowRoot);
  const banners = roots.flatMap((r) => [...r.querySelectorAll(selectors)]).filter(visible);
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

// A Google hit that says every tracking signal is denied is a cookieless Consent Mode ping, which a "no"
// allows; after "analytics only" the ad signals must be denied.
const cookieless = (h) => !!h.consent && CONSENT_SIGNALS.every((k) => h.consent[k] !== "granted");
const isAnalyticsOnlyOk = (h) => !!h.consent && CONSENT_SIGNALS.filter((k) => k !== "analytics_storage").every((k) => h.consent[k] !== "granted");

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

const GOOGLE = new Set(["ga4", "google_ads"]);

/**
 * What one scenario shows beyond the hit counts, from the steps from..to of its own browser: the first Google hit
 * with its consent and the campaign parameters its page address kept or lost, the GA4 client id on it and in _ga,
 * whether _gcl_aw holds the landing gclid, the cookies added, how long after the steps began each provider was
 * first called, and the Google tag's own consent state at the end.
 */
function factsOf(session, from, to, landing) {
  const inRange = (step) => step >= from && step <= to;
  const google = session.hits.filter((h) => inRange(h.step) && GOOGLE.has(h.platform)).sort((a, b) => a.t - b.t);
  const first = google.find((h) => h.platform === "ga4") ?? google[0] ?? null;
  const sent = campaignParamsIn(landing);
  let campaign = null;
  if (first?.params?.page_location && Object.keys(sent).length) {
    const got = campaignParamsIn(first.params.page_location);
    const names = Object.keys(sent);
    campaign = { kept: names.filter((n) => got[n] === sent[n]), lost: names.filter((n) => got[n] !== sent[n]) };
  }
  const identity = session.steps.filter((st) => inRange(st.index)).map((st) => st.identity).filter(Boolean).at(-1) ?? null;
  const tag = session.steps.filter((st) => st.index <= to).map((st) => st.tagConsent).filter(Boolean).at(-1) ?? null;
  const startedAt = session.steps[from]?.t ?? null;
  const loaded = {};
  for (const c of session.network) {
    if (!inRange(c.step) || !c.provider || c.provider in loaded || startedAt === null) continue;
    loaded[c.provider] = Math.max(0, c.t - startedAt);
  }
  return {
    firstHit: first ? { platform: first.platform, event: first.name, ...(first.consent ? { consent: first.consent } : {}) } : null,
    campaign,
    clientId: first?.protocol?.cid ?? null,
    cookieClientId: identity?.ga_client_id ?? null,
    gclAw: identity?.gcl_aw ?? null,
    cookies: [...new Set(session.cookieChanges.filter((c) => inRange(c.step) && c.change === "added").map((c) => c.name))],
    loaded,
    tagConsent: tag ? Object.fromEntries(Object.entries(tag.entries).map(([k, e]) => [k, e.update ?? e.default ?? null])) : null,
  };
}

/** Where the scenarios start: the start page opened like an ad click (test campaign parameters, or the caller's own), or as it is. */
export function scenarioLanding(config, campaign) {
  if (campaign === false || (campaign === undefined && config.campaign_checks === false)) return config.site;
  return withCampaignParams(config.site, campaign && typeof campaign === "object" ? campaign : null);
}

/**
 * Opens the start page, makes one consent choice (none for IGNORE), opens the page again, and returns the hits
 * before and after the choice with the facts of each part.
 */
async function runState(config, state, opts) {
  const session = new AuditSession({
    viewport: "desktop", site: config.site, allowedHosts: config.allowed_hosts, storageState: config.session_file, connect: config.connect, providers: config.providers,
    blockHits: config.block_hits !== false, headless: !opts.headed, ...(opts.blockPrivate ? { blockPrivate: opts.blockPrivate } : {}),
  });
  const landing = scenarioLanding(config, opts.campaign);
  try {
    await session.start();
    const startError = await session.act({ action: "goto", url: landing, reason: "Open the start page" });
    if (startError) return { state, error: startError };
    session.beginStep(`Choose: ${state}`);
    const via = state === IGNORE ? "none" : await session.page.evaluate(applyInPage, { state, selectors: CMP_BANNER_SELECTORS }).catch(() => null);
    if (!via) return { state, via: null, landing, before: countBy(session.hits), beforeFacts: factsOf(session, 0, session.currentStep, landing) };
    await session.settle();
    await session.observe();
    session.beginStep("Open the start page again");
    await session.page.reload().catch(() => {});
    await session.settle();
    await session.observe();
    const choice = session.steps.find((s) => s.label.startsWith("Choose:")).index;
    const beforeFacts = factsOf(session, 0, choice - 1, landing);
    // What a choice leads to is what the next page sends: a hit fired by the click itself can go out before the
    // consent update applies. The cookies count from the click on. The client id this same visitor had before
    // choosing tells a kept id from a new one.
    const last = session.currentStep;
    const facts = { ...factsOf(session, last, last, landing), cookies: factsOf(session, choice, last, landing).cookies, clientIdBefore: beforeFacts.clientId };
    return {
      state, via, landing, beforeFacts, facts,
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
 * opts.campaign: the campaign parameters to open the start page with, or false for none (see scenarioLanding).
 * opts.blockPrivate: as for AuditSession, for an MCP server reachable over HTTP.
 * @returns {Promise<null | { cmp: string, landing: string, before: object, beforeFacts: object, states: Record<string, { via: string|null, after?: object, facts?: object, error?: string }> }>}
 */
export async function runConsentScenarios(config, opts = {}) {
  const log = opts.log ?? (() => {});
  const first = await runState(config, "accept", opts);
  if (!first.via) return null;
  log(`\n▶ consent scenarios (${first.via})`);
  // The first choice shows whether there is a banner to answer at all; the others don't depend on each other.
  const results = [first, ...(await runPool([IGNORE, ...CONSENT_STATES.slice(1)], opts.concurrency ?? 1, (state) => runState(config, state, opts)))];
  const states = {};
  for (const state of [IGNORE, ...CONSENT_STATES]) {
    const r = results.find((x) => x.state === state);
    states[state] = r.error ? { via: null, error: r.error } : { via: r.via, ...(r.after ? { after: r.after } : {}), ...(r.facts ? { facts: r.facts } : {}) };
    log(`  ${state}: ${r.error ? `✗ ${r.error}` : r.via ? `${Object.values(r.after ?? {}).reduce((s, e) => s + Object.values(e).reduce((a, b) => a + b.n, 0), 0)} tracking hits` : "not supported here"}`);
  }
  return { cmp: first.via, landing: first.landing, before: first.before, beforeFacts: first.beforeFacts, states };
}

// The tables live in consent-table.js, which the Chrome extension can load without Playwright.
export { AD_PLATFORMS, CONSENT_STATES, IGNORE, SCENARIO_COLUMNS, consentMatrix, consentMatrixMarkdown, consentTable } from "./consent-table.js";
