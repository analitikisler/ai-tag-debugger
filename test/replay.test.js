// A site saved with --save-site is audited again offline, with the same findings.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig, runAudit } from "../src/audit.js";
import { AuditSession } from "../src/browser.js";
import { compareKeys, replaySavedSite, replayableJourney, SAVED_SITE_FILE, writeSavedSite, writeSavedSteps } from "../src/replay.js";

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
  // Asks for the cart with a new timestamp each time, and tags what it gets.
  "/cart": `<!doctype html><script>fetch("/section?sections=cart&_=" + Date.now() + Math.random()).then((r) => r.text()).then((t) => { if (t === "in-cart") { ${send("add_to_cart")} } });</script>`,
  "/section": "in-cart",
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
      { action: "click", selector: "body:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1)", text: "Accept all", reason: "Accept cookies", accepts_consent: true },
      { action: "wait", value: "500", reason: "wait" },
    ]);
  } finally {
    await session.close();
  }
});

test("a saved click keeps no text that looks like an email or phone number, and a field keeps none", async () => {
  const session = new AuditSession({ viewport: "desktop", site: url, providers: ["ga4"] });
  await session.start();
  try {
    await session.act({ action: "goto", url });
    await session.page.evaluate(() => document.body.insertAdjacentHTML("beforeend", '<button>jane@example.org</button><button>Call +90 532 123 45 67</button><input placeholder="Name">'));
    assert.equal(await session.act({ action: "click", text: "jane@example.org" }), null);
    assert.equal(await session.act({ action: "click", text: "Call +90 532 123 45 67" }), null);
    assert.equal(await session.act({ action: "fill", text: "Name", value: "Jane" }), null);
    const steps = replayableJourney({ journeyId: "j", viewport: "desktop", steps: session.steps }).steps;
    assert.deepEqual(steps.map((s) => s.text), [undefined, undefined, undefined]);
    assert.ok(steps.every((s) => s.selector));
  } finally {
    await session.close();
  }
});

