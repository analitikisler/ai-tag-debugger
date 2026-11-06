// End-to-end check of the Chrome extension: loads extension/ in Chromium, records a shopping journey on the demo shop
// through the panel, stops, and checks the run, the findings and the report tab. Not part of `npm test` (it needs a
// browser); run it with `npm run test:extension`. Nothing leaves the machine: no proxy is used and every host but localhost is unresolvable.
//
// A headless browser cannot answer Chrome's permission prompt, so the test loads a temporary copy of the extension
// with the optional host access granted at install. Everything else is the extension as shipped.
import { createServer } from "node:http";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { copyCore } from "./extension.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOP = path.join(ROOT, "examples", "demo-shop");

function serveShop() {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
  const server = createServer(async (req, res) => {
    const file = path.join(SHOP, new URL(req.url, "http://x").pathname.replace(/^\/$/, "/index.html"));
    if (!file.startsWith(SHOP + path.sep)) return res.writeHead(403).end();
    let body;
    try { body = await readFile(file); } catch { return res.writeHead(404).end(); }
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" }).end(body);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
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

  // As shipped, before any site access is granted: the panel must know the tab's site and offer Record, which is
  // what asks for access. (A panel that can't read the address until access is granted never gets to ask.)
  const shipped = await launch(path.join(ROOT, "extension"), "profile-shipped");
  try {
    const sw = shipped.serviceWorkers()[0] ?? (await shipped.waitForEvent("serviceworker"));
    const page = await shipped.newPage();
    await page.goto(`${base}/`);
    const tab = await sw.evaluate(async (url) => (await globalThis.chrome.tabs.query({ url: `${url}/*` }))[0]?.id, base);
    assert.ok(tab, "the worker can find the tab by its address");
    const p = await shipped.newPage();
    await p.goto(`chrome-extension://${new URL(sw.url()).host}/panel/panel.html?tab=${tab}`);
    await p.waitForFunction(() => document.getElementById("host").textContent !== "");
    assert.equal(await p.textContent("#host"), "localhost", "the panel names the site before access is granted");
    assert.equal(await p.isEnabled("#record"), true, "Record can be pressed before access is granted");
  } finally {
    await shipped.close();
  }

  const ext = path.join(work, "extension");
  await cp(path.join(ROOT, "extension"), ext, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(ext, "manifest.json"), "utf8"));
  manifest.host_permissions = manifest.optional_host_permissions;
  delete manifest.optional_host_permissions;
  await writeFile(path.join(ext, "manifest.json"), JSON.stringify(manifest));

  context = await launch(ext, "profile");
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;

  const shop = await context.newPage();
  await shop.goto(`${base}/`);
  const tabId = await worker.evaluate(async (url) => (await globalThis.chrome.tabs.query({ url: `${url}/*` }))[0].id, base);
  const panel = await context.newPage();
  const errors = [];
  panel.on("pageerror", (e) => errors.push(e.message));
  await panel.goto(`chrome-extension://${id}/panel/panel.html?tab=${tabId}`);
  await panel.setInputFiles("#planFile", path.join(ROOT, "examples", "measurement-plan.json"));
  await panel.click("#record");
  await panel.waitForSelector("#stop:not([hidden])");

  // The journey: accept consent, open a product, add it to the cart, check out and pay.
  await shop.waitForLoadState("load");
  await shop.click("#consent-accept");
  await shop.locator("#products a").first().click();
  await shop.waitForLoadState("load");
  await shop.locator("button", { hasText: /add to cart/i }).first().click();
  await panel.fill("#stepName", "Cart");
  await panel.click("#stepForm button");
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
    return { rec: rec.id, steps: run.steps.map((s) => s.label), hits: run.hits.map((h) => `${h.platform}:${h.name}`), pushes: run.dataLayerLog.length, checks: findings.map((f) => `${f.check}:${f.event ?? ""}`) };
  });
  assert.ok(result.steps.includes("Cart"), "the named step");
  assert.ok(result.steps.some((s) => s.includes("thanks.html")), "a step per page load");
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
  console.log(`ok: ${result.hits.length} hits, ${result.pushes} pushes, ${result.steps.length} steps; findings: ${result.checks.join(", ")}`);
} finally {
  await context?.close();
  server.close();
  await rm(work, { recursive: true, force: true });
}
