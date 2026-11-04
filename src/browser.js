import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, devices } from "playwright";
import { parseTrackingRequest, isCollectionEndpoint, providerOf, vendorOf, resolveProviders, PROVIDERS } from "./parsers.js";
import { redactBody, redactParams, redactPush, redactUrl, siteOf } from "./redact.js";
import { hostScope, isPrivateAddress, navigationError, privateHostChecker } from "./guard.js";
import { startEgressProxy } from "./egress.js";
import { campaignParamsIn } from "./campaign.js";
import { detectCmpInPage } from "./cmp.js";
import { callersOf, containerOf, containerVersion, isContainerId } from "./containers.js";
import { frameInfo } from "./frames.js";
import { fillLoginValue, hasLoginPlaceholder, loginFromEnv, loginScrubber, scrubDeep } from "./login.js";

// Consent banners of the common consent platforms (CMPs), by their container. A cover that matches
// one of these always blocks the journey, and a reject click is checked against them afterwards.
let browserInstall = null;
/** Downloads Chromium with Playwright's own installer. Output goes to stderr, because stdout carries the MCP protocol. */
export function installBrowser() {
  browserInstall ??= new Promise((resolve, reject) => {
    const cli = path.join(path.dirname(createRequire(import.meta.url).resolve("playwright/package.json")), "cli.js");
    console.error("ai-tag-debugger: installing the Chromium browser (one time, about a minute)...");
    const child = spawn(process.execPath, [cli, "install", "chromium"], { stdio: ["ignore", 2, 2] });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Installing the browser failed (exit code ${code}). Run: npx -y playwright@1.56.1 install chromium`))));
  }).finally(() => { browserInstall = null; });
  return browserInstall;
}

export const CMP_BANNER_SELECTORS = `#onetrust-banner-sdk, #onetrust-consent-sdk, #CybotCookiebotDialog, #usercentrics-root, #didomi-host, #cookiescript_injected, .cky-consent-container, .cc-window, #cmpbox, .qc-cmp2-container, \
#truste-consent-track, #consent_blackbar, .osano-cm-window, #iubenda-cs-banner, .iubenda-cs-container, #cmplz-cookiebanner-container, .cmplz-cookiebanner, #cookiefirst-root, .cookiefirst-root, #axeptio_overlay, \
#sp_message_container, [id^="sp_message_container_"], #cookie-law-info-bar, #BorlabsCookieBox, .klaro, #termly-code-snippet-support, #cookie-information-template-wrapper, #coiOverlay, \
#cmpwrapper, #cmpbox2, .fc-consent-root, #ppms_cm_popup_overlay, [aria-label*="cookie" i][role=dialog], \
[data-name^="Banner"][efl-consent-not-saved]`;
// Efilli draws its banner inside the open shadow root of <efilli-layout-dynamic>, so the checks below also look inside open shadow roots.

// Caps on what one audit records, so a looping page can't grow memory without limit.
const LOG_LIMITS = { hits: 5000, dataLayerLog: 5000, network: 10000, containerLoads: 500, containerScripts: 500, frameMessages: 1000 };

// Secrets the browser process has no use for. It gets the rest of the environment
// (PATH, HOME, DISPLAY...) so Chromium still starts normally.
const SECRET_ENV = /(API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY|_KEY$|^AWS_|^AZURE_|^GOOGLE_APPLICATION|^AITD_LOGIN)/i;
export const browserEnv = (env = process.env) => Object.fromEntries(Object.entries(env).filter(([k]) => !SECRET_ENV.test(k)));

export const VIEWPORTS = {
  desktop: { viewport: { width: 1366, height: 900 } },
  mobile: devices["Pixel 7"],
};

// Runs in the page before any site script: reports every dataLayer push
// (including gtag consent commands) to Node through an exposed binding, so the
// log survives page navigations.
/** A page address without its hash, for matching page_location to navigations. */
const pageKey = (url) => String(url ?? "").split("#")[0];
/** The host of a URL, or null. */
const hostOf = (url) => {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
};

// Runs inside INIT_SCRIPT: records each Google container script (gtm.js, gtag/js) the page adds, through
// window.__atdLoad, with how it got there. One set by a script carries that moment's call stack, whose script
// addresses tell who asked for it (see src/containers.js); one the HTML parser inserted never passes through
// the setters, so a MutationObserver reports it. A container reading another dataLayer gets it watched.
const CONTAINER_HOOK = `
  const docUrl = location.href;
  const doc = Math.random().toString(36).slice(2, 10);
  const isContainer = (src) => /\\/(gtm\\.js|gtag\\/js)\\?/.test(String(src)) && /[?&]id=/.test(String(src));
  const seen = new WeakSet();
  const report = (el, src, how) => {
    try {
      const abs = new URL(String(src), document.baseURI).href;
      if (!isContainer(abs) || !window.__atdLoad) return;
      const layer = new URL(abs).searchParams.get("l") || "dataLayer";
      watch(layer);
      let frames = [];
      if (how === "script") {
        const limit = Error.stackTraceLimit;
        Error.stackTraceLimit = 50;
        const stack = String(new Error().stack || "");
        Error.stackTraceLimit = limit;
        // The first two frames are report() and the setter, both from this script; injected inline code
        // (a Custom HTML tag) has no address and shows as <anonymous>.
        frames = stack.split("\\n").filter((line) => /^\\s+at /.test(line)).slice(2)
          .map((line) => (line.match(/(https?:\\/\\/[^\\s()]+?):\\d+:\\d+/) || [])[1] || (/<anonymous>/.test(line) ? "inline" : null))
          .filter(Boolean);
      }
      window.__atdLoad({ src: abs, how, frames, documentUrl: docUrl, page: location.href, doc });
    } catch {}
  };
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, "src");
    Object.defineProperty(HTMLScriptElement.prototype, "src", {
      ...desc,
      set(v) { if (!seen.has(this)) { seen.add(this); report(this, v, "script"); } return desc.set.call(this, v); },
    });
    const setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, v) {
      if (this instanceof HTMLScriptElement && String(name).toLowerCase() === "src" && !seen.has(this)) { seen.add(this); report(this, v, "script"); }
      return setAttribute.call(this, name, v);
    };
    new MutationObserver((list) => {
      for (const m of list) for (const n of m.addedNodes) {
        if (n instanceof HTMLScriptElement && n.src && !seen.has(n)) { seen.add(n); report(n, n.src, "parser"); }
        // A preload hint downloads a container without running it; caught as it is added, since a page's own code
        // can rewrite <head> and take it out again.
        else if (n instanceof HTMLLinkElement && /(^|\\s)(preload|modulepreload|prefetch)(\\s|$)/i.test(n.rel) && n.href && !seen.has(n)) { seen.add(n); report(n, n.href, "preload"); }
      }
    }).observe(document, { childList: true, subtree: true });
  } catch {}
`;

// Runs inside INIT_SCRIPT, in the page itself only: records each message an iframe posts to the page, through
// window.__atdMessage. Only a name and the field names are kept, never the values, since a form iframe's message
// can carry what the visitor typed. A message with nothing that reads as a name is not reported.
const MESSAGE_HOOK = `
  if (window === window.top) {
    const nameKeys = ["event", "eventName", "event_name", "type", "action", "name", "message"];
    const summarize = (data) => {
      let d = data;
      if (typeof d === "string") {
        try { d = JSON.parse(d); } catch {
          return d.length <= 80 && /^[\\w.:\\- ]+$/.test(d) ? { name: d, keys: [] } : null;
        }
      }
      if (!d || typeof d !== "object" || Array.isArray(d)) return null;
      const key = nameKeys.find((k) => typeof d[k] === "string" && d[k] && d[k].length <= 80);
      return key ? { name: d[key], nameKey: key, keys: Object.keys(d).slice(0, 20) } : null;
    };
    addEventListener("message", (e) => {
      try {
        if (e.source === window || !window.__atdMessage) return;
        const info = summarize(e.data);
        if (info) window.__atdMessage({ origin: String(e.origin), ...info });
      } catch {}
    }, true);
  }
