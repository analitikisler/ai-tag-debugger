// Which consent platform a page runs and how it is set up, read from the platform's own objects in the page,
// so a report can say what the agent otherwise has to dig out of the platform's bundle by hand.

/**
 * Runs in the page. Efilli, CookieYes, OneTrust and Cookiebot in full, as far as each exposes it: the site bundle
 * and the date it was compiled, the language in force, whether its own Consent Mode integration is on with the
 * category each signal maps to, auto-blocking and TCF. The other platforms by name only. Null when none is found.
 * Besides the fields below, a platform can add law, version, consentModel, region, impliedConsent, fixed and redaction.
 * @returns {null | { vendor: string, built?: string|null, script?: string|null, language?: string|null, categories?: string[],
 *   consentMode?: { active: boolean, mapping: Record<string,string>|null, urlPassthrough: boolean, adsDataRedaction: boolean },
 *   autoBlocking?: boolean, blockingRules?: number|null, tcf?: boolean }}
 */
export function detectCmpInPage() {
  const w = window;
  try {
    const efilli = w.efilliSdk;
    if (efilli?.consentManager) {
      // getLanguage() is the language the page matched: Efilli keeps a whole setup, mapping included, per language.
      const lang = efilli.configManager?.getLanguage?.() ?? {};
      const mode = lang.consentMode ?? {};
      return {
        vendor: "Efilli",
        built: typeof w.efilliBundleCompileDate === "string" ? w.efilliBundleCompileDate : null,
        script: [...document.scripts].map((s) => s.src).find((src) => /^https:\/\/bundles\.efilli\.com\//.test(src)) ?? null,
        language: typeof lang.name === "string" ? lang.name : null,
        categories: Object.keys(efilli.consentManager.getCategories?.() ?? {}),
        consentMode: {
          active: Boolean(mode.active),
          mapping: mode.mapping && typeof mode.mapping === "object" ? { ...mode.mapping } : null,
          urlPassthrough: Boolean(mode.url_passthrough),
          adsDataRedaction: Boolean(mode.ads_data_redaction),
        },
        autoBlocking: Boolean(lang.autoBlocking ?? efilli.configManager?.isAutoBlockingEnabled?.()),
        blockingRules: Array.isArray(lang.blockingRules) ? lang.blockingRules.length : null,
        tcf: Boolean(lang.tcf?.active),
      };
    }
    const cky = w.cookieyes?._ckyStore;
    if (cky && Array.isArray(cky._categories)) {
      return {
        vendor: "CookieYes",
        script: [...document.scripts].map((s) => s.src).find((src) => /^https:\/\/cdn-cookieyes\.com\/client_data\/[^/]+\/script\.js/.test(src)) ?? null,
        law: typeof cky._bannerConfig?.activeLaw === "string" ? cky._bannerConfig.activeLaw : null,
        categories: cky._categories.map((c) => c.slug).filter((s) => typeof s === "string"),
        // CookieYes fixes the mapping in its code rather than its setup; read off its consent updates in November 2026.
        consentMode: { fixed: true, mapping: { ad_storage: "advertisement", ad_user_data: "advertisement", ad_personalization: "advertisement", analytics_storage: "analytics", functionality_storage: "functional", personalization_storage: "functional", security_storage: "necessary" } },
        autoBlocking: Array.isArray(cky._providersToBlock) && cky._providersToBlock.length > 0,
        blockingRules: Array.isArray(cky._providersToBlock) ? cky._providersToBlock.length : null,
      };
    }
    const domain = w.OneTrust?.GetDomainData?.();
    if (domain && typeof domain === "object") {
      // GoogleConsent names, per signal, the consent group that grants it; the groups carry their names.
      const gc = domain.GoogleConsent ?? {};
      const groups = Object.fromEntries((domain.Groups ?? []).map((g) => [String(g.OptanonGroupId), g.GroupName]));
      const bySignal = { ad_storage: gc.GCAdStorage, analytics_storage: gc.GCAnalyticsStorage, ad_user_data: gc.GCAdUserData, ad_personalization: gc.GCAdPersonalization, functionality_storage: gc.GCFunctionalityStorage, personalization_storage: gc.GCPersonalizationStorage, security_storage: gc.GCSecurityStorage };
      const mapping = Object.fromEntries(Object.entries(bySignal).filter(([, id]) => id !== undefined && id !== null && id !== "").map(([k, id]) => [k, groups[id] ? `${groups[id]} (${id})` : String(id)]));
      const scripts = [...document.scripts];
      // The site's own setup file, /consent/<id>/<id>.js: its date is when the setup was last published.
      const id = scripts.find((s) => /\/otSDKStub\.js/.test(s.src))?.getAttribute("data-domain-script");
      const geo = w.OneTrust.getGeolocationData?.();
      const model = domain.ConsentModel?.Name ?? domain.ConsentModel;
      return {
        vendor: "OneTrust",
        version: scripts.map((s) => s.src.match(/\/scripttemplates\/(\d+\.\d+\.\d+)\/otBannerSdk\.js/)?.[1]).find(Boolean) ?? null,
        script: id ? scripts.map((s) => s.src).find((src) => src.endsWith(`/consent/${id}/${id}.js`)) ?? `https://cdn.cookielaw.org/consent/${id}/${id}.js` : null,
        categories: Object.values(groups),
        consentModel: typeof model === "string" ? model : null,
        // Opt-out, implied and notice-only models let tags run before the visitor chooses.
        impliedConsent: typeof model === "string" && /opt-?out|implied|notice/i.test(model),
        region: geo?.country ? [geo.country, geo.state].filter(Boolean).join("-") : null,
        consentMode: { active: Boolean(gc.GCEnable), mapping: Object.keys(mapping).length ? mapping : null, urlPassthrough: false, adsDataRedaction: Boolean(gc.GCRedactEnable) },
        tcf: Boolean(domain.IsIabEnabled),
      };
    }
    // Cookiebot's newer script names its object CookieConsent only.
    const cb = w.Cookiebot ?? w.CookieConsent;
    if (cb && typeof cb.submitCustomConsent === "function") {
      return {
        vendor: "Cookiebot",
        version: cb.version !== undefined && cb.version !== null ? String(cb.version) : null,
        // The banner setup, /consentconfig/<cbid>/settings.json: its date is when the setup was last published.
        script: typeof cb.serial === "string" ? `https://consentcdn.cookiebot.com/consentconfig/${cb.serial}/settings.json` : null,
        categories: ["necessary", "preferences", "statistics", "marketing"],
        consentModel: typeof cb.responseMode === "string" ? cb.responseMode : null,
        region: typeof cb.userCountry === "string" ? cb.userCountry : null,
        impliedConsent: cb.consent?.method === "implied",
        // Cookiebot fixes the mapping in its code; read off its consent updates in November 2026.
        consentMode: {
          fixed: true, active: !cb.consentModeDisabled,
          mapping: { ad_storage: "marketing", ad_user_data: "marketing", ad_personalization: "marketing", analytics_storage: "statistics", functionality_storage: "preferences", personalization_storage: "preferences", security_storage: "necessary" },
          redaction: typeof cb.consentModeDataRedaction === "string" ? cb.consentModeDataRedaction : cb.consentModeDataRedaction ? "true" : "false",
        },
        autoBlocking: Boolean(cb.autoblock),
        tcf: Boolean(cb.framework),
      };
    }
    if (w.OneTrust || w.OptanonWrapper) return { vendor: "OneTrust" };
    if (w.UC_UI || w.UC_UI_IS_RENDERED !== undefined) return { vendor: "Usercentrics" };
    if (w.Didomi) return { vendor: "Didomi" };
  } catch {
    // A platform object that throws when read is the same as none.
  }
  return null;
}

/** The consent platform's script dates from the run's network calls: each consent script's Last-Modified header, once per address. */
export function cmpScriptDates(run) {
  return (run.network ?? [])
    .filter((c) => c.provider === "consent" && c.lastModified)
    .map((c) => ({ url: c.url, lastModified: c.lastModified }))
    .filter((c, i, list) => list.findIndex((x) => x.url === c.url) === i);
}

const day = (d) => {
  const t = Date.parse(d);
  return Number.isNaN(t) ? String(d) : new Date(t).toISOString().slice(0, 10);
};
const hostPath = (url) => {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return String(url);
  }
};

