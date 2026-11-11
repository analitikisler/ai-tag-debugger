// Consent scenarios: the start page opened like an ad click in a fresh browser once per consent choice (no choice
// and on to the next page, accept all, reject all, analytics only), to show side by side which tags each choice lets
// through and what they carry: the consent on the first hit, the campaign parameters, the client id, the cookies.
// Runs on its own with every audit when the page shows a consent banner.
import { AuditSession, CMP_BANNER_SELECTORS } from "./browser.js";
import { runPool } from "./pool.js";
import { CONSENT_SIGNALS, providerLabel } from "./parsers.js";
import { NON_GOOGLE_AD_PLATFORMS, TRACKING_COOKIE } from "./checks.js";
import { campaignParamsIn, withCampaignParams } from "./campaign.js";
import { mdText } from "./report-shared.js";
import { messages } from "./i18n.js";

export const CONSENT_STATES = ["accept", "reject", "analytics"];
// The visitor who leaves the banner unanswered and opens the next page. Browsing on is no consent under the GDPR or
// KVKK, so a tag that sends with cookies then is as wrong as after "reject all".
export const IGNORE = "ignore";
/** The scenario columns, in the order the reports show them. */
export const SCENARIO_COLUMNS = ["before", IGNORE, ...CONSENT_STATES];
// Tags that are advertising, so an "analytics only" choice should keep them quiet.
export const AD_PLATFORMS = new Set(["google_ads", ...NON_GOOGLE_AD_PLATFORMS]);

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
  const accept = /^(accept|allow|agree|ok(ay)?\b|got it|kabul|tümünü kabul|izin ver|onayla|alle akzeptieren|tout accepter)/i;
  const reject = /^(reject|decline|deny|refuse|necessary only|only necessary|reddet|tümünü reddet|kabul etm|izin verme|ablehnen|tout refuser)/i;
  // "Accept necessary only" and "Kabul etmiyorum" start like an accept and are not one.
  const partial = /\b(necessary|essential|selection|selected|only)\b/i;
  const words = state === "accept" ? { test: (label) => accept.test(label) && !reject.test(label) && !partial.test(label) } : reject;
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

/** Hits per platform and event: { n, cookieless, adDenied }, the last two counting the ones sent with every signal or the ad signals denied. */
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
    viewport: "desktop", site: config.site, allowedHosts: config.allowed_hosts, storageState: config.session_file, connect: config.connect, providers: config.providers, detect: config.detect_providers,
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
 * Throws when the start page could not be opened at all, which is not the same as having no banner.
 * opts.concurrency runs the other choices side by side, each in its own browser; default 1.
 * opts.campaign: the campaign parameters to open the start page with, or false for none (see scenarioLanding).
 * opts.blockPrivate: as for AuditSession, for an MCP server reachable over HTTP.
 * @returns {Promise<null | { cmp: string, landing: string, before: object, beforeFacts: object, states: Record<string, { via: string|null, after?: object, facts?: object, error?: string }> }>}
 */
export async function runConsentScenarios(config, opts = {}) {
  const log = opts.log ?? (() => {});
  const first = await runState(config, "accept", opts);
  if (first.error) throw new Error(first.error);
  if (!first.via) return null;
  const t = messages(opts.lang ?? "en").ui.run;
  log(`\n▶ ${t.scenarios(first.via)}`);
  // The first choice shows whether there is a banner to answer at all; the others don't depend on each other.
  const results = [first, ...(await runPool([IGNORE, ...CONSENT_STATES.slice(1)], opts.concurrency ?? 1, (state) => runState(config, state, opts)))];
  const states = {};
  for (const state of [IGNORE, ...CONSENT_STATES]) {
    const r = results.find((x) => x.state === state);
    states[state] = r.error ? { via: null, error: r.error } : { via: r.via, ...(r.after ? { after: r.after } : {}), ...(r.facts ? { facts: r.facts } : {}) };
    log(`  ${state}: ${r.error ? `✗ ${r.error}` : r.via ? t.scenarioHits(Object.values(r.after ?? {}).reduce((s, e) => s + Object.values(e).reduce((a, b) => a + b.n, 0), 0)) : t.scenarioUnsupported}`);
  }
  return { cmp: first.via, landing: first.landing, before: first.before, beforeFacts: first.beforeFacts, states };
}

/**
 * The per-state tag table: one row per platform and event, one cell per state (hit count, or null when
 * the state did not run). A cell is a problem when a tag sent hits a choice should have kept quiet:
 * anything after "reject all" or no choice except cookieless Consent Mode pings, and ad tags after "analytics only"
 * unless they were sent with ad storage denied.
 */
