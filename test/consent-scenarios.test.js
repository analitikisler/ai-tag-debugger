// Consent scenarios: the start page opened once per consent choice, and the per-state tag table.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { consentTable, runConsentScenarios } from "../src/consent.js";
import { renderMarkdown } from "../src/report.js";

const n = (count, extra = {}) => ({ n: count, cookieless: 0, adDenied: 0, ...extra });

test("flags tags after reject and ad tags after analytics only, but not cookieless pings", () => {
  const { cols, rows } = consentTable({
    cmp: "Cookiebot",
    before: { ga4: { page_view: n(1, { cookieless: 1, adDenied: 1 }) } },
    states: {
      accept: { via: "Cookiebot", after: { ga4: { page_view: n(1) }, meta: { PageView: n(1) } } },
      reject: { via: "Cookiebot", after: { ga4: { page_view: n(1, { cookieless: 1, adDenied: 1 }) }, meta: { PageView: n(2) } } },
      analytics: { via: "Cookiebot", after: { ga4: { page_view: n(1) }, meta: { PageView: n(1) } } },
    },
  });
  assert.deepEqual(cols, ["before", "accept", "reject", "analytics"]);
  const cell = (p, state) => rows.find((r) => r.platform === p).cells.find((c) => c.state === state);
  assert.equal(cell("ga4", "reject").problem, false);
  assert.equal(cell("ga4", "analytics").problem, false);
  assert.deepEqual(cell("meta", "reject"), { state: "reject", count: 2, problem: true });
  assert.equal(cell("meta", "analytics").problem, true);
  assert.equal(cell("meta", "before").count, 0);
});

test("a state the consent platform can't answer shows as not run", () => {
  const scenarios = { cmp: "banner", before: {}, states: { accept: { via: "banner", after: { ga4: { page_view: n(1) } } }, reject: { via: "banner", after: {} }, analytics: { via: null } } };
  const md = renderMarkdown({ title: "t", generatedAt: "now", findings: [], explained: null, runs: [], consentScenarios: scenarios });
  assert.match(md, /\| GA4 `page_view` \| 0 \| 1 ✓ \| 0 \| – \|/);
});

const PAGE = `<!doctype html><html><body>
<div id="cookie-banner"><button>Accept all</button><button>Reject all</button></div>
<script>
  var stats = /stats=1/.test(document.cookie), ads = /ads=1/.test(document.cookie);
  window.Cookiebot = { submitCustomConsent: function (p, s, m) { document.cookie = "stats=" + (s ? 1 : 0); document.cookie = "ads=" + (m ? 1 : 0); } };
  if (stats) fetch("https://www.google-analytics.com/g/collect?v=2&tid=G-TEST&en=page_view&gcs=G111", { mode: "no-cors" }).catch(function () {});
  if (ads) new Image().src = "https://www.facebook.com/tr/?id=1&ev=PageView";
</script></body></html>`;

test("answers each choice through the consent platform's API", async () => {
  const server = createServer((req, res) => res.writeHead(200, { "content-type": "text/html" }).end(PAGE));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const site = `http://127.0.0.1:${server.address().port}/`;
    const result = await runConsentScenarios({ site });
    assert.equal(result.cmp, "Cookiebot");
    assert.ok(result.states.accept.after.ga4 && result.states.accept.after.meta);
    assert.deepEqual(result.states.reject.after, {});
    assert.ok(result.states.analytics.after.ga4);
    assert.equal(result.states.analytics.after.meta, undefined);
  } finally {
    server.close();
  }
});

test("returns nothing when the page has no consent banner", async () => {
  const server = createServer((req, res) => res.writeHead(200, { "content-type": "text/html" }).end("<p>hi</p>"));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    assert.equal(await runConsentScenarios({ site: `http://127.0.0.1:${server.address().port}/` }), null);
  } finally {
    server.close();
  }
});