`;

const INIT_SCRIPT = `(() => {
  const record = (entry, layer = "dataLayer") => {
    let value = entry;
    try {
      // gtag() pushes an arguments object; store it as a plain array.
      if (entry && typeof entry === "object" && typeof entry.length === "number" && !Array.isArray(entry)) value = Array.from(entry);
      // GTM click and form events carry DOM elements and objects that refer to themselves.
      // Copied by hand so only true cycles (an object inside itself) are cut, not shared objects.
      const copy = (v, parents) => {
        if (typeof v === "bigint") return String(v);
        if (typeof v === "function" || typeof v === "symbol") return undefined;
        if (!v || typeof v !== "object") return v;
        if (typeof Element !== "undefined" && v instanceof Element) return "<" + v.tagName.toLowerCase() + (v.id ? "#" + v.id : "") + ">";
        if (typeof Node !== "undefined" && v instanceof Node) return "[node]";
        if (v === window) return "[window]";
        if (parents.includes(v)) return "[circular]";
        if (parents.length > 20) return "[too deep]";
        if (typeof v.toJSON === "function") { try { return copy(v.toJSON(), parents); } catch { return String(v); } }
        parents.push(v);
        let out;
        if (Array.isArray(v)) out = v.map((x) => { const c = copy(x, parents); return c === undefined ? null : c; });
        else {
          out = {};
          for (const k of Object.keys(v)) {
            let x;
            try { x = v[k]; } catch { continue; }
            const c = copy(x, parents);
            if (c !== undefined) out[k] = c;
          }
        }
        parents.pop();
        return out;
      };
      value = JSON.parse(JSON.stringify(copy(value, [])));
    } catch { value = String(entry); }
    if (window.__atdRecord) window.__atdRecord({ url: location.href, value, ...(layer === "dataLayer" ? {} : { layer }) });
  };
  const wrap = (dl, layer) => {
    if (!dl || dl.__atdWrapped || typeof dl.push !== "function") return dl;
    dl.forEach((e) => record(e, layer));
    const push = dl.push.bind(dl);
    dl.push = (...items) => { items.forEach((e) => record(e, layer)); return push(...items); };
    dl.__atdWrapped = true;
    return dl;
  };
  const watched = new Set();
  // A container can read a dataLayer of another name (gtm.js?l=myDataLayer); it is watched once one is seen.
  const watch = (layer) => {
    if (watched.has(layer) || !/^[A-Za-z_$][\\w$]*$/.test(layer)) return;
    watched.add(layer);
    try {
      let current = layer === "dataLayer" ? wrap(window[layer] || [], layer) : wrap(window[layer], layer);
      Object.defineProperty(window, layer, {
        configurable: true,
        get: () => current,
        set: (v) => { current = wrap(v, layer); },
      });
    } catch { /* a property the page made unconfigurable */ }
  };
  watch("dataLayer");
${CONTAINER_HOOK}
${MESSAGE_HOOK}
})();`;

// Labels the interactive elements of one frame with numeric refs, starting at
// `first`, and returns a compact text view for the agent. Besides links, buttons
// and form fields, it finds custom controls that sites build from divs and spans
// (role attributes, tabindex, or a pointer cursor). Elements on screen come first,
// so a long menu or footer can't push the button the agent needs out of the list.
function snapshotInPage({ first, limit, textLimit, frameBox, offscreenLimit = null }) {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0;
  };
  const clean = (t) => (t || "").replace(/\s+/g, " ").trim();
  const label = (el) => {
    const labelledBy = el.getAttribute("aria-labelledby");
    const byId = labelledBy ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ") : "";
    const forLabel = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText : "";
    const img = el.querySelector?.("img[alt], svg title");
    return clean(
      el.getAttribute("aria-label") || byId || el.innerText || (el.type === "password" ? "" : el.value) || forLabel || el.getAttribute("placeholder") ||
        el.getAttribute("title") || (img ? img.getAttribute("alt") || img.textContent : "") || el.getAttribute("name") || "",
    ).slice(0, 80);
  };
  const NATIVE = "a[href], button, input:not([type=hidden]), select, textarea, summary, [contenteditable=true]";
  const ROLES = "[role=button], [role=link], [role=tab], [role=option], [role=menuitem], [role=checkbox], [role=radio], [role=switch], [role=combobox], [role=gridcell], [onclick], [tabindex]:not([tabindex='-1'])";
  // Every element in the document, including open shadow roots.
  const all = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll("*")) {
      all.push(el);
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);
  // Refs from the previous page view, including inside shadow roots.
  for (const el of all) if (el.hasAttribute("data-atd-ref")) el.removeAttribute("data-atd-ref");
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const found = new Set();
  for (const el of all) {
    if (el.matches(NATIVE) || el.matches(ROLES)) found.add(el);
  }
  // Custom controls: a pointer cursor where the parent has none, with text or a label.
  // Only for elements within a screen or so of the visible area, to keep this fast on big pages.
  const parentOf = (el) => el.parentElement ?? el.getRootNode().host ?? null;
  for (const el of all) {
    if (found.has(el) || el === document.body || el === document.documentElement) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || r.bottom < -vh || r.top > 2 * vh) continue;
    if (getComputedStyle(el).cursor !== "pointer") continue;
    const parent = parentOf(el);
    if (parent && parent.nodeType === 1 && getComputedStyle(parent).cursor === "pointer") continue;
    if (el.closest(NATIVE) || el.closest(ROLES)) continue;
    if (!visible(el)) continue;
    if (label(el)) found.add(el);
  }
  // Tier 0: on screen and actually on top at its center. Tier 1: above or below the
  // visible area. Tier 2: on screen but covered or clipped (collapsed menus, overlays).
  // In an iframe, "on screen" also means inside the frame's visible box in the main page.
  const inView = (r) => {
    if (r.bottom <= 0 || r.top >= vh) return false;
    if (!frameBox) return true;
    const top = frameBox.y + r.top;
    return top + r.height > 0 && top < frameBox.viewportHeight;
  };
  const tierOf = (el) => {
    const r = el.getBoundingClientRect();
    if (!inView(r)) return 1;
    const x = Math.min(Math.max(r.left + r.width / 2, 0), vw - 1);
    const y = Math.min(Math.max(r.top + r.height / 2, 0), vh - 1);
    let hit = document.elementFromPoint(x, y);
    while (hit?.shadowRoot && hit.shadowRoot.elementFromPoint(x, y) && hit.shadowRoot.elementFromPoint(x, y) !== hit) hit = hit.shadowRoot.elementFromPoint(x, y);
    return hit && (hit === el || el.contains(hit)) ? 0 : 2;
  };
  const ranked = [...found]
    .filter(visible)
    .map((el, order) => ({ el, order, tier: tierOf(el) }))
    .sort((a, b) => a.tier - b.tier || a.order - b.order);
  const firstCovered = ranked.findIndex((x) => x.tier === 2);
  let offscreen = 0;
  const items = ranked
    .filter((item, i) => item.tier < 2 || i - firstCovered < 30) // only a few covered or clipped ones
    // A compact view keeps a few elements above or below the screen; scrolling brings the rest on screen.
    .filter((item) => item.tier !== 1 || offscreenLimit === null || offscreen++ < offscreenLimit)
    .slice(0, limit)
    .map((item) => ({ ...item, onScreen: item.tier === 0 }));
  const lines = [];
  let ref = first;
  for (const { el, onScreen } of items) {
    el.setAttribute("data-atd-ref", String(ref));
    const tag = el.tagName.toLowerCase();
    let desc = el.getAttribute("role") || tag;
    if (tag === "input") desc = `input[type=${el.type}]${el.name ? ` name=${el.name}` : ""}${el.readOnly ? " readonly" : ""}`;
    if (tag === "a") desc = `link -> ${el.getAttribute("href")}`;
    if (tag === "select") desc = `select${el.name ? ` name=${el.name}` : ""} options=${[...el.options].map((o) => o.value).join("|").slice(0, 200)}`;
    if (!["a", "button", "input", "select", "textarea"].includes(tag) && !el.getAttribute("role")) desc = `clickable ${tag}`;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") desc += " disabled";
    lines.push(`[${ref}] ${desc} "${label(el)}"${onScreen ? "" : " (not in view)"}`);
    ref += 1;
  }
  const text = (document.body?.innerText || "").replace(/\s+\n/g, "\n").slice(0, textLimit);
  return { url: location.href, title: document.title, lines, next: ref, text, more: ranked.length > items.length };
}

const MAX_ELEMENTS = 250;

const MAX_BODY = 32 * 1024;
export const MAX_TOTAL_BODIES = 2 * 1024 * 1024;
/** A tracking request's POST body (GA4 batches, TikTok JSON), so the report can show every event in it. */
function trackingBody(request) {
  if (request.method() !== "POST" || !parseTrackingRequest(request.url(), null)) return null;
  const body = request.postData();
  return body ? (body.length > MAX_BODY ? body.slice(0, MAX_BODY) : body) : null;
}

/**
 * How a scripted run can find the element an action used again: the selector it was given,
 * else a CSS path to the element, else its visible text. Refs only mean something in one run.
 */
/** Query parameters that only carry the time or a cache-buster, so they differ between a recording and its replay. */
const STAMP_PARAMS = /^(_|_t|ts|timestamp|cb|cachebust|nocache)$/i;
/** The address without its timestamp parameters. */
function unstamped(href) {
  let url;
  try { url = new URL(href); } catch { return href; }
  for (const name of [...url.searchParams.keys()]) if (STAMP_PARAMS.test(name)) url.searchParams.delete(name);
  return url.href;
}
/**
 * The GET answers in a recording whose address carries a timestamp, by address without it.
 * Entries the recording has no body for (still loading when the page was left) are not included.
 */
function restampedAnswers(har) {
  const answers = new Map();
  answers.exact = new Set();
  for (const e of har.log.entries) {
    const { request, response } = e;
    answers.exact.add(request.url);
    if (request.method !== "GET" || response.status < 200 || response.status >= 300 || typeof response.content?.text !== "string") continue;
    const key = unstamped(request.url);
    if (key === request.url) continue;
    const headers = {};
    for (const h of response.headers ?? []) {
      const name = h.name.toLowerCase();
      if (["content-encoding", "content-length", "transfer-encoding"].includes(name)) continue;
      headers[name] = name === "set-cookie" && headers[name] ? `${headers[name]}\n${h.value}` : h.value;
    }
    const body = response.content.encoding === "base64" ? Buffer.from(response.content.text, "base64") : response.content.text;
    const entry = answers.get(key) ?? { queue: [] };
    entry.queue.push({ status: response.status, headers, body });
    answers.set(key, entry);
  }
  return answers;
}
// Text that looks like an email address or phone number is not saved with a click.
const savableText = (text) => (typeof text === "string" && text && !/@|\d[\d\s().+-]{6,}\d/.test(text) ? text : undefined);

async function replayTarget(a, locator) {
  // Only a click keeps its text: a field's text is what was typed in it, not what identifies it.
  const keepText = a.action === "click";
  if (a.selector) return { selector: a.selector, ...(keepText && savableText(a.text) ? { text: a.text } : {}) };
  const found = await locator
    .evaluate((el) => {
      const text = (el.innerText || el.value || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 80);
      if (window !== window.top) return { text };
      const parts = [];
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        if (n.id && document.querySelectorAll(`#${CSS.escape(n.id)}`).length === 1) {
          parts.unshift(`#${CSS.escape(n.id)}`);
          break;
        }
        let i = 1;
        for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) i++;
        parts.unshift(`${n.tagName.toLowerCase()}:nth-of-type(${i})`);
      }
      return { selector: parts.join(" > "), text };
    }, null, { timeout: 5000 })
    .catch(() => null);
  const text = found?.text || a.text;
  // The text too, since a path through the page's layout breaks when a banner or overlay shifts it.
  if (found?.selector) return { selector: found.selector, ...(keepText && savableText(text) ? { text } : {}) };
  return keepText && savableText(text) ? { text } : {};
}

