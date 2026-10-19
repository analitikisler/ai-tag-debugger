// The Journeys section of the new HTML report (src/html/journeys.js): the journey tabs and viewport switch, the step
// list and step panes, the ids Findings links to, the hit, push and request rows, the plan and parity lines, and the
// failed and empty runs, in English and Turkish.
import { test } from "node:test";
import assert from "node:assert/strict";
import { context } from "../src/html/shell.js";
import { render } from "../src/html/journeys.js";
import { hitAnchor, hitId, hitsOf, pushesOf, requestsOf, pushId, requestId } from "../src/html/lib.js";
import { reportInput, failedInput } from "./helpers/demo-capture.js";

const section = (opts) => render(context(reportInput(opts)));
const pane = (html, id) => html.slice(html.indexOf(`<article class="card jr-pane`, html.lastIndexOf(`id="${id}"`) - 120), html.indexOf("</article>", html.indexOf(`id="${id}"`)));

test("journey tabs in capture order, the worst run opened, a viewport switch per journey", () => {
  const html = section();
  assert.match(html, /^<section class="sec" id="journeys" aria-labelledby="journeys-h"><h2 id="journeys-h">Journeys<\/h2>/);
  assert.match(html, /<div class="tabs jr-pick" data-tabs><div role="tablist" aria-label="Choose a journey">/);
  const tabs = [...html.matchAll(/<button type="button" role="tab" aria-controls="(jy-\d)" aria-selected="(true|false)">([a-z]+)/g)].map((x) => x.slice(1).join(" "));
  assert.deepEqual(tabs, ["jy-0 false browse", "jy-1 true checkout"]);
  // checkout · mobile (j3) has the broken purchase, so it is the run on screen.
  assert.match(html, /data-vp-target="#j2" aria-pressed="false"/);
  assert.match(html, /data-vp-target="#j3" aria-pressed="true"/);
  assert.match(html, /data-vp-target="#j0" aria-pressed="true"/);
  assert.equal((html.match(/data-vp-switch/g) ?? []).length, 2);
  for (const ri of [0, 1, 2, 3]) assert.match(html, new RegExp(`<div class="jr-run" id="j${ri}" data-inspector>`));
  // Every tab sits inside a [data-tabs] box: as many tab boxes as tablists.
  assert.equal((html.match(/data-tabs>/g) ?? []).length, (html.match(/role="tablist"/g) ?? []).length);
});

