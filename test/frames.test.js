// Whose tracking a hit is: hits, pushes and container loads from an iframe carry the frame they came from, and a
// third-party iframe's hits to accounts the site's tags don't use are an embedded widget's. Those are left out of
// the plan checks and kept, labelled, for consent and personal data.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AuditSession } from "../src/browser.js";
import { collect } from "../src/agent.js";
import { checkRun } from "../src/checks.js";
import { isWidgetHit, siteIds, splitRun, widgetsOf } from "../src/frames.js";
import { containerRows } from "../src/containers.js";
import { timelineOf, widgetLines } from "../src/mcp.js";
import { widgetSummaries } from "../src/frames.js";
import { render as renderScope } from "../src/html/scope.js";
import { context } from "../src/html/shell.js";
import { renderMarkdown } from "../src/report.js";

const hit = (tid, en, gcs) => `fetch("https://region1.google-analytics.com/g/collect?v=2&tid=${tid}&cid=1.2&_p=${Math.floor(Math.random() * 1e9)}&gcs=${gcs}&en=${en}&dl=" + encodeURIComponent(location.href), { method: "POST", keepalive: true });`;
const snippet = (id) => `<script>(function(){var j=document.createElement('script');j.async=true;j.src='/gtm.js?id=${id}';document.head.appendChild(j);})();</script>`;

