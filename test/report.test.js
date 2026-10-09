import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHtml } from "../src/report.js";

const t0 = 1_000_000;
const run = {
  journeyId: "checkout",
  viewport: "desktop",
  startedAt: t0,
  completed: true,
  note: "done",
  steps: [{ index: 0, label: "start", t: t0 }, { index: 1, label: "Add to cart", t: t0 + 1000 }],
  hits: [
    { platform: "meta", name: "AddToCart", params: { value: "<img src=x onerror=alert(1)>" }, url: "https://www.facebook.com/tr/?ev=AddToCart", step: 1, t: t0 + 1100 },
    { platform: "ga4", name: "add_to_cart", params: { currency: "EUR" }, url: "https://region1.google-analytics.com/g/collect?en=add_to_cart", step: 1, t: t0 + 1200 },
    { platform: "pinterest", name: "addtocart", params: {}, url: "https://ct.pinterest.com/v3/?event=addtocart", step: 1, t: t0 + 1300 },
  ],
  dataLayerLog: [
    { value: { event: "add_to_cart", ecommerce: { currency: "EUR" } }, step: 1, t: t0 + 1050 },
    { value: ["consent", "update", { ad_storage: "granted" }], step: 1, t: t0 + 1010 },
  ],
  network: [
    { method: "GET", url: "https://www.facebook.com/tr/?ev=AddToCart", vendor: "Meta", status: 204, blocked: true, step: 1, t: t0 + 1100 },
    { method: "GET", url: "https://www.googletagmanager.com/gtm.js?id=GTM-X", vendor: "Google Tag Manager", status: 200, step: 1, t: t0 + 1001 },
  ],
};
const findings = [{ journey: "checkout", viewport: "desktop", severity: "broken", check: "missing_params", platform: "ga4", event: "add_to_cart", step: "Add to cart", detail: '"add_to_cart" was sent without "value".' }];

