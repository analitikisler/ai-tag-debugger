import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTrackingRequest, providerOf, vendorOf } from "../src/parsers.js";
import { checkRun } from "../src/checks.js";

const ga4 = (host, path = "/g/collect") => `https://${host}${path}?v=2&tid=G-1&en=purchase`;

test("GA4 hits to a server container are server-side; Google hosts and the tag gateway are not", () => {
  assert.equal(parseTrackingRequest(ga4("sgtm.shop.com"))[0].delivery, "server");
  assert.equal(parseTrackingRequest(ga4("shop.stape.io"))[0].delivery, "server");
  assert.equal(parseTrackingRequest(ga4("region1.google-analytics.com"))[0].delivery, "browser");
  assert.equal(parseTrackingRequest(ga4("shop.com", "/ab12/ag/g/c"))[0].delivery, "browser");
  assert.equal(providerOf(ga4("shop.stape.io")).key, "ga4");
  assert.equal(vendorOf(ga4("sgtm.shop.com")), "Google Analytics (server-side)");
  assert.equal(vendorOf(ga4("shop.com", "/ab12/ag/g/c")), "Google Analytics (Google tag gateway)");
});

test("Stape and Elevar requests are recognised and always shown", () => {
  assert.deepEqual([providerOf("https://shop.stape.io/abc.js").key, providerOf("https://shop.stape.io/abc.js").always], ["stape", true]);
  assert.equal(providerOf("https://shopify-gtm-suite.getelevar.com/configs/x/config.js").key, "elevar");
});

test("Meta eid and TikTok event_id are kept as the event ID", () => {
  const [meta] = parseTrackingRequest("https://www.facebook.com/tr/?id=1&ev=Purchase&eid=abc");
  assert.equal(meta.eventId, "abc");
  const [tt] = parseTrackingRequest("https://analytics.tiktok.com/api/v2/pixel", JSON.stringify({ event: "Purchase", event_id: "t1" }));
  assert.equal(tt.eventId, "t1");
});

const plan = { events: [] };
const run = (hits, network = []) => ({ journeyId: "j", viewport: "desktop", completed: true, steps: [{ index: 1, label: "s" }], dataLayerLog: [], hits, network });
const hit = (platform, name, extra = {}) => ({ platform, name, step: 1, params: {}, url: "https://x/", ...extra });
const checks = (r) => checkRun(plan, r).map((f) => `${f.check}:${f.platform ?? ""}:${f.event ?? ""}`);

test("duplicate check counts distinct event IDs, not repeats of one ID", () => {
  assert.ok(!checks(run([hit("meta", "Purchase", { eventId: "a" }), hit("meta", "Purchase", { eventId: "a" })])).some((c) => c.startsWith("duplicate")));
  assert.ok(checks(run([hit("meta", "Purchase", { eventId: "a" }), hit("meta", "Purchase", { eventId: "b" })])).includes("duplicate:meta:Purchase"));
  assert.ok(checks(run([hit("meta", "Purchase"), hit("meta", "Purchase")])).includes("duplicate:meta:Purchase"));
});

test("reports server-side vs browser events and a missing event ID next to a server setup", () => {
  const r = checkRun(plan, run([hit("ga4", "purchase", { delivery: "server" }), hit("ga4", "scroll", { delivery: "browser" }), hit("meta", "Purchase", { delivery: "browser" })]));
  const split = r.find((f) => f.check === "server_side");
  assert.equal(split.platform, "ga4");
  assert.match(split.detail, /"purchase"/);
  assert.match(split.detail, /"scroll"/);
  assert.ok(r.some((f) => f.check === "dedup_id_missing" && f.platform === "meta"));
  // Browser-only sites and Meta hits that carry an ID stay quiet.
  assert.ok(!checks(run([hit("meta", "Purchase")])).some((c) => c.startsWith("dedup_id_missing")));
  assert.ok(!checks(run([hit("meta", "Purchase", { eventId: "a" })], [{ provider: "stape" }])).some((c) => c.startsWith("dedup_id_missing")));
  assert.ok(checks(run([hit("meta", "Purchase")], [{ provider: "stape" }])).includes("dedup_id_missing:meta:Purchase"));
});

test("with no plan, events are not reported as missing from it", () => {
  assert.ok(!checks(run([hit("ga4", "page_view")])).some((c) => c.startsWith("unplanned_events")));
});

test("the server-side note only names Meta and TikTok when they were checked", () => {
  const r = { ...run([hit("ga4", "page_view", { delivery: "server" })]), providers: ["ga4"] };
  const f = checkRun(plan, r).find((x) => x.check === "server_side");
  assert.ok(!/Meta|TikTok/.test(f.detail), f.detail);
  const all = checkRun(plan, { ...r, providers: ["ga4", "meta"] }).find((x) => x.check === "server_side");
  assert.match(all.detail, /Meta events/);
  assert.doesNotMatch(all.detail, /TikTok/);
});
