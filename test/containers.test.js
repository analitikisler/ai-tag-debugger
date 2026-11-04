// How each Google container got onto the page: the browser records every gtm.js and gtag/js script with what
// inserted it, src/containers.js names the source, and checks.js flags duplicates, GTM environments, split
// dataLayers and destinations only a send_to loaded.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AuditSession } from "../src/browser.js";
import { callersOf, containerOf, containerRows, loadSources, sourceOf } from "../src/containers.js";
import { checkRun } from "../src/checks.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/mcp.js";

// Stand-ins for gtm.js and gtag/js, served from the test server: each does what the real script does to load
// another container (sets a script's src from its own code, or injects a Custom HTML tag that does).
const add = (src) => `(function(){var s=document.createElement("script");s.async=true;s.src=${JSON.stringify(src)};document.head.appendChild(s);})();`;
const SCRIPTS = {
  "/gtm.js?id=GTM-MAIN": [
    // Like gtm.js, a second copy of the same container does not run again.
    "if (!window.__main) { window.__main = true;",
    add("/gtag/js?id=G-INGTM&l=dataLayer&cx=c"),
    add("/gtm.js?id=GTM-ZONE"),
    // A Custom HTML tag: GTM inserts it as an inline script, which then runs in the page.
    `(function(){var t=document.createElement("script");t.text=${JSON.stringify(add("/gtm.js?id=GTM-CHTML&gtm_auth=SECRET&gtm_preview=env-3"))};document.head.appendChild(t);})();`,
    "}",
  ].join("\n"),
  "/gtag/js?id=G-HTML&l=myDataLayer": [
    // gtag.js reads its queue and loads the destinations the commands name.
    `setTimeout(function(){${add("/gtag/js?id=AW-111&l=myDataLayer")}${add("/gtag/js?id=AW-222&l=myDataLayer")}${add("/gtag/js?id=G-LINKED&l=myDataLayer")}}, 50);`,
  ].join("\n"),
  "/cmp.js": add("/gtm.js?id=GTM-MAIN"),
};
const PAGE = `<!doctype html><title>shop</title>
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-MAIN');</script>
<script async src="/gtag/js?id=G-HTML&l=myDataLayer"></script>
<script>window.myDataLayer = window.myDataLayer || []; function gtag(){myDataLayer.push(arguments);} gtag('js', new Date()); gtag('config', 'G-HTML'); gtag('config', 'AW-111'); gtag('event', 'conversion', { send_to: 'AW-222/abcDEF' });</script>
<script src="/cmp.js"></script>
<p>shop</p>`;