test("gtag.js array pushes link to their event, duplicates pair in order, and repeated step labels link to the right step", () => {
  const r = {
    ...run,
    steps: [...run.steps, { index: 2, label: "Add to cart", t: t0 + 2000 }],
    hits: [
      { platform: "ga4", name: "add_to_cart", params: {}, url: "https://x/g/collect?en=add_to_cart", step: 1, t: t0 + 1100 },
      { platform: "ga4", name: "add_to_cart", params: {}, url: "https://x/g/collect?en=add_to_cart", step: 2, t: t0 + 2100 },
      { platform: "ga4", name: "add_to_cart", params: {}, url: "https://x/g/collect?en=add_to_cart", step: 2, t: t0 + 2200 },
    ],
    dataLayerLog: [
      { value: ["event", "add_to_cart", { value: 1 }], step: 1, t: t0 + 1050 },
      { value: { event: "add_to_cart", n: "first" }, step: 2, t: t0 + 2050 },
      { value: { event: "add_to_cart", n: "second" }, step: 2, t: t0 + 2060 },
    ],
    network: [],
  };
  const f = [{ ...findings[0], step: "Add to cart", where: undefined }];
  // The finding's event fired in both steps; with a hit in step 1 it links there. Drop step 1's hit and it must link to step 2.
  const html = renderHtml({ title: "t", generatedAt: "now", findings: f, explained: null, runs: [r], lang: "en" });
  assert.match(html, /gtag\(&quot;event&quot;, &quot;add_to_cart&quot;/);
  // Each event's Source box names one push: duplicates are paired with their own push.
  const sources = [...html.matchAll(/<span class="lbl">dataLayer<\/span>((?:<span class="mono">[^<]*<\/span>)+)<\/li>/g)].map((x) => x[1].split('class="mono"').length - 1);
  assert.deepEqual(sources, [1, 1, 1]);
  const step2 = html.slice(html.indexOf('id="j0-s2"'));
  assert.ok(step2.indexOf("first") < step2.indexOf("second") && step2.indexOf("first") > 0);
  const onlyStep2 = renderHtml({ title: "t", generatedAt: "now", findings: f, explained: null, runs: [{ ...r, hits: r.hits.slice(1) }], lang: "en" });
  assert.match(onlyStep2, /href="#j0-s2"/);
});

test("each step has Events, dataLayer and Network tabs, with source filters and no scripts", () => {
  const html = renderHtml({ title: "t", generatedAt: "now", findings, explained: null, runs: [run], lang: "en" });
  assert.equal((html.match(/class="tabs steptabs"/g) ?? []).length, 1);
  assert.match(html, /for="s0-1-1">Events <span class="n">3<\/span>/);
  assert.match(html, /for="s0-1-2">dataLayer <span class="n">2<\/span>/);
  assert.match(html, /for="s0-1-3">Network requests <span class="n">2<\/span>/);
  // Events are ordered GA4, Meta, then other platforms, and can be filtered by source.
  const events = html.slice(html.indexOf('id="s0-1-1"'), html.indexOf('id="s0-1-2"'));
  const order = ['data-p="ga4"', 'data-p="meta"', 'data-p="pinterest"'].map((x) => html.indexOf(x));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], "GA4, Meta, then other platforms");
  assert.match(html, /id="s0-1e-pinterest" class="f-pinterest"/);
  assert.match(html, /\.filter>\.f-pinterest:checked~\.evlist>li:not\(\[data-p="pinterest"\]\)/);
  assert.ok(events.length > 0);
  // The Meta pixel's Source box names the GA4-named push behind it.
  const meta = html.slice(html.indexOf('<li data-p="meta">'), html.indexOf('<li data-p="pinterest">'));
  assert.match(meta, /<span class="mono">add_to_cart · \+1\.1s<\/span>/);
  // dataLayer and Network tabs list everything in the step, with parameter tips.
  assert.match(html, /<code class="ev">consent update<\/code>/);
  assert.match(html, /gtm\.js\?id=GTM-X/);
  assert.match(html, /data-tip="Meta event name\."/);
  assert.doesNotMatch(html, /Other dataLayer pushes and network calls/);
  // Findings link to the step, flagged events are marked with the finding, and page values are escaped.
  assert.match(html, /href="#j0-s1"/);
  assert.match(html, /class="event flag-broken" open/);
  assert.match(html, /<p class="flagnote broken">&quot;add_to_cart&quot; was sent without &quot;value&quot;\.<\/p>/);
  assert.doesNotMatch(html, /<img src=x/);
  // No scripts: the MCP server serves reports with a CSP that blocks them.
  assert.doesNotMatch(html, /<script/i);
});

test("GA4 batches show every event, items are decoded, and out-of-scope providers are counted", () => {
  const r = {
    ...run,
    providers: ["ga4", "meta"],
    skipped: { 1: { "Microsoft Clarity": 3, DoubleClick: 1 } },
    hits: [{ platform: "ga4", name: "view_item", params: { items: "x" }, items: ["nmShoe~id42~pr10~qt2~cp~k0size~v0XL"], url: "https://region1.google-analytics.com/g/collect?v=2", step: 1, t: t0 + 1100 }],
    dataLayerLog: [{ value: { event: "view_item", ecommerce: { currency: "EUR", value: 20, items: [{ item_id: "42", item_name: "Shoe", price: 10, quantity: 2, size: "XL" }] } }, step: 1, t: t0 + 1050 }],
    network: [
      { method: "POST", url: "https://region1.google-analytics.com/g/collect?v=2&tid=G-ABC&cid=1.2", postData: "en=view_item&pr1=nmShoe~id42~pr10~qt2~k0size~v0XL\nen=scroll&epn.percent_scrolled=90", vendor: "Google Analytics", provider: "ga4", status: 204, blocked: true, step: 1, t: t0 + 1100 },
    ],
  };
  const html = renderHtml({ title: "t", generatedAt: "now", findings: [], explained: null, runs: [r], lang: "en" });
  assert.match(html, /1 of 2 in one request/);
  assert.match(html, /2 of 2 in one request/);
  assert.match(html, /<code class="ev">scroll<\/code>/);
  assert.match(html, /data-tip="Number event parameter: percent_scrolled\."/);
  assert.match(html, /data-tip="Measurement ID \(G-…\): which GA4 property the request goes to\."/);
  // Item cards from the GA4 item string and from the dataLayer push, with custom parameters grouped.
  assert.ok((html.match(/<div class="item">/g) ?? []).length >= 3);
  assert.match(html, /<b>Shoe<\/b><span class="mono muted">42<\/span><span class="item-price mono">10 × 2<\/span>/);
  assert.match(html, /Custom item parameters<\/h6><dl class="grid4"><div><dt>size<\/dt><dd>XL<\/dd>/);
  // The scope line and the step's skipped count.
  assert.match(html, /Providers checked:<\/span><span class="ptag p-ga4">GA4<\/span><span class="ptag p-meta">Meta<\/span>/);
  assert.match(html, /Out of scope: Microsoft Clarity, DoubleClick \(4 requests skipped\)/);
  assert.match(html, /4 out-of-scope requests were skipped in this step: Microsoft Clarity 3, DoubleClick 1\./);
});

