// Server-side GTM's preview stream (extension/lib/sgtm.js): the preview link, the /gtm/get_memo answer recorded from
// a real server container (cleaned of its preview token and request headers), and how the panel shows it per hit.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { copyCore } from "../scripts/extension.js";

let G, M, memo;
before(async () => {
  await copyCore();
  G = await import("../extension/lib/sgtm.js");
  M = await import("../extension/panel/model.js");
  memo = await readFile(new URL("./fixtures/sgtm-memo.txt", import.meta.url), "utf8");
});

test("the preview link Tag Manager opens gives the server, the container and its preview environment", () => {
  assert.deepEqual(G.previewLink("https://sgtm.shop.example/gtm/debug?id=GTM-ABCD123&gtm_auth=AUTHAUTHAUTH&gtm_preview=env-12&canonicalId=1&hl=en-GB"),
    { url: "https://sgtm.shop.example", id: "GTM-ABCD123", auth: "AUTHAUTHAUTH", env: "env-12" });
  assert.equal(G.previewLink("https://shop.example/metrics/gtm/debug?id=GTM-ABCD123&gtm_auth=AUTHAUTHAUTH&gtm_preview=env-3").url, "https://shop.example/metrics");
  assert.equal(G.previewLink("http://sgtm.shop.example/gtm/debug?id=GTM-ABCD123&gtm_auth=AUTHAUTHAUTH&gtm_preview=env-12"), null, "https only");
  assert.equal(G.previewLink("https://sgtm.shop.example/gtm/debug?id=GTM-ABCD123"), null, "no auth");
  assert.equal(G.previewLink("https://sst.example.com"), null, "an ai tagging server address is no preview link");
  assert.equal(G.previewQuery({ id: "GTM-ABCD123", auth: "a1b2c3", env: "env-1" }), "id=GTM-ABCD123&gtm_auth=a1b2c3&gtm_preview=env-1");
  assert.equal(G.sessionOf('<meta name="sgtm:debug-session" content="1a1bf6cf28eb3401b5b75">'), "1a1bf6cf28eb3401b5b75");
  assert.equal(G.sessionOf("<html><body>not a container</body></html>"), null);
});

test("a real get_memo answer becomes the request's client, tag outcome, send and cookies", () => {
  const messages = G.parseMemo(memo);
  assert.equal(messages.length, 9);
  const groups = {};
  assert.deepEqual(G.addMessages(groups, messages), ["1a1bf6d7c7f044b4a1af2"]);
  const g = groups["1a1bf6d7c7f044b4a1af2"];
  assert.match(g.url, /^\/g\/collect\?v=2&tid=G-MNQKGZZ3XE&cid=111\.222&_p=123&_s=1&en=page_view/);
  const t = G.traceOf(g);
  assert.equal(t.kind, "sgtm");
  assert.equal(t.client, "GA4");
  assert.deepEqual(t.events, ["page_view"]);
  assert.deepEqual(t.tags.map((x) => `${x.tag}:${x.outcome}`), ["Google Analytics GA4:success"], "the last status wins over running");
  assert.deepEqual(t.notFired, []);
  assert.deepEqual(t.sends.map((s) => `${s.method} ${s.to} ${s.status} ${s.from}`), ["POST www.google-analytics.com/g/collect 204 Google Analytics GA4"]);
  assert.deepEqual(t.cookies, ["FPID"]);
  assert.equal(t.status, 200);
  assert.ok(!JSON.stringify(t).includes("FPID2."), "a cookie's name is kept, never its value");
  assert.deepEqual(G.parseMemo(""), [], "an empty poll (204)");
  assert.deepEqual(G.parseMemo(")]}'\nnot json"), []);
});

test("a batch's events get their own tags, a tag that never started did not fire, and later polls add to a request", () => {
  const messages = G.parseMemo(memo);
  // The same request as a batch of two events: the second event's tag never starts.
  const second = messages.filter((m) => m.messageType === "EVENT_STARTED").map((m) => ({ ...m, key: { ...m.key, eventId: 42 }, eventData: { ...m.eventData, event_name: "scroll" } }));
  const groups = {};
  G.addMessages(groups, [...messages.filter((m) => m.messageType !== "ASYNC_ACTION_RESOLVED"), ...second]);
  let t = G.traceOf(groups["1a1bf6d7c7f044b4a1af2"]);
  assert.deepEqual(t.events, ["page_view", "scroll"]);
  assert.deepEqual(t.notFired, [{ tag: "Google Analytics GA4", event: 1, enabled: true }]);
  assert.deepEqual(t.sends, [], "the send has not been answered yet");
  // The next poll brings the send.
  G.addMessages(groups, messages.filter((m) => m.messageType === "ASYNC_ACTION_RESOLVED"));
  t = G.traceOf(groups["1a1bf6d7c7f044b4a1af2"]);
  assert.equal(t.sends.length, 1);
});

