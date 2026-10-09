import { chromium, devices } from "playwright";
import { parseTrackingRequest, isCollectionEndpoint, providerOf, vendorOf, resolveProviders } from "./parsers.js";
import { redactBody, redactParams, redactPush, redactUrl } from "./redact.js";
import { hostScope, isPrivateAddress, navigationError, privateHostChecker } from "./guard.js";
import { startEgressProxy } from "./egress.js";

// Caps on what one audit records, so a looping page can't grow memory without limit.
const LOG_LIMITS = { hits: 5000, dataLayerLog: 5000, network: 10000 };

// Secrets the browser process has no use for. It gets the rest of the environment
// (PATH, HOME, DISPLAY...) so Chromium still starts normally.
const SECRET_ENV = /(API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY|_KEY$|^AWS_|^AZURE_|^GOOGLE_APPLICATION)/i;
export const browserEnv = (env = process.env) => Object.fromEntries(Object.entries(env).filter(([k]) => !SECRET_ENV.test(k)));

export const VIEWPORTS = {
  desktop: { viewport: { width: 1366, height: 900 } },
  mobile: devices["Pixel 7"],
};

// Runs in the page before any site script: reports every dataLayer push
// (including gtag consent commands) to Node through an exposed binding, so the
// log survives page navigations.
const INIT_SCRIPT = `(() => {
  const record = (entry) => {
    let value = entry;
    try {
      // gtag() pushes an arguments object; store it as a plain array.
      if (entry && typeof entry === "object" && typeof entry.length === "number" && !Array.isArray(entry)) value = Array.from(entry);
      value = JSON.parse(JSON.stringify(value));
    } catch { value = String(entry); }
    if (window.__atdRecord) window.__atdRecord({ url: location.href, value });
  };
  const wrap = (dl) => {
    if (!dl || dl.__atdWrapped) return dl;
    dl.forEach(record);
    const push = dl.push.bind(dl);
    dl.push = (...items) => { items.forEach(record); return push(...items); };
    dl.__atdWrapped = true;
    return dl;
  };
  let current = wrap(window.dataLayer || []);
  Object.defineProperty(window, "dataLayer", {
    configurable: true,
    get: () => current,
    set: (v) => { current = wrap(v); },
  });
})();`;

