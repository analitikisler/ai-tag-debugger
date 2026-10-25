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
  // Each event's Source box names one push: duplicates are paired with their own push. The push is a link to its
  // card in the step's Data Layer tab since the inspector design.
  const sources = [...html.matchAll(/<span class="lbl">Data Layer<\/span>((?:<a class="mono"[^>]*>[^<]*<\/a>)+)<\/li>/g)].map((x) => [...x[1].matchAll(/href="([^"]+)"/g)].map((h) => h[1]));
  assert.deepEqual(sources, [["#j0-s1-d0"], ["#j0-s2-d0"], ["#j0-s2-d1"]]);
  const step2 = html.slice(html.indexOf('id="j0-s2"'));
  assert.ok(step2.indexOf("first") < step2.indexOf("second") && step2.indexOf("first") > 0);
  const onlyStep2 = renderHtml({ title: "t", generatedAt: "now", findings: f, explained: null, runs: [{ ...r, hits: r.hits.slice(1) }], lang: "en" });
  // Where links the step's first matching hit (…-h0) rather than the step row.
  assert.match(onlyStep2, /href="#j0-s2-h0"/);
  assert.doesNotMatch(onlyStep2, /href="#j0-s1-h0"/);
});

test("each step row lists its hits in time order, its dataLayer pushes and its network requests, with no script but the fixed one", () => {
  const html = renderHtml({ title: "t", generatedAt: "now", findings, explained: null, runs: [run], lang: "en" });
  // The step row became a step list item that selects the step's pane.
  assert.match(html, /<li class="jr-st sev-broken" data-flagged="broken"><button type="button" data-select-target="#j0-s1"/);
  // The "Details · 3 hits · 2 dataLayer" summary became the counts on the pane's Hits and Data Layer tabs.
  assert.match(html, /Hits <span class="n">3<\/span>/);
  assert.match(html, /Data Layer <span class="n">2<\/span>/);
  assert.match(html, /Network requests <span class="n">2<\/span>/);
  // Hits come in the order they were sent: Meta, GA4, then Pinterest.
  const step = html.slice(html.indexOf('id="j0-s1" data-select-pane'), html.indexOf('id="j0-s1-dl"'));
  const order = ['<use href="#p-meta"/></svg><span>Meta</span></span></span></span><code class="jr-ev">AddToCart', '<use href="#p-ga4"/></svg><span>GA4</span></span></span></span><code class="jr-ev">add_to_cart', '<use href="#p-pinterest"/></svg><span>Pinterest</span></span></span></span><code class="jr-ev">addtocart'].map((x) => step.indexOf(x));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], "hits in time order");
  // The Meta pixel's Source box names the GA4-named push behind it, as a link to the push (times read "+1.1 s").
  const meta = step.slice(order[0], order[1]);
  assert.match(meta, /<a class="mono" href="#j0-s1-d1">add_to_cart · \+1\.1 s<\/a>/);
  // dataLayer pushes and network requests are listed too, with parameter tips that take no focus.
  assert.match(html, /<code class="jr-ev">consent update<\/code>/);
  assert.match(html, /gtm\.js\?id=GTM-X/);
  assert.match(html, /<span class="q" aria-hidden="true" data-tip="Meta event name\.">\?<\/span><span class="sr">Meta event name\.<\/span>/);
  assert.doesNotMatch(html, /Other dataLayer pushes and network calls/);
  // Findings link to the hit (the step's GA4 add_to_cart, …-h1), flagged events are marked with the finding and link
  // back to its card, and page values are escaped. Hit cards start collapsed; a flagged one opens when printed.
  assert.match(html, /href="#j0-s1-h1"/);
  assert.match(html, /<details class="card jr-hit sev-broken" id="j0-s1-h1" data-flagged="broken" data-print-open>/);
  assert.match(html, /<p class="jr-flag sev-broken"><svg[^>]*><use href="#sev-broken"\/><\/svg><span><code>add_to_cart<\/code> was sent without <code>value<\/code>\.<\/span><a href="#f-ga4-add_to_cart-missing_params">Finding →<\/a><\/p>/);
  assert.doesNotMatch(html, /<img src=x/);
  // The MCP server's CSP allows the fixed script by its hash and nothing else.
  assert.doesNotMatch(withoutScript(html), /<script/i);
});

