// User data sent for ad matching is redacted before it is stored or shown, and plain values are still reported.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AuditSession, MAX_TOTAL_BODIES } from "../src/browser.js";
import { checkRun } from "../src/checks.js";
import { renderMarkdown } from "../src/report.js";
import { resolveProviders } from "../src/parsers.js";
import { redactBody, redactUrl } from "../src/redact.js";

const HASH = "a".repeat(64);

test("emails, phones and user ids are replaced with a marker that keeps the length and whether they look hashed", () => {
  const meta = redactUrl(`https://www.facebook.com/tr/?id=1&ev=Purchase&ud[em]=me%40x.com&ud[ph]=${HASH}&cd[value]=5`);
  assert.doesNotMatch(meta.url, /me%40x\.com|aaaa/);
  assert.match(decodeURIComponent(meta.url), /ud\[em\]=\[redacted:\+8\+chars,\+plain\]/);
  assert.match(decodeURIComponent(meta.url), /cd\[value\]=5/);
  assert.deepEqual(meta.plain, ["ud[em]"]);
  const ga4 = redactBody(`en=purchase&em=tv.1~em.${HASH}&uid=u-123\nen=x&ep.email=me@x.com`);
  assert.doesNotMatch(ga4.text, /me@x|u-123|aaaa/);
  assert.deepEqual(ga4.plain, ["uid", "ep.email"]);
  const tiktok = redactBody(JSON.stringify({ event: "Purchase", context: { user: { email: "me@x.com", phone_number: HASH, ttp: "keep" } }, properties: { value: 5 } }));
  assert.deepEqual(JSON.parse(tiktok.text).context.user, { email: "[redacted: 8 chars, plain]", phone_number: "[redacted: 64 chars, looks hashed]", ttp: "keep" });
  // A body cut at the size limit is not valid JSON, and is still redacted.
  const cut = redactBody('{"event":"Purchase","context":{"user":{"email":"me@x.com","exte');
  assert.doesNotMatch(cut.text, /me@x/);
});

test("planned events for unselected providers are listed in an info line, platforms ignore case, and plan providers are added by default", () => {
  const plan = { events: [{ platform: "GA4", name: "purchase" }, { platform: "pinterest", name: "checkout" }] };
  const run = { journeyId: "j", viewport: "desktop", completed: true, hits: [{ platform: "ga4", name: "purchase", params: {}, step: 1, url: "https://x/g/collect" }], steps: [{ index: 0, label: "start" }, { index: 1, label: "Buy" }], consentStep: null, dataLayerLog: [], providers: ["ga4"] };
  const findings = checkRun(plan, run);
  assert.ok(!findings.some((f) => f.check === "missing_event"), "GA4 in capitals matches ga4 hits");
  assert.match(findings.find((f) => f.check === "planned_out_of_scope").detail, /1 planned event was not checked.*pinterest:checkout/);
  assert.deepEqual(resolveProviders(undefined, plan), ["ga4", "google_ads", "meta", "tiktok", "pinterest"]);
  assert.deepEqual(resolveProviders(["meta"], plan), ["meta"]);
});

test("unhashed user data is still reported as a personal data risk after redaction", () => {
  const run = { journeyId: "j", viewport: "desktop", completed: true, steps: [{ index: 0, label: "start" }, { index: 1, label: "Buy" }], consentStep: 1, dataLayerLog: [],
    hits: [{ platform: "meta", name: "Purchase", params: {}, step: 1, url: "https://www.facebook.com/tr/?ud%5Bem%5D=%5Bredacted%5D", userData: { fields: ["ud[em]"], plain: ["ud[em]"] } }] };
  assert.match(checkRun({ events: [] }, run).find((f) => f.check === "pii").detail, /without hashing it \(ud\[em\]\)/);
});

test("the Markdown report escapes the title and journey id", () => {
  const md = renderMarkdown({ title: "<b>x</b>", generatedAt: "now", findings: [], explained: null, lang: "en", runs: [{ journeyId: "<i>j</i>", viewport: "desktop", completed: true, note: "", steps: [], hits: [], startedAt: 0 }] });
  assert.doesNotMatch(md, /<b>|<i>/);
});

const big = "x".repeat(30 * 1024);
const PAGE = `<!doctype html><script>
  fetch("https://www.facebook.com/tr/?id=1&ev=Purchase&ud[em]=me%40x.com", { mode: "no-cors" });
  navigator.sendBeacon("https://region1.google-analytics.com/g/collect?v=2&tid=G-1", "en=purchase&em=me%40x.com&ep.big=${big}");
  for (let i = 0; i < ${Math.ceil(MAX_TOTAL_BODIES / (30 * 1024)) + 5}; i++) fetch("https://region1.google-analytics.com/g/collect?v=2&tid=G-1", { method: "POST", mode: "no-cors", body: "en=scroll&ep.big=${big}" });
</script>`;
let server;
let url;
before(async () => {
  server = createServer((req, res) => res.writeHead(200, { "content-type": "text/html" }).end(PAGE));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server.close());

test("the browser stores requests redacted, within a total body budget, and flags plain user data on the hit", async () => {
  const session = new AuditSession({ viewport: "desktop", site: url, providers: ["ga4", "meta"] });
  await session.start();
  try {
    await session.act({ action: "goto", url });
    await session.page.waitForTimeout(1500);
    const stored = JSON.stringify({ hits: session.hits, network: session.network });
    assert.doesNotMatch(stored, /me(@|%40)x\.com/);
    assert.ok(session.hits.find((h) => h.platform === "meta").userData.plain.includes("ud[em]"));
    assert.ok(session.hits.find((h) => h.name === "purchase").userData.plain.includes("em"));
    const bodies = session.network.filter((c) => c.postData).reduce((n, c) => n + c.postData.length, 0);
    assert.ok(bodies <= MAX_TOTAL_BODIES + 4096, `stored ${bodies} bytes of bodies`);
    assert.ok(session.network.some((c) => c.bodyDropped));
    assert.notEqual(session.bodyBudgetStep, null);
  } finally {
    await session.close();
  }
});