// Labels the interactive elements of one frame with numeric refs, starting at
// `first`, and returns a compact text view for the agent. Besides links, buttons
// and form fields, it finds custom controls that sites build from divs and spans
// (role attributes, tabindex, or a pointer cursor). Elements on screen come first,
// so a long menu or footer can't push the button the agent needs out of the list.
function snapshotInPage({ first, limit, textLimit, frameBox }) {
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
      el.getAttribute("aria-label") || byId || el.innerText || el.value || forLabel || el.getAttribute("placeholder") ||
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
  const items = ranked
    .filter((item, i) => item.tier < 2 || i - firstCovered < 30) // only a few covered or clipped ones
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

export class AuditSession {
  /**
   * @param {{ viewport: string, site?: string, allowedHosts?: string[], providers?: string[], keepBodies?: boolean, blockPrivate?: boolean | ((ip: string) => boolean), blockHits?: boolean, headless?: boolean }} opts
   *   keepBodies: store tracking URLs and bodies as sent. By default, user data for ad matching
   *     (emails, phone numbers, user ids, hashed or not) is replaced with a marker first.
   *   providers: which tracking providers to record (default GA4, Google Ads, Meta, TikTok). Requests to the
   *     others are still answered locally, but only counted, per step, in this.skipped.
   *   site: navigation is limited to this site's host and its subdomains, plus allowedHosts.
   *   blockPrivate: refuse loopback, private and link-local addresses (used when the MCP server is reachable over HTTP).
   *     All browser traffic then goes through the egress proxy. A function decides which addresses count as private (for tests).
   */
  constructor(opts) {
    this.opts = { blockHits: true, headless: true, ...opts };
    this.scope = this.opts.site ? hostScope(this.opts.site, this.opts.allowedHosts) : null;
    this.isBlockedAddress = typeof this.opts.blockPrivate === "function" ? this.opts.blockPrivate : isPrivateAddress;
    this.isPrivate = this.opts.blockPrivate ? privateHostChecker(this.isBlockedAddress) : null;
    this.blocked = null;
    this.hits = [];
    this.steps = [];
    this.consentStep = null;
    this.errors = [];
    this.dataLayerLog = [];
    this.network = [];
    this.providers = resolveProviders(this.opts.providers);
    this.skipped = {}; // step index -> { vendor label: requests }
    this.bodyBytes = 0;
    this.bodyBudgetStep = null; // the step at which POST bodies stopped being stored
    this.startedAt = Date.now();
  }

  async start() {
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
    this.browser = await chromium.launch(launch);
    this.context = await this.browser.newContext({ ...device, locale: "en-US" });
    await this.context.exposeBinding("__atdRecord", (_source, entry) => {
      this.record("dataLayerLog", { ...this.redactEntry(entry), step: this.currentStep, t: Date.now() });
    });
    await this.context.addInitScript(INIT_SCRIPT);
    this.page = await this.context.newPage();
    this.page.on("pageerror", (err) => this.errors.push({ step: this.currentStep, message: err.message }));

    const onRequest = (request) => {
      const hits = parseTrackingRequest(request.url(), request.postData());
      if (!hits) return;
      for (const hit of hits) {
        if (!this.providers.includes(hit.platform)) continue;
        this.record("hits", { ...this.redactHit(hit), step: this.currentStep, pageUrl: this.page.url(), t: Date.now() });
      }
    };
    // Every call to an analytics, ad or consent vendor, for the timeline.
    const calls = new Map();
    this.context.on("request", (request) => {
      const provider = providerOf(request.url());
      if (!provider) return;
      if (!provider.always && !this.providers.includes(provider.key)) {
        const counts = (this.skipped[this.currentStep] ??= {});
        counts[provider.label] = (counts[provider.label] ?? 0) + 1;
        return;
      }
      const vendor = vendorOf(request.url());
      const call = {
        step: this.currentStep,
        t: Date.now(),
        method: request.method(),
        url: this.opts.keepBodies ? request.url() : redactUrl(request.url()).url,
        type: request.resourceType(),
        vendor,
        provider: provider.key,
        ...this.storeBody(request),
        blocked: this.opts.blockHits && isCollectionEndpoint(request.url()),
        status: null,
      };
      if (this.record("network", call)) calls.set(request, call);
    });
    this.context.on("response", (response) => {
      const call = calls.get(response.request());
      if (call) call.status = response.status();
    });
    this.context.on("requestfailed", (request) => {
      const call = calls.get(request);
      if (call) call.status = "failed";
    });

    if (this.opts.blockHits) {
      await this.context.route((url) => isCollectionEndpoint(url.href), async (route) => {
        onRequest(route.request());
        await route.fulfill({ status: 204, body: "" });
      });
    } else {
      this.context.on("request", onRequest);
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
      return route.abort("blockedbyclient");
    });
    this.beginStep("start");
  }

  /** The hit with user data for ad matching redacted, and userData: { fields, plain } when there was any. */
  redactHit({ userFields, ...hit }) {
    const found = { fields: [], plain: [] };
    const url = redactUrl(hit.url, found).url;
    const params = redactParams(hit.params, found);
    redactParams(userFields, found); // fields from the POST body that the hit doesn't keep
    if (!found.fields.length) return hit;
    const userData = { fields: [...new Set(found.fields)], plain: [...new Set(found.plain)] };
    return this.opts.keepBodies ? { ...hit, userData } : { ...hit, url, params, userData };
  }

  /** A dataLayer entry with user data redacted, and userData: { fields, plain } when there was any. */
  redactEntry(entry) {
    const found = redactPush(entry.value);
    if (!found.fields.length) return entry;
    const userData = { fields: [...new Set(found.fields)], plain: [...new Set(found.plain)] };
    return this.opts.keepBodies ? { ...entry, userData } : { ...entry, value: found.value, userData };
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
    return { postData: this.opts.keepBodies ? body : redactBody(body).text };
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
    this.steps.push({ index: this.steps.length, label, t: Date.now(), ...extra });
  }

  async settle() {
    await this.page.waitForLoadState("load", { timeout: 15000 }).catch(() => {});
    await this.page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
    await this.page.waitForTimeout(400);
  }

  async snapshot() {
    const blocked = await this.enforce();
    if (blocked && this.page.url() === "about:blank") return { url: "about:blank", title: "", elements: "", text: `(${blocked})` };
    try {
      // The main page first, then iframes (booking and payment widgets often live in one).
      const frames = await this.visibleFrames();
      const main = await this.page.evaluate(snapshotInPage, { first: 1, limit: frames.length ? MAX_ELEMENTS - 60 : MAX_ELEMENTS, textLimit: 3000 });
      this.refFrames = new Map();
      const lines = [...main.lines];
      let next = main.next;
      let more = main.more;
      for (const { frame, frameBox } of frames) {
        if (next > MAX_ELEMENTS) break;
        const sub = await frame.evaluate(snapshotInPage, { first: next, limit: MAX_ELEMENTS - next + 1, textLimit: 0, frameBox }).catch(() => null);
        if (!sub?.lines.length) continue;
        lines.push(`(inside an embedded frame from ${new URL(sub.url).host})`, ...sub.lines);
        for (let r = next; r < sub.next; r++) this.refFrames.set(r, frame);
        next = sub.next;
        more ||= sub.more;
      }
      if (more) lines.push(`(more elements not listed: scroll to bring them on screen, or use text to click something by its visible text)`);
      const note = this.steps[this.currentStep]?.note;
      return { url: main.url, title: main.title, elements: lines.join("\n"), text: main.text, note };
    } catch (err) {
      return { url: this.page.url(), title: "", elements: "", text: `(snapshot failed: ${err.message})` };
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
      .evaluate((el) => {
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
            n.matches("#onetrust-banner-sdk, #onetrust-consent-sdk, #CybotCookiebotDialog, #usercentrics-root, #didomi-host, #cookiescript_injected, .cky-consent-container, .cc-window, #cmpbox, .qc-cmp2-container") ||
            (/(cookie|consent|gdpr|kvkk)/i.test(`${n.id} ${typeof n.className === "string" ? n.className : ""}`) && ["fixed", "sticky"].includes(getComputedStyle(n).position));
          if (consent) return { blocking: true, what: describe(n) };
          if (modal || b.width * b.height >= screen * 0.5) return { blocking: true, what: describe(n) };
        }
        return { blocking: false, what: describe(hit), free };
      })
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
   * @param {{ action: string, ref?: number, selector?: string, text?: string, value?: string, url?: string, reason?: string, accepts_consent?: boolean }} a
   */
  async act(a) {
    const describe = a.reason || `${a.action} ${a.selector ?? (a.ref != null ? `#${a.ref}` : a.text != null ? `"${a.text}"` : a.url ?? "")}`.trim();
    this.beginStep(describe, { action: a.action, acceptsConsent: !!a.accepts_consent });
    try {
      switch (a.action) {
        case "goto": {
          const target = new URL(a.url, this.page.url() === "about:blank" ? undefined : this.page.url()).href;
          const refused = await this.checkUrl(target);
          if (refused) return refused;
          await this.page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
          break;
        }
        case "click":
        case "fill":
        case "select": {
          let target;
          if (a.selector || Number.isInteger(a.ref)) target = this.locatorFor(a);
          else if (typeof a.text === "string" && a.text.trim()) {
            const found = await this.locateByText(a.text.trim());
            if (found.error) return found.error;
            target = found.locator;
          } else return `${a.action} needs a ref or the element's visible text.`;
          if (a.action === "click") await this.click(target);
          else if (a.action === "fill") await target.fill(a.value ?? "", { timeout: 10000 });
          else await target.selectOption(a.value ?? "", { timeout: 10000 });
          break;
        }
        case "scroll": {
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
          await this.page.waitForTimeout(Math.min(Number(a.value) || 1000, 10000));
          break;
        default:
          throw new Error(`Unknown action "${a.action}"`);
      }
      await this.settle();
      const blocked = await this.enforce();
      if (blocked) return blocked;
      if (a.accepts_consent && this.consentStep === null) this.consentStep = this.currentStep;
      return null;
    } catch (err) {
      return (await this.enforce().catch(() => null)) ?? err.message.split("\n")[0];
    }
  }

  async cookies() {
    return (await this.context.cookies()).map((c) => ({ name: c.name, domain: c.domain }));
  }

  async close() {
    await this.browser?.close();
    await this.egress?.close();
  }
}