test("structured summaries and explanations render, findings are grouped by severity, and old summaries still work", async () => {
  const { renderMarkdown } = await import("../src/report.js");
  const explained = {
    summary: { headline: "begin_checkout never reaches GA4.", points: [{ severity: "broken", text: "Checkout funnel is cut." }], also_check: ["A conversion fires on page load."] },
    explanations: [{ finding: 0, impact: "The funnel looks broken.", likely_cause: "No tag listens to the event.", fix_steps: ["Open GTM.", "Add the tag."] }],
  };
  const f = [findings[0], { ...findings[0], severity: "warning", check: "duplicate", detail: "Sent twice." }];
  const html = renderHtml({ title: "t", generatedAt: "now", findings: f, explained, runs: [run], lang: "en" });
  assert.match(html, /<p class="headline">begin_checkout never reaches GA4\.<\/p>/);
  assert.match(html, /<span class="tag broken">Broken<\/span><span>Checkout funnel is cut\.<\/span>/);
  assert.match(html, /Not in the findings list, but worth checking<\/h5><ul class="also"><li>A conversion fires on page load\.<\/li>/);
  assert.match(html, /<b>Impact\.<\/b> The funnel looks broken\./);
  assert.match(html, /<ol class="fix-steps"><li>Open GTM\.<\/li><li>Add the tag\.<\/li><\/ol>/);
  assert.ok(html.indexOf("Broken · 1") < html.indexOf("Warning · 1") && html.indexOf("Broken · 1") > 0);
  const md = renderMarkdown({ title: "t", generatedAt: "now", findings: f, explained, runs: [run], lang: "en" });
  assert.match(md, /\*\*begin_checkout never reaches GA4\.\*\*/);
  assert.match(md, /   2\. Add the tag\./);
  const old = renderHtml({ title: "t", generatedAt: "now", findings: f, explained: { summary: "Plain text summary.", explanations: [{ finding: 0, likely_cause: "c", fix: "Do this." }] }, runs: [run], lang: "en" });
  assert.match(old, /<div class="summary">Plain text summary\.<\/div>/);
  assert.match(old, /<ol class="fix-steps"><li>Do this\.<\/li><\/ol>/);
});

test("reports end with a plain credit line that branding false removes, together with the logo", async () => {
  const { renderHtml: html, renderMarkdown: md } = await import("../src/report.js");
  const report = { title: "T", generatedAt: "now", findings: [], explained: null, runs: [], lang: "en" };
  assert.match(html(report), /Generated by AI Tag Debugger · <a href="https:\/\/analitikisler\.com" rel="noopener noreferrer">analitikisler\.com<\/a>/);
  assert.match(html(report), /class="logo"/);
  assert.match(md(report), /_Generated by AI Tag Debugger · \[analitikisler\.com\]\(https:\/\/analitikisler\.com\)_/);
  assert.match(html({ ...report, lang: "tr" }), /AI Tag Debugger ile oluşturuldu/);
  assert.match(md({ ...report, lang: "tr" }), /AI Tag Debugger ile oluşturuldu/);
  const plain = html({ ...report, branding: false });
  assert.doesNotMatch(plain, /analitikisler\.com|class="logo"/);
  assert.doesNotMatch(md({ ...report, branding: false }), /analitikisler\.com/);
  assert.doesNotMatch(html(report), /<img/);
});