test("the status line, the plan line and the step list grouped by page", () => {
  const html = section();
  const j3 = html.slice(html.indexOf('id="j3"'));
  assert.match(j3, /<span class="chip chip-run completed"><svg[^>]*><use href="#sev-ok"\/><\/svg>Completed<\/span>/);
  assert.match(j3, /<span class="jr-nums">11 steps · 20 hits · 6\.6 s<\/span><span class="jr-goal" title="Accept cookies, add any product/);
  // Expected vs observed: the funnel sentence and a chip per failed planned event, linking to its hit.
  assert.match(j3, /<span class="jr-plan-h">Expected vs observed<\/span><span class="jr-plan-t">[^]*?11 of 11 expected events fired, 9 with every required parameter\.<\/span>/);
  assert.match(j3, /<a class="chip chip-sev broken" href="#j3-s11-h0" title="without currency, value">[^]*?<code>purchase<\/code><span class="sr"> without currency, value<\/span><\/a>/);
  // Page groups with the page title and path, steps numbered by their capture index, titles from stepTitle.
  assert.match(j3, /<li class="jr-pg"><span class="jr-pg-i">[^]*?<span class="jr-pg-t">Home<\/span><code class="jr-pg-p">\/<\/code><\/li>/);
  assert.match(j3, /<span class="jr-pg-t">Thank you<\/span><code class="jr-pg-p">\/thanks\.html<\/code>/);
  assert.match(j3, /<li class="jr-st sev-broken" data-flagged="broken"><button type="button" data-select-target="#j3-s11" data-step="11" aria-controls="j3-s11"><span class="jr-n">11<\/span><span class="jr-t">Place the order<\/span>/);
  assert.match(j3, /data-select-target="#j3-s1" data-step="1" aria-controls="j3-s1"><span class="jr-n">1<\/span><span class="jr-t">Open Home<\/span>/);
  assert.match(j3, /title="2 GA4 hits"/);
  // A zero-hit step is muted, and the run's worst step (earliest on ties) is the one selected on load.
  assert.match(j3, /<li class="jr-st zero"><button type="button" data-select-target="#j3-s2"/);
  const j3Only = j3.slice(0, j3.indexOf('<div class="jr-run" id="j4"') > 0 ? j3.indexOf('<div class="jr-run" id="j4"') : undefined);
  assert.deepEqual([...j3Only.matchAll(/id="(j3-s\d+)" data-select-pane data-step="\d+"(?: data-flagged="\w+")? data-selected/g)].map((x) => x[1]), ["j3-s11"]);
  const j0 = html.slice(html.indexOf('id="j0"'), html.indexOf('id="j1"'));
  assert.deepEqual([...j0.matchAll(/id="(j0-s\d+)" data-select-pane data-step="\d+"(?: data-flagged="\w+")? data-selected/g)].map((x) => x[1]), ["j0-s1"]);
});

test("the step pane: title, action and selector, viewport, tabs with counts, flagged state", () => {
  const html = section();
  const p = pane(html, "j3-s11");
  assert.match(p, /<article class="card jr-pane sev-broken" id="j3-s11" data-select-pane data-step="11" data-flagged="broken" data-selected tabindex="-1" aria-labelledby="j3-s11-t">/);
  assert.match(p, /<h3 id="j3-s11-t"><span class="jr-n">11<\/span><span>Place the order<\/span><\/h3>/);
  assert.match(p, /<p class="jr-ph-m"><span>\/thanks\.html<\/span><span>click button\[type=submit\]<\/span><span>\+6\.6 s<\/span><\/p>/);
  assert.match(p, /<span class="chip chip-vp mobile">/);
  assert.match(p, /aria-controls="j3-s11-hits" aria-selected="true">Hits <span class="n">4<\/span><\/button>/);
  assert.match(p, /aria-controls="j3-s11-dl" aria-selected="false">Data Layer <span class="n">4<\/span><\/button>/);
  assert.match(p, /aria-controls="j3-s11-req" aria-selected="false">Network requests <span class="n">4<\/span><\/button>/);
  assert.match(p, /<div role="tabpanel" id="j3-s11-hits" data-label="Hits in this step">/);
  // A step with nothing sent says so instead of three empty tabs; typed values never reach the page.
  assert.match(pane(html, "j3-s7"), /<span>fill input\[name=name\]<\/span>[^]*<p class="muted xs jr-empty">Nothing was sent in this step\.<\/p>/);
  assert.doesNotMatch(html, /Test User|qa-test@example\.com|1 Test Street/);
  // A step whose platforms disagree carries the parity line.
  assert.match(pane(html, "j3-s4"), /<p class="jr-par">[^]*?<span class="jr-par-h">Platform parity<\/span>[^]*?<code>add_to_cart<\/code><span class="mono">2× · 19\.9 EUR<\/span>[^]*?<b>count differs<\/b><\/p>/);
});

test("hits, pushes and requests carry the ids the contract defines, and Findings' links all land on one", () => {
  const ctx = context(reportInput());
  const html = render(ctx);
  ctx.runs.forEach((run, ri) => {
    for (const step of run.steps.filter((s) => s.index > 0)) {
      hitsOf(run, step.index).forEach((h, k) => assert.match(html, new RegExp(`<details class="card jr-hit[^"]*" id="${hitId(ri, step.index, k)}"[^>]*><summary><span class="jr-c-p"><span class="chip chip-plat ${h.platform}">[^]*?<code class="jr-ev">${h.name}</code>`)));
      pushesOf(run, step.index).forEach((_, k) => assert.match(html, new RegExp(`<details class="card jr-push" id="${pushId(ri, step.index, k)}">`)));
      requestsOf(run, step.index).forEach((_, k) => assert.match(html, new RegExp(`<tr id="${requestId(ri, step.index, k)}">`)));
    }
  });
  for (const row of ctx.rows.filter((f) => f.severity !== "ok")) {
    for (const w of row.where) {
      const a = hitAnchor(ctx.runs, row, w);
      if (a) assert.ok(html.includes(`id="${a.id}"`), a.id);
    }
  }
  assert.equal(hitAnchor(ctx.runs, ctx.rows[0], ctx.rows[0].where[0]).id, "j3-s11-h0");
  // No card starts open, no element takes focus by default, and ids are unique.
  assert.doesNotMatch(html, /<details[^>]* open[ >]/);
  assert.doesNotMatch(html, /tabindex="0"/);
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((x) => x[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test("a flagged hit: missing parameters, consent chips, its badge, and a link back to its finding card", () => {
  const html = section();
  const hit = html.slice(html.indexOf('id="j3-s11-h0"') - 60, html.indexOf('id="j3-s11-h1"'));
  assert.match(hit, /<details class="card jr-hit sev-broken" id="j3-s11-h0" data-flagged="broken" data-print-open><summary>/);
  assert.match(hit, /<span class="chip chip-sev broken jr-miss"><span class="k">currency<\/span>missing<\/span><span class="chip chip-sev broken jr-miss"><span class="k">value<\/span>missing<\/span><span class="jr-kv"><span class="k">items<\/span><span class="v">1<\/span><\/span>/);
  assert.match(hit, /<span class="chip chip-consent granted" title="ad_storage: granted"><span class="k" aria-hidden="true">ad<\/span><span aria-hidden="true">✓<\/span><span class="sr">ad_storage granted<\/span><\/span>/);
  assert.match(hit, /<span class="jr-c-s"><span class="badge sev-broken"><svg[^>]*><use href="#sev-broken"\/><\/svg>Broken<\/span><\/span>/);
  assert.match(hit, /<p class="jr-flag sev-broken">[^]*?<code>purchase<\/code> was sent without <code>value<\/code> and <code>currency<\/code>\.<\/span><a href="#f-ga4-purchase-missing_params">Finding →<\/a><\/p>/);
  // The parameters with glossary tips that take no focus, the missing ones last, the items table and the source.
  assert.match(hit, /<th scope="row"><span class="pk">tid<\/span><span class="q" aria-hidden="true" data-tip="Measurement ID \(G-…\): which GA4 property the request goes to\.">\?<\/span><span class="sr">Measurement ID/);
  assert.match(hit, /<tr class="jr-mr"><th scope="row"><span class="pk">currency<\/span><\/th><td><span class="chip chip-sev broken">missing<\/span><\/td><\/tr>/);
  assert.match(hit, /<table class="tbl jr-it" aria-label="Items">[^]*?<td class="mono">TEE-01<\/td><td>Basic Tee<\/td><td class="num">19\.9<\/td><td class="num">1<\/td>/);
  assert.match(hit, /<a class="mono" href="#j3-s11-d\d">purchase · \+6\.6 s<\/a>/);
  assert.match(hit, /<a class="mono" href="#j3-s11-q0">POST region1\.google-analytics\.com\/g\/collect 204<\/a><span class="muted">blocked by the audit: answered locally, never reached GA4<\/span>/);
  assert.match(hit, /<details class="card jr-raw"><summary><span class="t">Raw request<\/span>/);
  // Meta sends no consent signal; an unflagged hit has no badge and no data-flagged.
  assert.match(html, /id="j3-s11-h2"><summary><span class="jr-c-p"><span class="chip chip-plat meta">[^]*?<span class="chip chip-consent none" title="No consent signal on this hit">no signal<\/span><\/span><span class="jr-c-s"><\/span>/);
});

test("dataLayer pushes and requests: consent chips, a clear push, the blocked state", () => {
  const html = section();
  const s1 = pane(html, "j3-s1");
  assert.match(s1, /<details class="card jr-push" id="j3-s1-d0"><summary><code class="jr-ev">consent default<\/code><span class="jr-c-k"><span class="chip chip-consent denied" title="ad_storage: denied">/);
  assert.match(s1, /<code class="jr-ev">\{&quot;ecommerce&quot;:null\}<\/code><span class="jr-c-k"><span class="muted">clear<\/span><\/span>/);
  assert.match(s1, /<code class="jr-ev">view_item_list<\/code><span class="jr-c-k"><span class="jr-kv"><span class="k">value<\/span><span class="v">41\.4 EUR<\/span><\/span><span class="jr-kv"><span class="k">items<\/span><span class="v">3<\/span><\/span><\/span>/);
  assert.match(s1, /<table class="tbl jr-req" aria-label="Network requests"><thead><tr><th scope="col">Platform<\/th>/);
  assert.match(s1, /<span class="jr-st-c"><span class="mono">204<\/span> <span class="chip" title="blocked by the audit: answered locally, never reached GA4">blocked<span class="sr">/);
});

test("ported 0.17 behaviors: push pairing, hit order, sources, tips, GA4 batches, items, skipped requests, escaping", () => {
  const t0 = 1_000_000;
  const run = {
    journeyId: "checkout", viewport: "desktop", startedAt: t0, completed: true, note: "done", providers: ["ga4", "meta"],
    skipped: { 1: { "Microsoft Clarity": 3, DoubleClick: 1 } },
    steps: [{ index: 0, label: "start", t: t0 }, { index: 1, label: "Add to cart", t: t0 + 1000 }, { index: 2, label: "Add to cart", t: t0 + 2000 }],
    hits: [
      { platform: "meta", name: "AddToCart", params: { value: "<img src=x onerror=alert(1)>" }, url: "https://www.facebook.com/tr/?ev=AddToCart", step: 1, t: t0 + 1100 },
      { platform: "ga4", name: "add_to_cart", params: { currency: "EUR" }, url: "https://region1.google-analytics.com/g/collect?v=2&tid=G-ABC&cid=1.2", step: 1, t: t0 + 1200 },
      { platform: "pinterest", name: "addtocart", params: {}, url: "https://ct.pinterest.com/v3/?event=addtocart", step: 1, t: t0 + 1300 },
      { platform: "ga4", name: "scroll", params: {}, url: "https://region1.google-analytics.com/g/collect?v=2&tid=G-ABC&cid=1.2", step: 1, t: t0 + 1200 },
      { platform: "ga4", name: "add_to_cart", params: {}, url: "https://x/g/collect?en=add_to_cart", step: 2, t: t0 + 2100 },
      { platform: "ga4", name: "add_to_cart", params: {}, url: "https://x/g/collect?en=add_to_cart", step: 2, t: t0 + 2200 },
    ],
    dataLayerLog: [
      { value: ["event", "add_to_cart", { value: 1, items: [{ item_id: "42", item_name: "Shoe", price: 10, quantity: 2, size: "XL" }] }], step: 1, t: t0 + 1050 },
      { value: ["consent", "update", { ad_storage: "granted" }], step: 1, t: t0 + 1010 },
      { value: { event: "add_to_cart", n: "first" }, step: 2, t: t0 + 2050 },
      { value: { event: "add_to_cart", n: "second" }, step: 2, t: t0 + 2060 },
    ],
    network: [
      { method: "GET", url: "https://www.facebook.com/tr/?ev=AddToCart", vendor: "Meta", provider: "meta", status: 204, blocked: true, step: 1, t: t0 + 1100 },
      { method: "GET", url: "https://www.googletagmanager.com/gtm.js?id=GTM-X", vendor: "Google Tag Manager", status: 200, step: 1, t: t0 + 1001 },
      { method: "POST", url: "https://region1.google-analytics.com/g/collect?v=2&tid=G-ABC&cid=1.2", postData: "en=add_to_cart&pr1=nmShoe~id42~pr10~qt2~k0size~v0XL\nen=scroll&epn.percent_scrolled=90", vendor: "Google Analytics", provider: "ga4", status: 204, step: 1, t: t0 + 1200 },
    ],
  };
  const findings = [{ journey: "checkout", viewport: "desktop", severity: "broken", check: "missing_params", platform: "ga4", event: "add_to_cart", step: "Add to cart", detail: '"add_to_cart" was sent without "value".' }];
  const html = render(context({ title: "t", generatedAt: "now", findings, explained: null, runs: [run], lang: "en" }));
  // gtag.js array pushes show as gtag(...) calls; consent comes before the add_to_cart push, in time order.
  assert.match(html, /gtag\(&quot;event&quot;, &quot;add_to_cart&quot;/);
  const s1 = pane(html, "j0-s1");
  assert.ok(s1.indexOf('<code class="jr-ev">consent update</code>') < s1.indexOf('id="j0-s1-d1"'));
  // Hits in firing order (Meta, GA4, GA4 scroll, Pinterest); the Meta pixel's source is the GA4-named push.
  assert.deepEqual([...s1.matchAll(/<code class="jr-ev">([^<]+)<\/code><span class="jr-c-k">/g)].slice(0, 4).map((x) => x[1]), ["AddToCart", "add_to_cart", "scroll", "addtocart"]);
  const meta = s1.slice(s1.indexOf('id="j0-s1-h0"'), s1.indexOf('id="j0-s1-h1"'));
  assert.match(meta, /<a class="mono" href="#j0-s1-d1">add_to_cart · \+1\.1 s<\/a>/);
  // Duplicates in step 2 pair with their own push, in order: each hit's source names exactly one push.
  const s2 = pane(html, "j0-s2");
  assert.deepEqual([...s2.matchAll(/<span class="lbl">Data Layer<\/span>((?:<a class="mono"[^>]*>[^<]*<\/a>)+)/g)].map((x) => x[1].match(/<a /g).length), [1, 1]);
  assert.match(s2, /href="#j0-s2-d0"[^]*href="#j0-s2-d1"/);
  assert.ok(s2.indexOf("first") > 0 && s2.indexOf("first") < s2.indexOf("second"));
  // A GA4 batch: each hit shows its own parameter set with tips; the request row lists both events.
  assert.match(s1, /1 of 2 in one request/);
  assert.match(s1, /2 of 2 in one request/);
  assert.match(s1, /data-tip="Number event parameter: percent_scrolled\."/);
  assert.match(s1, /<span class="jr-rev"><code>scroll<\/code><span class="muted">2 of 2 in one request<\/span><\/span>/);
  // Items decoded from the GA4 item string and from the push, with their custom parameters.
  assert.match(s1, /<th scope="col">Custom item parameters<\/th>/);
  assert.match(s1, /<td class="mono">42<\/td><td>Shoe<\/td><td class="num">10<\/td><td class="num">2<\/td><td><span class="jr-ikv"><code>size<\/code> XL<\/span><\/td>/);
  // Skipped out-of-scope requests, the GTM request, an unknown platform's initials, the flagged hit and its finding link.
  assert.match(s1, /4 out-of-scope requests were skipped in this step: Microsoft Clarity 3, DoubleClick 1\./);
  assert.match(s1, /gtm\.js/);
  assert.match(s1, /<span class="plat-fb s14" aria-hidden="true">P<\/span>|<use href="#p-pinterest"\/>/);
  assert.match(s1, /<details class="card jr-hit sev-broken" id="j0-s1-h1" data-flagged="broken" data-print-open>/);
  assert.match(s1, /<a href="#f-ga4-add_to_cart-missing_params">Finding →<\/a>/);
  assert.match(html, /<span class="muted">No dataLayer push with this event name in this step\./);
  assert.doesNotMatch(html, /<img src=x/);
  // A finding that points at a step with no hit of its event still flags that step.
  const nothing = render(context({ title: "t", generatedAt: "now", findings: [{ ...findings[0], event: "nothing", step: "Add to cart" }], explained: null, runs: [run], lang: "en" }));
  assert.match(nothing, /<li class="jr-st sev-broken" data-flagged="broken"><button type="button" data-select-target="#j0-s1"/);
});

test("Turkish strings, the failed run and a report with no runs", () => {
  const tr = section({ lang: "tr" });
  assert.match(tr, /<h2 id="journeys-h">Yolculuklar<\/h2>/);
  assert.match(tr, /11 adım · 20 istek · 6\.6 sn/);
  assert.match(tr, /data-label="Bu adımdaki istekler"/);
  assert.match(tr, />Ağ istekleri <span class="n">4<\/span>/);
  assert.match(tr, />Veri katmanı <span class="n">4<\/span>/);
  assert.match(tr, /Beklenen ve gözlenen/);
  assert.match(tr, /<b>sayı farklı<\/b>/);
  assert.match(tr, /<a href="#f-ga4-purchase-missing_params">Bulgu →<\/a>/);
  for (const en of ["Nothing was sent", "Data Layer", "no signal", "Network requests", " steps ·", "Expected vs observed", "Platform parity"]) assert.ok(!tr.includes(en), en);

  const failed = render(context(failedInput()));
  assert.match(failed, /<span class="chip chip-run incomplete"><svg[^>]*><use href="#sev-warning"\/><\/svg>Not completed<\/span>/);
  assert.match(failed, /<p class="jr-stop">[^]*?<span>Could not open the start page: page\.goto: net::ERR_CONNECTION_REFUSED/);
  assert.match(failed, /0 of 6 expected events fired, 0 with every required parameter\./);
  assert.match(failed, /<span class="chip chip-sev broken" title="not sent">[^]*?<code>page_view<\/code>/);
  assert.match(failed, /<span class="chip plain">\+3<\/span>/);
  assert.match(failed, /<p class="muted xs jr-empty">Nothing was sent in this step\.<\/p>/);
  assert.doesNotMatch(failed, /data-select-pane[^>]*data-flagged/);

  const empty = render(context({ title: "t", generatedAt: "now", findings: [], explained: null, runs: [], lang: "en" }));
  assert.equal(empty, '<section class="sec" id="journeys" aria-labelledby="journeys-h"><h2 id="journeys-h">Journeys</h2>\n<p class="muted">No journey was run.</p>\n</section>');
});

test("hits recorded before the first listed step get a step 0 pane of their own, only in the run that has them", () => {
  const input = reportInput();
  const runs = input.runs.map((r, i) => (i === 0 ? { ...r, hits: [{ ...r.hits[0], step: 0, t: r.steps[0].t }, ...r.hits] } : r));
  const html = render(context({ ...input, runs }));
  assert.match(html, /<button type="button" data-select-target="#j0-s0" data-step="0" aria-controls="j0-s0"><span class="jr-n">0<\/span><span class="jr-t">Before the first step<\/span>/);
  assert.match(pane(html, "j0-s0"), new RegExp(`id="${hitId(0, 0, 0)}"`));
  assert.doesNotMatch(html, /id="j1-s0"/);
  // The stats line still counts the journey's own steps, and the run still opens on a listed step.
  assert.match(html, /<span class="jr-nums">4 steps · 10 hits · /);
  assert.doesNotMatch(html, /id="j0-s0" data-select-pane[^>]*data-selected/);
  assert.match(render(context({ ...reportInput({ lang: "tr" }), runs })), /<span class="jr-t">İlk adımdan önce<\/span>/);
  assert.doesNotMatch(section(), /id="j\d+-s0"/);
});

test("tables are named, header cells have a scope, headings do not skip a level", () => {
  for (const html of [section(), render(context(failedInput()))]) {
    for (const table of html.match(/<table[^>]*>/g) ?? []) assert.match(table, /aria-label="[^"]+"/);
    for (const th of html.match(/<th[\s>][^>]*>?/g) ?? []) assert.match(th, /scope="(row|col)"/, th);
    const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((x) => Number(x[1]));
    levels.reduce((prev, l) => { assert.ok(l <= prev + 1, `h${prev} then h${l}`); return l; }, 1);
    assert.doesNotMatch(html, /role="note"/);
  }
});
