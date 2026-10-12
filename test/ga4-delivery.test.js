// GA4 requests the way gtag.js sends them: keepalive fetches, a companion copy to
// www.google.com/g/collect, and a page_view sent just before the page navigates away.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AuditSession } from "../src/browser.js";

const send = (en, host = "region1.google-analytics.com") =>
  `fetch("https://${host}/g/collect?v=2&tid=G-1&cid=1.2&_s=1&en=${en}", { method: "POST", keepalive: true, credentials: "include", mode: "cors" });`;
const PAGES = {
  "/": `<!doctype html><a id="next" href="/leave">next</a><script>${send("page_view")}${send("demo_open")}${send("demo_open", "www.google.com")}${send("view_item", "region1.analytics.google.com")}${send("scroll", "stats.g.doubleclick.net")}</script>`,
  // Sends its page_view and leaves at once, like a redirect page or a fast click.
  "/leave": `<!doctype html><script>${send("page_view")}location.href = "/done";</script>`,
  "/done": `<!doctype html><p>done</p>`,
};
let server;
let url;
before(async () => {
  server = createServer((req, res) => res.writeHead(200, { "content-type": "text/html" }).end(PAGES[new URL(req.url, "http://x").pathname] ?? ""));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server.close());

test("GA4 keepalive requests count once, companion copies are not hits, and a page_view sent while leaving is kept", async () => {
  const session = new AuditSession({ viewport: "desktop", site: url, providers: ["ga4"], blockHits: true });
  await session.start();
  try {
    await session.act({ action: "goto", url });
    await session.act({ action: "click", selector: "#next" });
    await session.page.waitForURL(/\/done$/);
    await session.page.waitForTimeout(500);
    assert.deepEqual(session.hits.map((h) => h.name).sort(), ["demo_open", "page_view", "page_view", "view_item"]);
    // The companion request is still answered locally and listed, but not as a hit.
    const companion = session.network.find((c) => c.url.startsWith("https://www.google.com/g/collect"));
    assert.ok(companion?.blocked);
    // Answered requests show the 204 the page received, not "failed".
    assert.ok(session.network.filter((c) => c.blocked).every((c) => c.status === 204), JSON.stringify(session.network.map((c) => c.status)));
  } finally {
    await session.close();
  }
});
