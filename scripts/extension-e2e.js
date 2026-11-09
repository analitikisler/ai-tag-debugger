// End-to-end check of the Chrome extension: loads extension/ in Chromium exactly as shipped, records a shopping journey
// on the demo shop through the panel, stops, and checks the run, the findings and the report tab. Not part of
// `npm test` (it needs a browser); run it with `npm run test:extension`. Nothing leaves the machine: no proxy is used
// and every host but localhost is unresolvable.
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { copyCore } from "./extension.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOP = path.join(ROOT, "examples", "demo-shop");

// A stand-in for the ai tagging server: /g/collect keeps a trace of each hit, and the admin API answers with them in
// the shape the real server uses (src/traces.rs there), behind the same bearer token check.
const ADMIN_TOKEN = "e2e-admin-token";
const traces = [];
function tagServer(req, res, url) {
  if (url.pathname === "/g/collect") {
    const id = traces.length + 1;
    traces.push({
      id, at: Date.now(), status: 204, error: null,
      request: { method: req.method, path: url.pathname, query: url.search.slice(1), headers: [], body: "" },
      result: {
        claimed_by: "GA4", client_error: null, response: { status: 204 }, events: [{ event_name: url.searchParams.get("en") }],
        tags: [{ tag: "GA4", event: 0, outcome: "success", error: null }],
        sends: [{ from: "GA4", method: "POST", url: "https://region1.google-analytics.com/g/collect", result: { Ok: 204 } }],
        logs: [], triggers: [{ event: 0, tag: "Meta CAPI", fired: false, enabled: true, conditions: [] }],
      },
    });
    res.writeHead(204, { "x-tagging-server": "ai-tagging-server" }).end();
    return true;
  }
  if (!url.pathname.startsWith("/admin/api/traces")) return false;
  if (req.headers.authorization !== `Bearer ${ADMIN_TOKEN}`) { res.writeHead(401).end(); return true; }
  const json = (v) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(v));
  const one = /^\/admin\/api\/traces\/(\d+)$/.exec(url.pathname);
  if (one) return json(traces[Number(one[1]) - 1]), true;
  const after = Number(url.searchParams.get("after") ?? 0);
  json({ traces: traces.filter((t) => t.id > after).reverse().map((t) => ({ id: t.id, at: t.at, path: t.request.path })), latest: traces.length, oldest: traces.length ? 1 : null });
  return true;
}

