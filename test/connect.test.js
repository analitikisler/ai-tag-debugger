// Running audits in the user's own Chrome (--connect): the tool attaches to a Chrome started with a debugging port,
// gives each audit a fresh window, captures as usual, and leaves Chrome running. Only a Chrome on this computer.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { AuditSession, CHROME_START, connectToChrome } from "../src/browser.js";
import { collect } from "../src/agent.js";

const PAGE = `<!doctype html><title>Shop</title><script>
window.dataLayer = window.dataLayer || [];
dataLayer.push({ event: "page_ready" });
document.cookie = "visited=" + (document.cookie.includes("visited=") ? "again" : "first") + "; path=/";
fetch("https://region1.google-analytics.com/g/collect?v=2&tid=G-1&cid=1.2&en=page_view&dl=" + encodeURIComponent(location.href), { method: "POST", keepalive: true });
</script>`;

let server;
let url;
let chrome;
let endpoint;
before(async () => {
  server = createServer((req, res) => res.writeHead(200, { "content-type": "text/html" }).end(PAGE));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}/`;
  // A Chrome the way a user starts one: a debugging port and a profile folder of its own.
  const profile = await mkdtemp(path.join(tmpdir(), "atd-chrome-"));
  chrome = spawn(chromium.executablePath(), ["--headless=new", "--no-sandbox", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 100 && !endpoint; i++) {
    const port = await readFile(path.join(profile, "DevToolsActivePort"), "utf8").then((t) => t.split("\n")[0], () => null);
    if (port) endpoint = `http://127.0.0.1:${port}`;
    else await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(endpoint, "Chrome started with a debugging port");
});
after(() => {
  chrome?.kill();
  server.close();
});

async function audit() {
  const session = new AuditSession({ viewport: "desktop", site: url, providers: ["ga4"], quietMs: 0, connect: endpoint });
  await session.start();
  try {
    await session.act({ action: "goto", url });
    await session.act({ action: "wait", value: "300" });
    const cookie = (await session.context.cookies()).find((c) => c.name === "visited")?.value;
    return { run: collect(session, { id: "browse" }, "desktop"), cookie };
  } finally {
    await session.close();
  }
}

test("each audit runs in a fresh window of the user's Chrome, captures as usual, and leaves Chrome running", async () => {
  const first = await audit();
  assert.deepEqual(first.run.hits.map((h) => `${h.platform} ${h.name}`), ["ga4 page_view"]);
  assert.ok(first.run.dataLayerLog.some((e) => e.value?.event === "page_ready"));
  // The hit was answered inside the browser, as with the tool's own: nothing reached the real account.
  assert.ok(first.run.network.some((c) => c.provider === "ga4" && c.blocked && c.status === 204));
  assert.equal(first.cookie, "first");
  // A second audit is a new visitor: the first one's cookie is gone with its window.
  const second = await audit();
  assert.equal(second.cookie, "first");
  // Chrome is still running, with none of the audits' windows left.
  const version = await fetch(`${endpoint}/json/version`).then((r) => r.status);
  assert.equal(version, 200);
  const browser = await chromium.connectOverCDP(endpoint);
  try {
    assert.equal(browser.contexts().length, 1, "only Chrome's own profile is left");
    assert.ok(!browser.contexts()[0].pages().some((p) => p.url().startsWith(url)));
  } finally {
    await browser.close();
  }
});

test("only a Chrome on this computer, and a missing one says how to start it", async () => {
  await assert.rejects(connectToChrome("http://192.168.1.20:9222"), /^Error: Only a Chrome on this computer can be connected to \(127\.0\.0\.1 or localhost\), not 192\.168\.1\.20:9222\.$/);
  await assert.rejects(connectToChrome("not an address"), /is not an address/);
  const refused = () => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:9222"));
  await assert.rejects(connectToChrome("http://127.0.0.1:9222", { connect: refused, platform: "darwin" }), (err) => {
    assert.match(err.message, /^No Chrome answers at http:\/\/127\.0\.0\.1:9222\/\. Start Chrome with a debugging port/);
    assert.ok(err.message.includes(CHROME_START.darwin));
    return true;
  });
  // A server that blocks private addresses (the HTTP one) never drives a local Chrome.
  await assert.rejects(new AuditSession({ viewport: "desktop", site: url, connect: endpoint, blockPrivate: true }).start(), /only from the CLI or a local MCP server/);
});
