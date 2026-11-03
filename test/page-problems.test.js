// Pages that are not the site: a bot challenge in its place, or a page that crashed in the browser after its own
// scripts came back as HTML. Each is reported, in findings and MCP step results, and events not seen are unverified.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AuditSession } from "../src/browser.js";
import { checkRun } from "../src/checks.js";
import { stepCapture } from "../src/mcp.js";

const PAGES = {
  // Cloudflare's interstitial: its title and its challenge form.
  "/challenge": { type: "text/html", body: `<!doctype html><title>Just a moment...</title><form id="challenge-form"></form>` },
  // A Next.js page whose chunk comes back as an HTML page; the app then shows its error screen.
  "/crash": { type: "text/html", body: `<!doctype html><title>Shop</title><body><script src="/_next/chunk.js"></script><script>document.body.innerHTML = "<h2>Application error: a client-side exception has occurred (see the browser console for more information).</h2>";</script></body>` },
  "/_next/chunk.js": { type: "text/html", body: "<!doctype html><p>blocked</p>" },
  "/fine": { type: "text/html", body: `<!doctype html><title>Shop</title><p>Welcome</p>` },
};
let server;
let base;
before(async () => {
  server = createServer((req, res) => {
    const page = PAGES[new URL(req.url, "http://x").pathname] ?? PAGES["/fine"];
    res.writeHead(200, { "content-type": page.type, "x-content-type-options": "nosniff" }).end(page.body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function visit(path) {
  const session = new AuditSession({ viewport: "desktop", site: `${base}/`, providers: ["ga4"], quietMs: 0 });
  await session.start();
  try {
    await session.act({ action: "goto", url: `${base}${path}` });
    return session;
  } finally {
    await session.close();
  }
}

test("a bot challenge and a crashed page are recorded on their step, and a normal page is not", async () => {
  const challenge = await visit("/challenge");
  assert.deepEqual(challenge.steps[1].pageProblem, { kind: "challenge", vendor: "Cloudflare" });
  assert.match(stepCapture({ session: challenge }, 1), /^WARNING: the page is a bot challenge from Cloudflare, not the site\./);
  const crash = await visit("/crash");
  assert.deepEqual(crash.steps[1].pageProblem, { kind: "crash", vendor: "Next.js", refusedScripts: 1 });
  assert.match(stepCapture({ session: crash }, 1), /^WARNING: the page crashed in the browser \(the Next\.js error screen\); 1 of its own scripts came back as HTML pages/);
  assert.equal((await visit("/fine")).steps[1].pageProblem, undefined);
});

test("the findings name the problem, and planned events not seen become unverified instead of broken", () => {
  const plan = { events: [{ platform: "ga4", name: "purchase" }] };
  const run = (problem) => ({
    journeyId: "j", viewport: "desktop", completed: true, consentStep: null, hits: [], dataLayerLog: [], cookieLog: [],
    steps: [{ index: 0, label: "start" }, { index: 1, label: "Open the shop", ...(problem ? { pageProblem: problem } : {}) }],
  });
  const found = (r) => checkRun(plan, r).map((f) => `${f.severity}:${f.check}`);
  assert.deepEqual(found(run(null)), ["broken:missing_event"]);
  assert.deepEqual(found(run({ kind: "challenge", vendor: "Cloudflare" })), ["warning:page_blocked", "info:missing_event"]);
  const crashed = checkRun(plan, run({ kind: "crash", vendor: "Next.js", refusedScripts: 3 }));
  assert.deepEqual(crashed.map((f) => `${f.severity}:${f.check}`), ["warning:page_crashed", "info:missing_event"]);
  assert.match(crashed[0].detail, /after 3 of its own scripts came back as HTML pages instead of code/);
  assert.match(crashed[1].detail, /unverified rather than missing/);
  assert.match(checkRun(plan, run({ kind: "challenge", vendor: "DataDome" }), { lang: "tr" })[0].detail, /DataDome bot doğrulamasıydı/);
});
