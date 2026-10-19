import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHtml, renderMarkdown, SCRIPT } from "../src/report.js";

// The one fixed inline script (tabs, deep links, theme) is allowed; nothing else may run.
const withoutScript = (html) => html.replace(`<script>${SCRIPT}</script>`, "");

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
  assert.deepEqual(sources, [1, 1, 1]); // one hit list per step
  const step2 = html.slice(html.indexOf('id="j0-s2"'));
  assert.ok(step2.indexOf("first") < step2.indexOf("second") && step2.indexOf("first") > 0);
  const onlyStep2 = renderHtml({ title: "t", generatedAt: "now", findings: f, explained: null, runs: [{ ...r, hits: r.hits.slice(1) }], lang: "en" });
  assert.match(onlyStep2, /href="#j0-s2"/);
});

test("each step row lists its hits in time order, its dataLayer pushes and its network requests, with no script but the fixed one", () => {
  const html = renderHtml({ title: "t", generatedAt: "now", findings, explained: null, runs: [run], lang: "en" });
  assert.match(html, /<tr id="j0-s1" class="srow flagged sev-broken has-d">/);
  assert.match(html, /<summary><svg[^>]*><use href="#ui-chevron"\/><\/svg><span>Details · 3 hits · 2 dataLayer<\/span><\/summary>/);
  assert.match(html, /Network requests <span class="n">2<\/span>/);
  // Hits come in the order they were sent: Meta, GA4, then Pinterest.
  const step = html.slice(html.indexOf('id="j0-s1"'), html.indexOf('class="netblock"', html.indexOf('id="j0-s1"')));
  const order = ['<use href="#p-meta"/></svg><span>Meta</span></span><code class="ev">AddToCart', '<use href="#p-ga4"/></svg><span>GA4</span></span><code class="ev">add_to_cart', '<use href="#p-pinterest"/></svg><span>Pinterest</span></span><code class="ev">addtocart'].map((x) => step.indexOf(x));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], "hits in time order");
  // The Meta pixel's Source box names the GA4-named push behind it.
  const meta = step.slice(order[0], order[1]);
  assert.match(meta, /<span class="mono">add_to_cart · \+1\.1s<\/span>/);
  // dataLayer pushes and network requests are listed too, with parameter tips that take no focus.
  assert.match(html, /<code class="ev">consent update<\/code>/);
  assert.match(html, /gtm\.js\?id=GTM-X/);
  assert.match(html, /<span class="q" aria-hidden="true" data-tip="Meta event name\.">\?<\/span><span class="sr">Meta event name\.<\/span>/);
  assert.doesNotMatch(html, /Other dataLayer pushes and network calls/);
  // Findings link to the step, flagged events are marked with the finding and link back to its card, and page values are escaped.
  assert.match(html, /href="#j0-s1"/);
  assert.match(html, /class="event flag-broken sev-broken"><details open>/);
  assert.match(html, /<p class="flagnote sev-broken"><code>add_to_cart<\/code> was sent without <code>value<\/code>\. <a href="#f-ga4-add_to_cart-missing_params">Finding →<\/a><\/p>/);
  assert.doesNotMatch(html, /<img src=x/);
  // The MCP server's CSP allows the fixed script by its hash and nothing else.
  assert.doesNotMatch(withoutScript(html), /<script/i);
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
  // The scope card, the providers table and the step's skipped count.
  assert.match(html, /<dt>Platforms<\/dt><dd><span class="plat"><svg[^>]*><use href="#p-ga4"\/><\/svg><span>GA4<\/span><\/span> <span class="plat"><svg[^>]*><use href="#p-meta"\/><\/svg><span>Meta<\/span><\/span><\/dd>/);
  assert.match(html, /4 out-of-scope requests were skipped: Microsoft Clarity, DoubleClick\./);
  assert.match(html, /<tr><td><span class="plat"><svg[^>]*><use href="#p-ga4"\/><\/svg><span>GA4<\/span><\/span><\/td><td><span class="badge sev-ok"><svg[^>]*><use href="#sev-ok"\/><\/svg>Checked<\/span><\/td><td class="num">1<\/td><\/tr>/);
  assert.match(html, /<tr><td>Microsoft Clarity<\/td><td><span class="badge">Out of scope<\/span><\/td><td class="num">3<\/td><\/tr>/);
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
  assert.match(html, /<span class="ai-l">AI summary<\/span> begin_checkout never reaches GA4\.<\/p>/);
  assert.match(html, /<li><span class="badge sev-broken"><svg[^>]*><use href="#sev-broken"\/><\/svg>Broken<\/span><span>Checkout funnel is cut\.<\/span><\/li>/);
  assert.match(html, /Not in the findings list, but worth checking<\/p><ul class="also"><li>A conversion fires on page load\.<\/li>/);
  assert.match(html, /<span class="impact-l">Impact<\/span>The funnel looks broken\./);
  assert.match(html, /<ol class="fix-steps"><li><span>Open GTM\.<\/span><\/li><li><span>Add the tag\.<\/span><\/li><\/ol>/);
  // Broken findings come first, and the first card of each owner group (developer, then Tag Manager) is open.
  assert.ok(html.indexOf('data-sev="broken"') < html.indexOf('data-sev="warning"') && html.indexOf('data-sev="broken"') > 0);
  assert.equal((html.match(/<li class="finding [^"]+" id="[^"]+" data-sev="[a-z]+"><details open>/g) ?? []).length, 2);
  const md = renderMarkdown({ title: "t", generatedAt: "now", findings: f, explained, runs: [run], lang: "en" });
  assert.match(md, /\*\*begin_checkout never reaches GA4\.\*\*/);
  assert.match(md, / {3}2\. Add the tag\./);
  const old = renderHtml({ title: "t", generatedAt: "now", findings: f, explained: { summary: "Plain text summary.", explanations: [{ finding: 0, likely_cause: "c", fix: "Do this." }] }, runs: [run], lang: "en" });
  assert.match(old, /<span class="ai-l">AI summary<\/span> Plain text summary\.<\/p>/);
  assert.match(old, /<ol class="fix-steps"><li><span>Do this\.<\/span><\/li><\/ol>/);
});

