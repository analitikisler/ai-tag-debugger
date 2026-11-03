// The MCP server, through an in-memory client, against the demo shop.
import { freePort } from "./helpers/free-port.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, hitDetail, stepCapture } from "../src/mcp.js";

const PORT = await freePort();
let server;
before(async () => {
  server = spawn(process.execPath, ["examples/serve.js"], { env: { ...process.env, PORT: String(PORT) }, stdio: "pipe" });
  await new Promise((resolve) => server.stdout.once("data", resolve));
});
after(() => server.kill());

async function connect(opts) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildServer(opts).connect(a);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(b);
  const call = async (name, args) => (await client.callTool({ name, arguments: args })).content[0].text;
  return { client, call };
}

const refIn = (text, pattern) => Number(text.split("\n").find((l) => /^\[\d+\]/.test(l) && pattern.test(l)).match(/^\[(\d+)\]/)[1]);

test("a chat app can drive an audit through the MCP tools", async () => {
  const reportsDir = await mkdtemp(path.join(tmpdir(), "atd-"));
  const { client, call } = await connect({ allowFiles: true, reportsDir });
  assert.deepEqual((await client.listTools()).tools.map((t) => t.name), ["start_audit", "browser_action", "get_page", "get_hit", "get_step", "get_report", "consent_matrix", "finish_audit", "make_plan", "what_changed", "run_audit"]);

  let page = await call("start_audit", { site: `http://localhost:${PORT}/`, journey: "browse" });
  const id = page.match(/audit_id: (\w+)/)[1];
  assert.match(page, /meta PageView/);
  // By default the first page opens like an ad click, as in the CLI.
  assert.match(page, /^Opened like an ad click with gclid=aitd-gclid, fbclid=aitd-fbclid, utm_source=aitd, utm_medium=check, utm_campaign=aitd-campaign-check;/m);
  page = await call("browser_action", { audit_id: id, action: "click", ref: refIn(page, /Accept all/), reason: "Accept cookies", accepts_consent: true });
  // The consent command comes whole, as key=value, not as JSON cut at a fixed length.
  assert.match(page, /- consent update: ad_storage=granted analytics_storage=granted ad_user_data=granted ad_personalization=granted/);
  page = await call("browser_action", { audit_id: id, action: "click", ref: refIn(page, /product\.html/), reason: "Open a product" });
  page = await call("browser_action", { audit_id: id, action: "click", ref: refIn(page, /Add to cart/), reason: "Add to cart" });
  assert.match(page, /\[h\d+\] ga4 add_to_cart \[consent ad_storage=granted/);
  // The step's number and each hit's [h] number lead to the hit in full.
  const step = Number(page.match(/^Step (\d+): "Add to cart"/m)[1]);
  const h = Number(page.match(/\[h(\d+)\] ga4 add_to_cart/)[1]);
  const full = await call("get_hit", { audit_id: id, step, hit: h });
  assert.match(full, new RegExp(`^\\[h${h}\\] ga4 add_to_cart, step ${step} "Add to cart"`));
  assert.match(full, /^Request: .*\/g\/collect/m);
  assert.match(full, /^Event parameters/m);
  assert.match(await call("get_step", { audit_id: id, step }), /ga4 add_to_cart/);
  assert.match((await client.callTool({ name: "get_hit", arguments: { audit_id: id, step, hit: 99 } })).content[0].text, /^Step \d+ has \d+ hits? \(h0 to h\d+\)\.$/);

  const plan = JSON.stringify({ consent_mode: true, events: [{ platform: "ga4", name: "add_to_cart", required_params: ["currency"] }] });
  const finished = (await client.callTool({ name: "finish_audit", arguments: { audit_id: id, completed: true, note: "Added.", measurement_plan: plan } })).content;
  const result = finished[0].text;
  // A timeline comes with the result: one entry per step, with the hits and their consent.
  const timeline = JSON.parse(finished[1].text.replace(/^Timeline \(JSON, one entry per step\):\n/, ""));
  const cart = timeline.find((e) => e.action === "Add to cart");
  assert.ok(cart.hits.some((h) => h.platform === "ga4" && h.event === "add_to_cart" && h.consent.ad_storage === "granted"));
  assert.ok(timeline.find((e) => e.action === "Accept cookies").consent_commands.some((c) => c.update?.ad_storage === "granted"));
  // The report can be read over MCP by the name the result gives.
  const name = result.match(/get_report with report "([^"]+)"/)[1];
  assert.match(await call("get_report", { report: name }), /^# /m);
  assert.equal(JSON.parse(await call("get_report", { report: name, part: "summary" })).site, "localhost");
  const steps = JSON.parse(await call("get_report", { report: name, part: "timeline" }));
  assert.deepEqual(steps[0].steps, timeline);
  assert.match((await client.callTool({ name: "get_report", arguments: { report: "../../etc" } })).content[0].text, /^No report "\.\.\/\.\.\/etc" from this server\. Its reports: /);
  assert.match(result, /Meta "PageView" was sent before the visitor made a consent choice/);
  assert.match(result, /sent 2 times/);
  const reportPath = result.match(/event timeline: (.+report\.html)/)[1];
  assert.ok(existsSync(reportPath));
  assert.match(await call("get_page", { audit_id: id }).catch((e) => e.message), /No open audit/);
});

test("run_audit without a key tells the chat app how to go on, in its own terms", async () => {
  const keys = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENAI_COMPATIBLE_BASE_URL"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  keys.forEach((k) => delete process.env[k]);
  try {
    const { client } = await connect({ allowFiles: true, reportsDir: await mkdtemp(path.join(tmpdir(), "atd-")) });
    const result = await client.callTool({ name: "run_audit", arguments: { config: "examples/demo.config.json", scripted: false } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /No AI provider key.*scripted true.*start_audit/);
    assert.doesNotMatch(result.content[0].text, /--no-ai/);
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  }
});

test("over HTTP, files on the server cannot be read and run_audit is not offered", async () => {
  const { client, call } = await connect({ allowFiles: false, reportsDir: tmpdir() });
  assert.ok(!(await client.listTools()).tools.some((t) => t.name === "run_audit"));
  const page = await call("start_audit", { site: `http://localhost:${PORT}/` });
  const id = page.match(/audit_id: (\w+)/)[1];
  const result = await call("finish_audit", { audit_id: id, completed: false, note: "x", measurement_plan: "/etc/passwd" });
  assert.match(result, /JSON text, not a file path/);
  await call("finish_audit", { audit_id: id, completed: false, note: "x" });
});

test("a ready-made journey brings its goal and expected events", async () => {
  const { call } = await connect({ allowFiles: true, reportsDir: tmpdir() });
  let page = await call("start_audit", { site: `http://localhost:${PORT}/`, journey: "cart" });
  const id = page.match(/audit_id: (\w+)/)[1];
  assert.match(page, /Journey goal: Accept cookies, open any product and add it to the cart/);
  page = await call("browser_action", { audit_id: id, action: "click", ref: refIn(page, /Accept all/), reason: "Accept cookies", accepts_consent: true });
  page = await call("browser_action", { audit_id: id, action: "click", ref: refIn(page, /product\.html/), reason: "Open a product" });
  await call("browser_action", { audit_id: id, action: "click", ref: refIn(page, /Add to cart/), reason: "Add to cart" });
  const result = await call("finish_audit", { audit_id: id, completed: true, note: "Added.", events: ["add_to_cart"] });
  assert.match(result, /"add_to_cart" was sent 2 times/);
  assert.doesNotMatch(result, /PageView/);
});

test("start_audit only opens http and https URLs", async () => {
  const { call } = await connect({ allowFiles: true, reportsDir: tmpdir() });
  assert.match(await call("start_audit", { site: "file:///etc/passwd" }), /http or https/);
});

test("against checks a finished audit against a saved plan, and refuses paths over HTTP", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "atd-"));
  const plansDir = path.join(dataDir, "localhost", "plans", "2026-10-16_0900");
  await mkdir(plansDir, { recursive: true });
  const plan = { site: `http://localhost:${PORT}/`, events: [{ platform: "ga4", name: "add_to_cart", required_params: ["currency"] }, { platform: "ga4", name: "purchase", required_params: ["value"] }] };
  await writeFile(path.join(plansDir, "measurement-plan.json"), JSON.stringify(plan));

  const walk = async (call) => {
    let page = await call("start_audit", { site: `http://localhost:${PORT}/`, journey: "browse" });
    const id = page.match(/audit_id: (\w+)/)[1];
    page = await call("browser_action", { audit_id: id, action: "click", ref: refIn(page, /Accept all/), reason: "Accept cookies", accepts_consent: true });
    page = await call("browser_action", { audit_id: id, action: "click", ref: refIn(page, /product\.html/), reason: "Open a product" });
    await call("browser_action", { audit_id: id, action: "click", ref: refIn(page, /Add to cart/), reason: "Add to cart" });
    return id;
  };

  const { call } = await connect({ allowFiles: true, reportsDir: await mkdtemp(path.join(tmpdir(), "atd-")), dataDir });
  let id = await walk(call);
  const result = await call("finish_audit", { audit_id: id, completed: true, note: "Added.", against: "latest" });
  assert.match(result, /Checked against plan 2026-10-16_0900/);
  assert.match(result, /purchase/);
  const capture = JSON.parse(await readFile(path.join(path.dirname(result.match(/timeline: (.+report\.html)/)[1]), "capture.json"), "utf8"));
  assert.equal(capture.against.plan_id, "2026-10-16_0900");

  id = await walk(call);
  assert.match(await call("finish_audit", { audit_id: id, completed: true, note: "x", against: "2020-01-01_0000" }).catch((e) => e.message), /No plan 2020-01-01_0000 for localhost\. Available: 2026-10-16_0900/);
  await call("finish_audit", { audit_id: id, completed: true, note: "x" }); // a refused finish leaves the audit open; close its browser
  id = await walk(call);
  assert.match(await call("finish_audit", { audit_id: id, completed: true, note: "x", against: "latest", measurement_plan: "{}" }), /either against or measurement_plan/);
  await call("finish_audit", { audit_id: id, completed: true, note: "x" });

  const http = await connect({ allowFiles: false, reportsDir: await mkdtemp(path.join(tmpdir(), "atd-")), dataDir });
  id = await walk(http.call);
  assert.match(await http.call("finish_audit", { audit_id: id, completed: true, note: "x", against: plansDir }), /not a path/);
  assert.match(await http.call("finish_audit", { audit_id: id, completed: true, note: "x", against: "first" }), /Checked against plan 2026-10-16_0900/);
});