/**
 * The consent platform of a set of runs as { vendor, facts }: one sentence per fact, in the report's language.
 * Null when no run saw a consent platform. The same sentences go to the HTML report, report.md and MCP.
 */
export function cmpFacts(m, runs) {
  const cmp = runs.map((r) => r.cmp).find(Boolean) ?? null;
  const dates = runs.flatMap(cmpScriptDates);
  if (!cmp && !dates.length) return null;
  const c = m.ui.cmp;
  const vendor = cmp?.vendor ?? c.unknown;
  const facts = [];
  // The platform's own script or setup file when it is known; on the vendor's own site every first-party file looks
  // like the platform's. OneTrust and Cookiebot name a setup file, whose date is when the site last published its setup.
  const setupFile = ["OneTrust", "Cookiebot"].includes(cmp?.vendor);
  // OneTrust serves its setup as <id>.js or <id>.json, whichever its script asks for.
  const base = (url) => String(url).replace(/\.(js|json)$/, "");
  const own = cmp?.script ? dates.find((d) => base(d.url) === base(cmp.script)) : null;
  // A known setup file without a date gets none, rather than the date of some other file.
  const dated = own ?? (setupFile && cmp?.script ? null : dates[0]);
  if (cmp?.built) facts.push(c.built(day(cmp.built)));
  else if (dated) facts.push(own && setupFile ? c.published(day(dated.lastModified), hostPath(dated.url)) : c.scriptDated(day(dated.lastModified), hostPath(dated.url)));
  if (cmp?.version) facts.push(c.version(cmp.version));
  if (cmp?.script) facts.push(setupFile ? c.setupFile(cmp.script) : c.script(cmp.script));
  if (cmp?.consentModel) facts.push(c.model(cmp.consentModel, cmp.region ?? null));
  if (cmp?.impliedConsent) facts.push(c.implied);
  if (cmp?.language) facts.push(c.language(cmp.language));
  if (cmp?.law) facts.push(c.law(cmp.law));
  if (cmp?.categories?.length) facts.push(c.categories(cmp.categories));
  if (cmp?.consentMode) {
    const mapping = cmp.consentMode.mapping ? c.mapping(Object.entries(cmp.consentMode.mapping)) : "";
    if (cmp.consentMode.active === false) facts.push(c.modeOff(vendor, mapping));
    else if (cmp.consentMode.fixed) facts.push(c.modeFixed(vendor, mapping));
    else if (cmp.vendor === "OneTrust") facts.push(c.modeOn(vendor, mapping), c.redaction(cmp.consentMode.adsDataRedaction ? "on" : "off"));
    else facts.push(c.modeOn(vendor, mapping), c.passthrough(cmp.consentMode.urlPassthrough, cmp.consentMode.adsDataRedaction));
    if (cmp.consentMode.redaction && cmp.consentMode.active !== false) facts.push(c.redaction(cmp.consentMode.redaction));
  }
  if (typeof cmp?.autoBlocking === "boolean") facts.push(cmp.vendor === "CookieYes" ? c.providerBlocking(cmp.blockingRules ?? 0) : c.autoBlocking(cmp.autoBlocking, cmp.blockingRules ?? 0));
  if (typeof cmp?.tcf === "boolean") facts.push(c.tcf(cmp.tcf));
  return { vendor, facts };
}