test("reports carry the logos and credit line, and branding false leaves out the Analitik İşler parts", async () => {
  const { renderHtml: html, renderMarkdown: md } = await import("../src/report.js");
  const report = { title: "T", generatedAt: "now", findings: [], explained: null, runs: [], lang: "en" };
  const branded = html(report);
  assert.match(branded, /This report was made with the open source <a class="f-atd" href="https:\/\/github\.com\/analitikisler\/ai-tag-debugger"/);
  assert.match(branded, /<a href="https:\/\/analitikisler\.com" class="byline"/);
  assert.match(branded, /<link rel="icon" type="image\/png" href="data:image\/png;base64,/);
  // Logos are inline data URIs with a dark version, so the report needs no files and fetches nothing.
  assert.match(branded, /<img class="l-dark" src="data:image\/svg\+xml;base64,/);
  assert.doesNotMatch(branded, /(src|srcset|href)="(?!data:|#|https:\/\/(analitikisler\.com|github\.com\/analitikisler\/ai-tag-debugger)")/);
  assert.match(md(report), /_Generated by AI Tag Debugger · \[analitikisler\.com\]\(https:\/\/analitikisler\.com\)_/);
  assert.match(html({ ...report, lang: "tr" }), /Bu rapor açık kaynak <a class="f-atd"[^>]*>.*AI Tag Debugger<\/a> ile oluşturuldu\./);
  assert.match(md({ ...report, lang: "tr" }), /AI Tag Debugger ile oluşturuldu/);
  const plain = html({ ...report, branding: false });
  assert.doesNotMatch(plain, /analitikisler\.com|Analitik İşler/);
  assert.match(plain, /alt="AI Tag Debugger"/);
  assert.doesNotMatch(md({ ...report, branding: false }), /analitikisler\.com/);
});

test("the report has four tab panels, flagged steps open with their details, and plan coverage is shown", () => {
  const r = { ...run, steps: [...run.steps, { index: 2, label: "Checkout", t: t0 + 2000 }], providers: ["ga4", "meta"] };
  const plan = { events: [{ platform: "GA4", name: "add_to_cart" }, { platform: "ga4", name: "begin_checkout", journeys: ["checkout"] }, { platform: "ga4", name: "purchase", journeys: ["other"] }, { platform: "tiktok", name: "AddToCart" }] };
  const f = [{ ...findings[0], step: "Checkout", event: "nothing" }];
  const html = renderHtml({ title: "t", generatedAt: "now", findings: f, explained: null, runs: [r], plan, lang: "en" });
  for (const id of ["overview", "findings", "journeys", "scope"]) assert.match(html, new RegExp(`<button type="button" role="tab" id="tab-${id}" aria-controls="${id}"`));
  assert.match(html, /html\.js \.panel:not\(\.active\)\{display:none\}/);
  // Step 2, which the finding points at, is flagged although nothing was captured in it.
  assert.match(html, /<tr id="j0-s2" class="srow flagged sev-broken">/);
  assert.match(html, /<a href="#j0-s2" class="chip"><span class="chip-step">2<\/span>/);
  // Coverage: sent, not sent, not expected on this journey, and a provider that was not checked.
  const cov = html.slice(html.indexOf('class="dt cov"'));
  assert.match(cov, /<code>add_to_cart<\/code><\/td><td class="c y">✓<span class="sr"> sent<\/span><\/td>/);
  assert.match(cov, /<code>begin_checkout<\/code><\/td><td class="c x">✗<span class="sr"> not sent<\/span><\/td>/);
  assert.match(cov, /<code>purchase<\/code><\/td><td class="c o">–<span class="sr"> not expected<\/span><\/td>/);
  assert.match(cov, /<code>AddToCart<\/code> <span class="badge">not checked<\/span><\/td><td class="c o">–<span class="sr"> not expected<\/span><\/td>/);
  // Without a plan the Scope tab says so.
  assert.match(renderHtml({ title: "t", generatedAt: "now", findings: [], explained: null, runs: [r], lang: "en" }), /No measurement plan was given/);
});

test("AI text renders bold numbers and code names only; everything else stays escaped", () => {
  const explained = {
    summary: { headline: "Sent **2** times by `add_to_cart` <img src=x onerror=alert(1)>", points: [], also_check: [] },
    explanations: [{ finding: 0, impact: "**+70.4s** <b>late</b>", likely_cause: "`<script>`", fix_steps: ["[link](https://evil.example)"] }],
  };
  const html = renderHtml({ title: "t", generatedAt: "now", findings, explained, runs: [run], lang: "en" });
  assert.match(html, /Sent <strong>2<\/strong> times by <code>add_to_cart<\/code> &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /<strong>\+70\.4s<\/strong> &lt;b&gt;late&lt;\/b&gt;/);
  assert.match(html, /<code>&lt;script&gt;<\/code>/);
  assert.match(html, /\[link\]\(https:\/\/evil\.example\)/);
  assert.doesNotMatch(withoutScript(html), /<script|<img src=x|<b>late/);
});

test("a run against a plan names the plan in the report header, in English and Turkish", async () => {
  const { renderMarkdown } = await import("../src/report.js");
  const base = { title: "t", generatedAt: "now", findings: [], explained: null, runs: [] };
  assert.match(renderMarkdown({ ...base, against: "2026-10-16_0900" }), /Checked against plan 2026-10-16_0900/);
  assert.match(renderHtml({ ...base, against: "<x>" }), /Checked against plan &lt;x&gt;/);
  assert.match(renderMarkdown({ ...base, lang: "tr", against: "2026-10-16_0900" }), /2026-10-16_0900 planına göre kontrol edildi/);
  assert.doesNotMatch(renderMarkdown(base), /Checked against/);
});

test("findings are grouped by owner and carry verify links for their platform", async () => {
  const { renderMarkdown } = await import("../src/report.js");
  const f = [
    findings[0],
    { ...findings[0], severity: "risk", check: "after_reject", platform: "meta", event: "AddToCart", detail: "Meta fired after reject." },
    { ...findings[0], severity: "info", check: "unplanned_events", platform: undefined, event: undefined, detail: "Unplanned: x." },
  ];
  const html = renderHtml({ title: "t", generatedAt: "now", findings: f, explained: null, runs: [run], lang: "en" });
  const order = ["developer", "gtm", "marketing"].map((o) => html.indexOf(`data-owner="${o}"`));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2]);
  assert.match(html, /How to verify<\/span><\/h5><ul class="verify"><li><a href="https:\/\/tagassistant\.google\.com\/"/);
  assert.match(html, /Meta Test Events/);
  const tr = renderHtml({ title: "t", generatedAt: "now", findings: f, explained: null, runs: [run], lang: "tr" });
  assert.match(tr, /Nasıl doğrulanır/);
  const md = renderMarkdown({ title: "t", generatedAt: "now", findings: f, explained: null, runs: [run], lang: "en" });
  assert.match(md, /- How to verify: \[Tag Assistant\]\(https:\/\/tagassistant\.google\.com\/\), \[GA4 DebugView\]/);
});