let server;
let url;
before(async () => {
  server = createServer((req, res) => {
    if (req.url === "/" || req.url.startsWith("/?")) return res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
    res.writeHead(200, { "content-type": "application/javascript" }).end(SCRIPTS[req.url] ?? "");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server.close());

test("each container load is recorded with the way it reached the page", async () => {
  const session = new AuditSession({ viewport: "desktop", site: url, providers: ["ga4"], quietMs: 0 });
  await session.start();
  let run;
  try {
    await session.act({ action: "goto", url: `${url}?email=someone@example.com` });
    await session.act({ action: "wait", ms: 400 });
    run = { journeyId: "j", viewport: "desktop", dataLayerLog: session.dataLayerLog, containerLoads: session.containerLoads };
  } finally {
    await session.close();
  }
  const got = loadSources(run).map((l) => `${l.id} ${l.kind}${l.by ? ` ${l.by.replace(url, "/")}` : ""}`);
  assert.deepEqual(got.sort(), [
    "AW-111 config G-HTML",
    "AW-222 send_to G-HTML",
    "G-HTML html",
    "G-INGTM google_tag GTM-MAIN",
    "G-LINKED destination G-HTML",
    "GTM-CHTML custom_html GTM-MAIN",
    "GTM-MAIN inline",
    "GTM-MAIN script /cmp.js",
    "GTM-ZONE nested GTM-MAIN",
  ]);
  const chtml = run.containerLoads.find((l) => l.id === "GTM-CHTML");
  assert.equal(chtml.environment, "env-3");
  assert.equal(chtml.layer, "dataLayer");
  assert.equal(run.containerLoads.find((l) => l.id === "G-HTML").layer, "myDataLayer");
  // Neither the environment token nor the page's query string is kept.
  assert.doesNotMatch(JSON.stringify(run.containerLoads), /SECRET|someone/);
  // The named dataLayer is recorded too, marked with its name.
  assert.ok(run.dataLayerLog.some((e) => e.layer === "myDataLayer" && Array.isArray(e.value) && e.value[0] === "config" && e.value[1] === "AW-111"));
  assert.ok(run.dataLayerLog.some((e) => !e.layer && e.value?.event === "gtm.js"));

  const found = checkRun({ events: [] }, { ...run, completed: true, hits: [], steps: [{ index: 0, label: "start" }, { index: 1, label: "goto" }, { index: 2, label: "wait" }], consentStep: null, cookieLog: [] })
    .filter((f) => f.check.startsWith("container_") || f.check === "datalayer_split")
    .map((f) => `${f.severity}:${f.check}`);
  assert.deepEqual(found.sort(), ["info:container_send_to_only", "info:datalayer_split", "warning:container_duplicate", "warning:container_environment"]);
});

test("a container URL gives its ID, script, dataLayer and host, without the environment token", () => {
  assert.deepEqual(containerOf("https://www.googletagmanager.com/gtm.js?id=GTM-ABC12&l=myDataLayer&gtm_auth=x&gtm_preview=env-7"), {
    id: "GTM-ABC12", script: "gtm", layer: "myDataLayer", host: "www.googletagmanager.com", served: "google", environment: "env-7",
  });
  assert.deepEqual(containerOf("https://shop.example/metrics/gtag/js?id=G-XYZ"), { id: "G-XYZ", script: "gtag", layer: "dataLayer", host: "shop.example", served: "site" });
  assert.equal(containerOf("https://www.googletagmanager.com/gtm.js?id=nope"), null);
  assert.equal(containerOf("https://shop.example/app.js?id=GTM-ABC"), null);
});

test("callers fold repeats and keep scripts without their query", () => {
  const doc = "https://shop.example/p?q=1";
  assert.deepEqual(callersOf([
    "https://shop.example/p?q=1",
    "https://www.googletagmanager.com/gtm.js?id=GTM-A",
    "https://www.googletagmanager.com/gtm.js?id=GTM-A",
    "https://cdn.example/bundle.js?v=3",
  ], doc), [{ inline: true }, { container: "GTM-A" }, { script: "https://cdn.example/bundle.js" }]);
});

test("a gtag command only names the source when it came first on the same page", () => {
  const load = { id: "AW-1", how: "script", callers: [{ container: "G-A" }], page: "https://s.example/", t: 100 };
  const push = (t, url, value) => ({ t, url, value });
  assert.deepEqual(sourceOf(load, [push(50, "https://s.example/?x=1", ["config", "AW-1"])]), { kind: "config", by: "G-A" });
  assert.deepEqual(sourceOf(load, [push(150, "https://s.example/", ["config", "AW-1"])]), { kind: "destination", by: "G-A" });
  assert.deepEqual(sourceOf(load, [push(50, "https://s.example/other", ["config", "AW-1"])]), { kind: "destination", by: "G-A" });
  assert.deepEqual(sourceOf(load, [push(50, "https://s.example/", ["event", "x", { send_to: ["G-A", "AW-1/lbl"] }])]), { kind: "send_to", by: "G-A" });
});

test("container rows group loads by container and source across runs", () => {
  const load = (over) => ({ id: "GTM-A", script: "gtm", layer: "dataLayer", host: "www.googletagmanager.com", served: "google", how: "script", callers: [{ inline: true }], step: 1, t: 1, ...over });
  const rows = containerRows([
    { journeyId: "a", viewport: "desktop", containerLoads: [load({ page: "https://s.example/" }), load({ page: "https://s.example/cart" })] },
    { journeyId: "b", viewport: "mobile", containerLoads: [load({ page: "https://s.example/" }), load({ id: "G-B", script: "gtag", how: "parser", callers: undefined, page: "https://s.example/" })] },
    { journeyId: "old", viewport: "desktop" },
  ]);
  assert.deepEqual(rows.map((r) => [r.id, r.kind, r.pages.length, r.journeys.length]), [["GTM-A", "inline", 2, 2], ["G-B", "html", 1, 1]]);
});

// A run as the browser would save it: the GTM snippet, the gtag.js snippet on another dataLayer, and a GA4 tag in GTM.
const savedRun = () => ({
  journeyId: "browse", viewport: "desktop", completed: true, hits: [], consentStep: null, cookieLog: [], network: [],
  steps: [{ index: 0, label: "start" }, { index: 1, label: "open home" }],
  dataLayerLog: [],
  containerLoads: [
    { id: "GTM-AB12", script: "gtm", layer: "dataLayer", host: "www.googletagmanager.com", served: "google", how: "script", callers: [{ inline: true }], page: "https://shop.example/", doc: "d1", step: 1, t: 1 },
    { id: "G-XY34", script: "gtag", layer: "myDataLayer", host: "shop.example", served: "site", how: "parser", page: "https://shop.example/", doc: "d1", step: 1, t: 2 },
    { id: "G-XY34", script: "gtag", layer: "dataLayer", host: "www.googletagmanager.com", served: "google", how: "script", callers: [{ container: "GTM-AB12" }], page: "https://shop.example/", doc: "d1", step: 1, t: 3 },
  ],
});

test("the report and report.md list the containers with their sources, in both languages", async () => {
  const { context } = await import("../src/html/shell.js");
  const { render } = await import("../src/html/scope.js");
  const { renderMarkdown } = await import("../src/report.js");
  const runs = [savedRun()];
  const input = { title: "t", generatedAt: "now", findings: checkRun({ events: [] }, runs[0]), explained: null, runs };
  const html = render(context(input));
  assert.match(html, /id="inv-containers"><summary><span class="t">Google containers<\/span>/);
  assert.match(html, /<code>GTM-AB12<\/code><span class="chip plain">GTM container<\/span><span>Inline code in the page \(the snippet\)<\/span>/);
  assert.match(html, /<code>G-XY34<\/code>.*A Google tag in GTM-AB12 \(load_google_tags\)/);
  assert.match(html, /The site&#39;s own domain \(shop\.example\)|The site's own domain \(shop\.example\)/);
  const md = renderMarkdown(input);
  assert.match(md, /## Google containers\n\n\| Container \| Loaded by \| dataLayer \| Served from \| Pages \|/);
  assert.match(md, /\| G-XY34 \(Google tag\) \| A script tag in the page's HTML \| myDataLayer \| The site's own domain \(shop\.example\) \| 1 \|/);
  const tr = renderMarkdown({ ...input, lang: "tr" });
  assert.match(tr, /## Google container'ları/);
  assert.match(tr, /GTM-AB12 içindeki bir Google etiketi/);
  // The same container twice on one page, and two dataLayers.
  assert.deepEqual(input.findings.filter((f) => /container|datalayer/.test(f.check)).map((f) => `${f.severity}:${f.check}`), ["warning:container_duplicate", "info:datalayer_split"]);
});

test("a run saved without container loads renders and checks as before", async () => {
  const { context } = await import("../src/html/shell.js");
  const { render } = await import("../src/html/scope.js");
  const { renderMarkdown } = await import("../src/report.js");
  const { containerLoads, ...old } = savedRun();
  assert.ok(containerLoads.length);
  const input = { title: "t", generatedAt: "now", findings: checkRun({ events: [] }, old), explained: null, runs: [old] };
  assert.doesNotMatch(render(context(input)), /inv-containers/);
  assert.doesNotMatch(renderMarkdown(input), /Google containers/);
  assert.equal(input.findings.filter((f) => /container|datalayer/.test(f.check)).length, 0);
});

test("MCP step results list the containers the step loaded", async () => {
  const { stepCapture } = await import("../src/mcp.js");
  const run = savedRun();
  const session = { ...run, network: [], hits: [], cookieChanges: [], steps: run.steps };
  const text = stepCapture({ session }, 1);
  assert.match(text, /Google containers loaded:\n {2}GTM-AB12 \(GTM container\): Inline code in the page \(the snippet\)\n {2}G-XY34 \(Google tag\): A script tag in the page's HTML; dataLayer myDataLayer, served from shop\.example\n {2}G-XY34 \(Google tag\): A Google tag in GTM-AB12 \(load_google_tags\)/);
});

test("over MCP: get_containers during the audit, then finish_audit, its timeline and get_report", async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildServer({ allowFiles: true, reportsDir: await mkdtemp(path.join(tmpdir(), "atd-")) }).connect(a);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(b);
  const call = async (name, args) => (await client.callTool({ name, arguments: args })).content;
  const page = (await call("start_audit", { site: url, journey: "browse", campaign: false }))[0].text;
  const id = page.match(/audit_id: (\w+)/)[1];
  await call("browser_action", { audit_id: id, action: "wait", ms: 400, reason: "Let the tags load" });

  const listed = (await call("get_containers", { audit_id: id }))[0].text;
  // The test server is the site, so every script counts as served from the site's own domain.
  assert.match(listed, /GTM-MAIN \(GTM container\): Inline code in the page \(the snippet\); served from 127\.0\.0\.1/);
  assert.match(listed, /GTM-CHTML \(GTM container\): A Custom HTML tag in GTM-MAIN; served from 127\.0\.0\.1, GTM environment env-3/);
  assert.match(listed, /G-HTML \(Google tag\): A script tag in the page's HTML; dataLayer myDataLayer, served from 127\.0\.0\.1/);
  const json = JSON.parse(listed.split("As JSON: ")[1]);
  assert.ok(json.some((l) => l.id === "AW-222" && l.source === "send_to" && l.by === "G-HTML"));
  assert.doesNotMatch(listed, /SECRET/);
  assert.match((await call("get_step", { audit_id: id, step: 1 }))[0].text, /Google containers loaded:/);

  const [result, timeline] = await call("finish_audit", { audit_id: id, completed: true, note: "Loaded.", measurement_plan: JSON.stringify({ events: [] }) });
  assert.match(result.text, /^Google containers \(how each reached the page\):$/m);
  assert.match(result.text, /^ {2}GTM-MAIN \(GTM container\): Another script on the page: http:\/\/127\.0\.0\.1:\d+\/cmp\.js; served from 127\.0\.0\.1, 1 page$/m);
  assert.match(result.text, /loaded 2 times into one page/);
  assert.match(result.text, /GTM environment \(gtm_preview=env-3\)/);
  const steps = JSON.parse(timeline.text.replace(/^Timeline \(JSON, one entry per step\):\n/, ""));
  assert.ok(steps.flatMap((s) => s.containers ?? []).some((c) => c.id === "G-HTML" && c.source === "html" && c.data_layer === "myDataLayer"));
  const name = result.text.match(/get_report with report "([^"]+)"/)[1];
  const rows = JSON.parse((await call("get_report", { report: name, part: "containers" }))[0].text);
  assert.deepEqual(rows.find((r) => r.id === "GTM-CHTML"), { id: "GTM-CHTML", source: "custom_html", by: "GTM-MAIN", served_from: "127.0.0.1", gtm_environment: "env-3", pages: [url] });
  await client.close();
});