test("GA4 batches show every event, items are decoded, and out-of-scope providers are counted", () => {
  const r = {
    ...run,
    providers: ["ga4", "meta"],
    skipped: { 1: { "Microsoft Clarity": 3, DoubleClick: 1 } },
    // The batch's second event is a hit too, as a real capture records it: its card carries the request's own
    // parameters and their tips (percent_scrolled, tid), which the Requests table no longer lists.
    hits: [
      { platform: "ga4", name: "view_item", params: { items: "x" }, items: ["nmShoe~id42~pr10~qt2~cp~k0size~v0XL"], url: "https://region1.google-analytics.com/g/collect?v=2", step: 1, t: t0 + 1100 },
      { platform: "ga4", name: "scroll", params: { percent_scrolled: "90" }, url: "https://region1.google-analytics.com/g/collect?v=2&tid=G-ABC&cid=1.2", step: 1, t: t0 + 1100 },
    ],
    dataLayerLog: [{ value: { event: "view_item", ecommerce: { currency: "EUR", value: 20, items: [{ item_id: "42", item_name: "Shoe", price: 10, quantity: 2, size: "XL" }] } }, step: 1, t: t0 + 1050 }],
    network: [
      { method: "POST", url: "https://region1.google-analytics.com/g/collect?v=2&tid=G-ABC&cid=1.2", postData: "en=view_item&pr1=nmShoe~id42~pr10~qt2~k0size~v0XL\nen=scroll&epn.percent_scrolled=90", vendor: "Google Analytics", provider: "ga4", status: 204, blocked: true, step: 1, t: t0 + 1100 },
    ],
  };
  const html = renderHtml({ title: "t", generatedAt: "now", findings: [], explained: null, runs: [r], lang: "en" });
  assert.match(html, /1 of 2 in one request/);
  assert.match(html, /2 of 2 in one request/);
  assert.match(html, /<span class="jr-rev"><code>scroll<\/code><span class="muted">2 of 2 in one request<\/span><\/span>/);
  assert.match(html, /data-tip="Number event parameter: percent_scrolled\."/);
  assert.match(html, /data-tip="Measurement ID \(G-…\): which GA4 property the request goes to\."/);
  // Items from the GA4 item string and from the dataLayer push, now rows of an items table (cards before the
  // inspector design), with custom parameters in their own column.
  assert.ok((html.match(/<td class="mono">42<\/td><td>Shoe<\/td><td class="num">10<\/td><td class="num">2<\/td>/g) ?? []).length >= 2);
  assert.match(html, /<th scope="col">Custom item parameters<\/th><\/tr><\/thead><tbody><tr>.*?<span class="jr-ikv"><code>size<\/code> XL<\/span>/);
  // The Run facts, the inventory lines (GA4 seen with its request, Meta checked but not seen), the out-of-scope
  // card that replaced the providers table, and the step's skipped count.
  assert.match(html, /<dt>Platforms<\/dt><dd><span class="chip chip-plat ga4"><svg[^>]*><use href="#p-ga4"\/><\/svg>GA4<\/span><span class="chip chip-plat meta"><svg[^>]*><use href="#p-meta"\/><\/svg>Meta<\/span><\/dd>/);
  assert.match(html, /4 out-of-scope requests were skipped: Microsoft Clarity, DoubleClick\./);
  assert.match(html, /<details class="card inv" id="inv-ga4" data-seen="yes"><summary><span class="chip chip-plat ga4"><svg[^>]*><use href="#p-ga4"\/><\/svg>GA4<\/span><span class="chip chip-sev ok"><svg[^>]*><use href="#sev-ok"\/><\/svg>Seen<\/span><span class="inv-m"><b>1<\/b> request<\/span>/);
  assert.match(html, /id="inv-meta"[^>]*>.*?<span class="badge sev-info"><svg[^>]*><use href="#sev-info"\/><\/svg>Checked, not seen<\/span>/);
  assert.match(html, /<li><span>Microsoft Clarity<\/span><span class="badge">Out of scope<\/span><span class="inv-n"><b>3<\/b> requests<\/span><\/li>/);
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
  // The Summary keeps the headline on one line; the points and the "worth checking" list sit in the Findings
  // section's AI summary card.
  const ai = html.slice(html.indexOf('id="ai-summary"'), html.indexOf("</details>", html.indexOf('id="ai-summary"')));
  assert.ok(html.indexOf('id="findings"') < html.indexOf('id="ai-summary"') && html.indexOf('id="ai-summary"') < html.indexOf('id="journeys"'));
  assert.match(ai, /<li><span class="badge sev-broken"><svg[^>]*><use href="#sev-broken"\/><\/svg>Broken<\/span><span>Checkout funnel is cut\.<\/span><\/li>/);
  assert.match(ai, /Not in the findings list, but worth checking<\/p><ul class="fnd-change-list also"><li>A conversion fires on page load\.<\/li>/);
  // The impact strip shows the impact icon in place of the "Impact" label.
  assert.match(html, /<p class="fnd-impact"><svg[^>]*><use href="#ui-impact"\/><\/svg><span>The funnel looks broken\.<\/span><\/p>/);
  assert.match(html, /<ol class="fix-steps"><li><span>Open GTM\.<\/span><\/li><li><span>Add the tag\.<\/span><\/li><\/ol>/);
  // Broken findings come first, and every card starts collapsed (the design opens one on a click or a deep link).
  assert.ok(html.indexOf('data-sev="broken"') < html.indexOf('data-sev="warning"') && html.indexOf('data-sev="broken"') > 0);
  const cards = [...html.matchAll(/<details class="card sev-[a-z]+" id="f-[^"]+"([^>]*)>/g)].map((x) => x[1].replace(/"[^"]*"/g, '""'));
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.filter((attrs) => /\sopen(\s|$)/.test(attrs)), []);
  const md = renderMarkdown({ title: "t", generatedAt: "now", findings: f, explained, runs: [run], lang: "en" });
  assert.match(md, /\*\*begin_checkout never reaches GA4\.\*\*/);
  assert.match(md, /- Fix: 1\. Open GTM\.; 2\. Add the tag\./);
  const old = renderHtml({ title: "t", generatedAt: "now", findings: f, explained: { summary: "Plain text summary.", explanations: [{ finding: 0, likely_cause: "c", fix: "Do this." }] }, runs: [run], lang: "en" });
  assert.match(old, /<span class="ai-l">AI summary<\/span> Plain text summary\.<\/p>/);
  assert.match(old, /<ol class="fix-steps"><li><span>Do this\.<\/span><\/li><\/ol>/);
  // A plain-text summary has no points to list, so the Findings section carries no AI summary card.
  assert.doesNotMatch(old, /id="ai-summary"/);
});

