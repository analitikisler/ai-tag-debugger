// The MCP server, through an in-memory client, against the demo shop.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/mcp.js";

const PORT = 4397;
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
  assert.deepEqual((await client.listTools()).tools.map((t) => t.name), ["start_audit", "browser_action", "get_page", "finish_audit", "make_plan", "what_changed", "run_audit"]);

  let page = await call("start_audit", { site: `http://localhost:${PORT}/`, journey: "browse" });
  const id = page.match(/audit_id: (\w+)/)[1];
  assert.match(page, /meta PageView/);
  page = await call("browser_action", { audit_id: id, action: "click", ref: refIn(page, /Accept all/), reason: "Accept cookies", accepts_consent: true });
  page = await call("browser_action", { audit_id: id, action: "click", ref: refIn(page, /product\.html/), reason: "Open a product" });
  page = await call("browser_action", { audit_id: id, action: "click", ref: refIn(page, /Add to cart/), reason: "Add to cart" });
  assert.match(page, /ga4 add_to_cart \[consent ad_storage=granted/);

  const plan = JSON.stringify({ consent_mode: true, events: [{ platform: "ga4", name: "add_to_cart", required_params: ["currency"] }] });
  const result = await call("finish_audit", { audit_id: id, completed: true, note: "Added.", measurement_plan: plan });
  assert.match(result, /PageView" fired before the visitor accepted cookies/);
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
  const { client, call } = await connect({ allowFiles: false, blockPrivate: true, reportsDir: tmpdir(), dataDir: tmpdir() });
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
