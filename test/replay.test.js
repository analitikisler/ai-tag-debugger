// A site saved with --save-site is audited again offline, with the same findings.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAudit } from "../src/audit.js";
import { AuditSession } from "../src/browser.js";
import { compareKeys, replaySavedSite, replayableJourney, SAVED_SITE_FILE, writeSavedSite } from "../src/replay.js";

const send = (en, extra = "") =>
  `fetch("https://region1.google-analytics.com/g/collect?v=2&tid=G-1&cid=1.2&_s=1&en=${en}${extra}", { method: "POST", keepalive: true });`;
const PAGES = {
  "/": `<!doctype html><script src="/app.js"></script>
<div class="banner"><div class="btn" style="cursor:pointer">Accept all</div></div>
<a href="/product">Product</a><img src="/logo.png">`,
  "/logo.png": "png",
  "/account": `<!doctype html><p>Account</p>`,
  "/api/profile": `{"ok":true}`,
  // Served as a script, so a replay has to answer it from the recording.
  "/app.js": `${send("page_view")}
document.addEventListener("click", (e) => { if (e.target.closest(".btn")) { ${send("consent_given")} } });`,
  // The button only shows once the badge loads, and its tag sends a moment after the click.
  "/late": `<!doctype html><script src="/late.js"></script>`,
  // Asks for the script the page before was still waiting for when it was left.
  "/next": `<!doctype html><script src="/slow.js"></script><p>Next</p>`,
  "/slow.js": "",
  "/late.js": `fetch("/slow.js");
fetch("/badge.svg").then((r) => { if (r.ok) document.body.insertAdjacentHTML("beforeend", '<button id="buy">Add to cart</button>'); });
document.addEventListener("click", (e) => { if (e.target.id === "buy") setTimeout(() => { ${send("add_to_cart")} }, 1500); });`,
  "/badge.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>",
  "/product": `<!doctype html><script>${send("page_view")}${send("view_item")}${send("view_item")}</script><p>Product</p>`,
};

