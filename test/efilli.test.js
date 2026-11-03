// Efilli, against a stand-in page written for these tests (none of Efilli's code): the banner in the open shadow
// root of <efilli-layout-dynamic>, the efilliSdk consent manager the consent scenarios use, a reject button that
// leaves the banner open, and the platform's setup as the report and MCP describe it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AuditSession } from "../src/browser.js";
import { runConsentScenarios } from "../src/consent.js";
import { checkRun } from "../src/checks.js";
import { cmpFacts, cmpScriptDates } from "../src/cmp.js";
import { messages } from "../src/i18n.js";

// What Efilli showed on its own site in November 2026: the banner and its buttons by data-name, the efl- attributes,
// the choice kept in localStorage under efl-saved-consent, an efilli.consent push, and a setup per language.
const page = ({ modeActive, brokenReject }) => `<!doctype html><html><body><p>shop</p><script>
var saved = JSON.parse(localStorage.getItem("efl-saved-consent") || "null");
var cats = saved ? saved.categories : { essential: true, functional: false, marketing: false, other: false };
window.dataLayer = window.dataLayer || [];
window.efilliBundleCompileDate = "2026-10-28T09:00:00.000Z";
var mode = { active: ${modeActive}, mapping: { ad_storage: "marketing", analytics_storage: "functional", ad_user_data: "marketing", ad_personalization: "marketing" }, url_passthrough: false, ads_data_redaction: true };
var host = document.createElement("efilli-layout-dynamic");
document.body.appendChild(host);
var root = host.attachShadow({ mode: "open" });
if (!saved) root.innerHTML = '<div data-name="Banner" efl-consent-not-saved style="position:fixed;bottom:0;right:0;width:420px;height:120px;background:#fff">'
  + '<div data-name="Accept Button" efl-consent-not-saved style="cursor:pointer;padding:8px">Tümünü Kabul Et</div>'
  + '<div data-name="Reject Button" efl-consent-not-saved style="cursor:pointer;padding:8px">Tümünü Reddet</div></div>';
var pending = Object.assign({}, cats);
function save(next) {
  ${brokenReject ? "if (!next.marketing && !next.functional) return;" : ""}
  localStorage.setItem("efl-saved-consent", JSON.stringify({ categories: next }));
  root.innerHTML = "";
  dataLayer.push({ event: "efilli.consent", categories: next });
}
window.efilliSdk = {
  consentManager: {
    acceptAll: function () { save({ essential: true, functional: true, marketing: true, other: true }); },
    rejectAll: function () { save({ essential: true, functional: false, marketing: false, other: false }); },
    getCategories: function () { return Object.assign({}, cats); },
    setCategoryConsent: function (c, on) { pending[c] = on; },
    saveConsent: function () { save(pending); },
  },
  configManager: { getLanguage: function () { return { name: "Türkçe", consentMode: mode, autoBlocking: true, blockingRules: [{}, {}], tcf: { active: false } }; } },
};
root.addEventListener("click", function (e) {
  var name = e.target.closest("[data-name]") && e.target.closest("[data-name]").getAttribute("data-name");
  if (name === "Accept Button") efilliSdk.consentManager.acceptAll();
  if (name === "Reject Button") efilliSdk.consentManager.rejectAll();
});
if (cats.functional) fetch("https://www.google-analytics.com/g/collect?v=2&tid=G-TEST&en=page_view&gcs=G101", { mode: "no-cors" }).catch(function () {});
if (cats.marketing) new Image().src = "https://www.facebook.com/tr/?id=1&ev=PageView";
</script></body></html>`;