// Images, fonts and video don't change what tracking sends, and are most of a recording's size.
const MEDIA = /^(image|font|video|audio)\//;

const MEDIA_FILE = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|mov|mp3|m4a|ogg|wav)$/i;
const isDroppedMedia = (request) =>
  ["image", "font", "media"].includes(request.resourceType()) || MEDIA_FILE.test(new URL(request.url()).pathname);

// Cookies the server sets for the page's scripts (a country or language, for example) are kept, since
// sites often need them to render. HttpOnly ones, where sessions and logins usually live, are dropped,
// and so are ones named or holding like a login. Replay applies only one Set-Cookie header, so the
// kept ones are joined into one, one cookie per line.
const LOGIN_COOKIE = /sess|sid|token|auth|jwt|login|csrf|xsrf|remember/i;
function keptHeaders(headers) {
  const isSetCookie = (h) => /^set-cookie$/i.test(h.name);
  const isPrivate = (cookie) => {
    const [pair] = cookie.split(";");
    const name = pair.slice(0, pair.indexOf("=")).trim();
    return /;\s*httponly\s*(;|$)/i.test(cookie) || LOGIN_COOKIE.test(name) || /@|%40/.test(pair);
  };
  const cookies = headers.filter(isSetCookie).flatMap((h) => h.value.split("\n")).filter((c) => !isPrivate(c));
  return [...headers.filter((h) => !isSetCookie(h)), ...(cookies.length ? [{ name: "Set-Cookie", value: cookies.join("\n") }] : [])];
}

const CLOSE_TIMEOUT_MS = 30_000;

const SECRET_REQUEST_HEADER = /^(cookie|authorization|proxy-authorization)$/i;

/**
 * Drops images, fonts, video and tracking requests from a recording (they are answered locally on replay, and their
 * URLs can hold the user data redacted everywhere else), unanswered requests, requests with user data in their address, form bodies,
 * the cookies the browser sent, HttpOnly cookies the server set, and authorization headers.
 */
async function cleanRecording(file) {
  const har = JSON.parse(await readFile(file, "utf8"));
  har.log.entries = har.log.entries
    .filter((e) => !isCollectionEndpoint(e.request.url) && !MEDIA.test(e.response?.content?.mimeType ?? ""))
    // A request that had no answer yet when the browser closed would never finish on replay either.
    .filter((e) => e.response?.status > 0)
    // A request whose address holds user data (an email in a form GET, for example) is left out whole.
    .filter((e) => redactUrl(e.request.url).url === e.request.url)
    .map((e) => {
      // Form bodies are dropped; replay then matches POSTs by address and method.
      const { postData: _postData, ...request } = e.request;
      return {
        ...e,
        request: { ...request, cookies: [], headers: request.headers.filter((h) => !SECRET_REQUEST_HEADER.test(h.name)) },
        response: { ...e.response, cookies: [], headers: keptHeaders(e.response.headers) },
      };
    });
  await writeFile(file, JSON.stringify(har));
}

/** Where the step left the browser, without query or fragment, so the route can be compared across runs. */
function pagePath(href) {
  try {
    const u = new URL(href);
    return /^https?:$/.test(u.protocol) ? u.origin + u.pathname : null;
  } catch {
    return null;
  }
}

const NAVIGATION_RETRY_MS = 2000;

// Chromium network errors that a second try can get past: the connection dropped, the network changed,
// a lookup or the server took too long. Blocked, refused-by-proxy, certificate and protocol errors are not here.
const TRANSIENT_NET_ERRORS = /net::ERR_(CONNECTION_(RESET|CLOSED|ABORTED|REFUSED|TIMED_OUT)|TIMED_OUT|NETWORK_CHANGED|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|DNS_TIMED_OUT|INTERNET_DISCONNECTED|ADDRESS_UNREACHABLE|EMPTY_RESPONSE|SOCKET_NOT_CONNECTED|HTTP2_(PROTOCOL|SERVER_REFUSED_STREAM|PING_FAILED)|NETWORK_IO_SUSPENDED|SPDY_PROTOCOL_ERROR|QUIC_PROTOCOL_ERROR)\b/;

// goto's error when Chromium committed its error page before goto heard why the load failed. It has no
// net::ERR_* code; the failed document request does. Other interruptions say nothing about the network.
const ERROR_PAGE_INTERRUPTION = /interrupted by another navigation to "chrome-error:/;

/**
 * The net::ERR_* code or "timeout" from a Playwright navigation error, for the log line. failedLoad is the
 * error text of the main frame's failed document request, which counts when an error page cut goto short.
 */
function navigationErrorCode(err, failedLoad) {
  const message = String(err?.message ?? err);
  if (ERROR_PAGE_INTERRUPTION.test(message)) return failedLoad?.match(/net::ERR_[A-Z0-9_]+/)?.[0] ?? "error";
  return message.match(/net::ERR_[A-Z0-9_]+/)?.[0] ?? (err?.name === "TimeoutError" || /Timeout \d+ms exceeded/.test(message) ? "timeout" : "error");
}

/** True when a failed navigation is worth one more try: a transient network error or a timeout. */
export function isTransientNavigationError(err, failedLoad) {
  const code = navigationErrorCode(err, failedLoad);
  return code === "timeout" || TRANSIENT_NET_ERRORS.test(code);
}

/**
 * What a step's analytics and ad cookies say, without keeping their values: the GA4 client id from _ga
 * (the cid GA4 hits carry anyway), whether _gcl_aw and _fbc hold the click ids the landing page was opened
 * with ("landing") or other ones ("other"), and whether _gcl_au and _fbp exist. Null when none of them do.
 */
export function identityOf(cookies, landingUrl) {
  const value = (name) => cookies.find((c) => c.name === name)?.value ?? "";
  const sent = landingUrl ? campaignParamsIn(landingUrl) : {};
  const out = {};
  const ga = /^GA\d\.\d+\.(\d+\.\d+)$/.exec(value("_ga"));
  if (ga) out.ga_client_id = ga[1];
  // _gcl_aw is GCL.<time>.<gclid>; _fbc is fb.<n>.<time>.<fbclid>.
  const aw = /^GCL\.\d+\.(.+)$/.exec(value("_gcl_aw"));
  if (aw) out.gcl_aw = aw[1] === sent.gclid ? "landing" : "other";
  const fbc = /^fb\.\d+\.\d+\.(.+)$/.exec(value("_fbc"));
  if (fbc) out.fbc = fbc[1] === sent.fbclid ? "landing" : "other";
  if (value("_gcl_au")) out.gcl_au = true;
  if (value("_fbp")) out.fbp = true;
  return Object.keys(out).length ? out : null;
}

/**
 * Runs in the page: the Google tag's own consent state (google_tag_data.ics), or null before a Google tag loaded.
 * Per consent type the default and update it holds, and whether it applied a default and an update at all, whether
 * the default came after a tag had already read consent (wasSetLate), and whether wait_for_update ran out. It is how
 * the tag sees consent, wherever it was set: gtag() in the page, or a consent platform's GTM template, which never
 * shows in the dataLayer. Not documented by Google; read defensively.
 */
export function googleConsentStateInPage() {
  const ics = window.google_tag_data?.ics;
  if (!ics || typeof ics !== "object") return null;
  const word = (v) => (v === true ? "granted" : v === false ? "denied" : undefined);
  const entries = {};
  for (const [type, e] of Object.entries(ics.entries ?? {})) {
    if (!e || typeof e !== "object") continue;
    const d = word(e.default);
    const u = word(e.update);
    entries[type] = { ...(d ? { default: d } : {}), ...(u ? { update: u } : {}) };
  }
  return { entries, usedDefault: Boolean(ics.usedDefault), usedUpdate: Boolean(ics.usedUpdate), wasSetLate: Boolean(ics.wasSetLate), waitPeriodTimedOut: Boolean(ics.waitPeriodTimedOut) };
}

/**
 * Runs in the page: the IDs Google's own registry (window.google_tag_manager) holds, which are the containers and
 * Google tags that actually ran, however their script got in; and the addresses the page only preloads
 * (<link rel="preload">, "modulepreload", "prefetch"), which download a script without running it.
 */
export function containersInPage() {
  const registry = window.google_tag_manager && typeof window.google_tag_manager === "object" ? Object.keys(window.google_tag_manager) : [];
  const preloads = [...document.querySelectorAll('link[rel~="preload"], link[rel~="modulepreload"], link[rel~="prefetch"]')].map((l) => l.href).filter(Boolean);
  return { registry: registry.slice(0, 200), preloads: preloads.slice(0, 200) };
}

/**
 * Runs in the page: whether it is something other than the site, so what a step captured there says nothing about
 * the site's tracking. A bot challenge in its place (Cloudflare, DataDome, HUMAN, Akamai), or a page that crashed in
 * the browser (the error screen a Next.js app shows when its scripts fail). Null for a page that looks like itself.
 * @returns {null | { kind: "challenge"|"crash", vendor?: string }}
 */
