// The ai tagging server connection (extension/lib/server.js): which addresses are accepted, which trace belongs to
// which request, what of a trace is kept, and how the panel's model puts it under each hit.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { copyCore } from "../scripts/extension.js";

let S, M;
before(async () => {
  await copyCore();
  S = await import("../extension/lib/server.js");
  M = await import("../extension/panel/model.js");
});

// The shape GET /admin/api/traces/{id} answers with (ai tagging server, src/traces.rs).
const detail = (id, query, { at = 10_000, body = "", path = "/g/collect" } = {}) => ({
  id, at, status: 204, error: null, tenant: null, duration_ms: 12.5,
  request: { method: body ? "POST" : "GET", path, query, headers: [], body, body_truncated: false, remote_address: "1.2.3.4" },
  result: {
    claimed_by: "GA4", client_error: null, response: { status: 204, headers: [], body: "" },
    events: [{ event_name: "page_view", client_id: "9.9" }, { event_name: "scroll" }],
    tags: [
      { tag: "GA4", event: 0, outcome: "success", error: null },
      { tag: "Meta CAPI", event: 0, outcome: "failure", error: "access token rejected" },
      { tag: "GA4", event: 1, outcome: "success", error: null },
    ],
    sends: [
      { from: "GA4", method: "POST", url: "https://region1.google-analytics.com/g/collect?v=2&tid=G-1&cid=9.9", result: { Ok: 204 } },
      { from: "Meta CAPI", method: "POST", url: "https://graph.facebook.com/v19.0/123/events?access_token=secret", result: { Ok: 400 }, detail: "{\"error\":{}}" },
    ],
    logs: ["a log line"],
    triggers: [{ event: 0, tag: "TikTok", fired: false, enabled: true, conditions: [] }, { event: 0, tag: "GA4", fired: true, enabled: true, conditions: [] }],
  },
});

test("only https server addresses are accepted, and http for this computer", () => {
  assert.equal(S.serverOrigin("https://sst.example.com/some/path"), "https://sst.example.com");
  assert.equal(S.serverOrigin("http://localhost:8080"), "http://localhost:8080");
  assert.equal(S.serverOrigin("http://sst.example.com"), null);
  assert.equal(S.serverOrigin("javascript:alert(1)"), null);
  assert.equal(S.serverOrigin("not a url"), null);
  assert.ok(S.isTraceList({ traces: [], latest: 0, oldest: null }));
  assert.ok(!S.isTraceList({ status: "ok" }));
});

test("a trace goes to the request with the same path and query, or the same GA4 cid, page load and hit number", () => {
  const pending = [
    { requestId: "a", path: "/g/collect", query: "v=2&cid=9.9&_p=1&_s=1&en=page_view", t: 10_100 },
    { requestId: "b", path: "/g/collect", query: "v=2&cid=9.9&_p=1&_s=2&en=add_to_cart&ep.user_data.email=jane%40mail.example", t: 11_000 },
  ];
  assert.equal(S.matchTrace(detail(1, "v=2&cid=9.9&_p=1&_s=1&en=page_view"), pending).requestId, "a");
  // The server masks user data in the query it keeps; the GA4 identifiers still match.
  assert.equal(S.matchTrace(detail(2, "v=2&cid=9.9&_p=1&_s=2&en=add_to_cart&ep.user_data.email=%5Bmasked%5D", { at: 11_050 }), pending).requestId, "b");
  // Another visitor's hit, another path, or far away in time is nobody's here.
  assert.equal(S.matchTrace(detail(3, "v=2&cid=5.5&_p=7&_s=1&en=page_view"), pending), null);
  assert.equal(S.matchTrace(detail(4, "v=2&cid=9.9&_p=1&_s=1&en=page_view", { path: "/other" }), pending), null);
  assert.equal(S.matchTrace(detail(5, "v=2&cid=9.9&_p=1&_s=1&en=page_view", { at: 500_000 }), pending), null);
  assert.ok(S.mayMatch({ path: "/g/collect", at: 10_000 }, pending));
  assert.ok(!S.mayMatch({ path: "/admin", at: 10_000 }, pending));
});