test("a step's dataLayer pushes come in time order after its hits, and a hit without a push says so", () => {
  const html = renderHtml({ title: "t", generatedAt: "now", findings, explained: null, runs: [run], lang: "en" });
  const step = html.slice(html.indexOf('id="j0-s1"'), html.indexOf('class="netblock"', html.indexOf('id="j0-s1"')));
  const at = (x, from = 0) => step.indexOf(x, from);
  // The hit list first, then the consent command (the earlier push) before the add_to_cart push.
  assert.ok(at("Hits in this step") > 0 && at("Hits in this step") < at("<h5>dataLayer"));
  assert.ok(at("<h5>dataLayer") < at('<code class="ev">consent update</code>') && at('<code class="ev">consent update</code>') < at('<code class="ev">add_to_cart</code>', at("<h5>dataLayer")));
  // A hit no push explains says so in its Source box.
  const extra = { ...run, hits: [...run.hits, { platform: "ga4", name: "page_view", params: {}, url: "https://x/g/collect?en=page_view", step: 1, t: t0 + 1001 }] };
  const html2 = renderHtml({ title: "t", generatedAt: "now", findings, explained: null, runs: [extra], lang: "en" });
  assert.match(html2, /<code class="ev">page_view<\/code>[\s\S]*?<span class="lbl">dataLayer<\/span><span class="muted">No dataLayer push with this event name in this step\./);
  // Flagged hits stay flagged, with the severity as text.
  assert.match(step, /class="event flag-broken sev-broken"><details open>[\s\S]*?<span class="tag badge sev-broken"><svg[^>]*><use href="#sev-broken"\/><\/svg>Broken<\/span>/);
  const tr = renderHtml({ title: "t", generatedAt: "now", findings, explained: null, runs: [run], lang: "tr" });
  assert.match(tr, /Bu adımdaki istekler/);
});

test("a GTM tag's evaluation is shown as a why line under the finding, in both languages", () => {
  const gtm = [{ name: "GA4 - add_to_cart", type: "gaawe", paused: false, consent: [], triggers: [{ id: "10", name: "CE - add_to_cart", type: "CUSTOM_EVENT" }], blocking: [], evaluation: { fired: false, why: 'trigger "CE - add_to_cart" needs ecommerce.value greater than 0, the push had 0' } }];
  const withGtm = [{ ...findings[0], gtm }];
  const md = renderMarkdown({ title: "t", generatedAt: "now", findings: withGtm, explained: null, runs: [run] });
  assert.match(md, /- In your GTM container: GA4 - add_to_cart, Fires on CE - add_to_cart\n- Tag "GA4 - add_to_cart": did not fire — trigger "CE - add_to_cart" needs ecommerce.value greater than 0, the push had 0/);
  const html = renderHtml({ title: "t", generatedAt: "now", findings: withGtm, explained: null, runs: [run], lang: "tr" });
  assert.match(html, /&quot;GA4 - add_to_cart&quot; etiketi: tetiklenmedi — trigger &quot;CE - add_to_cart&quot; needs/);
});
