// Consent checks: Consent Mode v2 signals, declining, cookies set early, and the browser side of a reject click.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { checkRun } from "../src/checks.js";
import { AuditSession } from "../src/browser.js";
import { providerOf } from "../src/parsers.js";

const plan = { consent_mode: true, events: [] };
const cmd = (step, kind, values) => ({ step, value: ["consent", kind, values] });
const run = (over) => ({
  journeyId: "j", viewport: "desktop", completed: true, consentStep: null, hits: [], cookieLog: [],
  steps: [0, 1, 2, 3].map((index) => ({ index, label: `step ${index}` })),
  dataLayerLog: [cmd(0, "default", { ad_storage: "denied", analytics_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" })],
  ...over,
});
const checks = (r, p = plan) => checkRun(p, r).map((f) => `${f.severity}:${f.check}`);

test("flags a Consent Mode default without the v2 signals", () => {
  const dataLayerLog = [cmd(0, "default", { ad_storage: "denied", analytics_storage: "denied" })];
  assert.ok(checks(run({ dataLayerLog })).includes("risk:consent_v2_missing"));
  assert.ok(!checks(run()).includes("risk:consent_v2_missing"));
});

test("flags an update that grants storage but not the v2 signals", () => {
  const dataLayerLog = [...run().dataLayerLog, cmd(2, "update", { ad_storage: "granted", analytics_storage: "granted" })];
  assert.ok(checks(run({ dataLayerLog, consentStep: 2 })).includes("warning:consent_v2_update"));
  const full = [...run().dataLayerLog, cmd(2, "update", { ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted" })];
  assert.ok(!checks(run({ dataLayerLog: full, consentStep: 2 })).includes("warning:consent_v2_update"));
});

test("a reject journey flags tags, a re-grant and cookies after the visitor said no", () => {
  const hit = (platform, name, step, extra = {}) => ({ platform, name, step, params: {}, url: "https://x/", ...extra });
  const r = run({
    rejectStep: 1,
    hits: [hit("meta", "PageView", 0), hit("meta", "PageView", 2), hit("ga4", "page_view", 2, { consent: { ad_storage: "granted", analytics_storage: "granted" } })],
    dataLayerLog: [...run().dataLayerLog, cmd(2, "update", { ad_storage: "granted" })],
    cookieLog: [{ name: "_ga", domain: ".x", step: 0 }, { name: "_fbp", domain: ".x", step: 2 }, { name: "session", domain: "x", step: 0 }],
  });
  const got = checks(r);
  assert.ok(got.includes("broken:after_reject"));
  assert.ok(got.includes("broken:reject_ignored"));
  assert.ok(got.includes("risk:cookies_before_consent"));
  assert.ok(got.includes("broken:cookies_after_reject"));
  // The hit before the reject click is a before-consent risk; the ones after it are not reported twice.
  const findings = checkRun(plan, r);
  assert.equal(findings.filter((f) => f.check === "before_consent").length, 1);
  assert.ok(!findings.some((f) => /session/.test(f.detail)));
});

test("a reject that left the banner open is a failed reject button", () => {
  const steps = [0, 1, 2].map((index) => ({ index, label: `s${index}`, ...(index === 1 ? { bannerOpenAfter: true } : {}) }));
  assert.ok(checks(run({ rejectStep: 1, steps })).includes("broken:reject_button_failed"));
  assert.ok(!checks(run({ rejectStep: 1 })).includes("broken:reject_button_failed"));
});

test("a clean reject journey has no consent findings", () => {
  const got = checks(run({ rejectStep: 1, cookieLog: [{ name: "session", domain: "x", step: 0 }] }));
  assert.deepEqual(got.filter((c) => /consent|reject/.test(c)), []);
});

test("recognizes more consent platforms", () => {
  for (const host of ["sdk.privacy-center.org", "cdn.cookie-script.com", "cdn.iubenda.com", "app.termly.io", "consent.trustarc.com", "cmp.quantcast.mgr.consensu.org"]) {
    assert.equal(providerOf(`https://${host}/x.js`)?.key, "consent", host);
  }
});

test("a reject click is recorded with the cookies set before it and whether the banner closed", async () => {
  const server = createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    if (req.url === "/") res.setHeader("set-cookie", "_ga=GA1.1.1; Path=/");
    res.end(`<!doctype html><div id="onetrust-banner-sdk" style="position:fixed;bottom:0;width:100%;height:50px"><button id="no">Reject all</button></div>
<script>document.getElementById("no").onclick = () => { document.cookie = "_fbp=fb.1; path=/"; document.getElementById("onetrust-banner-sdk").remove(); };</script>`);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const session = new AuditSession({ viewport: "desktop", site: url, providers: ["ga4"] });
  await session.start();
  try {
    await session.act({ action: "goto", url });
    assert.equal(await session.act({ action: "click", text: "Reject all", reason: "Reject cookies", rejects_consent: true }), null);
    assert.equal(session.rejectStep, 2);
    assert.equal(session.steps[2].bannerOpenAfter, false);
    assert.deepEqual(session.cookieLog.map((c) => [c.name, c.step]), [["_ga", 1], ["_fbp", 2]]);
  } finally {
    await session.close();
    server.close();
  }
});