export function pageProblemInPage() {
  const title = (document.title || "").trim();
  const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 3000);
  const has = (selector) => {
    try {
      return Boolean(document.querySelector(selector));
    } catch {
      return false;
    }
  };
  if (/^just a moment\.\.\.$|^attention required! \| cloudflare$/i.test(title) || has("#challenge-form, #challenge-running, #cf-challenge-running")) return { kind: "challenge", vendor: "Cloudflare" };
  if (has('iframe[src*="captcha-delivery.com"]')) return { kind: "challenge", vendor: "DataDome" };
  if (has("#px-captcha")) return { kind: "challenge", vendor: "HUMAN" };
  if (/^access denied$/i.test(title) && /reference\s*#\s*[\d.a-f]+/i.test(text)) return { kind: "challenge", vendor: "Akamai" };
  if (/^application error: a client-side exception has occurred/i.test(text)) return { kind: "crash", vendor: "Next.js" };
  return null;
}

export class AuditSession {
  /**
   * @param {{ viewport: string, site?: string, allowedHosts?: string[], providers?: string[], keepBodies?: boolean, blockPrivate?: boolean | ((ip: string) => boolean), blockHits?: boolean, headless?: boolean }} opts
   *   keepBodies: store tracking URLs and bodies as sent. By default, user data for ad matching
   *     (emails, phone numbers, user ids, hashed or not) is replaced with a marker first.
   *   providers: which tracking providers to record. Requests to the others are still answered locally,
   *     but only counted, per step, in this.skipped.
   *   detect: also record any other known provider the site sends to, from its first request
   *     (default: when no providers were chosen). They join this.providers.
   *   site: navigation is limited to this site's host and its subdomains, plus allowedHosts.
   *   recordHar: save every response the site sends into this .har file, so the journey can be replayed offline later.
   *     closeTimeoutMs: how long close() waits for the recording to be written (default 30 s) before skipping it.
   *   replayHar: answer requests from a .har file saved with recordHar instead of the network; requests it lacks fail.
   *   blockPrivate: refuse loopback, private and link-local addresses (used when the MCP server is reachable over HTTP).
   *     All browser traffic then goes through the egress proxy. A function decides which addresses count as private (for tests).
   *   log: gets one line when a dropped navigation is tried again. navigationRetryMs: the wait before that (default 2 s).
   */
  constructor(opts) {
    this.opts = { blockHits: true, headless: true, ...opts };
    this.log = this.opts.log ?? (() => {});
    this.scope = this.opts.site ? hostScope(this.opts.site, this.opts.allowedHosts) : null;
    // The test account (see src/login.js): typed only where a placeholder asks for it, and scrubbed from everything kept.
    this.login = this.opts.login !== undefined ? this.opts.login : loginFromEnv();
    this.scrub = loginScrubber(this.login);
    this.loginStep = null; // the first step that typed the test account's password
    this.isBlockedAddress = typeof this.opts.blockPrivate === "function" ? this.opts.blockPrivate : isPrivateAddress;
    this.isPrivate = this.opts.blockPrivate ? privateHostChecker(this.isBlockedAddress) : null;
    this.blocked = null;
    this.hits = [];
    this.steps = [];
    this.consentStep = null;
    this.rejectStep = null;
    this.cookieLog = []; // each cookie name and domain with the step it was first seen at (never values)
    this.cookieChanges = []; // { step, name, domain, change: added|changed|removed }, never values
    this.cookieHashes = new Map(); // domain|name -> a hash of the value at the last step, kept in memory only
    this.cmp = null; // the consent platform and its setup, from detectCmpInPage, with the step it was first seen at
    this.refusedScripts = new Map(); // step -> how many of the page's scripts were refused for coming back as HTML
    this.errors = [];
    this.dataLayerLog = [];
    this.containerLoads = []; // each Google container script the page added, with how (see src/containers.js)
    this.containerScripts = []; // each container script's answer: status, version, size and load time
    this.containersRunning = new Map(); // container ID -> the step it was first seen running at (google_tag_manager)
    this.containerPreloads = new Map(); // "id|host" -> { id, host, step } for containers the page only preloaded
    this.frameMessages = []; // each named message an iframe posted to the page: origin, name and field names, never values
    // The order hits, dataLayer pushes and iframe messages were recorded in. Several often share a millisecond, and
    // telling which came first matters: a page's push answers the message just before it (see messageOutcomes).
    this.seq = 0;
    this.network = [];
    this.providers = resolveProviders(this.opts.providers);
    this.landing = null; // the first page: { step, requested, chain, final }
    this.detect = this.opts.detect ?? !this.opts.providers?.length;
    this.skipped = {}; // step index -> { vendor label: requests }
    this.loadedIn = new Map(); // page address -> the last step whose main-frame navigation reached it
    this.leaving = null; // the page address being navigated away from, until the next page commits
    this.failedLoad = null; // the error text of the main frame's last failed document request in navigate()
    this.errorPageShown = false; // whether Chromium's error page committed in the main frame since navigate() began
    this.bodyBytes = 0;
    this.bodyBudgetStep = null; // the step at which POST bodies stopped being stored
    this.lastTrackingAt = 0; // when a tag, consent or tracking request or a dataLayer push last happened, for settle()
    this.startedAt = Date.now();
  }

