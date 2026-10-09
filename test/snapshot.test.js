// The page view finds the controls real sites build: custom div buttons, long menus, iframes.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AuditSession } from "../src/browser.js";
import { validateAction } from "../src/agent.js";

// Like a travel site: a huge menu first, then a booking widget whose button is a styled div with a JS listener.
const menu = Array.from({ length: 300 }, (_, i) => `<a href="/p${i}">Bölge ${i}</a>`).join(" ");
const PAGE = `<!doctype html><html><body>
<nav style="height:40px;overflow:hidden">${menu}</nav>
<section id="booking">
  <div class="date" style="cursor:pointer" id="checkin">Giriş tarihi seçin</div>
  <div class="btn-book" style="cursor:pointer;padding:12px;background:#f60"><span>Rezervasyon Yap</span></div>
  <span class="icon" style="cursor:pointer;display:inline-block;width:20px;height:20px" aria-label="Favorilere ekle"></span>
</section>
<iframe src="/frame" style="width:300px;height:80px"></iframe>
<div style="height:3000px"></div>
<footer><div style="cursor:pointer" id="late">Footer link</div></footer>
<script>
  window.dataLayer = window.dataLayer || [];
  document.querySelector(".btn-book").addEventListener("click", () => dataLayer.push({ event: "begin_checkout" }));
</script></body></html>`;
const FRAME = `<!doctype html><button onclick="parent.dataLayer.push({event:'frame_click'})">Odayı seç</button>`;