let server;
let base;
before(async () => {
  server = createServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page({ modeActive: path !== "/gtm-template", brokenReject: path === "/broken" }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test("the consent scenarios answer Efilli through its SDK, with analytics only from its own Consent Mode mapping", async () => {
  const result = await runConsentScenarios({ site: `${base}/`, providers: ["ga4", "meta"] });
  assert.equal(result.cmp, "Efilli");
  assert.ok(result.states.accept.after.ga4 && result.states.accept.after.meta);
  assert.deepEqual(result.states.reject.after, {});
  // analytics_storage maps to "functional" and ads to "marketing": analytics only turns functional on.
  assert.equal(result.states.analytics.via, "Efilli");
  assert.ok(result.states.analytics.after.ga4);
  assert.equal(result.states.analytics.after.meta, undefined);
});

test("with Consent Mode run from a GTM template, analytics only is not attempted", async () => {
  const result = await runConsentScenarios({ site: `${base}/gtm-template`, providers: ["ga4", "meta"] });
  assert.equal(result.cmp, "Efilli");
  assert.equal(result.states.analytics.via, null);
  assert.equal(result.states.analytics.after, undefined);
});

test("a reject inside Efilli's shadow root is recorded, and a reject button that leaves the banner open is flagged", async () => {
  for (const [path, open] of [["/", false], ["/broken", true]]) {
    const session = new AuditSession({ viewport: "desktop", site: `${base}/`, providers: ["ga4"], quietMs: 0 });
    await session.start();
    try {
      await session.act({ action: "goto", url: `${base}${path}` });
      // The page's setup is read once, on the step it is first seen at.
      assert.deepEqual(session.cmp, {
        vendor: "Efilli", built: "2026-10-28T09:00:00.000Z", script: null, language: "Türkçe", categories: ["essential", "functional", "marketing", "other"],
        consentMode: { active: true, mapping: { ad_storage: "marketing", analytics_storage: "functional", ad_user_data: "marketing", ad_personalization: "marketing" }, urlPassthrough: false, adsDataRedaction: true },
        autoBlocking: true, blockingRules: 2, tcf: false, step: 1,
      });
      // The visible text of a button in the shadow root is enough to click it, as the agent would.
      const error = await session.act({ action: "click", text: "Tümünü Reddet", rejects_consent: true });
      assert.equal(error, null);
      assert.equal(session.steps[session.rejectStep].bannerOpenAfter, open, path);
      const run = { journeyId: "j", viewport: "desktop", completed: true, consentStep: null, rejectStep: session.rejectStep, hits: [], cookieLog: [], dataLayerLog: session.dataLayerLog, steps: session.steps };
      assert.equal(checkRun({ events: [] }, run).some((f) => f.check === "reject_button_failed"), open, path);
    } finally {
      await session.close();
    }
  }
});

test("the platform's setup reads as sentences in English and Turkish, and other platforms are dated by their script", () => {
  const cmp = {
    vendor: "Efilli", built: "2026-10-28T09:00:00.000Z", script: "https://bundles.efilli.com/shop.example.prod.js", language: "Türkçe", categories: ["essential", "functional", "marketing", "other"],
    consentMode: { active: false, mapping: { ad_storage: "marketing", analytics_storage: "functional" }, urlPassthrough: false, adsDataRedaction: false },
    autoBlocking: true, blockingRules: 0, tcf: false, step: 1,
  };
  const en = cmpFacts(messages("en"), [{ cmp }]);
  assert.equal(en.vendor, "Efilli");
  assert.deepEqual(en.facts, [
    "Its site bundle was compiled on 2026-10-28.",
    "Bundle: https://bundles.efilli.com/shop.example.prod.js.",
    "The setup in force is the one for the Türkçe language.",
    "Categories: essential, functional, marketing, other.",
    "Efilli's own Consent Mode integration is off, so the consent signals come from elsewhere, such as a GTM template or the site's code; its configured mapping (ad_storage → marketing, analytics_storage → functional) is not in force.",
    "Auto-blocking is on.",
    "IAB TCF is off.",
  ]);
  const on = cmpFacts(messages("en"), [{ cmp: { ...cmp, consentMode: { ...cmp.consentMode, active: true, adsDataRedaction: true } } }]).facts;
  assert.ok(on.includes("Efilli's own Consent Mode integration is on, with ad_storage → marketing, analytics_storage → functional."));
  assert.ok(on.includes("URL passthrough is off and ads data redaction is on."));
  assert.match(cmpFacts(messages("tr"), [{ cmp }]).facts.join(" "), /Site paketi 2026-10-28 tarihinde derlendi\. .*Efilli'nin kendi Consent Mode entegrasyonu kapalı/);
  // A platform known only by its script: the date its server gives, once per address.
  const network = [
    { provider: "consent", url: "https://cdn.cookielaw.org/scripttemplates/otSDKStub.js", lastModified: "Fri, 03 Apr 2026 10:17:18 GMT" },
    { provider: "consent", url: "https://cdn.cookielaw.org/scripttemplates/otSDKStub.js", lastModified: "Fri, 03 Apr 2026 10:17:18 GMT" },
    { provider: "ga4", url: "https://www.googletagmanager.com/gtag/js", lastModified: "Mon, 02 Nov 2026 00:00:00 GMT" },
  ];
  assert.equal(cmpScriptDates({ network }).length, 1);
  assert.deepEqual(cmpFacts(messages("en"), [{ cmp: { vendor: "OneTrust" }, network }]), { vendor: "OneTrust", facts: ["Its script (cdn.cookielaw.org/scripttemplates/otSDKStub.js) last changed on 2026-04-03."] });
  assert.equal(cmpFacts(messages("en"), [{ network: [] }]), null);
});