  async start() {
    // Checked before anything launches, so a wrong path leaves no browser behind.
    if (this.opts.storageState && !existsSync(this.opts.storageState)) throw new Error(`No saved login session at ${this.opts.storageState}. Save one with: aitd login --site <url>`);
    const device = VIEWPORTS[this.opts.viewport];
    if (!device) throw new Error(`Unknown viewport "${this.opts.viewport}". Use: ${Object.keys(VIEWPORTS).join(", ")}`);
    const launch = { headless: this.opts.headless, env: browserEnv() };
    if (this.opts.blockPrivate) {
      // Every connection, WebSockets included, goes to an address the proxy checked.
      // "<-loopback>" stops Chromium from sending localhost around the proxy.
      this.egress = await startEgressProxy({ isBlocked: this.isBlockedAddress });
      launch.proxy = { server: this.egress.url, bypass: "<-loopback>" };
      launch.args = ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"];
    }
    if (this.opts.replayHar) {
      // A replay never goes online: requests the routes below don't answer, including any still in
      // flight once they are removed at the end, go to a proxy that isn't there.
      launch.proxy = { server: "http://127.0.0.1:9", bypass: "<-loopback>" };
    }
    try {
      this.browser = await chromium.launch(launch);
    } catch (err) {
      if (!/Executable doesn't exist|playwright install/i.test(String(err?.message))) throw err;
      await installBrowser();
      this.browser = await chromium.launch(launch);
    }
    const record = this.opts.recordHar ? { recordHar: { path: this.opts.recordHar, mode: "minimal" } } : {};
    // A session saved with `aitd login`: the browser starts logged in, for sites whose login needs a person.
    const session = this.opts.storageState ? { storageState: this.opts.storageState } : {};
    this.context = await this.browser.newContext({ ...device, locale: "en-US", ...record, ...session });
    await this.context.exposeBinding("__atdRecord", (source, entry) => {
      const frame = frameInfo(source?.frame);
      if (frame) entry = { ...entry, frame };
      this.lastTrackingAt = Date.now();
      this.record("dataLayerLog", { ...this.redactEntry(entry), step: this.currentStep, t: Date.now(), seq: ++this.seq });
    });
    await this.context.exposeBinding("__atdMessage", (source, m) => this.recordMessage(m, source?.frame));
    await this.context.exposeBinding("__atdLoad", (source, entry) => this.recordLoad(entry, frameInfo(source?.frame)));
    await this.context.addInitScript(INIT_SCRIPT);
    this.page = await this.context.newPage();
    this.page.on("pageerror", (err) => this.errors.push({ step: this.currentStep, message: this.scrub(err.message) }));
    // A script that comes back as an HTML page (a bot check, or files a new deployment no longer has) is refused.
    this.page.on("console", (msg) => {
      if (msg.type() === "error" && /^Refused to execute script from .*MIME type \('text\/html'\)/.test(msg.text())) this.refusedScripts.set(this.currentStep, (this.refusedScripts.get(this.currentStep) ?? 0) + 1);
    });
    this.page.on("framenavigated", (frame) => {
      if (frame !== this.page.mainFrame()) return;
      if (frame.url().startsWith("chrome-error:")) this.errorPageShown = true;
      this.loadedIn.set(pageKey(frame.url()), this.currentStep);
      this.leaving = null;
      // Script redirects on the first page move where it ends up.
      if (this.landing && this.landing.step === this.currentStep) this.landing.final = frame.url();
    });
    // From the moment the main frame starts loading another document, the open page is leaving.
    this.page.on("request", (request) => {
      if (this.isPageLoad(request)) this.leaving = pageKey(this.page.url());
    });
    this.page.on("requestfailed", (request) => {
      if (this.isPageLoad(request)) this.failedLoad = request.failure()?.errorText ?? null;
    });

    const onRequest = (request) => {
      const hits = parseTrackingRequest(request.url(), request.postData());
      if (!hits) return;
      const recorded = [];
      const frame = this.frameOf(request);
      for (const hit of hits) {
        if (!this.checks(hit.platform)) continue;
        const entry = { ...this.redactHit(hit), step: this.stepForHit(hit), pageUrl: this.scrub(this.page.url()), t: Date.now(), seq: ++this.seq, ...(frame ? { frame } : {}) };
        const late = this.lateFor(hit, entry);
        if (late) Object.assign(entry, late);
        if (this.record("hits", entry)) recorded.push(entry);
      }
      if (recorded.length) hitsOf.set(request, recorded);
    };
    // Hits of requests the guard below stops never left the browser, so they are taken back out.
    const hitsOf = new WeakMap();
    const unrecord = (request) => {
      const dropped = new Set(hitsOf.get(request) ?? []);
      if (dropped.size) this.hits = this.hits.filter((h) => !dropped.has(h));
      const call = calls.get(request);
      if (call) call.status = "blocked";
    };
    // Every call to an analytics, ad or consent vendor, for the timeline.
    const calls = new Map();
    this.context.on("request", (request) => {
      const provider = providerOf(request.url());
      if (!provider) return;
      this.lastTrackingAt = Date.now();
      if (!provider.always && !this.checks(provider.key)) {
        const counts = (this.skipped[this.currentStep] ??= {});
        counts[provider.label] = (counts[provider.label] ?? 0) + 1;
        return;
      }
      const vendor = vendorOf(request.url());
      const call = {
        step: this.currentStep,
        pageUrl: this.scrub(this.opts.keepBodies ? this.page.url() : redactUrl(this.page.url()).url),
        t: Date.now(),
        method: request.method(),
        url: this.scrub(this.opts.keepBodies ? request.url() : redactUrl(request.url()).url),
        type: request.resourceType(),
        vendor,
        provider: provider.key,
        ...this.storeBody(request),
        blocked: this.opts.blockHits && isCollectionEndpoint(request.url()),
        status: null,
        ...((frame) => (frame ? { frame } : {}))(this.frameOf(request)),
      };
      if (this.record("network", call)) calls.set(request, call);
    });
    this.context.on("response", (response) => {
      const call = calls.get(response.request());
      if (!call) return;
      call.status = response.status();
      // A consent platform's script or setup file date tells which build of its setup the site serves. Setup files
      // (OneTrust's, Cookiebot's) are fetched by script rather than loaded as one.
      if (call.provider === "consent" && ["script", "fetch", "xhr"].includes(call.type)) {
        const lastModified = response.headers()["last-modified"];
        if (lastModified) call.lastModified = lastModified;
      }
    });
    this.context.on("requestfailed", (request) => {
      const call = calls.get(request);
      // Keepalive requests answered below are still reported as aborted; the page got the 204.
      if (call && call.status === null) call.status = "failed";
      // A script answered with an error status has a response, but Chromium aborts its body: the status is kept.
      if (containerOf(request.url())) this.recordScript(request, request.response().catch(() => null)).catch(() => {});
    });
    this.context.on("requestfinished", (request) => {
      if (containerOf(request.url())) this.recordScript(request, request.response()).catch(() => {});
    });

    // Hits come from the request event rather than the route below: a request sent while
    // the page navigates away (a page_view on the next load, a beacon on unload) can be
    // cancelled before its route handler runs, but its request event has already fired.
    this.context.on("request", onRequest);
    // Registered first, so the routes below run before it and tracking requests are still answered locally.
    if (this.opts.replayHar) {
      // Requests the recording lacks fail, except the media left out of it: those get an empty answer,
      // since a failed image or icon can stop a script (a consent banner waiting for its logo, for example).
      await this.context.route("**/*", (route) =>
        (isDroppedMedia(route.request()) ? route.fulfill({ status: 200, body: "" }) : route.abort()).catch(() => {}),
      );
      await this.context.routeFromHAR(this.opts.replayHar, { notFound: "fallback" });
      const har = JSON.parse(await readFile(this.opts.replayHar, "utf8"));
      // A page asks again for what it asked when saved, with a new timestamp on the address. Registered
      // after the recording, so it runs first and leaves every exact match to the recording.
      const restamped = restampedAnswers(har);
      if (restamped.size) {
        await this.context.route(
          (url) => restamped.has(unstamped(url.href)),
          (route) => {
            const request = route.request();
            const answers = restamped.get(unstamped(request.url()));
            if (request.method() !== "GET" || restamped.exact.has(request.url())) return route.fallback().catch(() => {});
            const answer = answers.queue.length > 1 ? answers.queue.shift() : answers.queue[0];
            return route.fulfill(answer).catch(() => {});
          },
        );
      }
      // A saved redirect to a page the browser may not open fails here, as it did when saved. Left to the
      // recording, the redirect would be followed outside any handler, and its failure would end the run.
      const refusedRedirects = await this.refusedRedirects(har);
      if (refusedRedirects.size) {
        await this.context.route((url) => refusedRedirects.has(url.href), (route) => route.abort("blockedbyclient").catch(() => {}));
      }
    }
    if (this.opts.blockHits) {
      await this.context.route((url) => isCollectionEndpoint(url.href), async (route) => {
        await route.fulfill({ status: 204, body: "" });
        const call = calls.get(route.request());
        if (call) call.status = 204;
      });
    }

    // Registered last, so it runs before the route above. Route handlers only see the
    // first hop of a redirect, so enforce() checks where each step actually landed too.
    await this.context.route("**/*", async (route) => {
      const request = route.request();
      let error = null;
      let isMainNavigation = false;
      try {
        isMainNavigation = request.isNavigationRequest() && request.frame() === this.page?.mainFrame();
      } catch { /* service worker requests have no frame */ }
      if (isMainNavigation) error = await this.checkUrl(request.url());
      else if (this.isPrivate) {
        const u = new URL(request.url());
        if (/^https?:$/.test(u.protocol) && (await this.isPrivate(u.hostname))) error = `${u.hostname} is a private network address.`;
      }
      if (!error) return route.fallback();
      if (isMainNavigation) this.blocked = { step: this.currentStep, url: request.url(), error };
      unrecord(request);
      return route.abort("blockedbyclient");
    });
    this.beginStep("start");
  }

  /**
   * The step a hit belongs to. A page_view sent as the page unloads arrives after the next
   * step has started, so it goes to the step that loaded its page, when that was earlier.
   */
  stepForHit(hit) {
    if (hit.name !== "page_view" || !hit.params?.page_location) return this.currentStep;
    // Only when its page is going or gone: a page_view for the page still open (GTM resending
    // it after consent, a virtual page view) belongs to the current step.
    const page = pageKey(hit.params.page_location);
    if (page === pageKey(this.page.url()) && page !== this.leaving) return this.currentStep;
    const loaded = this.loadedIn.get(page);
    return loaded !== undefined && loaded < this.currentStep ? loaded : this.currentStep;
  }

  /**
   * A page_view that arrives during a wait or a scroll for the page an earlier step loaded, when that step
   * got none: gtag can hold it for a consent update or a slow tag until after the step was reported. It goes
   * to the step that loaded the page, marked late, so the report doesn't read as "this click sent nothing".
   * Returns { step, late: { during, ms } } or null.
   */
  lateFor(hit, entry) {
    if (hit.name !== "page_view" || !hit.params?.page_location || entry.step !== this.currentStep) return null;
    const now = this.steps[this.currentStep];
    if (!["wait", "scroll"].includes(now?.action)) return null;
    const page = pageKey(hit.params.page_location);
    const loaded = this.loadedIn.get(page);
    if (loaded === undefined || loaded >= this.currentStep || page !== pageKey(this.page.url())) return null;
    // A second page_view for the same page (a virtual one, a resend) is the step's own.
    if (this.hits.some((h) => h.name === "page_view" && h.step >= loaded && h.params?.page_location && pageKey(h.params.page_location) === page)) return null;
    const since = this.steps[loaded].endedAt ?? this.steps[loaded].t;
    return { step: loaded, late: { during: this.currentStep, ms: Math.max(0, entry.t - since) } };
  }

  /** The hit with user data for ad matching redacted, and userData: { fields, plain } when there was any. */
  /** Whether requests of this provider are recorded; with detection on, a known provider seen for the first time joins the list. */
  checks(key) {
    if (this.providers.includes(key)) return true;
    if (!this.detect || !(key in PROVIDERS)) return false;
    this.providers.push(key);
    return true;
  }

  /** A copy with the test account's values turned back into placeholders; the value itself when there is no test account. */
  keepOut(value) {
    return this.login ? scrubDeep(value, this.scrub) : value;
  }

  redactHit(raw) {
    return this.keepOut(this.redactUserData(raw));
  }

  redactUserData({ userFields, ...hit }) {
    const found = { fields: [], plain: [] };
    const site = hostOf(hit.params?.page_location) ?? hostOf(this.page.url());
    const url = redactUrl(hit.url, found, site).url;
    const params = redactParams(hit.params, found, site);
    redactParams(userFields, found, site); // fields from the POST body that the hit doesn't keep
    if (!found.fields.length) return hit;
    const userData = { fields: [...new Set(found.fields)], plain: [...new Set(found.plain)] };
    return this.opts.keepBodies ? { ...hit, userData } : { ...hit, url, params, userData };
  }

  /** A dataLayer entry with user data redacted, and userData: { fields, plain } when there was any. */
  redactEntry(entry) {
    const found = redactPush(entry.value, undefined, hostOf(this.page.url()));
    if (!found.fields.length) return this.keepOut(entry);
    const userData = { fields: [...new Set(found.fields)], plain: [...new Set(found.plain)] };
    return this.keepOut(this.opts.keepBodies ? { ...entry, userData } : { ...entry, value: found.value, userData });
  }

  /** { postData } for a tracking POST, redacted, within the per-audit budget; { bodyDropped } past it. */
  storeBody(request) {
    const body = trackingBody(request);
    if (body === null) return {};
    if (this.bodyBytes + body.length > MAX_TOTAL_BODIES) {
      this.bodyBudgetStep ??= this.currentStep;
      return { bodyDropped: true };
    }
    this.bodyBytes += body.length;
    return { postData: this.scrub(this.opts.keepBodies ? body : redactBody(body).text) };
  }

  /**
   * A container script the page added: its ID, dataLayer and host, whether the HTML parser inserted it or a
   * script did and, for a script, the callers on the stack. Only addresses without their query are kept, so
   * the environment token (gtm_auth) and user data in a page's query string never reach the capture.
   */
  recordLoad(entry, frame = null) {
    const container = containerOf(entry?.src);
    if (!container) return;
    // A preload hint is not a load: it downloads the script without running it (see unseenContainers).
    if (entry.how === "preload") {
      const k = `${container.id}|${container.host}`;
      if (!frame && !this.containerPreloads.has(k)) this.containerPreloads.set(k, { id: container.id, host: container.host, step: this.currentStep, page: pagePath(entry.page) });
      return;
    }
    this.record("containerLoads", {
      ...container,
      how: entry.how === "parser" ? "parser" : "script",
      ...(entry.how === "parser" ? {} : { callers: callersOf(entry.frames, entry.documentUrl) }),
      page: pagePath(entry.page),
      doc: String(entry.doc ?? "").slice(0, 16),
      step: this.currentStep,
      t: Date.now(),
      ...(frame ? { frame } : {}),
    });
  }

  /**
   * A container script's answer: its HTTP status (or "failed"), the container version its published data opens
   * with, the size of the script as the page got it (decoded) and over the wire, and how long it took to load.
   * response resolves to null when no answer came at all. Only the ID and host are kept, not the address.
   */
  async recordScript(request, response) {
    const container = containerOf(request.url());
    if (!container) return;
    const step = this.currentStep;
    const res = await response;
    const body = res ? await res.body().catch(() => null) : null;
    const sizes = res ? await request.sizes().catch(() => null) : null;
    const timing = request.timing();
    const ms = timing.responseEnd > 0 ? Math.round(timing.responseEnd) : null;
    const version = body ? containerVersion(body.subarray(0, 4096).toString("utf8")) : null;
    this.record("containerScripts", {
      id: container.id, host: container.host, step,
      status: res ? res.status() : "failed",
      ...(version ? { version } : {}),
      ...(body ? { bytes: body.length } : {}),
      ...(sizes?.responseBodySize > 0 ? { transferBytes: sizes.responseBodySize } : {}),
      ...(ms !== null ? { ms } : {}),
    });
  }

  /**
   * A message an iframe posted to the page: the iframe's origin, whether it is on the site's own site, the name the
   * message carries and the names of its fields. The page's main frame reports it; values never leave the page.
   */
  recordMessage(m, frame) {
    if (!m || (frame && frame !== this.page?.mainFrame())) return;
    let party = "third";
    try {
      party = siteOf(new URL(m.origin).hostname) === siteOf(new URL(this.page.url()).hostname) ? "site" : "third";
    } catch { /* an opaque origin ("null"): a sandboxed iframe, someone else's */ }
    this.record("frameMessages", {
      origin: String(m.origin).slice(0, 200),
      party,
      name: this.scrub(String(m.name ?? "")).slice(0, 80),
      ...(m.nameKey ? { nameKey: String(m.nameKey).slice(0, 20) } : {}),
      keys: (Array.isArray(m.keys) ? m.keys : []).slice(0, 20).map((k) => String(k).slice(0, 40)),
      step: this.currentStep,
      t: Date.now(),
      seq: ++this.seq,
    });
  }

  /** The iframe a request came from, as frameInfo gives it; null for the page itself or a worker. */
  frameOf(request) {
    try {
      return frameInfo(request.frame());
    } catch {
      return null; // service worker requests have no frame
    }
  }

  /** Adds an entry to one of the logs, up to its limit. Returns false once the limit is reached. */
  record(log, entry) {
    if (this[log].length >= LOG_LIMITS[log]) {
      if (!this.logFull) this.errors.push({ step: this.currentStep, message: `Recording limit reached (${LOG_LIMITS[log]} ${log} entries); later entries were dropped.` });
      this.logFull = true;
      return false;
    }
    this[log].push(entry);
    return true;
  }

  /** Addresses whose saved answer redirects somewhere the browser may not go. */
  async refusedRedirects(har) {
    const refused = new Set();
    for (const e of har.log.entries) {
      const status = e.response?.status;
      if (status < 300 || status >= 400) continue;
      const location = e.response.redirectURL || e.response.headers?.find((h) => /^location$/i.test(h.name))?.value;
      if (!location) continue;
      let target;
      try { target = new URL(location, e.request.url).href; } catch { continue; }
      if (await this.checkUrl(target)) refused.add(e.request.url);
    }
    return refused;
  }

  /**
   * Opens a page. When the network dropped the first attempt or it timed out, tries once more after a
   * short wait, since one lost connection should not cost the journey. A navigation the guard refused
   * (this.blocked, net::ERR_BLOCKED_BY_CLIENT) is never tried again: it would be refused again.
   */
  async navigate(url) {
    const options = { waitUntil: "domcontentloaded", timeout: 30000 };
    this.failedLoad = null;
    this.errorPageShown = false;
    try {
      return await this.page.goto(url, options);
    } catch (err) {
      if (this.blocked?.step === this.currentStep) throw err;
      // When the error page cut goto short, the failed request can be reported just after goto rejects.
      if (!this.failedLoad && ERROR_PAGE_INTERRUPTION.test(err?.message)) {
        await this.page.waitForEvent("requestfailed", { predicate: (request) => this.isPageLoad(request), timeout: 1000 }).catch(() => {});
      }
      if (!isTransientNavigationError(err, this.failedLoad)) throw err;
      const code = navigationErrorCode(err, this.failedLoad);
      const delay = this.opts.navigationRetryMs ?? NAVIGATION_RETRY_MS;
      this.log(`  Opening ${url} failed (${code}); trying once more in ${Math.round(delay / 1000)}s`);
      // Chromium can commit the error page for the failed load well after goto has given up. A retry begun
      // before that is interrupted by it, so the retry waits for it. A load that timed out gets no error page.
      const errorPage = code === "timeout" || this.errorPageShown ? null : this.page.waitForEvent("framenavigated", {
        predicate: (frame) => frame === this.page.mainFrame() && frame.url().startsWith("chrome-error:"),
        timeout: 5000,
      }).catch(() => {});
      await Promise.all([new Promise((resolve) => setTimeout(resolve, delay)), errorPage]);
      return this.page.goto(url, options);
    }
  }

  /** Whether a request loads a new document into the main frame. */
  isPageLoad(request) {
    return request.isNavigationRequest() && request.frame() === this.page.mainFrame();
  }

  /** Error message when the browser may not be on this URL, or null. */
  checkUrl(url) {
    if (url.startsWith("chrome-error:")) return null; // Chromium's own error page, e.g. after a blocked navigation
    return navigationError(url, { scope: this.scope, isPrivate: this.isPrivate });
  }

  /**
   * Makes sure the page is somewhere it may be (a redirect or script can move it).
   * If not, goes back, or to a blank page. Returns the error, or null.
   */
  async enforce() {
    let error = await this.checkUrl(this.page.url());
    if (!error && this.blocked?.step === this.currentStep) error = this.blocked.error;
    if (!error) return null;
    if (this.page.url().startsWith("chrome-error:") || (await this.checkUrl(this.page.url()))) {
      await this.page.goBack({ timeout: 10000 }).catch(() => {});
      if (this.page.url().startsWith("chrome-error:") || (await this.checkUrl(this.page.url()))) {
        await this.page.goto("about:blank").catch(() => {});
      }
    }
    return `Navigation blocked: ${error}`;
  }

  get currentStep() {
    return this.steps.length - 1;
  }

  beginStep(label, extra = {}) {
    this.leaving = null; // a navigation that never committed (a download, a 204) ends with its step
    this.steps.push({ index: this.steps.length, label, t: Date.now(), ...extra });
  }

  async settle() {
    for (let round = 0; round < 2; round++) {
      await this.page.waitForLoadState("load", { timeout: 15000 }).catch(() => {});
      await this.page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
      await this.page.waitForTimeout(400);
      // The network can go quiet before the tags are done: gtag holds a page_view until the consent
      // platform answers (wait_for_update), and a consent platform loads its own scripts first. So the
      // step ends once no tag, consent or tracking request and no dataLayer push came for quietMs.
      const quiet = this.opts.quietMs ?? 1200;
      const until = Date.now() + (this.opts.quietCapMs ?? 3000);
      while (Date.now() < until) {
        const wait = this.lastTrackingAt + quiet - Date.now();
        if (wait <= 0) break;
        await this.page.waitForTimeout(Math.min(wait, until - Date.now()));
      }
      // A click whose page starts loading only now (a link delayed for its tags) is waited for once more.
      if (!this.leaving) break;
      await this.page.waitForEvent("framenavigated", { predicate: (f) => f === this.page.mainFrame(), timeout: 5000 }).catch(() => {});
    }
  }

  /** @param {{ offscreenLimit?: number|null }} [opts] offscreenLimit: how many elements above or below the screen to list; null for all. */
  async snapshot({ offscreenLimit = null } = {}) {
    const blocked = await this.enforce();
    if (blocked && this.page.url() === "about:blank") return { url: "about:blank", title: "", elements: "", text: `(${blocked})` };
    try {
      // The main page first, then iframes (booking and payment widgets often live in one).
      const frames = await this.visibleFrames();
      const main = await this.page.evaluate(snapshotInPage, { first: 1, limit: frames.length ? MAX_ELEMENTS - 60 : MAX_ELEMENTS, textLimit: 3000, offscreenLimit });
      this.refFrames = new Map();
      const lines = [...main.lines];
      let next = main.next;
      let more = main.more;
      for (const { frame, frameBox } of frames) {
        if (next > MAX_ELEMENTS) break;
        const sub = await frame.evaluate(snapshotInPage, { first: next, limit: MAX_ELEMENTS - next + 1, textLimit: 0, frameBox, offscreenLimit }).catch(() => null);
        if (!sub?.lines.length) continue;
        lines.push(`(inside an embedded frame from ${new URL(sub.url).host})`, ...sub.lines);
        for (let r = next; r < sub.next; r++) this.refFrames.set(r, frame);
        next = sub.next;
        more ||= sub.more;
      }
      if (more) lines.push(`(more elements not listed: scroll to bring them on screen, or use text to click something by its visible text)`);
      const note = this.steps[this.currentStep]?.note;
      // What the model reads never holds the test account: a username a page shows back reads as its placeholder.
      return { url: this.scrub(main.url), title: this.scrub(main.title), elements: this.scrub(lines.join("\n")), text: this.scrub(main.text), note };
    } catch (err) {
      return { url: this.scrub(this.page.url()), title: "", elements: "", text: `(snapshot failed: ${this.scrub(err.message)})` };
    }
  }

  /**
   * Iframes worth showing the agent: visible, with a real size, on the main page's
   * screen or below it, and not an ad, analytics or consent vendor's frame.
   * @returns {Promise<{ frame: import("playwright").Frame, frameBox: { y: number, viewportHeight: number } }[]>}
   */
  async visibleFrames() {
    const out = [];
    const viewportHeight = this.page.viewportSize()?.height ?? 900;
    for (const frame of this.page.frames()) {
      if (frame === this.page.mainFrame() || frame.isDetached()) continue;
      if (vendorOf(frame.url())) continue;
      if (/^(google_ads_iframe|aswift_|ad_iframe)/i.test(frame.name())) continue; // ad slots, often about:blank
      try {
        const element = await frame.frameElement();
        if (/^(google_ads_iframe|aswift_)/i.test((await element.getAttribute("id")) ?? "")) continue;
        if (!(await element.isVisible())) continue;
        const box = await element.boundingBox();
        if (!box || box.width < 20 || box.height < 20) continue;
        out.push({ frame, frameBox: { y: box.y, viewportHeight } });
      } catch {
        // detached while we looked
      }
    }
    return out;
  }

  locatorFor({ ref, selector }) {
    if (selector) return this.page.locator(selector).first();
    return (this.refFrames?.get(ref) ?? this.page).locator(`[data-atd-ref="${ref}"]`).first();
  }

  /**
   * Finds one visible element by its text: exact matches before partial ones, buttons
   * and links before labels, placeholders and other text, the main page before iframes.
   * Returns { locator } or { error } when nothing or several elements match.
   */
  async locateByText(text) {
    const roots = [this.page, ...(await this.visibleFrames()).map((f) => f.frame)];
    const kinds = (root, exact) => [
      root.getByRole("button", { name: text, exact }),
      root.getByRole("link", { name: text, exact }),
      root.getByLabel(text, { exact }),
      root.getByPlaceholder(text, { exact }),
      root.getByText(text, { exact }),
    ];
    for (const exact of [true, false]) {
      for (const root of roots) {
        for (const candidate of kinds(root, exact)) {
          const visible = candidate.filter({ visible: true });
          const n = await visible.count().catch(() => 0);
          if (n === 1) return { locator: visible.first() };
          if (n > 1) return { error: `${n} elements match "${text}"${exact ? "" : " partly"}. Use the ref of the one you mean.` };
        }
      }
    }
    return { error: `No visible element with the text "${text}". Scroll, or use a ref from the page view.` };
  }

  /**
   * Clicks like a visitor. When something covers the element: refuses if it's a dialog,
   * a modal or most of the screen (a consent wall the journey has to deal with first);
   * otherwise (a sticky header, a small badge) clicks a part of the element that is free,
   * with real mouse events, or as a last resort sends a synthetic click, and notes that on the step.
   */
  async click(locator) {
    try {
      await locator.click({ timeout: 8000 });
      return null;
    } catch (err) {
      if (!/intercepts pointer events|not stable|outside of the viewport/.test(err.message)) throw err;
    }
    const cover = await locator
      .evaluate((el, selectors) => {
        const r = el.getBoundingClientRect();
        const x = Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth - 1);
        const y = Math.min(Math.max(r.top + r.height / 2, 0), window.innerHeight - 1);
        const hit = document.elementFromPoint(x, y);
        if (!hit || hit === el || el.contains(hit)) return null;
        // A part of the element nothing covers, to click there with real mouse events.
        let free = null;
        for (const fy of [0.5, 0.25, 0.75, 0.1, 0.9]) {
          for (const fx of [0.5, 0.25, 0.75, 0.1, 0.9]) {
            const px = r.left + r.width * fx;
            const py = r.top + r.height * fy;
            if (px < 0 || py < 0 || px >= window.innerWidth || py >= window.innerHeight) continue;
            const h = document.elementFromPoint(px, py);
            if (h && (h === el || el.contains(h))) { free = { x: r.width * fx, y: r.height * fy }; break; }
          }
          if (free) break;
        }
        const describe = (n) => `${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ""}${n.getAttribute("role") ? ` role=${n.getAttribute("role")}` : ""} "${(n.innerText || "").replace(/\s+/g, " ").trim().slice(0, 60)}"`;
        const screen = window.innerWidth * window.innerHeight;
        for (let n = hit; n && n !== document.body && n !== document.documentElement && !n.contains(el); n = n.parentElement) {
          const b = n.getBoundingClientRect();
          const modal = n.matches("dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]");
          // Cookie and consent banners block even when they cover only part of the screen.
          const consent =
            n.matches(selectors) ||
            (/(cookie|consent|gdpr|kvkk)/i.test(`${n.id} ${typeof n.className === "string" ? n.className : ""}`) && ["fixed", "sticky"].includes(getComputedStyle(n).position));
          if (consent) return { blocking: true, what: describe(n) };
          if (modal || b.width * b.height >= screen * 0.5) return { blocking: true, what: describe(n) };
        }
        return { blocking: false, what: describe(hit), free };
      }, CMP_BANNER_SELECTORS)
      .catch(() => null);
    if (cover?.blocking) {
      throw new Error(`The element is covered by ${cover.what}. Deal with that first (for example accept or close it), as a visitor would.`);
    }
    let note;
    if (cover?.free) {
      await locator.click({ position: cover.free, timeout: 8000 });
      note = `Clicked the part of the element not covered by ${cover.what}.`;
    } else {
      // Fully covered by something small: a synthetic click is the only way, and some widgets ignore it.
      await locator.dispatchEvent("click");
      note = `Clicked through ${cover?.what ?? "an overlapping element"} with a synthetic click; the page may not have reacted.`;
    }
    this.steps[this.currentStep].note = note;
    this.steps[this.currentStep].forced = true;
    return note;
  }