let server;
let url;
let dir;
before(async () => {
  server = createServer((req, res) => {
    const page = PAGES[new URL(req.url, "http://x").pathname];
    if (page === undefined) return res.writeHead(404).end();
    const type = req.url.endsWith(".js") ? "text/javascript" : req.url.endsWith(".png") ? "image/png" : req.url.endsWith(".svg") ? "image/svg+xml" : "text/html";
    const headers = { "content-type": type };
    if (req.url === "/account") headers["set-cookie"] = ["session=s3cret; Path=/; HttpOnly", "auth_token=t0k3n; Path=/", "user=jane%40example.org; Path=/", "country=TR; Path=/"];
    res.writeHead(200, headers).end(page);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}/`;
  dir = await mkdtemp(path.join(tmpdir(), "atd-replay-"));
});
after(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
});

test("a click by ref is saved as a CSS path a scripted run can repeat", async () => {
  const session = new AuditSession({ viewport: "desktop", site: url, providers: ["ga4"] });
  await session.start();
  try {
    await session.act({ action: "goto", url });
    const { elements } = await session.snapshot();
    const ref = Number(elements.split("\n").find((l) => /"Accept all"/.test(l))?.match(/^\[(\d+)\]/)?.[1]);
    assert.equal(await session.act({ action: "click", ref, reason: "Accept cookies", accepts_consent: true }), null);
    await session.act({ action: "wait", value: "500" });
    const journey = replayableJourney({ journeyId: "j", viewport: "desktop", steps: session.steps });
    assert.equal(journey.start, url);
    assert.deepEqual(journey.steps, [
      { action: "click", selector: "body:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1)", reason: "Accept cookies", accepts_consent: true },
      { action: "wait", value: "500", reason: "wait" },
    ]);
  } finally {
    await session.close();
  }
});

test("a recording keeps no session cookies, authorization headers or form data", async () => {
  const har = path.join(dir, "private.har");
  const session = new AuditSession({ viewport: "desktop", site: url, providers: ["ga4"], recordHar: har });
  await session.start();
  try {
    await session.act({ action: "goto", url: `${url}account` });
    await session.page.evaluate(async () => {
      await fetch("/api/profile", { method: "POST", headers: { authorization: "Bearer t0ken" }, body: "email=jane%40example.org" });
      await fetch("/api/profile?email=jane%40example.org");
    });
  } finally {
    await session.close();
  }
  const text = await readFile(har, "utf8");
  for (const secret of ["s3cret", "t0ken", "t0k3n", "jane"]) assert.ok(!text.includes(secret), `${secret} is not in the recording`);
  const entries = JSON.parse(text).log.entries.map((e) => `${e.request.method} ${new URL(e.request.url).pathname}`);
  assert.deepEqual(entries, ["GET /account", "POST /api/profile"]);

  // The cookie the page's scripts can read is still set on replay.
  const replay = new AuditSession({ viewport: "desktop", site: url, providers: ["ga4"], replayHar: har });
  await replay.start();
  try {
    await replay.act({ action: "goto", url: `${url}account` });
    assert.equal(await replay.page.evaluate(() => document.cookie), "country=TR");
  } finally {
    await replay.close();
  }
});

test("a saved site replays offline with the same hits and findings", async () => {
  const config = {
    site: url,
    providers: ["ga4"],
    journeys: [{ id: "browse", steps: [{ action: "click", text: "Accept all", accepts_consent: true }, { action: "click", text: "Product" }, { action: "wait", value: "500" }] }],
  };
  const plan = { events: [{ platform: "ga4", name: "view_item" }, { platform: "ga4", name: "purchase", journeys: ["browse"] }] };
  const saved = await runAudit({ config, plan, scripted: true, ai: false, saveSite: dir, outDir: path.join(dir, "first") });
  const site = JSON.parse(await readFile(path.join(dir, SAVED_SITE_FILE), "utf8"));
  assert.ok(site.expected.includes("broken missing_event browse desktop ga4 purchase"));
  assert.ok(site.expected.includes("warning duplicate browse desktop ga4 view_item"));

  const recorded = JSON.parse(await readFile(path.join(dir, "browse-desktop.har"), "utf8")).log.entries.map((e) => new URL(e.request.url).pathname);
  assert.deepEqual(recorded, ["/", "/app.js", "/product"], "images and tracking requests are left out of the recording");

  server.close(); // the replay must not need the site
  const replay = await replaySavedSite(dir);
  assert.deepEqual({ missing: replay.missing, extra: replay.extra, incomplete: replay.incomplete }, { missing: [], extra: [], incomplete: [] });
  const capture = JSON.parse(await readFile(path.join(dir, "last-replay", "capture.json"), "utf8"));
  const names = (runs) => runs[0].hits.map((h) => h.name).sort();
  assert.deepEqual(names(capture.runs), names(saved.runs));
  assert.ok(names(capture.runs).includes("consent_given"));
});

test("a replay repeats failed steps, late tags, left-out media, unanswered requests and unfinished journeys as they were", async () => {
  const late = await mkdtemp(path.join(tmpdir(), "atd-replay-late-"));
  let slowAsked = 0;
  const lateServer = createServer((req, res) => {
    if (req.url === "/slow.js" && !slowAsked++) return; // the first request gets no answer
    const page = PAGES[new URL(req.url, "http://x").pathname];
    res.writeHead(page === undefined ? 404 : 200, { "content-type": req.url.endsWith(".js") ? "text/javascript" : req.url.endsWith(".svg") ? "image/svg+xml" : "text/html" }).end(page ?? "");
  });
  await new Promise((r) => lateServer.listen(0, "127.0.0.1", r));
  try {
    const config = {
      site: `http://127.0.0.1:${lateServer.address().port}/`,
      providers: ["ga4"],
      journeys: [
        { id: "buy", start: "/late", steps: [{ action: "click", selector: "#buy", reason: "Add to cart" }] },
        { id: "away", start: "https://elsewhere.example/", steps: [{ action: "click", selector: "#buy", reason: "Add to cart" }] },
        { id: "next", start: "/late", steps: [{ action: "goto", url: "/next", reason: "Open the next page" }] },
        { id: "stuck", start: "/late", steps: [{ action: "click", selector: "#checkout", reason: "Check out" }] },
      ],
    };
    const plan = { events: [{ platform: "ga4", name: "add_to_cart" }] };
    const saved = await runAudit({ config, plan, scripted: true, ai: false, saveSite: late, outDir: path.join(late, "first") });
    assert.ok(saved.runs[0].hits.some((h) => h.name === "add_to_cart"), "the tag sent after the last click is captured");
    const site = JSON.parse(await readFile(path.join(late, SAVED_SITE_FILE), "utf8"));
    assert.equal(site.journeys[3].steps[0].optional, true, "a step that failed is optional on replay, so the steps after it still run");
    assert.match(site.journeys[3].incomplete, /Step "Check out" failed/);
    assert.deepEqual(site.journeys[1].steps, [], "a journey whose start page was blocked has no steps to replay");
    assert.match(site.journeys[1].incomplete, /Could not open the start page/);

    lateServer.close();
    lateServer.closeAllConnections();
    const replay = await replaySavedSite(late);
    assert.deepEqual({ missing: replay.missing, extra: replay.extra, incomplete: replay.incomplete }, { missing: [], extra: [], incomplete: [] });
    const capture = JSON.parse(await readFile(path.join(late, "last-replay", "capture.json"), "utf8"));
    assert.ok(capture.runs[0].hits.some((h) => h.name === "add_to_cart"), "the badge left out of the recording still loads, so the button shows");
    assert.equal(capture.runs[1].completed, false);
    assert.equal(capture.runs[3].completed, false);
  } finally {
    lateServer.close();
    lateServer.closeAllConnections();
    await rm(late, { recursive: true, force: true });
  }
});

test("a recording that takes too long to write is skipped instead of stalling the run", async () => {
  const har = path.join(dir, "stuck.har");
  const session = new AuditSession({ viewport: "desktop", site: url, providers: ["ga4"], recordHar: har, closeTimeoutMs: 1000 });
  await session.start();
  await session.act({ action: "goto", url: `${url}account` });
  session.context.close = () => new Promise(() => {}); // as if the browser never finished writing it
  const started = Date.now();
  await session.close();
  assert.ok(Date.now() - started < 10_000, "close() returns");
  await assert.rejects(readFile(har), "no partly written recording is left");
});

test("a site whose recording is missing is not saved", async () => {
  const empty = await mkdtemp(path.join(tmpdir(), "atd-replay-empty-"));
  try {
    const runs = [{ journeyId: "j", viewport: "desktop", completed: true, note: "", steps: [] }];
    await assert.rejects(writeSavedSite(empty, { config: { site: url }, plan: null, runs, findings: [] }), /recording of j \(desktop\) is missing/);
    await assert.rejects(readFile(path.join(empty, SAVED_SITE_FILE)));
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});

test("compareKeys counts repeats", () => {
  assert.deepEqual(compareKeys(["a", "a", "b"], ["a", "c"]), { missing: ["a", "b"], extra: ["c"] });
});