let server;
let url;
let widget;
before(async () => {
  server = createServer((req, res) => {
    const port = server.address().port;
    const html = (body) => res.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html>${body}`);
    // The site: its own GTM and GA4 (consent denied), a form in a same-site iframe, and a booking widget from another site.
    if (req.url === "/") return html(`${snippet("GTM-TOP")}<script>${hit("G-SITE", "page_view", "G100")}</script><iframe src="/form.html"></iframe><iframe src="http://localhost:${port}/widget.html"></iframe>`);
    // The form runs its own container: the page's dataLayer never reaches it.
    if (req.url === "/form.html") return html(`${snippet("GTM-FORM")}<script>dataLayer.push({ event: "form_view" });</script>`);
    // The widget tracks to its own GA4 property, with consent claimed granted before the visitor chose, and also
    // sends a lead to the site's own property, as a booking engine set up with the site's ID does.
    // Its own container, and its own dataLayer: the booking it completes is pushed there, which the page's tags never see.
    if (req.url === "/widget.html") return html(`${snippet("GTM-WIDGET")}<script>dataLayer.push({ event: "widget_ready" }); dataLayer.push({ event: "booking_complete" }); dataLayer.push({ event: "generate_lead" }); ${hit("G-WIDGET", "purchase", "G111")} ${hit("G-SITE", "generate_lead", "G100")}</script>`);
    res.writeHead(200, { "content-type": "application/javascript" }).end("");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}/`;
  widget = `http://localhost:${server.address().port}`;
});
after(() => server.close());

test("a widget's own hits are kept apart from the site's, and still count for consent", async () => {
  const session = new AuditSession({ viewport: "desktop", site: url, providers: ["ga4"], quietMs: 0 });
  await session.start();
  let run;
  try {
    await session.act({ action: "goto", url });
    await session.act({ action: "wait", ms: 500 });
    run = { ...collect(session, { id: "browse" }, "desktop"), completed: true };
  } finally {
    await session.close();
  }
  // Every hit, push and load from an iframe says which, and whose site it is on.
  const purchase = run.widgetHits.find((h) => h.name === "purchase");
  assert.deepEqual(purchase.frame, { origin: widget, party: "third", parent: url });
  assert.deepEqual(run.hits.map((h) => `${h.id} ${h.name} ${h.frame?.party ?? "page"}`).sort(), ["G-SITE generate_lead third", "G-SITE page_view page"]);
  assert.deepEqual(run.widgetHits.map((h) => `${h.id} ${h.name}`), ["G-WIDGET purchase"]);
  assert.ok(run.dataLayerLog.some((e) => e.value?.event === "form_view" && e.frame?.party === "site"));
  assert.ok(run.widgetDataLayerLog.some((e) => e.value?.event === "widget_ready"));
  assert.ok(!run.dataLayerLog.some((e) => e.value?.event === "widget_ready"));
  assert.ok(session.network.some((c) => c.frame?.origin === widget));
  assert.deepEqual(containerRows([run]).map((r) => `${r.id} ${r.frame?.party ?? "page"}`), ["GTM-TOP page", "GTM-FORM site", "GTM-WIDGET third"]);

  const plan = { events: [{ platform: "ga4", name: "purchase" }, { platform: "ga4", name: "generate_lead" }] };
  const findings = checkRun(plan, run);
  const f = (check) => findings.filter((x) => x.check === check);
  // The widget's purchase does not stand in for the site's.
  assert.deepEqual(f("missing_event").map((x) => x.event), ["purchase"]);
  assert.ok(!f("unplanned_events").length);
  // Consent still sees it, and says whose it is.
  assert.equal(f("before_consent").length, 1);
  assert.match(f("before_consent")[0].detail, new RegExp(`^In an embedded widget from ${widget}: GA4 "purchase" was sent although`));
  assert.match(f("widget_tracking")[0].detail, new RegExp(`^An embedded widget from ${widget} sent its own tracking: GA4 \\(G-WIDGET\\) "purchase"\\.`));
  assert.match(f("iframe_container")[0].detail, new RegExp(`^GTM-FORM runs in an iframe from http://127\\.0\\.0\\.1:\\d+ embedded in ${url}\\.`));
  // The widget as a whole: where it sat, its container, its tracking both ways, and its own dataLayer.
  const [w] = widgetSummaries([run]);
  assert.deepEqual({ ...w, step: undefined }, {
    origin: widget, parents: [url], containers: [{ id: "GTM-WIDGET", script: "gtm" }],
    own: [{ platform: "ga4", id: "G-WIDGET", events: ["purchase"] }],
    shared: [{ platform: "ga4", id: "G-SITE", events: ["generate_lead"] }],
    pushes: { total: 3, consent: 0, events: [{ name: "widget_ready", count: 1 }, { name: "booking_complete", count: 1 }, { name: "generate_lead", count: 1 }] },
    unshared: ["widget_ready", "booking_complete"],
    step: undefined,
  });
  assert.match(f("widget_events_unshared")[0].detail, new RegExp(`^An embedded widget from ${widget} pushed "widget_ready", "booking_complete" to its own dataLayer, but none of its hits to the site's accounts carried them\\.`));
  const html = renderScope(context({ title: "t", generatedAt: "now", findings, explained: null, runs: [run] }));
  assert.match(html, /id="inv-widgets"><summary><span class="t">Embedded widgets<\/span>/);
  assert.match(html, /<code>GA4 G-WIDGET: purchase<\/code>/);
  assert.match(html, /Not sent to the site&#39;s accounts<\/span><code>widget_ready<\/code> <code>booking_complete<\/code>|Not sent to the site's accounts<\/span><code>widget_ready<\/code> <code>booking_complete<\/code>/);
  const md = renderMarkdown({ title: "t", generatedAt: "now", findings, explained: null, runs: [run] });
  assert.match(md, new RegExp(`## Embedded widgets\\n\\n\\| Widget \\| Embedded in \\| Own tracking \\| To the site's accounts \\| dataLayer events \\|\\n\\|---\\|---\\|---\\|---\\|---\\|\\n\\| ${widget.replace(/[.:/]/g, "\\$&")} \\| `));
  assert.match(md, /\| GA4 G-WIDGET: purchase \| GA4 G-SITE: generate_lead \| widget_ready, booking_complete, generate_lead \(Not sent to the site's accounts: widget_ready, booking_complete\) \|/);
  assert.match(renderMarkdown({ title: "t", generatedAt: "now", findings, explained: null, runs: [run], lang: "tr" }), /## Gömülü widget'lar/);
  assert.match(widgetLines([run]).join("\n"), /not sent to the site's accounts: widget_ready, booking_complete/);
  // The MCP timeline shows the widget's hits beside the site's.
  const steps = timelineOf(run);
  assert.ok(steps.some((s) => s.widget_hits?.some((h) => h.widget === widget && h.event === "purchase" && h.id === "G-WIDGET")));
  assert.ok(steps.some((s) => s.hits?.some((h) => h.event === "generate_lead" && h.iframe === widget)));
  assert.ok(steps.some((s) => s.widget_pushes?.some((p) => p.widget === widget && p.event === "booking_complete")));
});

test("site IDs come from the page and same-site iframes; old captures stay whole", () => {
  const third = { origin: "https://widget.example", party: "third", parent: "https://shop.example/" };
  const run = {
    hits: [
      { platform: "google_ads", name: "conversion", id: "123456" },
      { platform: "ga4", name: "purchase", id: "G-W", frame: third },
      { platform: "google_ads", name: "conversion", id: "123456", frame: third },
      { platform: "meta", name: "Lead", id: "999", frame: third },
    ],
    containerLoads: [{ id: "GTM-A" }, { id: "G-X", frame: { ...third, party: "site" } }, { id: "G-W", frame: third }],
    dataLayerLog: [{ value: ["config", "AW-777"] }, { value: ["config", "G-Z"], frame: third }],
  };
  const ids = siteIds(run);
  assert.deepEqual([...ids].sort(), ["123456", "777", "G-X", "GTM-A"]);
  assert.equal(isWidgetHit(run.hits[1], ids), true);
  assert.equal(isWidgetHit(run.hits[2], ids), false, "the site's Ads account, whatever frame sent it");
  assert.equal(isWidgetHit({ platform: "google_ads", name: "c", id: "777", frame: third }, ids), false, "AW-777 in a config is conversion ID 777");
  const split = splitRun(run);
  assert.deepEqual(split.widgetHits.map((h) => h.id), ["G-W", "999"]);
  assert.deepEqual(widgetsOf(split.widgetHits), [{ origin: "https://widget.example", parent: "https://shop.example/", platforms: [{ platform: "ga4", ids: ["G-W"], events: ["purchase"] }, { platform: "meta", ids: ["999"], events: ["Lead"] }] }]);
  assert.deepEqual(split.widgetDataLayerLog, [{ value: ["config", "G-Z"], frame: third }]);
  // A capture from before frames were recorded has no frame anywhere, so all of it is the site's.
  const old = splitRun({ hits: [{ platform: "ga4", name: "x", id: "G-1" }], dataLayerLog: [{ value: { event: "e" } }] });
  assert.equal(old.hits.length, 1);
  assert.equal(old.widgetHits.length, 0);
  assert.equal(old.dataLayerLog.length, 1);
});

test("over MCP: get_widgets during the audit, then finish_audit and get_report", async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { buildServer } = await import("../src/mcp.js");
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildServer({ allowFiles: true, reportsDir: await mkdtemp(path.join(tmpdir(), "atd-")) }).connect(a);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(b);
  const call = async (name, args) => (await client.callTool({ name, arguments: args })).content;
  try {
    const page = (await call("start_audit", { site: url, journey: "browse", campaign: false }))[0].text;
    const id = page.match(/audit_id: (\w+)/)[1];
    await call("browser_action", { audit_id: id, action: "wait", ms: 500, reason: "Let the widget load" });
    const listed = (await call("get_widgets", { audit_id: id }))[0].text;
    assert.match(listed, new RegExp(`^ {2}${widget.replace(/[.:/]/g, "\\$&")}, embedded in ${url.replace(/[.:/]/g, "\\$&")}; containers GTM-WIDGET$`, "m"));
    assert.match(listed, /^ {4}own tracking: GA4 G-WIDGET: purchase$/m);
    assert.match(listed, /^ {4}not sent to the site's accounts: widget_ready, booking_complete$/m);
    assert.equal(JSON.parse(listed.split("As JSON: ")[1])[0].origin, widget);

    const [result] = await call("finish_audit", { audit_id: id, completed: true, note: "Loaded.", measurement_plan: JSON.stringify({ events: [] }) });
    assert.match(result.text, /^Embedded widgets \(third-party iframes; their own dataLayer is invisible to the page's tags\):$/m);
    assert.match(result.text, /pushed "widget_ready", "booking_complete" to its own dataLayer/);
    const name = result.text.match(/get_report with report "([^"]+)"/)[1];
    const [w] = JSON.parse((await call("get_report", { report: name, part: "widgets" }))[0].text);
    assert.deepEqual(w.unshared, ["widget_ready", "booking_complete"]);
  } finally {
    await client.close();
  }
});