  /**
   * Performs one action and records it as a step. Returns an error message
   * instead of throwing, so the agent can recover.
   * @param {{ action: string, ref?: number, selector?: string, text?: string, value?: string, url?: string, reason?: string, accepts_consent?: boolean, rejects_consent?: boolean }} a
   */
  async act(a) {
    const error = this.scrub(await this.perform(a));
    await this.observe();
    // A scripted replay of this step may fail the same way, which must not end the journey there.
    if (error) this.steps[this.currentStep].error = error;
    // A saved step keeps placeholders, never the test account (a click's text can be a username the page shows).
    const step = this.steps[this.currentStep];
    if (step.replay) step.replay = this.keepOut(step.replay);
    this.steps[this.currentStep].pagePath = pagePath(this.page.url());
    this.steps[this.currentStep].endedAt = Date.now(); // when the step was reported, so a late hit can say how late
    return error;
  }

  /**
   * What the step just taken left behind, beyond its requests: the cookies it changed, the consent platform the
   * first time one is seen, and the Google tag's consent state when it changed. act() calls it after every action;
   * the consent scenarios call it after the steps they take themselves.
   */
  async observe() {
    await this.trackCookies();
    if (!this.cmp) {
      const cmp = await this.evaluateWithin(detectCmpInPage);
      if (cmp) this.cmp = { ...cmp, step: this.currentStep };
    }
    const problem = await this.evaluateWithin(pageProblemInPage);
    if (problem) {
      const refused = this.refusedScripts.get(this.currentStep) ?? 0;
      this.steps[this.currentStep].pageProblem = { ...problem, ...(refused ? { refusedScripts: refused } : {}) };
    }
    // Kept on the step only when it changed, so the steps that hold one are where the Google tag's state moved.
    const tagConsent = await this.evaluateWithin(googleConsentStateInPage);
    const before = this.steps.slice(0, this.currentStep).map((st) => st.tagConsent).filter(Boolean).at(-1);
    if (tagConsent && JSON.stringify(tagConsent) !== JSON.stringify(before)) this.steps[this.currentStep].tagConsent = tagConsent;
    // Which containers ran, and which the page only preloaded: a container can download and never run.
    const found = await this.evaluateWithin(containersInPage);
    for (const id of (found?.registry ?? []).map((k) => String(k).toUpperCase()).filter(isContainerId)) {
      if (!this.containersRunning.has(id)) this.containersRunning.set(id, this.currentStep);
    }
    for (const c of (found?.preloads ?? []).map(containerOf).filter(Boolean)) {
      const k = `${c.id}|${c.host}`;
      if (!this.containerPreloads.has(k)) this.containerPreloads.set(k, { id: c.id, host: c.host, step: this.currentStep, page: pagePath(this.page.url()) });
    }
  }

