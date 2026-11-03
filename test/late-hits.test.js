// Hits that come after a step was reported: a step waits for the tags to go quiet, and a page_view
// that still arrives later, during a wait or a scroll, goes to the step that loaded its page, marked late.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AuditSession } from "../src/browser.js";

const send = (en) =>
  `fetch("https://region1.google-analytics.com/g/collect?v=2&tid=G-1&cid=1.2&_s=1&en=${en}&dl=" + encodeURIComponent(location.href), { method: "POST", keepalive: true, mode: "cors" });`;
const PAGES = {
  "/": `<!doctype html><a id="held" href="/held">held</a> <a id="slow" href="/slow">slow</a>`,
  // gtag holding its page_view for a consent update: dataLayer activity first, the hit a second later.
  "/held": `<!doctype html><p>held</p><script>window.dataLayer = window.dataLayer || []; dataLayer.push({ event: "cmp_loaded" }); setTimeout(() => { ${send("page_view")} }, 1000);</script>`,
  // A page_view much later than any step waits for, then a second one (a virtual page view).
  "/slow": `<!doctype html><p>slow</p><script>setTimeout(() => { ${send("page_view")} }, 2500); setTimeout(() => { ${send("page_view")} }, 5500);</script>`,
};
let server;
let url;
before(async () => {
  server = createServer((req, res) => res.writeHead(200, { "content-type": "text/html" }).end(PAGES[new URL(req.url, "http://x").pathname] ?? ""));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server.close());

test("a step waits until the tags have gone quiet, so a page_view held for consent lands on its click", async () => {
  const session = new AuditSession({ viewport: "desktop", site: url, providers: ["ga4"], quietMs: 2000 });
  await session.start();
  try {
    await session.act({ action: "goto", url });
    await session.act({ action: "click", selector: "#held" });
    const click = session.currentStep;
    const views = session.hits.filter((h) => h.name === "page_view");
    assert.equal(views.length, 1);
    assert.equal(views[0].step, click);
    assert.equal(views[0].late, undefined);
  } finally {
    await session.close();
  }
});

test("a page_view that arrives during a later wait goes to the step that loaded its page, marked late", async () => {
  const session = new AuditSession({ viewport: "desktop", site: url, providers: ["ga4"], quietMs: 300, quietCapMs: 500 });
  await session.start();
  try {
    await session.act({ action: "goto", url });
    await session.act({ action: "click", selector: "#slow" });
    const click = session.currentStep;
    assert.equal(session.hits.filter((h) => h.name === "page_view").length, 0, "the click step was reported before the page_view");
    await session.act({ action: "wait", value: "2500" });
    const wait = session.currentStep;
    const [first] = session.hits.filter((h) => h.name === "page_view");
    assert.equal(first.step, click);
    assert.equal(first.late.during, wait);
    assert.ok(first.late.ms > 0 && first.late.ms < 5000, String(first.late.ms));
    // The page's second page_view is its own event, not a late copy: it stays on the step it came in.
    await session.act({ action: "wait", value: "3000" });
    const second = session.hits.filter((h) => h.name === "page_view")[1];
    assert.equal(second.step, session.currentStep);
    assert.equal(second.late, undefined);
  } finally {
    await session.close();
  }
});
