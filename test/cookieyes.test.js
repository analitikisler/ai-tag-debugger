// CookieYes, against a stand-in page written for these tests (none of its code): its setup read from
// window.cookieyes._ckyStore, its fixed Consent Mode mapping, and the consent scenarios answered through its named
// buttons and preference center switches, analytics only included.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AuditSession } from "../src/browser.js";
import { runConsentScenarios } from "../src/consent.js";
import { cmpFacts } from "../src/cmp.js";
import { messages } from "../src/i18n.js";

// What CookieYes showed on its own site in November 2026: data-cky-tag buttons, ckySwitch<category> switches, the
// choice in a cookieyes-consent cookie, and its categories, law and blocked providers in _ckyStore.
const PAGE = `<!doctype html><html><body><p>shop</p>
<div class="cky-consent-container"><div class="cky-notice-btn-wrapper">
  <button class="cky-btn cky-btn-customize" data-cky-tag="settings-button">Customise</button>
  <button class="cky-btn cky-btn-reject" data-cky-tag="reject-button">Alle ablehnen</button>
  <button class="cky-btn cky-btn-accept" data-cky-tag="accept-button">Alle akzeptieren</button>
</div><div class="cky-preference-center" style="display:none">
  <input type="checkbox" id="ckySwitchfunctional"><input type="checkbox" id="ckySwitchanalytics">
  <input type="checkbox" id="ckySwitchadvertisement" checked><button data-cky-tag="detail-save-button">Save</button>
</div></div>
<script>
  var saved = (document.cookie.match(/cookieyes-consent=([^;]*)/) || [])[1] || "";
  var on = function (c) { return saved.indexOf(c + ":yes") >= 0; };
  window.cookieyes = { _ckyStore: { _categories: ["necessary", "functional", "analytics", "performance", "advertisement"].map(function (slug) { return { slug: slug, isNecessary: slug === "necessary" }; }),
    _providersToBlock: [{ url: "hotjar.com" }, { url: "doubleclick.net" }], _bannerConfig: { activeLaw: "gdpr" } } };
  var save = function (cats) { document.cookie = "cookieyes-consent=" + cats.map(function (c) { return c + ":yes"; }).join(",") + "; path=/"; document.querySelector(".cky-consent-container").remove(); };
  document.querySelector('[data-cky-tag="accept-button"]').onclick = function () { save(["functional", "analytics", "advertisement"]); };
  document.querySelector('[data-cky-tag="reject-button"]').onclick = function () { save([]); };
  document.querySelector('[data-cky-tag="detail-save-button"]').onclick = function () {
    save(["functional", "analytics", "advertisement"].filter(function (c) { return document.getElementById("ckySwitch" + c).checked; }));
  };
  if (on("analytics")) fetch("https://www.google-analytics.com/g/collect?v=2&tid=G-TEST&en=page_view&gcs=" + (on("advertisement") ? "G111" : "G101"), { mode: "no-cors" }).catch(function () {});
  if (on("advertisement")) new Image().src = "https://www.facebook.com/tr/?id=1&ev=PageView";
</script></body></html>`;
let server;
let site;
before(async () => {
  server = createServer((req, res) => res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  site = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server.close());

test("CookieYes's setup is read from the page, with its fixed Consent Mode mapping", async () => {
  const session = new AuditSession({ viewport: "desktop", site, providers: ["ga4"], quietMs: 0 });
  await session.start();
  try {
    await session.act({ action: "goto", url: site });
    assert.equal(session.cmp.vendor, "CookieYes");
    assert.equal(session.cmp.law, "gdpr");
    assert.deepEqual(session.cmp.categories, ["necessary", "functional", "analytics", "performance", "advertisement"]);
    assert.equal(session.cmp.blockingRules, 2);
    const { facts } = cmpFacts(messages("en"), [{ cmp: session.cmp }]);
    assert.ok(facts.includes("The law its banner follows here: GDPR."));
    assert.ok(facts.includes("It holds back scripts from 2 providers until their category is allowed."));
    assert.ok(facts.some((f) => /^CookieYes maps its categories to Consent Mode the same way on every site: ad_storage → advertisement, .*analytics_storage → analytics, .*security_storage → necessary\.$/.test(f)));
    assert.match(cmpFacts(messages("tr"), [{ cmp: session.cmp }]).facts.join(" "), /Bannerın burada uyduğu yasa: GDPR\./);
  } finally {
    await session.close();
  }
});

test("the consent scenarios answer CookieYes by its named buttons in any language, and analytics only through its switches", async () => {
  const sc = await runConsentScenarios({ site, providers: ["ga4", "meta"] }, { campaign: false });
  assert.equal(sc.cmp, "CookieYes");
  assert.ok(sc.states.accept.after.ga4 && sc.states.accept.after.meta);
  assert.deepEqual(sc.states.reject.after, {});
  // Analytics on, advertisement switched off though it started on, and saved.
  assert.equal(sc.states.analytics.via, "CookieYes");
  assert.ok(sc.states.analytics.after.ga4);
  assert.equal(sc.states.analytics.after.meta, undefined);
});
