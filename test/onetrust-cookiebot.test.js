// OneTrust and Cookiebot, against stand-in pages written for these tests (none of their code): their setups and
// Consent Mode mappings as the report gives them, and the consent scenarios through their APIs. The shapes are what
// onetrust.com and cookiebot.com showed in November 2026: OneTrust numbering its groups 1 to 7 and naming in
// GoogleConsent the group behind each signal, Cookiebot's newer script exposing CookieConsent and no Cookiebot.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AuditSession } from "../src/browser.js";
import { runConsentScenarios } from "../src/consent.js";
import { cmpFacts } from "../src/cmp.js";
import { messages } from "../src/i18n.js";

// Tags by group (OneTrust) or category (Cookiebot): analytics sends GA4, ads send Meta.
const tags = (analytics, ads) => `if (${analytics}) fetch("https://www.google-analytics.com/g/collect?v=2&tid=G-TEST&en=page_view&gcs=G101", { mode: "no-cors" }).catch(function () {});
  if (${ads}) new Image().src = "https://www.facebook.com/tr/?id=1&ev=PageView";`;
const onetrust = (sharedGroup) => `<!doctype html><html><body><p>shop</p>
<script src="/scripttemplates/otSDKStub.js" data-domain-script="abc-123"></script><script src="/scripttemplates/202604.2.0/otBannerSdk.js"></script>
<div id="onetrust-banner-sdk"><button>Accept All Cookies</button></div><script>
  var active = (document.cookie.match(/groups=([^;]*)/) || [])[1] || ",1,";
  var save = function (groups) { document.cookie = "groups=" + groups + "; path=/"; };
  window.OneTrust = {
    GetDomainData: function () { return { ConsentModel: { Name: "opt-in" }, IsIabEnabled: false,
      Groups: [{ OptanonGroupId: "1", GroupName: "Strictly Necessary" }, { OptanonGroupId: "2", GroupName: "Performance" }, { OptanonGroupId: "3", GroupName: "Functional" }, { OptanonGroupId: "4", GroupName: "Targeting" }],
      GoogleConsent: { GCEnable: true, GCAnalyticsStorage: "2", GCAdStorage: "${sharedGroup ? "2" : "4"}", GCAdUserData: "4", GCAdPersonalization: "4", GCFunctionalityStorage: "3", GCPersonalizationStorage: "3", GCSecurityStorage: "1", GCRedactEnable: true } }; },
    getGeolocationData: function () { return { country: "DE", state: "BY" }; },
    AllowAll: function () { save(",1,2,3,4,"); }, RejectAll: function () { save(",1,"); },
    UpdateConsent: function (kind, value) { var g = value.split(":")[0]; if ((document.cookie.match(/groups=([^;]*)/) || [])[1].indexOf("," + g + ",") < 0) save((document.cookie.match(/groups=([^;]*)/) || [])[1] + g + ","); },
  };
  ${tags('active.indexOf(",2,") >= 0', 'active.indexOf(",4,") >= 0')}
</script></body></html>`;
const cookiebot = `<!doctype html><html><body><p>shop</p><div id="CybotCookiebotDialog"><button>Allow all</button></div><script>
  var c = (document.cookie.match(/cb=([^;]*)/) || [])[1] || "0,0,0";
  var parts = c.split(",");
  window.CookieConsent = { version: 19, serial: "c99c74a8", responseMode: "leveloptin", userCountry: "de-BY", consentModeDisabled: false, consentModeDataRedaction: "dynamic", autoblock: true, framework: "",
    consent: { method: c === "0,0,0" ? null : "explicit" },
    submitCustomConsent: function (p, s, m) { document.cookie = "cb=" + [p ? 1 : 0, s ? 1 : 0, m ? 1 : 0].join(",") + "; path=/"; } };
  ${tags('parts[1] === "1"', 'parts[2] === "1"')}
</script></body></html>`;
const PAGES = { "/onetrust": onetrust(false), "/onetrust-shared": onetrust(true), "/cookiebot": cookiebot };
let server;
let base;
before(async () => {
  server = createServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    if (path.endsWith(".js")) return res.writeHead(200, { "content-type": "text/javascript" }).end("");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGES[path] ?? "<p>none</p>");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function setupOf(path) {
  const session = new AuditSession({ viewport: "desktop", site: `${base}/`, providers: ["ga4"], quietMs: 0 });
  await session.start();
  try {
    await session.act({ action: "goto", url: `${base}${path}` });
    return session.cmp;
  } finally {
    await session.close();
  }
}

test("OneTrust's setup names the group behind each Consent Mode signal, and the version, model and region of the visit", async () => {
  const cmp = await setupOf("/onetrust");
  assert.equal(cmp.vendor, "OneTrust");
  assert.equal(cmp.version, "202604.2.0");
  assert.equal(cmp.script, "https://cdn.cookielaw.org/consent/abc-123/abc-123.js");
  assert.deepEqual([cmp.consentModel, cmp.impliedConsent, cmp.region], ["opt-in", false, "DE-BY"]);
  assert.equal(cmp.consentMode.mapping.analytics_storage, "Performance (2)");
  assert.equal(cmp.consentMode.mapping.ad_storage, "Targeting (4)");
  const { facts } = cmpFacts(messages("en"), [{ cmp }]);
  assert.ok(facts.includes("Version 202604.2.0."));
  assert.ok(facts.includes('It handled this visit, placed in DE-BY, under its "opt-in" consent model.'));
  assert.ok(facts.some((f) => /^OneTrust's own Consent Mode integration is on, with ad_storage → Targeting \(4\), analytics_storage → Performance \(2\),/.test(f)));
  assert.ok(facts.includes("Ads data redaction: on."));
  // OneTrust serves its setup as .js or .json; either one dates it.
  const dated = cmpFacts(messages("en"), [{ cmp, network: [{ provider: "consent", url: "https://cdn.cookielaw.org/consent/abc-123/abc-123.json", lastModified: "Thu, 22 Oct 2026 13:46:15 GMT" }] }]);
  assert.equal(dated.facts[0], "That setup (cdn.cookielaw.org/consent/abc-123/abc-123.json) was last published on 2026-10-22.");
});

test("the consent scenarios turn on OneTrust's own analytics group for analytics only, and skip it when ads share that group", async () => {
  const sc = await runConsentScenarios({ site: `${base}/onetrust`, providers: ["ga4", "meta"] }, { campaign: false });
  assert.equal(sc.states.analytics.via, "OneTrust");
  assert.ok(sc.states.analytics.after.ga4, "group 2 (Performance), not the usual C0002");
  assert.equal(sc.states.analytics.after.meta, undefined);
  assert.deepEqual(sc.states.reject.after, {});
  const shared = await runConsentScenarios({ site: `${base}/onetrust-shared`, providers: ["ga4", "meta"] }, { campaign: false });
  assert.equal(shared.states.analytics.via, null);
});

test("Cookiebot is found by its newer CookieConsent object, with its fixed mapping, and answered through it", async () => {
  const cmp = await setupOf("/cookiebot");
  assert.equal(cmp.vendor, "Cookiebot");
  assert.equal(cmp.script, "https://consentcdn.cookiebot.com/consentconfig/c99c74a8/settings.json");
  const { facts } = cmpFacts(messages("en"), [{ cmp }]);
  assert.ok(facts.includes("Version 19."));
  assert.ok(facts.includes('It handled this visit, placed in de-BY, under its "leveloptin" consent model.'));
  assert.ok(facts.some((f) => /^Cookiebot maps its categories to Consent Mode the same way on every site: ad_storage → marketing, .*analytics_storage → statistics,/.test(f)));
  assert.ok(facts.includes("Ads data redaction: dynamic."));
  assert.ok(facts.includes("Auto-blocking is on."));
  // A visit counted as consent without a choice is said so, since it changes what No choice means.
  assert.ok(cmpFacts(messages("en"), [{ cmp: { ...cmp, impliedConsent: true } }]).facts.some((f) => /^It counted this visit as consent given without a choice/.test(f)));
  assert.match(cmpFacts(messages("tr"), [{ cmp: { ...cmp, consentMode: { ...cmp.consentMode, active: false } } }]).facts.join(" "), /Cookiebot'nin kendi Consent Mode entegrasyonu kapalı/);
  const sc = await runConsentScenarios({ site: `${base}/cookiebot`, providers: ["ga4", "meta"] }, { campaign: false });
  assert.equal(sc.cmp, "Cookiebot");
  assert.ok(sc.states.accept.after.ga4 && sc.states.accept.after.meta);
  assert.deepEqual(sc.states.reject.after, {});
  assert.ok(sc.states.analytics.after.ga4);
  assert.equal(sc.states.analytics.after.meta, undefined);
});