test("make_plan drafts and saves a plan, limited to a topic, and finish_audit can check against it", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "atd-"));
  const answer = {
    pages: [{ type: "home", url: `http://localhost:${PORT}/` }],
    events: [
      { name: "view_item", custom: false, description: "Visitor views a product", trigger_page: "product", trigger_element: "page load", parameters: [] },
      { name: "size_guide_open", custom: true, description: "Opens the size guide", trigger_page: "product", trigger_element: "button", parameters: [] },
    ],
    user_properties: [],
  };
  let system;
  const provider = {
    conversation: () => ({ next: async () => ({ toolCalls: [{ id: "c0", name: "finish", input: { success: true, note: "Done." } }], stop: "tool_use" }), addToolResults() {}, addUserText() {} }),
    json: async (req) => ((system = req.system), { value: answer }),
  };
  const { call } = await connect({ allowFiles: true, reportsDir: tmpdir(), dataDir, provider });
  const result = await call("make_plan", { site: `http://localhost:${PORT}/`, topic: "custom-events" });
  assert.match(system, /covers only custom-events/);
  assert.match(result, /Saved plan \S+ \(custom-events only\): 1 events \(1 custom\)/);
  assert.match(result, /ga4 size_guide_open \(custom\)/);
  assert.doesNotMatch(result, /view_item/);
  const id = result.match(/Saved plan (\S+)/)[1];
  assert.ok(existsSync(path.join(dataDir, "localhost", "plans", id, "measurement-plan.json")));
});