  async perform(a) {
    const describe = a.reason || `${a.action} ${a.selector ?? (a.ref != null ? `#${a.ref}` : a.text != null ? `"${a.text}"` : a.url ?? "")}`.trim();
    this.beginStep(describe, { action: a.action, acceptsConsent: !!a.accepts_consent, rejectsConsent: !!a.rejects_consent });
    const step = this.steps[this.currentStep];
    try {
      switch (a.action) {
        case "goto": {
          const target = new URL(a.url, this.page.url() === "about:blank" ? undefined : this.page.url()).href;
          step.replay = { action: "goto", url: target };
          const refused = await this.checkUrl(target);
          if (refused) return refused;
          const response = await this.navigate(target);
          if (!this.landing) {
            // The first page: the address asked for, each redirect on the way, and where it ended up.
            const chain = [];
            for (let r = response?.request(); r; r = r.redirectedFrom()) chain.unshift(r.url());
            this.landing = { step: this.currentStep, requested: target, chain, final: this.page.url() };
          }
          break;
        }
        case "click":
        case "fill":
        case "select": {
          let target;
          if (a.action === "click" && a.selector && typeof a.text === "string" && a.text.trim()) {
            // A saved click: its path first, then its text if the path finds nothing to click.
            target = this.locatorFor(a);
            const shown = await target.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false);
            if (!shown) {
              const found = await this.locateByText(a.text.trim());
              if (!found.error) {
                target = found.locator;
                step.foundBy = "text"; // the replay summary says so, in case it is not the element saved
              }
            }
          } else if (a.selector || Number.isInteger(a.ref)) target = this.locatorFor(a);
          else if (typeof a.text === "string" && a.text.trim()) {
            const found = await this.locateByText(a.text.trim());
            if (found.error) return found.error;
            target = found.locator;
          } else return `${a.action} needs a ref or the element's visible text.`;
          step.replay = { action: a.action, ...(await replayTarget(a, target)), ...(a.value !== undefined ? { value: a.value } : {}) };
          if (a.action === "click") await this.click(target);
          else if (a.action === "fill" && hasLoginPlaceholder(a.value)) {
            // The test account is typed only into the audited site's own pages, never a frame from elsewhere.
            const host = await target.evaluate(() => location.hostname).catch(() => "");
            if (this.scope && !this.scope.allows(host)) return `The test account is only filled in on ${this.scope.hosts.join(", ")}, not on ${host || "this frame"}.`;
            let value;
            try {
              value = fillLoginValue(a.value, this.login);
            } catch (err) {
              if (err.code === "NO_LOGIN") return err.message;
              throw err;
            }
            await target.fill(value, { timeout: 10000 });
            if (/login\.password/.test(a.value) && this.loginStep === null) this.loginStep = this.currentStep;
          } else if (a.action === "fill") await target.fill(a.value ?? "", { timeout: 10000 });
          else await target.selectOption(a.value ?? "", { timeout: 10000 });
          break;
        }
        case "scroll": {
          step.replay = { action: "scroll", ...(a.value !== undefined ? { value: a.value } : {}) };
          const dy = /^up$/i.test(a.value ?? "") ? -900 : 900;
          const size = this.page.viewportSize() ?? { width: 800, height: 600 };
          const before = await this.page.evaluate(() => window.scrollY);
          await this.page.mouse.move(size.width / 2, size.height / 2);
          await this.page.mouse.wheel(0, dy);
          await this.page.waitForTimeout(300);
          // Some pages ignore the wheel over their content; scroll the window directly then.
          if ((await this.page.evaluate(() => window.scrollY)) === before) await this.page.evaluate((d) => window.scrollBy(0, d), dy);
          break;
        }
        case "wait":
          step.replay = { action: "wait", ...(a.value !== undefined ? { value: a.value } : {}) };
          await this.page.waitForTimeout(Math.min(Number(a.value) || 1000, 10000));
          break;
        default:
          throw new Error(`Unknown action "${a.action}"`);
      }
      await this.settle();
      const blocked = await this.enforce();
      if (blocked) return blocked;
      if (a.accepts_consent && this.consentStep === null) this.consentStep = this.currentStep;
      if (a.rejects_consent && this.rejectStep === null) {
        this.rejectStep = this.currentStep;
        // A rejected banner should close; one that is still showing means the button did nothing.
        step.bannerOpenAfter = await this.page.evaluate((sel) => {
          const roots = [document];
          for (let i = 0; i < roots.length; i++) for (const n of roots[i].querySelectorAll("*")) if (n.shadowRoot) roots.push(n.shadowRoot);
          return roots.flatMap((r) => [...r.querySelectorAll(sel)]).some((n) => {
            const r = n.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== "hidden";
          });
        }, CMP_BANNER_SELECTORS).catch(() => false);
      }
      return null;
    } catch (err) {
      return (await this.enforce().catch(() => null)) ?? err.message.split("\n")[0];
    }
  }

  /**
   * Notes the cookies the step just taken added, changed or removed, and what the analytics and ad cookies
   * say (identityOf). Values never leave this function: a short hash of each, held until the next step,
   * is enough to tell that one changed.
   */
  async trackCookies() {
    const all = await this.rawCookies();
    const seen = new Set(this.cookieLog.map((c) => `${c.domain}|${c.name}`));
    const now = new Map();
    for (const c of all) {
      const k = `${c.domain}|${c.name}`;
      const hash = createHash("sha256").update(c.value).digest("base64").slice(0, 16);
      now.set(k, hash);
      if (!seen.has(k) && this.cookieLog.length < 500) this.cookieLog.push({ name: c.name, domain: c.domain, step: this.currentStep });
      const before = this.cookieHashes.get(k);
      const change = before === undefined ? "added" : before !== hash ? "changed" : null;
      if (change && this.cookieChanges.length < 2000) this.cookieChanges.push({ step: this.currentStep, name: c.name, domain: c.domain, change });
    }
    for (const k of this.cookieHashes.keys()) {
      if (now.has(k) || this.cookieChanges.length >= 2000) continue;
      const [domain, ...name] = k.split("|");
      this.cookieChanges.push({ step: this.currentStep, name: name.join("|"), domain, change: "removed" });
    }
    this.cookieHashes = now;
    const identity = identityOf(all, this.landing?.requested);
    if (identity) this.steps[this.currentStep].identity = identity;
  }

  /** page.evaluate(fn), or null when it fails or the page does not answer within ms: a page stuck in a script never answers, and the next page read reports that. */
  async evaluateWithin(fn, ms = 2000) {
    let timer;
    const result = await Promise.race([
      this.page.evaluate(fn).catch(() => null),
      new Promise((resolve) => (timer = setTimeout(() => resolve(null), ms))),
    ]);
    clearTimeout(timer);
    return result;
  }

  /** The browser's cookies with their values, for trackCookies only; [] when the browser takes too long. */
  async rawCookies() {
    let timer;
    const tooLong = new Promise((resolve) => (timer = setTimeout(() => resolve([]), 10_000)));
    const cookies = await Promise.race([this.context.cookies().catch(() => []), tooLong]);
    clearTimeout(timer);
    return cookies;
  }

  async cookies() {
    return (await this.rawCookies()).map((c) => ({ name: c.name, domain: c.domain }));
  }

  async close() {
    // Leaving the page first cancels what it is still loading (the recording would otherwise wait for it),
    // while tracking requests sent on the way out are still answered locally.
    if (this.opts.recordHar && this.context) {
      await this.page?.goto("about:blank", { timeout: 5000 }).catch(() => {});
      // The recording also waits for requests the browser holds for an open page, such as a tracking hit
      // sent as the page was left, which can stay open for good. Once their page is closed it stops waiting.
      // A moment first lets hits already sent be answered locally: once their page is closed,
      // the browser would send them on its own.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      let pagesTimer;
      await Promise.race([
        Promise.all(this.context.pages().map((p) => p.close().catch(() => {}))),
        new Promise((resolve) => (pagesTimer = setTimeout(resolve, 5000))),
      ]);
      clearTimeout(pagesTimer);
    }
    if (this.opts.replayHar) {
      // The recording's own route callbacks would otherwise throw for requests still in flight once the
      // browser is gone. Without routes, those go nowhere (see start). Elsewhere the routes stay, so a
      // hit sent while the browser closes is still answered locally instead of reaching the real account.
      // A page stuck in a script never answers, so this waits at most 5 seconds.
      let unrouteTimer;
      await Promise.race([
        this.context?.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {}),
        new Promise((resolve) => (unrouteTimer = setTimeout(resolve, 5000))),
      ]);
      clearTimeout(unrouteTimer);
    }
    if (this.opts.recordHar && this.context) {
      // Writes the recording. If the browser already went away, or writing it takes too long, there is
      // none to clean: closing the browser below then ends the run's wait.
      let timer;
      const limit = this.opts.closeTimeoutMs ?? CLOSE_TIMEOUT_MS;
      const tooLong = new Promise((resolve) => (timer = setTimeout(() => resolve("timeout"), limit)));
      const closed = await Promise.race([this.context.close().then(() => "closed", () => "gone"), tooLong]);
      clearTimeout(timer);
      if (closed === "timeout") {
        console.warn(`Writing the recording ${this.opts.recordHar} took over ${Math.round(limit / 1000)} seconds, so it was skipped.`);
        await this.browser?.close().catch(() => {});
        await rm(this.opts.recordHar, { force: true }); // a partly written file
      }
      const written = closed === "closed";
      // A recording that could not be cleaned may hold cookies or form data, so it is deleted.
      if (written) {
        await cleanRecording(this.opts.recordHar).catch(async (err) => {
          console.warn(`Could not clean the recording ${this.opts.recordHar}, so it was deleted: ${err.message}`);
          await rm(this.opts.recordHar, { force: true });
        });
      }
    }
    await this.browser?.close();
    await this.egress?.close();
  }
}
