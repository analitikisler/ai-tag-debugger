// The consent matrix: every consent choice (none and on to the next page, accept, reject, analytics only) side by
// side, with the first hit's consent and campaign parameters, the client id, cookies and tag timing per choice, and
// the marks for what should not happen with a choice. Also as the consent_matrix MCP tool.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { consentMatrix, consentMatrixMarkdown, consentTable, runConsentScenarios, scenarioLanding } from "../src/consent.js";
import { messages } from "../src/i18n.js";
import { buildServer } from "../src/mcp.js";

const en = messages("en");
const facts = (over = {}) => ({
  firstHit: { platform: "ga4", event: "page_view", consent: { ad_storage: "denied", analytics_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" } },
  campaign: { kept: ["gclid", "utm_source"], lost: [] }, clientId: "111.222", cookieClientId: null, gclAw: null, cookies: [], loaded: { gtm: 120, ga4: 840 }, tagConsent: null, clientIdBefore: "111.222",
  ...over,
});
const granted = { ad_storage: "granted", analytics_storage: "granted", ad_user_data: "granted", ad_personalization: "granted" };

test("the matrix marks tracking cookies without consent, a client id lost on accept and a UTM parameter lost from the first hit", () => {
  const scenarios = {
    cmp: "Cookiebot", landing: "https://shop.example/?gclid=aitd-gclid&utm_source=aitd",
    beforeFacts: facts({ clientIdBefore: undefined }),
    states: {
      ignore: { via: "none", after: {}, facts: facts({ cookies: ["_ga", "session"], cookieClientId: "111.222" }) },
      accept: { via: "Cookiebot", after: {}, facts: facts({ firstHit: { platform: "ga4", event: "page_view", consent: granted }, cookieClientId: "333.444", gclAw: "landing", cookies: ["_ga", "_gcl_aw"], campaign: { kept: ["gclid"], lost: ["utm_source"] } }) },
      reject: { via: "Cookiebot", after: {}, facts: facts({ clientId: "555.666" }) },
      analytics: { via: null },
    },
  };
  const matrix = consentMatrix(en, scenarios);
  assert.deepEqual(matrix.cols, ["before", "ignore", "accept", "reject", "analytics"]);
  const row = (key) => Object.fromEntries(matrix.cols.map((c, i) => [c, matrix.rows.find((r) => r.key === key).cells[i]]));
  assert.deepEqual(row("firstHit").accept, { text: "page_view · ad ✓ an ✓ ud ✓ ap ✓", problem: false });
  // Browsing on is no consent: _ga set after no choice is marked, a session cookie is not.
  assert.deepEqual(row("cookies").ignore, { text: "2: _ga, session", problem: true });
  assert.equal(row("cookies").accept.problem, false);
  // Accepting gave the visitor a new id; without a cookie (reject) a new id per page is what declining asks for.
  assert.deepEqual(row("clientId").accept, { text: "changed", problem: true });
  assert.deepEqual(row("clientId").reject, { text: "changed", problem: false });
  assert.deepEqual(row("clientId").before, { text: "without a cookie", problem: false });
  assert.deepEqual(row("campaign").accept, { text: "lost: utm_source", problem: true });
  assert.equal(row("gclAw").accept.text, "holds the landing gclid");
  assert.equal(row("loaded").before.text, "Google Tag Manager 120 ms · GA4 840 ms");
  assert.equal(row("firstHit").analytics.text, "–");
  const md = consentMatrixMarkdown(en, scenarios).join("\n");
  assert.match(md, /^Each column is a fresh browser that opened https:\/\/shop\.example\/\?gclid=aitd-gclid&utm_source=aitd,/);
  assert.match(md, /^\| GA4 client id \| without a cookie \| kept \| changed ⚠ \| changed \| – \|$/m);
  assert.match(consentMatrixMarkdown(messages("tr"), scenarios).join("\n"), /^\| GA4 istemci kimliği \| çerezsiz \| korundu \| değişti ⚠ \|/m);
  // Captures from before the scenarios recorded facts have no matrix, and no column for the next page without a choice.
  const old = { cmp: "Cookiebot", before: {}, states: { accept: { via: "Cookiebot", after: {} }, reject: { via: "Cookiebot", after: {} }, analytics: { via: null } } };
  assert.equal(consentMatrix(en, old), null);
  assert.deepEqual(consentTable(old).cols, ["before", "accept", "reject", "analytics"]);
});

test("the scenarios start from the ad-click address, or from the caller's own campaign values, or from the plain address", () => {
  const config = { site: "https://shop.example/" };
  assert.match(scenarioLanding(config), /gclid=aitd-gclid/);
  assert.equal(scenarioLanding(config, false), "https://shop.example/");
  assert.equal(scenarioLanding({ ...config, campaign_checks: false }), "https://shop.example/");
  assert.equal(scenarioLanding(config, { utm_source: "newsletter" }), "https://shop.example/?utm_source=newsletter");
});

// A site with a Cookiebot-style API whose GA4 keeps one client id from the cookieless ping to the cookie, and which
// (wrongly) takes browsing on as consent: the second page without a choice sets _ga.
const PAGE = `<!doctype html><html><body><div id="cookie-banner"><button>Accept all</button></div><script>
  var seen = /seen=1/.test(document.cookie), stats = /stats=1/.test(document.cookie) || seen, decided = /decided=1/.test(document.cookie);
  if (!decided) document.cookie = "seen=1; path=/";
  window.Cookiebot = { submitCustomConsent: function (p, s, m) { document.cookie = "decided=1"; document.cookie = "seen=0"; document.cookie = "stats=" + (s ? 1 : 0); } };
  if (stats && !/stats=0/.test(document.cookie)) document.cookie = "_ga=GA1.1.111.222; path=/";
  var gcs = stats && !/stats=0/.test(document.cookie) ? "G111" : "G100";
  fetch("https://www.google-analytics.com/g/collect?v=2&tid=G-TEST&en=page_view&cid=111.222&gcs=" + gcs + "&dl=" + encodeURIComponent(location.href), { mode: "no-cors" }).catch(function () {});
</script></body></html>`;
let server;
let site;
before(async () => {
  server = createServer((req, res) => res.writeHead(200, { "content-type": "text/html" }).end(PAGE));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  site = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server.close());

test("each scenario records its facts from its own browser, and browsing on as consent is caught", async () => {
  const sc = await runConsentScenarios({ site, providers: ["ga4"] }, { campaign: { utm_source: "newsletter", gclid: "test123" }, concurrency: 2 });
  assert.equal(sc.cmp, "Cookiebot");
  assert.equal(sc.landing, `${site}?utm_source=newsletter&gclid=test123`);
  assert.equal(sc.states.ignore.via, "none");
  // Before a choice: a cookieless GA4 hit that kept the campaign parameters.
  assert.deepEqual(sc.beforeFacts.firstHit, { platform: "ga4", event: "page_view", consent: { ad_storage: "denied", analytics_storage: "denied" } });
  assert.deepEqual(sc.beforeFacts.campaign, { kept: ["gclid", "utm_source"], lost: [] });
  assert.ok("ga4" in sc.beforeFacts.loaded);
  // Accepting kept the client id and set _ga.
  assert.equal(sc.states.accept.facts.cookieClientId, "111.222");
  assert.equal(sc.states.accept.facts.clientIdBefore, "111.222");
  assert.ok(sc.states.accept.facts.cookies.includes("_ga"));
  const matrix = consentMatrix(en, sc);
  const cells = (key) => Object.fromEntries(matrix.cols.map((c, i) => [c, matrix.rows.find((r) => r.key === key).cells[i]]));
  assert.deepEqual(cells("clientId").accept, { text: "kept", problem: false });
  // The next page without a choice set _ga and sent with cookies: marked in the matrix and in the tag table.
  assert.equal(cells("cookies").ignore.problem, true);
  assert.equal(consentTable(sc).rows.find((r) => r.platform === "ga4").cells.find((c) => c.state === "ignore").problem, true);
});

test("consent_matrix answers over MCP with the tag table and the matrix", async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildServer({ allowFiles: true, reportsDir: await mkdtemp(path.join(tmpdir(), "atd-")) }).connect(a);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(b);
  const out = (await client.callTool({ name: "consent_matrix", arguments: { site, providers: ["ga4"], campaign: { utm_source: "newsletter" } } })).content[0].text;
  assert.match(out, /^Consent banner answered through: Cookiebot\.$/m);
  assert.match(out, /^\| GA4 page_view \| 1 \| 1 ⚠ \| 1 \| 1 \| 1 \|$/m);
  assert.match(out, /^\| Cookies set \| /m);
  assert.match(out, new RegExp(`opened ${site.replace(/[.?]/g, "\\$&")}\\?utm_source=newsletter,`));
  const none = (await client.callTool({ name: "consent_matrix", arguments: { site: "not a url" } })).content[0].text;
  assert.equal(none, "site must be an http or https URL.");
});