test("what_changed returns only the since-last-run diff, and says so when there is nothing to compare", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "atd-"));
  const { call } = await connect({ allowFiles: false, reportsDir: tmpdir(), dataDir });
  assert.match(await call("what_changed", { site: "https://www.example.com/" }), /No saved run/);
  const runs = path.join(dataDir, "example.com", "runs");
  const f = (event) => ({ severity: "broken", check: "missing_event", platform: "ga4", event, detail: `${event} never fired` });
  for (const [id, findings] of [["2026-10-01_0900", [f("purchase")]], ["2026-10-02_0900", [f("add_to_cart")]]]) {
    await mkdir(path.join(runs, id), { recursive: true });
    await writeFile(path.join(runs, id, "capture.json"), JSON.stringify({ findings }));
  }
  const out = await call("what_changed", { site: "https://example.com" });
  assert.match(out, /1 problem fixed, 1 new problem\. Compared with run 2026-10-01_0900.*\(2026-10-02_0900\)/);
  assert.match(out, /Fixed: GA4 purchase/);
  assert.match(out, /New: GA4 add_to_cart/);
  assert.match(await call("what_changed", { site: "https://example.com", language: "tr" }), /1 sorun düzeldi, 1 yeni sorun/);
  assert.equal((await call("what_changed", { site: "nope" })).includes("not a full URL"), true);
});

