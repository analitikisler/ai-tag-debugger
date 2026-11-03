// The Google tag's own consent state (google_tag_data.ics): recorded on the steps where it changes, and used by the
// consent checks for defaults and updates a consent platform's GTM template sets without any dataLayer command.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AuditSession } from "../src/browser.js";
import { checkRun, consentGrantedStep } from "../src/checks.js";
import { consentCompliance } from "../src/metrics.js";
import { context } from "../src/html/shell.js";
import { render as renderConsent } from "../src/html/consent.js";
import { stepCapture } from "../src/mcp.js";

// The shape gtag.js gave in November 2026: booleans per type, plus the flags. A stand-in, so no Google script loads.
const PAGE = `<!doctype html><button id="accept">accept</button><button id="noop">noop</button><script>
var e = function (d, u) { return { implicit: true, default: d, update: u, quiet: false }; };
window.google_tag_data = { ics: { entries: { ad_storage: e(false), analytics_storage: e(false), security_storage: e(true) }, active: true, usedDefault: true, usedUpdate: false, wasSetLate: false, waitPeriodTimedOut: false } };
document.getElementById("accept").onclick = function () {
  var i = window.google_tag_data.ics;
  i.entries.ad_storage = e(false, true); i.entries.analytics_storage = e(false, true); i.usedUpdate = true;
};
</script>`;
let server;
let url;
before(async () => {
  server = createServer((req, res) => res.writeHead(200, { "content-type": "text/html" }).end(PAGE));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server.close());

test("the Google tag's consent state is kept on the steps where it changed", async () => {
  const session = new AuditSession({ viewport: "desktop", site: url, providers: ["ga4"], quietMs: 0 });
  await session.start();
  try {
    await session.act({ action: "goto", url });
    await session.act({ action: "click", selector: "#noop" });
    await session.act({ action: "click", selector: "#accept" });
    assert.deepEqual(session.steps[1].tagConsent, {
      entries: { ad_storage: { default: "denied" }, analytics_storage: { default: "denied" }, security_storage: { default: "granted" } },
      usedDefault: true, usedUpdate: false, wasSetLate: false, waitPeriodTimedOut: false,
    });
    assert.equal(session.steps[2].tagConsent, undefined, "unchanged, so not kept again");
    assert.deepEqual(session.steps[3].tagConsent.entries.ad_storage, { default: "denied", update: "granted" });
    assert.equal(session.steps[3].tagConsent.usedUpdate, true);
  } finally {
    await session.close();
  }
});

const D = { ad_storage: { default: "denied" }, analytics_storage: { default: "denied" }, ad_user_data: { default: "denied" }, ad_personalization: { default: "denied" } };
const G = Object.fromEntries(Object.keys(D).map((k) => [k, { default: "denied", update: "granted" }]));
const state = (entries, over = {}) => ({ entries, usedDefault: true, usedUpdate: false, wasSetLate: false, waitPeriodTimedOut: false, ...over });
const run = (over = {}) => ({
  journeyId: "j", viewport: "desktop", completed: true, consentStep: null, rejectStep: null, cookieLog: [], hits: [], dataLayerLog: [],
  steps: [0, 1, 2, 3].map((index) => ({ index, label: `step ${index}`, t: 1000 * index })),
  ...over,
});
const withTag = (states, over = {}) => run({ ...over, steps: [0, 1, 2, 3].map((index) => ({ index, label: `step ${index}`, t: 1000 * index, ...(states[index] ? { tagConsent: states[index] } : {}) })) });
const checks = (r) => checkRun({ consent_mode: true, events: [] }, r).map((f) => `${f.severity}:${f.check}`).filter((c) => /consent|reject/.test(c));
const pushed = (step, kind, values) => ({ step, t: 1000 * step, value: ["consent", kind, values] });

test("a default the Google tag applied counts, though no dataLayer command set it", () => {
  assert.deepEqual(checks(run()), ["risk:consent_default_missing"]);
  assert.deepEqual(checks(withTag({ 1: state(D) })), []);
  // The tag's own late flag, and v2 signals its default left out.
  assert.deepEqual(checks(withTag({ 1: state(D, { wasSetLate: true }) })), ["risk:consent_default_late"]);
  assert.deepEqual(checks(withTag({ 1: state({ ad_storage: { default: "denied" }, analytics_storage: { default: "denied" } }) })), ["risk:consent_v2_missing"]);
});

test("a default the page pushed but the Google tag never applied is flagged", () => {
  const ignored = withTag({ 1: state({}, { usedDefault: false }) }, { dataLayerLog: [pushed(1, "default", { ad_storage: "denied", analytics_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" })] });
  assert.deepEqual(checks(ignored), ["warning:consent_default_not_applied"]);
  // Applied, or no Google tag at all to ask: nothing to say.
  assert.deepEqual(checks(withTag({ 1: state(D) }, { dataLayerLog: ignored.dataLayerLog })), []);
  assert.deepEqual(checks(run({ dataLayerLog: ignored.dataLayerLog })), []);
});

test("updates the Google tag applied decide when consent was given and whether a reject was overturned", () => {
  const granted = withTag({ 1: state(D), 2: state(G, { usedUpdate: true }) });
  assert.equal(consentGrantedStep(granted), 2);
  assert.deepEqual(checks(granted), []);
  // An update that left the v2 signals out.
  const partial = withTag({ 1: state(D), 2: state({ ...G, ad_user_data: { default: "denied" }, ad_personalization: { default: "denied" } }, { usedUpdate: true }) });
  assert.deepEqual(checks(partial), ["warning:consent_v2_update"]);
  // Granted again after the visitor rejected.
  const regranted = withTag({ 1: state(D), 3: state(G, { usedUpdate: true }) }, { rejectStep: 2 });
  assert.ok(checks(regranted).includes("broken:reject_ignored"));
  assert.ok(!checks(withTag({ 1: state(D) }, { rejectStep: 2 })).includes("broken:reject_ignored"));
});

test("the report and MCP show the Google tag's own state, and say where a default with no dataLayer command came from", () => {
  const r = withTag({ 1: state(D), 2: state(G, { usedUpdate: true }) });
  const metrics = consentCompliance({ plan: { consent_mode: true, events: [] }, runs: [r], findings: [] });
  assert.equal(metrics.consentMode.defaultPresent, true);
  assert.equal(metrics.consentMode.runs[0].source, "tag");
  const html = renderConsent(context({ title: "t", generatedAt: "now", findings: [], explained: null, runs: [r], plan: { consent_mode: true, events: [] }, lang: "en" }));
  assert.match(html, /No consent command in the dataLayer: the default was set elsewhere, such as a consent platform&#39;s GTM template, and the Google tag applied it\./);
  assert.match(html, /<b>The Google tag&#39;s own state<\/b> · default applied, update applied<\/p>/);
  const audit = { session: { steps: r.steps, hits: [], dataLayerLog: [], network: [], cookieChanges: [] } };
  assert.match(stepCapture(audit, 2), /^Google tag consent state \(google_tag_data\.ics\), changed at this step: ad_storage denied → granted, analytics_storage denied → granted, ad_user_data denied → granted, ad_personalization denied → granted; default applied, update applied\.$/m);
  assert.doesNotMatch(stepCapture(audit, 3), /Google tag consent state/);
});