test("the panel shows the preview under the hit it belongs to, keeping the server-side GTM route", () => {
  const groups = {};
  G.addMessages(groups, G.parseMemo(memo));
  const srv = "https://sgtm.shop.example";
  const events = [
    { t: 100, seq: 1, kind: "serverStatus", url: srv, server: "sgtm", state: "ok", detail: null },
    { t: 110, seq: 2, kind: "step", action: "navigate", url: "https://shop.example/", label: "Opened /" },
    { t: 200, seq: 3, kind: "request", requestId: "r1", method: "GET", initiator: "https://shop.example", url: `${srv}/g/collect?v=2&tid=G-MNQKGZZ3XE&cid=111.222&_p=123&_s=1&en=page_view` },
    { t: 300, seq: 4, kind: "request", requestId: "r2", method: "GET", initiator: "https://shop.example", url: `${srv}/g/collect?v=2&tid=G-MNQKGZZ3XE&cid=111.222&_p=123&_s=2&en=scroll` },
    { t: 900, seq: 5, kind: "server", requestId: "r1", trace: G.traceOf(groups["1a1bf6d7c7f044b4a1af2"]) },
  ];
  const [pv, scroll] = M.buildModel(events).rows.filter((r) => r.kind === "hit");
  assert.equal(pv.route.kind, "sgtm");
  assert.equal(pv.server.kind, "sgtm");
  assert.deepEqual(pv.server.cookies, ["FPID"]);
  assert.deepEqual(scroll.server, { kind: "sgtm", waiting: true });
});

test("a preview found in the tabs is offered to its own site, and a newer link replaces a connection's old one", async () => {
  const { siteOf } = await import("../extension/core/redact.js");
  const previews = [
    { url: "https://sgtm.other.example", id: "GTM-OTHER11", auth: "a1b2c3d4", env: "env-1", at: 3 },
    { url: "https://sgtm.shop.example", id: "GTM-SHOP111", auth: "olderauth", env: "env-4", at: 1 },
    { url: "https://sgtm.shop.example", id: "GTM-SHOP222", auth: "neweraut", env: "env-5", at: 2 },
  ];
  assert.equal(G.previewForSite(previews, "www.shop.example", siteOf).id, "GTM-SHOP222", "the newest one on the site's domain");
  assert.equal(G.previewForSite(previews, "elsewhere.example", siteOf), null);
  const servers = { "shop.example": { kind: "sgtm", url: "https://sgtm.shop.example", id: "GTM-SHOP111", auth: "olderauth", env: "env-4" }, "aits.example": { kind: "aits", url: "https://sst.aits.example", token: "t" } };
  const fresh = G.freshen(servers, { url: "https://sgtm.shop.example", id: "GTM-SHOP111", auth: "brandnew1", env: "env-9" });
  assert.deepEqual(fresh["shop.example"], { kind: "sgtm", url: "https://sgtm.shop.example", id: "GTM-SHOP111", auth: "brandnew1", env: "env-9" });
  assert.deepEqual(fresh["aits.example"], servers["aits.example"]);
  assert.equal(G.freshen(servers, { url: "https://sgtm.shop.example", id: "GTM-SHOP111", auth: "olderauth", env: "env-4" }), null, "the same link changes nothing");
  assert.equal(G.freshen(servers, { url: "https://sgtm.shop.example", id: "GTM-OTHER11", auth: "x1y2z3w4", env: "env-1" }), null, "another container is not this connection");
  assert.equal(G.previewUrl({ url: "https://sgtm.shop.example", id: "GTM-SHOP111", auth: "olderauth", env: "env-4" }), "https://sgtm.shop.example/gtm/debug?id=GTM-SHOP111&gtm_auth=olderauth&gtm_preview=env-4");
});
