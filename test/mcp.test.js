// The MCP server, through an in-memory client, against the demo shop.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
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
  assert.deepEqual((await client.listTools()).tools.map((t) => t.name), ["start_audit", "browser_action", "get_page", "finish_audit", "run_audit"]);

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