let server;
let url;
before(async () => {
  server = createServer((req, res) => res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(req.url === "/frame" ? FRAME : PAGE));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server.close());

const refOf = (elements, pattern) => Number(elements.split("\n").find((l) => pattern.test(l))?.match(/^\[(\d+)\]/)?.[1]);

test("custom div buttons are listed, on-screen ones before a long menu, and iframes too", async () => {
  const session = new AuditSession({ viewport: "desktop", site: url });
  await session.start();
  try {
    await session.act({ action: "goto", url });
    const { elements } = await session.snapshot();
    const book = refOf(elements, /clickable div "Rezervasyon Yap"/);
    assert.ok(book, "the div button is listed");
    assert.ok(refOf(elements, /"Giriş tarihi seçin"/));
    assert.ok(refOf(elements, /"Favorilere ekle"/));
    assert.match(elements, /\(inside an embedded frame/);
    assert.ok(refOf(elements, /button "Odayı seç"/), "the iframe button is listed");
    assert.match(elements, /more elements not listed/);

    assert.equal(await session.act({ action: "click", ref: book }), null);
    assert.ok(session.dataLayerLog.some((e) => e.value?.event === "begin_checkout"));

    const frameRef = refOf(elements, /button "Odayı seç"/);
    assert.equal(await session.act({ action: "click", ref: frameRef }), null);
    assert.ok(session.dataLayerLog.some((e) => e.value?.event === "frame_click"));
  } finally {
    await session.close();
  }
});

test("the agent can click by visible text when an element has no ref, and scroll reaches the footer", async () => {
  const session = new AuditSession({ viewport: "desktop", site: url });
  await session.start();
  try {
    await session.act({ action: "goto", url });
    const before = session.dataLayerLog.length;
    assert.equal(await session.act({ action: "click", text: "Rezervasyon Yap" }), null);
    assert.ok(session.dataLayerLog.slice(before).some((e) => e.value?.event === "begin_checkout"));

    for (let i = 0; i < 4; i++) await session.act({ action: "scroll" });
    const { elements } = await session.snapshot();
    assert.match(elements.split("\n").find((l) => /Footer link/.test(l)) ?? "", /^\[\d+\] clickable div "Footer link"$/);
  } finally {
    await session.close();
  }
});

test("click, fill and select accept text instead of ref", () => {
  assert.equal(validateAction({ action: "click", text: "Rezervasyon Yap" }), null);
  assert.match(validateAction({ action: "click" }), /ref, or the element's visible text/);
});

// Small pages for the click and text-matching rules.
const pages = {
  "/wall": `<!doctype html><button id="buy" onclick="dataLayer.push({event:'buy'})">Buy</button>
    <div role="dialog" aria-modal="true" style="position:fixed;inset:0;background:rgba(0,0,0,.6)"><button onclick="this.parentNode.remove()">Accept all</button></div>
    <script>window.dataLayer=[]</script>`,
  "/badge": `<!doctype html><button id="buy" style="margin:40px;width:100px" onclick="dataLayer.push({event:'buy'})">Buy</button>
    <div style="position:fixed;left:30px;top:30px;width:80px;height:40px;background:red"></div><script>window.dataLayer=[]</script>`,
  "/text": `<!doctype html><nav><a href="#nav" onclick="dataLayer.push({event:'nav'})">Rezervasyon Yap ve Öde Bilgileri</a></nav>
    <button onclick="dataLayer.push({event:'book'})">Rezervasyon Yap</button>
    <button>Seç</button><button>Seç</button>
    <iframe src="/inner" style="width:300px;height:80px"></iframe>
    <iframe src="/inner-hidden" style="display:none"></iframe><script>window.dataLayer=[]</script>`,
  "/inner": `<!doctype html><button onclick="parent.dataLayer.push({event:'room'})">Odayı onayla</button>`,
  "/inner-hidden": `<!doctype html><button>Gizli reklam</button>`,
  "/shadow": `<!doctype html><x-card></x-card><button id="toggle">Toggle</button><script>
    const host = document.querySelector("x-card"); const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<button id="inner">Shadow button</button>';
    document.querySelector("#toggle").onclick = () => { root.querySelector("#inner").style.display = "none"; };
  </script>`,
};
let small;
let base;
before(async () => {
  small = createServer((req, res) => res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(pages[req.url] ?? ""));
  await new Promise((r) => small.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${small.address().port}`;
});
after(() => small.close());

async function withPage(pathname, fn) {
  const session = new AuditSession({ viewport: "desktop", site: base });
  await session.start();
  try {
    assert.equal(await session.act({ action: "goto", url: base + pathname }), null);
    await fn(session);
  } finally {
    await session.close();
  }
}
const events = (session) => session.dataLayerLog.map((e) => e.value?.event).filter(Boolean);

test("a click never goes through a consent wall or modal", async () => {
  await withPage("/wall", async (session) => {
    const error = await session.act({ action: "click", selector: "#buy" });
    assert.match(error, /covered by div role=dialog/);
    assert.ok(!events(session).includes("buy"));
  });
});

test("a small overlap is clicked through with real mouse events, and the step says so", async () => {
  await withPage("/badge", async (session) => {
    assert.equal(await session.act({ action: "click", selector: "#buy" }), null);
    assert.ok(events(session).includes("buy"));
    const step = session.steps.at(-1);
    assert.ok(step.forced);
    assert.match((await session.snapshot()).note, /not covered by div/);
  });
});

test("text picks the exact visible match over a partial one, reports ambiguity, and reaches visible iframes only", async () => {
  await withPage("/text", async (session) => {
    assert.equal(await session.act({ action: "click", text: "Rezervasyon Yap" }), null);
    assert.deepEqual(events(session), ["book"]);
    assert.match(await session.act({ action: "click", text: "Seç" }), /2 elements match "Seç"/);
    assert.equal(await session.act({ action: "click", text: "Odayı onayla" }), null);
    assert.ok(events(session).includes("room"));
    assert.match(await session.act({ action: "click", text: "Gizli reklam" }), /No visible element/);
    const { elements } = await session.snapshot();
    assert.match(elements, /Odayı onayla/);
    assert.doesNotMatch(elements, /Gizli reklam/);
    assert.doesNotMatch(elements, /more elements not listed/);
  });
});

test("refs inside shadow roots are cleared when an element drops out of the list", async () => {
  await withPage("/shadow", async (session) => {
    let { elements } = await session.snapshot();
    assert.match(elements, /Shadow button/);
    await session.act({ action: "click", selector: "#toggle" });
    ({ elements } = await session.snapshot());
    assert.doesNotMatch(elements, /Shadow button/);
    const tagged = await session.page.evaluate(() => {
      const inner = document.querySelector("x-card").shadowRoot.querySelector("#inner");
      return inner.hasAttribute("data-atd-ref");
    });
    assert.equal(tagged, false);
  });
});

test("a non-integer ref is rejected", () => {
  assert.match(validateAction({ action: "click", ref: "1] , a", text: "x" }), /ref must be an integer/);
});

test("a partial-screen cookie banner blocks clicks too, and ad-slot iframes are skipped", async () => {
  pages["/banner"] = `<!doctype html><button id="buy" style="position:fixed;bottom:20px;left:20px" onclick="dataLayer.push({event:'buy'})">Buy</button>
    <div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;height:90px;background:#eee">We use cookies <button>Accept</button></div>
    <iframe id="google_ads_iframe_1" name="google_ads_iframe_1" style="width:300px;height:250px" srcdoc="<button>Ad button</button>"></iframe>
    <script>window.dataLayer=[]</script>`;
  await withPage("/banner", async (session) => {
    assert.match(await session.act({ action: "click", selector: "#buy" }), /covered by div#onetrust-banner-sdk/);
    assert.ok(!events(session).includes("buy"));
    assert.doesNotMatch((await session.snapshot()).elements, /Ad button/);
  });
});

test("a sticky header with an AEM cmp-* class is not mistaken for a consent banner", async () => {
  pages["/aem"] = `<!doctype html><button id="buy" style="position:fixed;top:10px;left:20px;width:120px" onclick="dataLayer.push({event:'buy'})">Buy</button>
    <header class="cmp-navigation" style="position:sticky;top:0;height:30px;width:110px;background:#ccc">Menu</header>
    <script>window.dataLayer=[]</script>`;
  await withPage("/aem", async (session) => {
    assert.equal(await session.act({ action: "click", selector: "#buy" }), null);
    assert.ok(events(session).includes("buy"));
    assert.ok(session.steps.at(-1).forced, "the header did overlap the button");
  });
});
