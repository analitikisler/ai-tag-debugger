// Choosing providers: only their requests are recorded and checked; the rest are answered locally and counted.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AuditSession } from "../src/browser.js";
import { checkRun } from "../src/checks.js";
import { parseGa4, parseX, providerOf, resolveProviders, DEFAULT_PROVIDERS } from "../src/parsers.js";
import { decodeGa4Item, paramTip } from "../src/glossary.js";

test("providers resolve to the default, reject unknown keys, and requests map to providers", () => {
  assert.deepEqual(resolveProviders(), DEFAULT_PROVIDERS);
  assert.deepEqual(resolveProviders("GA4, meta"), ["ga4", "meta"]);
  assert.throws(() => resolveProviders(["ga4", "myspace"]), /Unknown provider myspace/);
  assert.equal(providerOf("https://www.googletagmanager.com/gtag/js?id=G-1").key, "ga4");
  assert.equal(providerOf("https://www.googletagmanager.com/gtag/js?id=AW-1").key, "google_ads");
  assert.equal(providerOf("https://www.googletagmanager.com/gtm.js?id=GTM-1").always, true);
  assert.equal(providerOf("https://googleads.g.doubleclick.net/pagead/viewthroughconversion/1/").key, "google_ads");
  assert.equal(providerOf("https://td.doubleclick.net/td/rul/1").key, "doubleclick");
  assert.equal(providerOf("https://sgtm.shop.com/g/collect?v=2").key, "ga4");
  assert.equal(providerOf("https://www.clarity.ms/collect").label, "Microsoft Clarity");
  assert.equal(providerOf("https://shop.com/app.js"), null);
});

test("GA4 hits keep their item strings, items decode with custom parameters, and X pixel hits parse", () => {
  const [hit] = parseGa4("https://x.com/g/collect?v=2&tid=G-1&en=add_to_cart&pr1=nmShoe~id42~pr10~qt2~k0size~v0XL~k1color~v1red");
  assert.deepEqual(hit.items, ["nmShoe~id42~pr10~qt2~k0size~v0XL~k1color~v1red"]);
  assert.deepEqual(decodeGa4Item(hit.items[0]), { fields: [["item_name", "Shoe"], ["item_id", "42"], ["price", "10"], ["quantity", "2"]], custom: [["size", "XL"], ["color", "red"]] });
  const [x] = parseX("https://analytics.twitter.com/1/i/adsct?txn_id=o1&event_id=tw-o1-abc&tw_sale_amount=25");
  assert.deepEqual([x.platform, x.name, x.id, x.params.value], ["x", "tw-o1-abc", "o1", "25"]);
  assert.equal(parseX("https://t.co/i/adsct?txn_id=o1&events=%5B%5B%22pageview%22%2C%7B%7D%5D%5D")[0].name, "pageview");
  assert.equal(paramTip("gcs", "tr").startsWith("Consent Mode durumu"), true);
  assert.equal(paramTip("ep.week_type"), "Text event parameter: week_type.");
  assert.equal(paramTip("unknown_thing"), null);
});

test("planned events for providers that were not chosen are not reported missing", () => {
  const plan = { events: [{ platform: "ga4", name: "purchase" }, { platform: "tiktok", name: "CompletePayment" }] };
  const run = { journeyId: "j", viewport: "desktop", completed: true, hits: [], steps: [{ index: 0, label: "start" }], consentStep: null, dataLayerLog: [], providers: ["ga4"] };
  const missing = checkRun(plan, run).filter((f) => f.check === "missing_event").map((f) => f.event);
  assert.deepEqual(missing, ["purchase"]);
});

const PAGE = `<!doctype html><script>
  navigator.sendBeacon("https://region1.google-analytics.com/g/collect?v=2&tid=G-1&en=page_view", "en=scroll\\nen=view_item&pr1=nmShoe~id42");
  new Image().src = "https://www.facebook.com/tr/?id=1&ev=PageView";
  new Image().src = "https://www.clarity.ms/collect?x=1";
  new Image().src = "https://td.doubleclick.net/td/rul/1";
</script>`;
let server;
let url;
before(async () => {
  server = createServer((req, res) => res.writeHead(200, { "content-type": "text/html" }).end(PAGE));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server.close());

test("the browser records only the chosen providers, keeps GA4 batch bodies, and counts the rest per step", async () => {
  const session = new AuditSession({ viewport: "desktop", site: url, providers: ["ga4"] });
  await session.start();
  try {
    await session.act({ action: "goto", url });
    await session.page.waitForTimeout(500);
    assert.deepEqual([...new Set(session.hits.map((h) => h.platform))], ["ga4"]);
    assert.deepEqual(session.hits.map((h) => h.name).sort(), ["scroll", "view_item"]);
    const ga4 = session.network.find((c) => c.provider === "ga4");
    assert.equal(ga4.postData, "en=scroll\nen=view_item&pr1=nmShoe~id42");
    assert.ok(!session.network.some((c) => ["meta", "clarity", "doubleclick"].includes(c.provider)));
    const skipped = session.skipped[session.steps.at(-1).index];
    assert.deepEqual(Object.keys(skipped).sort(), ["DoubleClick", "Meta", "Microsoft Clarity"]);
  } finally {
    await session.close();
  }
});