// A stand-in for Google's server-side GTM under /sgtm: /gtm/debug opens a preview session, a hit that carries the
// preview cookies is queued, and /gtm/get_memo answers with it in the stream's real format (test/fixtures/), or with
// 204 after a while, as the real one does after about 20 s.
const memoTemplate = (await readFile(path.join(ROOT, "test", "fixtures", "sgtm-memo.txt"), "utf8")).replace(/^\)\]\}'\n/, "");
const memoQueue = [];
let memoWaiter = null;
function sgtmServer(req, res, url) {
  if (url.pathname === "/sgtm/gtm/debug") {
    res.writeHead(200, { "content-type": "text/html" }).end('<!DOCTYPE html><html><head><meta name="sgtm:debug-session" content="e2esession01"></head></html>');
    return true;
  }
  if (url.pathname === "/sgtm/g/collect") {
    const cookies = String(req.headers.cookie ?? "");
    if (cookies.includes("gtm_debug=GTM-E2E0001=e2esession01") && cookies.includes("gtm_auth=GTM-E2E0001=e2eauth01")) {
      const path0 = (url.pathname + url.search).replace(/^\/sgtm/, "");
      memoQueue.push(memoTemplate.replace(/\/g\/collect\?v=2[^"]*/g, path0).replace(/1a1bf6d7c7f044b4a1af2/g, `group${memoQueue.length}`));
      memoWaiter?.();
    }
    res.writeHead(200).end();
    return true;
  }
  if (url.pathname === "/sgtm/gtm/get_memo") {
    const answer = () => {
      memoWaiter = null;
      if (!memoQueue.length) return res.writeHead(204).end();
      const all = memoQueue.splice(0).map((t) => Object.values(JSON.parse(t))[0]).flat();
      res.writeHead(200, { "content-type": "application/json" }).end(`)]}'\n${JSON.stringify({ "GTM-E2E0001": all })}`);
    };
    if (memoQueue.length) return answer(), true;
    const timer = setTimeout(answer, 3000);
    memoWaiter = () => { clearTimeout(timer); answer(); };
    return true;
  }
  return false;
}

function serveShop() {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
  const server = createServer(async (req, res) => {
    if (tagServer(req, res, new URL(req.url, "http://x"))) return;
    if (sgtmServer(req, res, new URL(req.url, "http://x"))) return;
    // A page whose Google tag sends to a server-side GTM container under /sgtm, with its cookies.
    if (new URL(req.url, "http://x").pathname === "/sgtm.html") {
      return res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<!doctype html><title>sGTM</title><script>
setTimeout(() => fetch("/sgtm/g/collect?v=2&tid=G-SGTM1&cid=7.7&_p=" + Date.now() + "&_s=1&en=page_view", { credentials: "include", keepalive: true }), 300);
</script>`);
    }
    // A page whose Google tag sends to the site's own server container, as server_container_url makes it.
    if (new URL(req.url, "http://x").pathname === "/sst.html") {
      return res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<!doctype html><title>Server</title><script>
fetch("/g/collect?v=2&tid=G-SST1&cid=9.9&_p=" + Date.now() + "&_s=1&en=page_view", { keepalive: true });
</script>`);
    }
    // A page that sends a GA4 hit as it is left, as gtag's user_engagement does, named after which load of the
    // page sent it, so the recording can tell the page it reloads from the page it records.
    if (new URL(req.url, "http://x").pathname === "/beacon.html") {
      return res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<!doctype html><title>Beacon</title><script>
const ga = (en) => navigator.sendBeacon("https://region1.google-analytics.com/g/collect?v=2&tid=G-BEACON1&cid=1.1&en=" + en);
const n = Number(sessionStorage.getItem("loads") || 0) + 1;
sessionStorage.setItem("loads", n);
addEventListener("pagehide", () => ga("goodbye_load_" + n));
ga("page_view_load_" + n);
</script>`);
    }
    const file = path.join(SHOP, new URL(req.url, "http://x").pathname.replace(/^\/$/, "/index.html"));
    if (!file.startsWith(SHOP + path.sep)) return res.writeHead(403).end();
    let body;
    try { body = await readFile(file); } catch { return res.writeHead(404).end(); }
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" }).end(body);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** The extension's service worker once its extension APIs exist: right after launch, a first call can land before. */
async function workerOf(context) {
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  for (let i = 0; i < 100; i++) {
    if (await sw.evaluate(() => typeof globalThis.chrome?.tabs === "object").catch(() => false)) return sw;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The extension's service worker never got its APIs.");
}

const work = await mkdtemp(path.join(tmpdir(), "aitd-ext-"));
const server = await serveShop();
const base = `http://localhost:${server.address().port}`;
let context;
try {
  await copyCore();
  const launch = (dir, profile) => chromium.launchPersistentContext(path.join(work, profile), {
    channel: "chromium", headless: !process.argv.includes("--headed"),
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`, "--no-proxy-server", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"],
  });

  // As shipped, before anything is recorded: the panel names the site and offers Record.
  const shipped = await launch(path.join(ROOT, "extension"), "profile-shipped");
  try {
    const sw = await workerOf(shipped);
    const page = await shipped.newPage();
    await page.goto(`${base}/`);
    const tab = await sw.evaluate(async (url) => (await globalThis.chrome.tabs.query({ url: `${url}/*` }))[0]?.id, base);
    assert.ok(tab, "the worker can find the tab by its address");
    // The first-run tour is skipped, as a returning user would have; the panel then opens on setup.
    await sw.evaluate(() => globalThis.chrome.storage.local.set({ onboarded: true }));
    const p = await shipped.newPage();
    await p.goto(`chrome-extension://${new URL(sw.url()).host}/panel/panel.html?tab=${tab}`);
    await p.waitForFunction(() => document.getElementById("host").textContent === "localhost", null, { timeout: 10_000 }).catch(() => {});
    assert.equal(await p.textContent("#host"), "localhost", "the panel names the site");
    assert.equal(await p.isEnabled("#record"), true, "Record can be pressed");
  } finally {
    await shipped.close();
  }

  context = await launch(path.join(ROOT, "extension"), "profile");
  const worker = await workerOf(context);
  const id = new URL(worker.url()).host;

  const shop = await context.newPage();
  await shop.goto(`${base}/`);
  const tabId = await worker.evaluate(async (url) => (await globalThis.chrome.tabs.query({ url: `${url}/*` }))[0].id, base);
  await worker.evaluate(() => globalThis.chrome.storage.local.set({ onboarded: true }));
  const panel = await context.newPage();
  const errors = [];
  panel.on("pageerror", (e) => errors.push(e.message));
  await panel.goto(`chrome-extension://${id}/panel/panel.html?tab=${tabId}`);
  // Setup: the plan, then Start recording (the platforms are the ones found on the page, or the defaults).
  await panel.waitForSelector("#record");
  await panel.setInputFiles("#planFile", path.join(ROOT, "examples", "measurement-plan.json"));
  await panel.waitForSelector(".file");
  await panel.click("#record");
  await panel.waitForSelector("#stop:not([hidden])");

  // The journey: accept consent, open a product, add it to the cart, check out and pay.
  await shop.waitForLoadState("load");
  await shop.click("#consent-accept");
  await shop.locator("#products a").first().click();
  await shop.waitForLoadState("load");
  await shop.locator("button", { hasText: /add to cart/i }).first().click();
  await panel.fill("#stepName", "Cart");
  await panel.click("#stepForm button[type=submit]");
  await shop.goto(`${base}/cart.html`);
  await shop.click("#checkout-btn");
  await shop.waitForLoadState("load");
  await shop.fill("[name=name]", "Test");
  await shop.fill("[name=email]", "jane@mail.example");
  await shop.fill("[name=address]", "Test");
  await shop.selectOption("[name=payment]", { index: 1 });
  await shop.click("#checkout-form button[type=submit]");
  await shop.waitForURL(/thanks\.html/);
  await shop.waitForTimeout(1500);

  await panel.click("#stop");
  await panel.waitForSelector("#verdict:not(:empty)", { timeout: 15_000 });
  const result = await panel.evaluate(async () => {
    const { listRecordings, getEvents } = await import("../lib/store.js");
    const { buildRun } = await import("../lib/run.js");
    const { analyze } = await import("../lib/analyze.js");
    const [rec] = await listRecordings();
    const run = buildRun(await getEvents(rec.id), { site: rec.site, startedAt: rec.startedAt });
    const { findings } = analyze(run, { plan: rec.plan?.plan ?? null });
    return { rec: rec.id, steps: run.steps.map((s) => s.label), urls: run.steps.map((s) => s.url ?? ""), hits: run.hits.map((h) => `${h.platform}:${h.name}`), pushes: run.dataLayerLog.length, checks: findings.map((f) => `${f.check}:${f.event ?? ""}`) };
  });
  assert.ok(result.steps.includes("Cart"), "the named step");
  // Steps are named after the page title; the page they are on is in their address.
  assert.ok(result.urls.some((u) => u.includes("thanks.html")), "a step per page load");
  for (const hit of ["ga4:page_view", "ga4:add_to_cart", "ga4:purchase", "meta:Purchase"]) assert.ok(result.hits.includes(hit), hit);
  assert.ok(result.pushes > 10, "dataLayer pushes are recorded without a GTM container");
  assert.ok(result.checks.includes("duplicate:add_to_cart"), "the demo shop's double add_to_cart is caught");

  const report = await context.newPage();
  await report.goto(`chrome-extension://${id}/report/report.html?rec=${encodeURIComponent(result.rec)}&lang=tr`);
  await report.waitForFunction(() => !document.getElementById("frame").hidden);
  const frame = report.frames().find((f) => f.url().endsWith("sandbox.html"));
  await frame.waitForSelector("text=localhost");
  assert.equal(await frame.evaluate(() => document.documentElement.lang), "tr");
  assert.deepEqual(errors, [], "no errors in the panel");
  // Recording starts with a reload: the page being left still sends its goodbye hit (load 1), which belongs to the
  // visit before the recording, so it must not be recorded; the reloaded page's own hit (load 2) must be.
  const beaconTab = await context.newPage();
  await beaconTab.goto(`${base}/beacon.html`);
  const beaconTabId = await worker.evaluate(async (url) => (await globalThis.chrome.tabs.query({ url: `${url}/beacon.html` }))[0].id, base);
  const beaconPanel = await context.newPage();
  await beaconPanel.goto(`chrome-extension://${id}/panel/panel.html?tab=${beaconTabId}`);
  // The site's last recording is on screen; Start over (keeping it in History) goes back to setup.
  await beaconPanel.click("#startOver");
  await beaconPanel.click("#resetGo");
  await beaconPanel.click("#record");
  await beaconPanel.waitForSelector("#stop:not([hidden])");
  await beaconTab.waitForLoadState("load");
  await beaconTab.waitForTimeout(1500);
  await beaconPanel.click("#stop");
  await beaconPanel.waitForTimeout(500);
  const beaconHits = await beaconPanel.evaluate(async () => {
    const { listRecordings, getEvents } = await import("../lib/store.js");
    const [rec] = await listRecordings();
    return (await getEvents(rec.id)).filter((e) => e.kind === "request").map((e) => new URL(e.url).searchParams.get("en"));
  });
  assert.ok(beaconHits.includes("page_view_load_2"), `the reloaded page's hit is recorded (${beaconHits.join(", ")})`);
  assert.ok(!beaconHits.includes("goodbye_load_1"), `the page being left is not (${beaconHits.join(", ")})`);

  // The ai tagging server: connected for the site in the panel, its trace of the page's hit lands under that hit.
  const sstTab = await context.newPage();
  await sstTab.goto(`${base}/sst.html`);
  const sstTabId = await worker.evaluate(async (url) => (await globalThis.chrome.tabs.query({ url: `${url}/sst.html` }))[0].id, base);
  const sstPanel = await context.newPage();
  sstPanel.on("pageerror", (e) => errors.push(e.message));
  await sstPanel.goto(`chrome-extension://${id}/panel/panel.html?tab=${sstTabId}`);
  // Not connected yet: the server's header alone marks the hit as an ai tagging server's and offers to connect.
  await sstPanel.click("#startOver");
  await sstPanel.click("#resetGo");
  await sstPanel.click("#record");
  await sstPanel.waitForSelector("#stop:not([hidden])");
  await sstTab.waitForLoadState("load");
  await sstTab.waitForTimeout(1500);
  await sstPanel.click("#stop");
  await sstPanel.waitForTimeout(500);
  const named = await sstPanel.evaluate(async () => {
    const { listRecordings, getEvents } = await import("../lib/store.js");
    const { buildModel } = await import("./model.js");
    const [rec] = await listRecordings();
    const row = buildModel(await getEvents(rec.id)).rows.find((r) => r.kind === "hit" && r.e.url.includes("G-SST1"));
    return { route: row?.route?.kind, server: row?.server };
  });
  assert.deepEqual(named, { route: "aits", server: { kind: "aits", detected: true } }, "the header names the server");
  await sstPanel.click("#more");
  await sstPanel.click("text=Server container…");
  await sstPanel.fill("#srvUrl", base);
  await sstPanel.fill("#srvToken", "wrong");
  await sstPanel.click("#srvSave");
  await sstPanel.waitForSelector("text=The admin token was refused.");
  await sstPanel.fill("#srvToken", ADMIN_TOKEN);
  await sstPanel.click("#srvSave");
  await sstPanel.waitForSelector(`text=Connected to ${base}`);
  await sstPanel.keyboard.press("Escape");
  await sstPanel.click(".sheet .btn:not(.primary):not(#srvRemove)").catch(() => {});
  await sstPanel.click("#startOver");
  await sstPanel.click("#resetGo");
  await sstPanel.click("#record");
  await sstPanel.waitForSelector("#stop:not([hidden])");
  await sstTab.waitForLoadState("load");
  await sstTab.waitForTimeout(4000);
  await sstPanel.click("#stop");
  await sstPanel.waitForTimeout(2500);
  const sst = await sstPanel.evaluate(async () => {
    const { listRecordings, getEvents } = await import("../lib/store.js");
    const { buildModel } = await import("./model.js");
    const [rec] = await listRecordings();
    const model = buildModel(await getEvents(rec.id));
    const row = model.rows.find((r) => r.kind === "hit" && r.e.url.includes("G-SST1"));
    return { route: row?.route?.kind, client: row?.server?.client, sends: row?.server?.sends?.map((x) => `${x.to} ${x.status}`), notFired: row?.server?.notFired?.map((x) => x.tag) };
  });
  assert.equal(sst.route, "aits", `the hit is marked as sent to the ai tagging server (${JSON.stringify(sst)})`);
  assert.equal(sst.client, "GA4");
  assert.deepEqual(sst.sends, ["region1.google-analytics.com/g/collect 204"]);
  assert.deepEqual(sst.notFired, ["Meta CAPI"]);
  // Opened, the hit shows the server's card.
  await sstPanel.click("#tab-events").catch(() => {});
  await sstPanel.locator(".ev", { hasText: "page_view" }).first().click();
  await sstPanel.waitForSelector("text=Claimed by GA4", { timeout: 5000 });
  if (process.argv.includes("--shots")) {
    await sstPanel.click(".rc-h");
    await sstPanel.screenshot({ path: path.join(process.cwd(), "sst-panel.png"), fullPage: true });
  }
  assert.deepEqual(errors, [], "no errors in the panel");

  // Google's server-side GTM: connected with the preview link, the container's preview of the hit lands under it.
  const gTab = await context.newPage();
  await gTab.goto(`${base}/sgtm.html`);
  const gTabId = await worker.evaluate(async (url) => (await globalThis.chrome.tabs.query({ url: `${url}/sgtm.html` }))[0].id, base);
  const gPanel = await context.newPage();
  gPanel.on("pageerror", (e) => errors.push(e.message));
  await gPanel.goto(`chrome-extension://${id}/panel/panel.html?tab=${gTabId}`);
  await gPanel.click("#more");
  await gPanel.click("text=Server container…");
  await gPanel.fill("#srvUrl", `${base}/sgtm/gtm/debug?id=GTM-E2E0001&gtm_auth=e2eauth01&gtm_preview=env-7&hl=en`);
  await gPanel.click("#srvSave");
  await gPanel.waitForSelector(`text=Connected to ${base}/sgtm`);
  await gPanel.click(".sheet .btn:not(.primary):not(#srvRemove)").catch(() => {});
  await gPanel.click("#startOver");
  await gPanel.click("#resetGo");
  await gPanel.click("#record");
  await gPanel.waitForSelector("#stop:not([hidden])");
  await gTab.waitForLoadState("load");
  await gTab.waitForTimeout(3000);
  await gPanel.click("#stop");
  await gPanel.waitForTimeout(2500);
  const g = await gPanel.evaluate(async () => {
    const { listRecordings, getEvents } = await import("../lib/store.js");
    const { buildModel } = await import("./model.js");
    const [rec] = await listRecordings();
    const row = buildModel(await getEvents(rec.id)).rows.find((r) => r.kind === "hit" && r.e.url.includes("G-SGTM1"));
    return { route: row?.route?.kind, kind: row?.server?.kind, client: row?.server?.client, tags: row?.server?.tags?.map((x) => `${x.tag}:${x.outcome}`), sends: row?.server?.sends?.map((x) => `${x.to} ${x.status}`) };
  });
  // Under a path on the site's own host, the route reads as a gateway; the preview data is the container's all the same.
  assert.deepEqual(g, { route: "gateway", kind: "sgtm", client: "GA4", tags: ["Google Analytics GA4:success"], sends: ["www.google-analytics.com/g/collect 204"] }, "the preview lands under its hit");
  assert.deepEqual((await context.cookies(base)).filter((c) => c.name.startsWith("gtm_")), [], "the browser leaves preview mode when the recording stops");
  assert.deepEqual(errors, [], "no errors in the panel");

  console.log(`ok: ${result.hits.length} hits, ${result.pushes} pushes, ${result.steps.length} steps; findings: ${result.checks.join(", ")}; the reloaded page's goodbye hit was left out; the ai tagging server's trace and the sGTM preview landed under their hits`);
} finally {
  await context?.close();
  server.close();
  await rm(work, { recursive: true, force: true });
}