test("reports carry the logos and credit line, and branding false leaves out the Analitik İşler parts", async () => {
  const { renderHtml: html, renderMarkdown: md } = await import("../src/report.js");
  const report = { title: "T", generatedAt: "now", findings: [], explained: null, runs: [], lang: "en" };
  const branded = html(report);
  assert.match(branded, /This report was made with the open source <a class="f-atd" href="https:\/\/github\.com\/analitikisler\/ai-tag-debugger"/);
  assert.match(branded, /<a href="https:\/\/analitikisler\.com" class="byline"/);
  assert.match(branded, /<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml;base64,/);
  // The brand's logos are sprite symbols whose ink is the text colour and whose point is the brand red (brand/ai/BRAND.md §4),
  // and the favicon tiles are data URIs, so the report needs no files and fetches nothing.
  assert.match(branded, /<symbol id="logo-master" viewBox="[^"]+"><path fill="currentColor" d="[^"]+"\/>.*<path style="fill:var\(--brand-point\)" d="[^"]+"\/><\/symbol>/);
  assert.match(branded, /<a class="f-atd"[^>]*><span class="logo f-mark"><img class="l-light" src="data:image\/svg\+xml;base64,[^"]+" alt="" height="16"><img class="l-dark" src="data:image\/svg\+xml;base64,/);
  assert.doesNotMatch(branded, /(src|srcset|href)="(?!data:|#|https:\/\/(analitikisler\.com|github\.com\/analitikisler\/ai-tag-debugger)")/);
  assert.match(md(report), /_Generated by ai tag debugger · \[analitikisler\.com\]\(https:\/\/analitikisler\.com\)_/);
  assert.match(html({ ...report, lang: "tr" }), /Bu rapor açık kaynak <a class="f-atd"[^>]*>.*ai tag debugger<\/a> ile oluşturuldu\./);
  assert.match(md({ ...report, lang: "tr" }), /ai tag debugger ile oluşturuldu/);
  const plain = html({ ...report, branding: false });
  assert.doesNotMatch(plain, /analitikisler\.com|Analitik İşler/);
  assert.match(plain, /aria-label="ai tag debugger"><use href="#logo-atd-lockup"\/>/);
  assert.doesNotMatch(md({ ...report, branding: false }), /analitikisler\.com/);
});