export function consentTable(scenarios) {
  const keys = new Set();
  const add = (counts) => Object.entries(counts ?? {}).forEach(([p, events]) => Object.keys(events).forEach((e) => keys.add(`${p}\u0000${e}`)));
  add(scenarios.before);
  for (const s of Object.values(scenarios.states)) add(s.after);
  // Captures from before the no-choice scenario existed have no column for it.
  const cols = SCENARIO_COLUMNS.filter((col) => col !== IGNORE || scenarios.states?.[IGNORE]);
  const rows = [...keys].sort().map((k) => {
    const [platform, event] = k.split("\u0000");
    const cells = cols.map((col) => {
      const s = col === "before" ? { after: scenarios.before } : scenarios.states[col];
      if (!s?.after) return { state: col, count: null, problem: false };
      const c = s.after[platform]?.[event] ?? { n: 0, cookieless: 0, adDenied: 0 };
      const problem = ((col === "reject" || col === IGNORE) && c.n > c.cookieless) || (col === "analytics" && AD_PLATFORMS.has(platform) && c.n > c.adDenied);
      return { state: col, count: c.n, problem };
    });
    return { platform, event, cells };
  });
  return { cols, rows };
}

/**
 * The consent matrix: one row per fact, one cell per scenario column, from the facts each scenario recorded.
 * Every cell is { text, problem }, where problem marks what should not happen with that choice: tracking cookies
 * set before a choice, without one or after "reject all", a client id that changes when the visitor accepts, and a
 * UTM parameter lost from the first hit. Null for captures from before the scenarios recorded facts.
 * @returns {null | { landing: string|null, cols: string[], rows: { key: string, label: string, cells: { text: string, problem: boolean }[] }[] }}
 */
export function consentMatrix(m, scenarios) {
  const t = m.ui.matrix;
  const factsFor = (col) => (col === "before" ? scenarios.beforeFacts : scenarios.states?.[col]?.facts) ?? null;
  const cols = SCENARIO_COLUMNS.filter((col) => col === "before" || scenarios.states?.[col]);
  if (!cols.some(factsFor)) return null;
  const signals = (c) => CONSENT_SIGNALS.filter((k) => c?.[k]).map((k) => `${t.signals[k]} ${c[k] === "granted" ? "✓" : c[k] === "denied" ? "✗" : "?"}`).join(" ");
  // No choice yet, no choice and on, and "reject all" may not leave tracking cookies; accepting must not lose the visitor.
  const strict = (col) => col === "before" || col === IGNORE || col === "reject";
  const cell = (text, problem = false) => ({ text, problem });
  const clientId = (f, col) => {
    if (col === "before") return cell(f.cookieClientId ? t.cid.cookie : f.clientId ? t.cid.cookieless : t.cid.none, Boolean(f.cookieClientId));
    const after = f.cookieClientId ?? f.clientId;
    if (!after) return cell(t.cid.none);
    if (!f.clientIdBefore) return cell(t.cid.new);
    if (after === f.clientIdBefore) return cell(t.cid.kept);
    // Without a cookie every page load gets a new id, which is what declining asks for.
    return cell(t.cid.changed, !strict(col) && Boolean(f.cookieClientId));
  };
  const rows = {
    firstHit: (f) => cell(f.firstHit ? `${f.firstHit.event}${f.firstHit.consent ? ` · ${signals(f.firstHit.consent)}` : ""}` : t.none),
    campaign: (f) => (!f.campaign ? cell(t.notRun) : f.campaign.lost.length
      ? cell(t.lost(f.campaign.lost), f.campaign.lost.some((n) => n.startsWith("utm_")) || f.firstHit?.consent?.ad_storage === "granted")
      : cell(t.kept)),
    clientId,
    gclAw: (f) => cell(t.gcl[f.gclAw ?? "none"]),
    cookies: (f, col) => cell(t.cookies(f.cookies.length, f.cookies.slice(0, 10)), strict(col) && f.cookies.some((n) => TRACKING_COOKIE.test(n))),
    loaded: (f) => cell(Object.entries(f.loaded).sort((a, b) => a[1] - b[1]).slice(0, 8).map(([p, ms]) => `${providerLabel(p)} ${t.ms(ms)}`).join(" · ") || t.none),
    tagConsent: (f) => cell(f.tagConsent ? signals(f.tagConsent) || t.none : t.notRun),
  };
  return {
    landing: scenarios.landing ?? null,
    cols,
    rows: Object.entries(rows).map(([key, fn]) => ({ key, label: t.rows[key], cells: cols.map((col) => (factsFor(col) ? fn(factsFor(col), col) : cell(t.notRun))) })),
  };
}

/** The consent matrix as a Markdown table with its legend, for report.md and MCP. */
export function consentMatrixMarkdown(m, scenarios) {
  const matrix = consentMatrix(m, scenarios);
  if (!matrix) return [];
  return [
    ...(matrix.landing ? [m.ui.matrix.intro(matrix.landing), ""] : []),
    `| | ${matrix.cols.map((c) => m.ui.scenarioCols[c]).join(" | ")} |`,
    `|${" --- |".repeat(matrix.cols.length + 1)}`,
    ...matrix.rows.map((r) => `| ${r.label} | ${r.cells.map((c) => `${mdText(c.text)}${c.problem ? " ⚠" : ""}`).join(" | ")} |`),
    "",
    m.ui.matrix.legend,
  ];
}