test("make_plan refuses an unknown topic, a private address over HTTP, and says what to do without a key", async () => {
  const { client } = await connect({ allowFiles: false, blockPrivate: true, reportsDir: tmpdir(), dataDir: tmpdir() });
  const refused = await client.callTool({ name: "make_plan", arguments: { site: "http://127.0.0.1:1/" } });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /limited to public websites/);
  const badTopic = await client.callTool({ name: "make_plan", arguments: { site: "https://example.com", topic: "nope" } });
  assert.equal(badTopic.isError, true);
});

test("make_plan without a key tells the chat app how to go on, in its own terms", async () => {
  const keys = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENAI_COMPATIBLE_BASE_URL"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  keys.forEach((k) => delete process.env[k]);
  try {
    const { client } = await connect({ allowFiles: true, reportsDir: tmpdir(), dataDir: await mkdtemp(path.join(tmpdir(), "atd-")) });
    const result = await client.callTool({ name: "make_plan", arguments: { site: `http://localhost:${PORT}/` } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /No AI provider key.*measurement_plan/);
    assert.doesNotMatch(result.content[0].text, /--no-ai/);
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  }
});

test("a step result keeps page addresses and consent commands whole and lists the calls it read no event from", () => {
  const longUrl = `https://shop.example/landing?${"x".repeat(150)}&utm_source=news&utm_campaign=autumn_sale_2026`;
  const audit = { session: {
    steps: [{ index: 0, label: "Open the start page" }, { index: 1, label: "Wait" }],
    hits: [
      { platform: "ga4", name: "page_view", step: 0, params: { page_location: longUrl, page_referrer: "https://ref.example/", long: "y".repeat(300) }, late: { during: 1, ms: 3200 } },
      { platform: "ga4", name: "scroll", step: 1, params: {} },
    ],
    dataLayerLog: [
      { step: 1, value: ["consent", "update", { ad_storage: "denied", analytics_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", functionality_storage: "granted", security_storage: "granted" }] },
      { step: 1, value: { event: "virtual_page", page: { page_location: longUrl, filler: "z".repeat(300) } } },
    ],
    network: [
      { step: 1, provider: "google_ads", vendor: "Google Ads", url: "https://www.google.com/ccm/collect?en=page_view&gcs=G100&gcd=13p3p3p2p5l1&dma=1" },
      { step: 1, provider: "ga4", vendor: "Google Analytics", url: "https://region1.google-analytics.com/g/collect?v=2&tid=G-X&en=scroll" },
    ],
  } };
  const first = stepCapture(audit, 0);
  assert.ok(first.includes(`page_location=${longUrl}`), "page_location is not cut");
  assert.ok(first.includes("page_referrer=https://ref.example/"));
  assert.match(first, /long=y{100,}…/);
  assert.match(first, /arrived 3\.2 s late, after the step that loaded its page: "Open the start page"/);
  const later = stepCapture(audit, 1);
  assert.match(later, /^Step 1: "Wait"\. Read a hit's full parameters with get_hit/);
  assert.match(later, /Tracking hits sent by this step: 1\n- \[h0\] ga4 scroll/);
  assert.match(later, /belong to the step that loaded their page: ga4 page_view \(step "Open the start page"\)/);
  assert.match(later, /- consent update: ad_storage=denied analytics_storage=denied ad_user_data=denied ad_personalization=denied functionality_storage=granted security_storage=granted/);
  assert.ok(later.includes(`…`) && later.includes(`(page_location=${longUrl})`), "a long push is cut but keeps its page address whole");
  // The Consent Mode ping is listed with its consent parameters; the GA4 hit is not listed twice.
  assert.match(later, /- Google Ads: www\.google\.com\/ccm\/collect \[gcs=G100 gcd=13p3p3p2p5l1 dma=1\] \[consent ad_storage=denied analytics_storage=denied ad_user_data=denied ad_personalization=denied\]/);
  assert.doesNotMatch(later, /region1\.google-analytics\.com/);
});

test("get_hit shows every parameter of a hit's request, its batch position and gcd per signal", () => {
  const url = "https://region1.google-analytics.com/g/collect?v=2&tid=G-X&cid=123.456&sid=789&gcs=G101&gcd=13p3r3z2l5l1&_fv=1&_ss=1&dl=https%3A%2F%2Fshop%2F";
  const hit = { platform: "ga4", name: "scroll", step: 0, url, params: { percent_scrolled: "90" }, consent: { ad_storage: "denied", analytics_storage: "granted" }, protocol: { cid: "123.456", sid: "789", gcs: "G101", gcd: "13p3r3z2l5l1", _fv: "1", _ss: "1" } };
  const audit = { session: {
    steps: [{ index: 0, label: "Read the article" }],
    hits: [{ ...hit, name: "page_view", params: {} }, hit],
    dataLayerLog: [],
    network: [{ step: 0, method: "POST", url, postData: "en=page_view\nen=scroll&epn.percent_scrolled=90", blocked: true }],
  } };
  const detail = hitDetail(audit, 0, 1);
  assert.match(detail, /^\[h1\] ga4 scroll, step 0 "Read the article"$/m);
  assert.match(detail, /^Request: POST https:\/\/region1\.google-analytics\.com\/g\/collect\?.* \(answered locally, never reached the platform\)$/m);
  assert.match(detail, /^gcd 13p3r3z2l5l1: ad_storage p: denied by default, no update; analytics_storage r: denied by default, granted by update; ad_user_data z: a letter this tool doesn't know; ad_personalization l: consent mode not used$/m);
  assert.match(detail, /^Event parameters \(event 2 of 2 in one request\):\n {2}en = scroll\n {2}epn\.percent_scrolled = 90$/m);
  assert.match(detail, /^ {2}cid = 123\.456$/m);
  assert.match(detail, /^ {2}_fv = 1$/m);
  assert.equal(hitDetail(audit, 0, 2), null);
  // The step result names the hit with its [h] number and the protocol fields in short.
  assert.match(stepCapture(audit, 0), /- \[h1\] ga4 scroll \[consent ad_storage=denied analytics_storage=granted\] \{cid=123\.456 sid=789 gcs=G101 gcd=13p3r3z2l5l1 _fv _ss\}: percent_scrolled=90/);
});

test("start_audit opens the site as given with campaign false, and with a campaign's own values when given", async () => {
  const { call } = await connect({ allowFiles: true, reportsDir: await mkdtemp(path.join(tmpdir(), "atd-")) });
  const plain = await call("start_audit", { site: `http://localhost:${PORT}/`, campaign: false });
  assert.doesNotMatch(plain, /Opened like an ad click/);
  assert.match(plain, /^URL: http:\/\/localhost:\d+\/$/m);
  await call("finish_audit", { audit_id: plain.match(/audit_id: (\w+)/)[1], completed: true, note: "Opened." });
  const own = await call("start_audit", { site: `http://localhost:${PORT}/`, campaign: { utm_source: "newsletter", gclid: "test123" } });
  assert.match(own, /^Opened like an ad click with gclid=test123, utm_source=newsletter;/m);
  const result = await call("finish_audit", { audit_id: own.match(/audit_id: (\w+)/)[1], completed: true, note: "Opened." });
  // The campaign checks ran on the landing page and found the parameters kept.
  const reportPath = result.match(/event timeline: (.+report\.html)/)[1];
  const capture = JSON.parse(await readFile(path.join(path.dirname(reportPath), "capture.json"), "utf8"));
  const campaign = capture.findings.filter((f) => f.check.startsWith("campaign_"));
  assert.deepEqual(campaign.map((f) => `${f.severity}:${f.check}`), ["ok:campaign_params"]);
  assert.match(campaign[0].detail, /gclid.*utm_source|utm_source.*gclid/);
});

test("a step result lists its cookie changes by name, the GA4 client id when it changes, and the click ids a consent ping carried", () => {
  const audit = { session: {
    steps: [
      { index: 0, label: "start" },
      { index: 1, label: "Accept", identity: { ga_client_id: "111.222", gcl_aw: "landing" } },
      { index: 2, label: "Next page", identity: { ga_client_id: "111.222", gcl_aw: "landing" } },
      { index: 3, label: "Reset", identity: { ga_client_id: "333.444", gcl_aw: "landing" } },
    ],
    hits: [], dataLayerLog: [],
    cookieChanges: [
      { step: 1, name: "_ga", domain: ".shop", change: "added" },
      { step: 1, name: "_gcl_aw", domain: ".shop", change: "added" },
      { step: 3, name: "_ga", domain: ".shop", change: "changed" },
      { step: 3, name: "prefs", domain: "shop", change: "removed" },
    ],
    network: [
      { step: 1, provider: "google_ads", vendor: "Google Ads", url: "https://www.google.com/ccm/collect?en=consent_update&gclid=aitd-gclid&gclaw=aitd-gclid&gcs=G111" },
      { step: 2, provider: "google_ads", vendor: "Google Ads", url: "https://pagead2.googlesyndication.com/ccm/collect?en=page_view&gclid=0&gcs=G100" },
    ],
  } };
  const accept = stepCapture(audit, 1);
  assert.match(accept, /^Cookies \(names only\): added _ga, _gcl_aw$/m);
  assert.match(accept, /^GA4 client id \(_ga\) 111\.222, new at this step; _gcl_aw holds the landing gclid\.$/m);
  assert.match(accept, /\[gcs=G111 gclid=aitd-gclid gclaw=aitd-gclid\]/);
  // Nothing changed at step 2: no cookie lines; the redacted gclid is named.
  const next = stepCapture(audit, 2);
  assert.doesNotMatch(next, /Cookies|client id/);
  assert.match(next, /\[gcs=G100 gclid=0 \(redacted\)\]/);
  const reset = stepCapture(audit, 3);
  assert.match(reset, /^Cookies \(names only\): changed _ga; removed prefs$/m);
  assert.match(reset, /^GA4 client id \(_ga\) 333\.444, changed from 111\.222; _gcl_aw holds the landing gclid\.$/m);
});

test("a compact page view lists 40 off-screen elements at most and leaves out what the last view already showed", async () => {
  const links = Array.from({ length: 120 }, (_, i) => `<p style="margin:40px 0"><a href="/p${i}">Product ${i}</a></p>`).join("");
  const page = `<!doctype html><button id="b" onclick="document.getElementById('t').textContent='Added'">Add</button><p id="t">Ready</p>${links}`;
  const site = createServer((req, res) => res.writeHead(200, { "content-type": "text/html" }).end(page));
  await new Promise((r) => site.listen(0, "127.0.0.1", r));
  try {
    const { call } = await connect({ allowFiles: true, reportsDir: await mkdtemp(path.join(tmpdir(), "atd-")) });
    const first = await call("start_audit", { site: `http://127.0.0.1:${site.address().port}/`, campaign: false });
    const id = first.match(/audit_id: (\w+)/)[1];
    const offscreen = (view) => view.split("\n").filter((l) => /^\[\d+\].*\(not in view\)$/.test(l)).length;
    assert.equal(offscreen(first), 40);
    assert.match(first, /more elements not listed/);
    // Nothing changed: neither the text nor the elements are sent again.
    const waited = await call("browser_action", { audit_id: id, action: "wait", value: "200", reason: "Wait" });
    assert.match(waited, /Visible text:\n\(unchanged since the last page view\)/);
    assert.match(waited, /Interactive elements:\n\(unchanged since the last page view: the same refs still apply\)/);
    // The text changed, the elements did not.
    const added = await call("browser_action", { audit_id: id, action: "click", text: "Add", reason: "Add" });
    assert.match(added, /Visible text:\n[^(]*Added/);
    assert.match(added, /Interactive elements:\n\(unchanged since the last page view/);
    // get_page shows everything, and so does detail full.
    const full = await call("get_page", { audit_id: id });
    assert.ok(offscreen(full) > 100, String(offscreen(full)));
    assert.match(full, /Visible text:\n[^(]*Added/);
    assert.ok(offscreen(await call("browser_action", { audit_id: id, action: "wait", value: "100", reason: "Wait", detail: "full" })) > 100);
    await call("finish_audit", { audit_id: id, completed: true, note: "Done." });
  } finally {
    site.close();
  }
});

test("a live audit lets tracking requests through, only where the server allows it, and the result and report say so", async () => {
  let received = 0;
  const site = createServer((req, res) => {
    if (req.url.startsWith("/g/collect")) {
      received++;
      return res.writeHead(204).end();
    }
    res.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><p>shop</p><script>fetch("/g/collect?v=2&tid=G-TEST&en=page_view&dl=" + encodeURIComponent(location.href), { method: "POST", keepalive: true });</script>`);
  });
  await new Promise((r) => site.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${site.address().port}/`;
  try {
    const reportsDir = await mkdtemp(path.join(tmpdir(), "atd-"));
    const locked = await connect({ allowFiles: false, reportsDir, allowLive: false });
    assert.match((await locked.client.callTool({ name: "start_audit", arguments: { site: url, live: true } })).content[0].text, /^Live audits are off on this server: it was started without --allow-live\./);

    const { call } = await connect({ allowFiles: true, reportsDir, allowLive: true });
    const quiet = await call("start_audit", { site: url, campaign: false });
    assert.match(quiet, /ga4 page_view/);
    assert.equal(received, 0, "answered locally by default");
    await call("finish_audit", { audit_id: quiet.match(/audit_id: (\w+)/)[1], completed: true, note: "Opened." });

    const page = await call("start_audit", { site: url, campaign: false, live: true });
    assert.match(page, /^LIVE: tracking requests go to the real analytics and ad accounts/m);
    assert.ok(received >= 1, "the hit reached the site's endpoint");
    const result = await call("finish_audit", { audit_id: page.match(/audit_id: (\w+)/)[1], completed: true, note: "Opened." });
    assert.match(result, /^LIVE: /);
    const md = await readFile(path.join(path.dirname(result.match(/event timeline: (.+report\.html)/)[1]), "report.md"), "utf8");
    assert.match(md, /^\*\*Live run: tracking requests reached the real analytics and ad accounts/m);
  } finally {
    site.close();
  }
});