test("a saved click whose path no longer matches is found by its text", async () => {
  const session = new AuditSession({ viewport: "desktop", site: url, providers: ["ga4"] });
  await session.start();
  try {
    await session.act({ action: "goto", url });
    // As if a banner added before the button shifted the layout since the site was saved.
    const step = { action: "click", selector: "body:nth-of-type(1) > div:nth-of-type(7) > div:nth-of-type(1)", text: "Accept all", accepts_consent: true };
    assert.equal(await session.act(step), null);
    assert.equal(session.steps.at(-1).foundBy, "text", "the replay summary can say the click was found by its text");
    await session.act({ action: "wait", value: "500" });
    assert.ok(session.hits.some((h) => h.name === "consent_given"));
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

test("a replay answers a request that only differs by its timestamp from the recording", async () => {
  const har = path.join(dir, "stamped.har");
  const record = new AuditSession({ viewport: "desktop", site: url, providers: ["ga4"], recordHar: har });
  await record.start();
  try {
    await record.act({ action: "goto", url: `${url}cart` });
    await record.act({ action: "wait", value: "500" });
    assert.ok(record.hits.some((h) => h.name === "add_to_cart"));
  } finally {
    await record.close();
  }
  const replay = new AuditSession({ viewport: "desktop", site: url, providers: ["ga4"], replayHar: har });
  await replay.start();
  try {
    await replay.act({ action: "goto", url: `${url}cart` });
    await replay.act({ action: "wait", value: "500" });
    assert.ok(replay.hits.some((h) => h.name === "add_to_cart"), "the recorded answer is used although the timestamp is new");
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

test("a replay repeats failed steps, late tags, left-out media, unanswered requests, refused redirects and unfinished journeys as they were", async () => {
  const late = await mkdtemp(path.join(tmpdir(), "atd-replay-late-"));
  let slowAsked = 0;
  const lateServer = createServer((req, res) => {
    if (req.url === "/slow.js" && !slowAsked++) return; // the first request gets no answer
    // Another host, so the browser may not open it. Only the first hop is checked when saved, so it loads then.
    if (req.url === "/moved") return res.writeHead(301, { location: `http://localhost:${lateServer.address().port}/late` }).end();
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
        { id: "moved", start: "/moved", steps: [{ action: "click", selector: "#buy", reason: "Add to cart" }] },
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
    assert.equal(capture.runs[4].completed, false, "a saved redirect off the site is refused again instead of ending the replay");
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

test("--save-steps writes the steps taken into a new config that a run without AI repeats", async () => {
  const out = await mkdtemp(path.join(tmpdir(), "atd-steps-"));
  // Its own server, since an earlier test closes the shared one.
  const own = createServer((req, res) => {
    const page = PAGES[new URL(req.url, "http://x").pathname];
    res.writeHead(page === undefined ? 404 : 200, { "content-type": req.url.endsWith(".js") ? "text/javascript" : "text/html" }).end(page ?? "");
  });
  await new Promise((r) => own.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${own.address().port}/`;
  try {
    const config = { site: url, providers: ["ga4"], journeys: [{ id: "browse", goal: "Accept cookies and open a product", steps: [{ action: "click", text: "Accept all", accepts_consent: true }, { action: "click", text: "Product" }] }] };
    const plan = { events: [{ platform: "ga4", name: "view_item", journeys: ["browse"] }] };
    const first = await runAudit({ config, plan, scripted: true, ai: false, outDir: path.join(out, "first") });
    const file = path.join(out, "saved", "steps.json");
    assert.deepEqual(await writeSavedSteps(file, { site: url, plan: first.plan, journeys: first.journeys, runs: first.runs }), { saved: ["browse"], skipped: [] });

    const written = JSON.parse(await readFile(file, "utf8"));
    assert.equal(written.site, url);
    assert.deepEqual(written.plan, plan);
    assert.equal(written.journeys[0].goal, "Accept cookies and open a product");
    assert.equal(written.journeys[0].steps[0].accepts_consent, true);
    assert.equal(written.journeys[0].viewport, undefined);

    const again = await runAudit({ ...(await loadConfig(file)), scripted: true, ai: false, outDir: path.join(out, "again") });
    const names = (r) => r.runs[0].hits.map((h) => h.name).sort();
    assert.ok(again.runs[0].completed, again.runs[0].note);
    assert.deepEqual(names(again), names(first));
    assert.ok(names(again).includes("view_item"));
  } finally {
    own.close();
    await rm(out, { recursive: true, force: true });
  }
});

test("--save-steps replaces only the saved journeys' steps in an existing config", async () => {
  const out = await mkdtemp(path.join(tmpdir(), "atd-steps-"));
  try {
    const file = path.join(out, "site.config.json");
    const existing = {
      site: "https://shop.example",
      plan: "plan.json",
      journeys: [
        { id: "buy", goal: "Buy something", start: "/old", incomplete: "old note", steps: [{ action: "wait", value: "1" }], note: "kept" },
        { id: "other", steps: [{ action: "wait", value: "2" }] },
      ],
    };
    await writeFile(file, JSON.stringify(existing));
    const step = (index, replay, extra = {}) => ({ index, label: `step ${index}`, replay, ...extra });
    const runs = [
      { journeyId: "buy", viewport: "desktop", completed: true, steps: [step(0), step(1, { action: "goto", url: "https://shop.example/p" }), step(2, { action: "click", text: "Add" })] },
      { journeyId: "buy", viewport: "mobile", completed: true, steps: [step(1, { action: "click", text: "Mobile" })] },
      { journeyId: "custom", viewport: "desktop", completed: false, note: "no cart", steps: [step(1, { action: "click", text: "Shop" })] },
      { journeyId: "empty", viewport: "desktop", completed: false, note: "error", steps: [] },
    ];
    const journeys = [{ id: "buy", goal: "Buy something" }, { id: "custom", goal: "Find the cart" }, { id: "empty", goal: "x" }];
    const result = await writeSavedSteps(file, { site: "https://other.example", plan: { events: [{ platform: "ga4", name: "purchase" }] }, journeys, runs });
    assert.deepEqual(result, { saved: ["buy", "custom"], skipped: ["empty"] });
    const written = JSON.parse(await readFile(file, "utf8"));
    assert.equal(written.site, "https://shop.example");
    assert.equal(written.plan, "plan.json", "a plan the config already has is kept");
    assert.deepEqual(written.journeys, [
      { id: "buy", goal: "Buy something", note: "kept", start: "https://shop.example/p", steps: [{ action: "click", text: "Add", reason: "step 2" }] },
      existing.journeys[1],
      { id: "custom", goal: "Find the cart", incomplete: "no cart", steps: [{ action: "click", text: "Shop", reason: "step 1" }] },
    ]);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("compareKeys counts repeats", () => {
  assert.deepEqual(compareKeys(["a", "a", "b"], ["a", "c"]), { missing: ["a", "b"], extra: ["c"] });
});