test("the report has seven sections, flagged steps are marked even with nothing captured, and plan coverage is shown", () => {
  const r = { ...run, steps: [...run.steps, { index: 2, label: "Checkout", t: t0 + 2000 }], providers: ["ga4", "meta"] };
  const plan = { events: [{ platform: "GA4", name: "add_to_cart" }, { platform: "ga4", name: "begin_checkout", journeys: ["checkout"] }, { platform: "ga4", name: "purchase", journeys: ["other"] }, { platform: "tiktok", name: "AddToCart" }] };
  const f = [{ ...findings[0], step: "Checkout", event: "nothing" }];
  const html = renderHtml({ title: "t", generatedAt: "now", findings: f, explained: null, runs: [r], plan, lang: "en" });
  // The four tab panels became seven sections, one rail link each; the script hides all but one through the hidden
  // attribute, so the markup carries none and every section shows without JavaScript.
  const sections = ["summary", "findings", "journeys", "consent", "coverage", "inventory", "run"];
  assert.deepEqual([...html.matchAll(/<section class="sec[^"]*" id="([^"]+)" aria-labelledby="\1-h">/g)].map((x) => x[1]), sections);
  const rail = html.slice(html.indexOf('<nav class="rail"'), html.indexOf("</nav>", html.indexOf('<nav class="rail"')));
  assert.deepEqual([...rail.matchAll(/<li><a href="#([a-z]+)"/g)].map((x) => x[1]), sections);
  assert.match(html, /\[hidden\]\{display:none!important\}/);
  assert.doesNotMatch(html, /<section class="sec[^>]* hidden/);
  // Step 2, which the finding points at, is flagged although nothing was captured in it.
  assert.match(html, /<li class="jr-st zero sev-broken" data-flagged="broken"><button type="button" data-select-target="#j0-s2"/);
  assert.match(html, /<article class="card jr-pane sev-broken" id="j0-s2" [^>]*data-flagged="broken"/);
  // With no hit in step 2, the Where chip falls back to the step's pane.
  assert.match(html, /<a class="chip chip-vp desktop" href="#j0-s2"><svg[^>]*><use href="#ui-desktop"\/><\/svg>checkout · desktop<\/a><span class="fnd-step"><span class="muted">step 2 ·<\/span> Checkout/);
  // Coverage: sent, not sent, not expected on this journey, and a provider that was not checked.
  const cov = html.slice(html.indexOf('<tbody id="cov-rows">'));
  assert.match(cov, /<code>add_to_cart<\/code><\/span><\/th><td class="cv-needs">.*?<\/td><td class="cv-c"><span class="chip chip-sev ok cv-g"><svg[^>]*><use href="#sev-ok"\/><\/svg><span class="sr"> sent<\/span><\/span><\/td>/);
  assert.match(cov, /<code>begin_checkout<\/code><\/span><\/th><td class="cv-needs">.*?<\/td><td class="cv-c"><span class="chip chip-sev warning"><svg[^>]*><use href="#sev-warning"\/><\/svg>not sent<\/span><\/td>/);
  assert.match(cov, /<code>purchase<\/code><\/span><\/th><td class="cv-needs">.*?<\/td><td class="cv-c muted">–<span class="sr"> not expected<\/span><\/td>/);
  assert.match(cov, /<code>AddToCart<\/code><span class="badge">not checked<\/span><\/span><\/th><td class="cv-needs">.*?<\/td><td class="cv-c muted">–<span class="sr"> not expected<\/span><\/td>/);
  // Without a plan the Coverage section says so.
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
  // The Meta hit's value is text, not a number: the parity card shows it escaped, never as NaN.
  assert.match(html, /1× · &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /NaN/);
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
  // Rows sort by severity now and carry their owner, which the owner filter groups by, in the owners' order.
  const findingsSec = html.slice(html.indexOf('id="findings"'), html.indexOf('id="journeys"'));
  assert.deepEqual([...findingsSec.matchAll(/data-filter="owner=([a-z]+)"/g)].map((x) => x[1]), ["developer", "gtm", "marketing"]);
  assert.match(findingsSec, /id="f-ga4-add_to_cart-missing_params"[^>]* data-owner="developer"/);
  assert.match(findingsSec, /id="f-meta-addtocart-after_reject"[^>]* data-owner="gtm"/);
  assert.match(findingsSec, /id="f-site-unplanned_events"[^>]* data-owner="marketing"/);
  // "How to verify" is a tab of the card, whose panel lists the links.
  assert.match(html, />How to verify<\/button>/);
  assert.match(html, /<div role="tabpanel" id="f-ga4-add_to_cart-missing_params-verify" data-label="How to verify"><ul class="fnd-links"><li><a href="https:\/\/tagassistant\.google\.com\/"/);
  assert.match(html, /Meta Test Events/);
  const tr = renderHtml({ title: "t", generatedAt: "now", findings: f, explained: null, runs: [run], lang: "tr" });
  assert.match(tr, /Nasıl doğrulanır/);
  const md = renderMarkdown({ title: "t", generatedAt: "now", findings: f, explained: null, runs: [run], lang: "en" });
  assert.match(md, /- How to verify: \[Tag Assistant\]\(https:\/\/tagassistant\.google\.com\/\), \[GA4 DebugView\]/);
});

test("a step's dataLayer pushes come in time order after its hits, and a hit without a push says so", () => {
  const html = renderHtml({ title: "t", generatedAt: "now", findings, explained: null, runs: [run], lang: "en" });
  const step = html.slice(html.indexOf('id="j0-s1" data-select-pane'), html.indexOf("</article>", html.indexOf('id="j0-s1" data-select-pane')));
  const at = (x, from = 0) => step.indexOf(x, from);
  // The lists became the pane's tabs, in the order Hits, Data Layer, Network requests; the consent command (the
  // earlier push) comes before the add_to_cart push.
  assert.ok(at('aria-controls="j0-s1-hits"') > 0 && at('aria-controls="j0-s1-hits"') < at('aria-controls="j0-s1-dl"') && at('aria-controls="j0-s1-dl"') < at('aria-controls="j0-s1-req"'));
  assert.ok(at('id="j0-s1-hits" data-label="Hits in this step"') > 0 && at('id="j0-s1-hits"') < at('id="j0-s1-dl"') && at('id="j0-s1-dl"') < at('id="j0-s1-req"'));
  assert.ok(at('id="j0-s1-dl"') < at('<code class="jr-ev">consent update</code>') && at('<code class="jr-ev">consent update</code>') < at('<code class="jr-ev">add_to_cart</code>', at('id="j0-s1-dl"')));
  // A hit no push explains says so in its Source box.
  const extra = { ...run, hits: [...run.hits, { platform: "ga4", name: "page_view", params: {}, url: "https://x/g/collect?en=page_view", step: 1, t: t0 + 1001 }] };
  const html2 = renderHtml({ title: "t", generatedAt: "now", findings, explained: null, runs: [extra], lang: "en" });
  assert.match(html2, /<code class="jr-ev">page_view<\/code>[\s\S]*?<span class="lbl">Data Layer<\/span><span class="muted">No dataLayer push with this event name in this step\./);
  // Flagged hits stay flagged, with the severity as text (hit cards start collapsed).
  assert.match(step, /<details class="card jr-hit sev-broken" id="j0-s1-h1" data-flagged="broken" data-print-open><summary>[\s\S]*?<span class="jr-c-s"><span class="badge sev-broken"><svg[^>]*><use href="#sev-broken"\/><\/svg>Broken<\/span>/);
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