test("a kept trace has the client, tags, tags that did not fire and sends, without send queries or logs", () => {
  const t = S.slimTrace(detail(7, "v=2"));
  assert.equal(t.client, "GA4");
  assert.deepEqual(t.events, ["page_view", "scroll"]);
  assert.deepEqual(t.notFired, [{ tag: "TikTok", event: 0, enabled: true }]);
  assert.deepEqual(t.sends.map((s) => `${s.to} ${s.status}`), ["region1.google-analytics.com/g/collect 204", "graph.facebook.com/v19.0/123/events 400"]);
  assert.ok(!JSON.stringify(t).includes("secret"), "the access token in a send's query is not kept");
  assert.ok(!("logs" in t));
  // In a batch, each event gets its own tags and those tags' sends.
  const second = S.traceForEvent(t, 1);
  assert.deepEqual(second.tags.map((x) => x.tag), ["GA4"]);
  assert.deepEqual(second.sends.map((s) => s.from), ["GA4"]);
  assert.equal(S.slimTrace({ id: 8, at: 1, status: 404, error: "unknown host", result: null }).error, "unknown host");
});

test("the panel shows the server's trace under the hit it belongs to, and waits for the rest", () => {
  const srv = "https://sst.shop.example";
  const events = [
    { t: 100, seq: 1, kind: "serverStatus", url: srv, state: "ok", detail: null },
    { t: 110, seq: 2, kind: "step", action: "navigate", url: "https://shop.example/", label: "Opened /" },
    { t: 200, seq: 3, kind: "request", requestId: "r1", method: "POST", url: `${srv}/g/collect?v=2&tid=G-1&cid=9.9&_p=1&_s=1`, body: "en=page_view\nen=scroll" },
    { t: 300, seq: 4, kind: "request", requestId: "r2", method: "GET", url: `${srv}/g/collect?v=2&tid=G-1&cid=9.9&_p=1&_s=3&en=add_to_cart` },
    { t: 1800, seq: 5, kind: "server", requestId: "r1", trace: S.slimTrace(detail(1, "v=2&tid=G-1&cid=9.9&_p=1&_s=1", { body: "en=page_view\nen=scroll" })) },
  ];
  const model = M.buildModel(events);
  assert.equal(model.steps.length, 1, "server events open no step of their own");
  const [pv, scroll, cart] = model.rows.filter((r) => r.kind === "hit");
  assert.equal(pv.route.kind, "aits");
  assert.deepEqual(pv.server.tags.map((x) => `${x.tag}:${x.outcome}`), ["GA4:success", "Meta CAPI:failure"]);
  assert.deepEqual(scroll.server.tags.map((x) => x.tag), ["GA4"]);
  assert.deepEqual(cart.server, { kind: "aits", waiting: true });
  assert.equal(M.routesOf(model).blocks[0].kind, "aits");
  // Without a connected server, nothing changes.
  const plain = M.buildModel(events.filter((e) => !e.kind.startsWith("server")));
  assert.ok(plain.rows.every((r) => r.server === undefined && r.route?.kind !== "aits"));
});

test("a hit whose response named the ai tagging server is marked as its hit, and offers to connect", () => {
  const events = [
    { t: 110, seq: 1, kind: "step", action: "navigate", url: "https://shop.example/", label: "Opened /" },
    { t: 200, seq: 2, kind: "request", requestId: "r1", method: "GET", url: "https://sst.shop.example/g/collect?v=2&tid=G-1&cid=9.9&en=page_view" },
    { t: 250, seq: 3, kind: "status", requestId: "r1", status: 204, software: "ai-tagging-server" },
    { t: 300, seq: 4, kind: "request", requestId: "r2", method: "GET", url: "https://sgtm.other.example/g/collect?v=2&tid=G-1&cid=9.9&en=scroll" },
    { t: 350, seq: 5, kind: "status", requestId: "r2", status: 204 },
  ];
  const model = M.buildModel(events);
  const [ours, theirs] = model.rows.filter((r) => r.kind === "hit");
  assert.equal(ours.route.kind, "aits");
  assert.deepEqual(ours.server, { kind: "aits", detected: true });
  assert.equal(theirs.route.kind, "sgtm");
  assert.equal(theirs.server, undefined);
});
