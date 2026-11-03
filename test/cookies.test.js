// Cookies per step: which ones a step added, changed or removed (never their values), and what the analytics
// and ad cookies say: the GA4 client id, and whether the click id cookies hold the landing page's click ids.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AuditSession, identityOf } from "../src/browser.js";
import { checkRun } from "../src/checks.js";

test("identityOf reads the GA4 client id and compares the click id cookies with the landing address", () => {
  const landing = "https://shop.example/?gclid=G123&fbclid=F456&utm_source=x";
  const cookies = [
    { name: "_ga", value: "GA1.1.1028414602.1793721464" },
    { name: "_gcl_aw", value: "GCL.1793721488.G123" },
    { name: "_fbc", value: "fb.1.1793721488000.F456" },
    { name: "_gcl_au", value: "1.1.1530680988.1793721489" },
    { name: "_fbp", value: "fb.1.1793721488000.123" },
    { name: "session", value: "secret" },
  ];
  assert.deepEqual(identityOf(cookies, landing), { ga_client_id: "1028414602.1793721464", gcl_aw: "landing", fbc: "landing", gcl_au: true, fbp: true });
  // Click ids from another visit, or a landing address without any.
  assert.deepEqual(identityOf(cookies, "https://shop.example/"), { ga_client_id: "1028414602.1793721464", gcl_aw: "other", fbc: "other", gcl_au: true, fbp: true });
  assert.equal(identityOf([{ name: "session", value: "secret" }], landing), null);
  assert.equal(identityOf([{ name: "_ga", value: "not-a-ga-cookie" }], landing), null);
});

const PAGES = {
  "/": `<!doctype html><button id="accept" onclick="document.cookie='_ga=GA1.1.111.222; path=/'; document.cookie='_gcl_aw=GCL.1.aitd-gclid; path=/'; document.cookie='prefs=a; path=/'">accept</button>
<button id="reset" onclick="document.cookie='_ga=GA1.1.333.444; path=/'; document.cookie='prefs=; path=/; max-age=0'">reset</button>`,
};
let server;
let url;
before(async () => {
  server = createServer((req, res) => res.writeHead(200, { "content-type": "text/html", "set-cookie": "visit=1; Path=/" }).end(PAGES["/"]));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server.close());

test("each step records the cookies it added, changed and removed by name, and the identity the cookies give", async () => {
  const session = new AuditSession({ viewport: "desktop", site: url, providers: ["ga4"], quietMs: 0 });
  await session.start();
  try {
    await session.act({ action: "goto", url: `${url}?gclid=aitd-gclid` });
    await session.act({ action: "click", selector: "#accept" });
    await session.act({ action: "click", selector: "#reset" });
    const changes = (step) => session.cookieChanges.filter((c) => c.step === step).map((c) => `${c.change}:${c.name}`).sort();
    assert.deepEqual(changes(1), ["added:visit"]);
    assert.deepEqual(changes(2), ["added:_ga", "added:_gcl_aw", "added:prefs"]);
    assert.deepEqual(changes(3), ["changed:_ga", "removed:prefs"]);
    assert.equal(session.steps[1].identity, undefined);
    assert.deepEqual(session.steps[2].identity, { ga_client_id: "111.222", gcl_aw: "landing" });
    assert.deepEqual(session.steps[3].identity, { ga_client_id: "333.444", gcl_aw: "landing" });
    // Values are never kept: not in the change list, and no cookie value appears anywhere in the session's records.
    const recorded = JSON.stringify({ changes: session.cookieChanges, log: session.cookieLog });
    assert.doesNotMatch(recorded, /GCL\.1|"a"|value/);
  } finally {
    await session.close();
  }
});

const landing = { step: 1, requested: "https://shop.example/?gclid=G123", final: "https://shop.example/?gclid=G123", chain: ["https://shop.example/?gclid=G123"] };
const ads = { platform: "google_ads", name: "conversion", step: 2, params: {}, url: "https://www.googleadservices.com/pagead/conversion/1/" };
const ga4 = (consent) => ({ platform: "ga4", name: "page_view", step: 1, params: { page_location: landing.final }, url: "https://x/g/collect", ...(consent ? { consent } : {}) });
const cookieRun = (over) => ({
  journeyId: "j", viewport: "desktop", completed: true, consentStep: null, rejectStep: null, dataLayerLog: [], cookieLog: [], cookieChanges: [], landing,
  steps: [0, 1, 2, 3].map((index) => ({ index, label: `step ${index}` })), hits: [],
  ...over,
});
const found = (r) => checkRun({ events: [] }, r).filter((f) => ["gclid_not_stored", "client_id_changed"].includes(f.check)).map((f) => `${f.severity}:${f.check}`);
const withIdentity = (ids) => [0, 1, 2, 3].map((index) => ({ index, label: `step ${index}`, ...(ids[index] ? { identity: ids[index] } : {}) }));

test("a gclid that _gcl_aw never held is flagged when a Google Ads tag ran with ad storage granted", () => {
  const granted = { ad_storage: "granted", analytics_storage: "granted" };
  assert.deepEqual(found(cookieRun({ hits: [ga4(granted), ads] })), ["warning:gclid_not_stored"]);
  // Without Consent Mode nothing holds the cookie back either.
  assert.deepEqual(found(cookieRun({ hits: [ga4(null), ads] })), ["warning:gclid_not_stored"]);
  // Stored: fine.
  assert.deepEqual(found(cookieRun({ hits: [ga4(granted), ads], steps: withIdentity({ 2: { gcl_aw: "landing" } }) })), []);
  // Ad storage denied: the cookie is rightly not written.
  assert.deepEqual(found(cookieRun({ hits: [ga4({ ad_storage: "denied", analytics_storage: "denied" }), ads] })), []);
  // GA4 alone never writes _gcl_aw.
  assert.deepEqual(found(cookieRun({ hits: [ga4(granted)] })), []);
  // No gclid on the landing page, or one a redirect lost (campaign_lost_redirect reports that).
  assert.deepEqual(found(cookieRun({ hits: [ga4(granted), ads], landing: { ...landing, requested: "https://shop.example/", final: "https://shop.example/" } })), []);
  assert.deepEqual(found(cookieRun({ hits: [ga4(granted), ads], landing: { ...landing, final: "https://shop.example/home" } })), []);
  // A capture from before cookies were tracked per step says nothing.
  assert.deepEqual(found(cookieRun({ hits: [ga4(granted), ads], cookieChanges: undefined })), []);
});

test("a GA4 client id that changes mid-visit is flagged, unless the visitor rejected cookies in between", () => {
  const changed = cookieRun({ steps: withIdentity({ 1: { ga_client_id: "1.1" }, 2: { ga_client_id: "1.1" }, 3: { ga_client_id: "2.2" } }) });
  const [f] = checkRun({ events: [] }, changed).filter((x) => x.check === "client_id_changed");
  assert.equal(f.severity, "warning");
  assert.equal(f.step, "step 3");
  assert.equal(f.evidence, "_ga 1.1 -> 2.2");
  assert.match(f.detail, /between "step 2" and "step 3"/);
  // A first _ga after consent is not a change, and a reject in between may rightly clear the cookie.
  assert.deepEqual(found(cookieRun({ steps: withIdentity({ 2: { ga_client_id: "1.1" }, 3: { ga_client_id: "1.1" } }) })), []);
  assert.deepEqual(found(cookieRun({ rejectStep: 2, steps: withIdentity({ 1: { ga_client_id: "1.1" }, 3: { ga_client_id: "2.2" } }) })), []);
});
