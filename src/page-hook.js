// The script that runs in every page and frame before the site's own: it records dataLayer pushes, Google container
// loads and iframe messages through window.__atdRecord, __atdLoad and __atdMessage. The CLI exposes those as
// Playwright bindings (src/browser.js); the Chrome extension defines them in its page hook (extension/hook-prelude.js),
// so both capture exactly the same thing.

// Runs inside INIT_SCRIPT: records each Google container script (gtm.js, gtag/js) the page adds, through
// window.__atdLoad, with how it got there. One set by a script carries that moment's call stack, whose script
// addresses tell who asked for it (see src/containers.js); one the HTML parser inserted never passes through
// the setters, so a MutationObserver reports it. A container reading another dataLayer gets it watched.
const CONTAINER_HOOK = `
  const docUrl = location.href;
  const doc = Math.random().toString(36).slice(2, 10);
  const isContainer = (src) => /\\/(gtm\\.js|gtag\\/js)\\?/.test(String(src)) && /[?&]id=/.test(String(src));
  const seen = new WeakSet();
  const report = (el, src, how, frames = []) => {
    try {
      const abs = new URL(String(src), document.baseURI).href;
      if (!isContainer(abs) || !window.__atdLoad) return;
      const layer = new URL(abs).searchParams.get("l") || "dataLayer";
      watch(layer);
      window.__atdLoad({ src: abs, how, frames, documentUrl: docUrl, page: location.href, doc });
    } catch {}
  };
  // The scripts on the stack when code sets a script's src. The first two frames are callers() and the setter, both
  // from this script; injected inline code (a Custom HTML tag) has no address and shows as <anonymous>.
  const callers = () => {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 50;
    const stack = String(new Error().stack || "");
    Error.stackTraceLimit = limit;
    return stack.split("\\n").filter((line) => /^\\s+at /.test(line)).slice(2)
      .map((line) => (line.match(/(https?:\\/\\/[^\\s()]+?):\\d+:\\d+/) || [])[1] || (/<anonymous>/.test(line) ? "inline" : null))
      .filter(Boolean);
  };
  // A script whose src code sets is a load only once it is in the page and of a type that runs. Consent platforms'
  // auto-blocking builds copies of a script, or adds one as text/plain, and drops them; the browser never fetches
  // those, so they are not loads. The callers are taken when src is set, since that is when they are on the stack.
  const pending = new WeakMap();
  const runnable = (el) => {
    const t = (el.getAttribute("type") || "").trim().toLowerCase();
    return !t || t === "module" || /^(text|application)\\/(x-)?(javascript|ecmascript)$/.test(t);
  };
  const noted = (el, src, frames) => {
    if (seen.has(el)) return;
    if (!el.isConnected) { pending.set(el, { src, frames }); return; }
    if (runnable(el)) { seen.add(el); report(el, src, "script", frames); }
  };
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, "src");
    Object.defineProperty(HTMLScriptElement.prototype, "src", {
      ...desc,
      set(v) { if (!seen.has(this)) noted(this, v, callers()); return desc.set.call(this, v); },
    });
    const setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, v) {
      if (this instanceof HTMLScriptElement && String(name).toLowerCase() === "src" && !seen.has(this)) noted(this, v, callers());
      return setAttribute.call(this, name, v);
    };
    new MutationObserver((list) => {
      for (const m of list) for (const n of m.addedNodes) {
        if (n instanceof HTMLScriptElement && !seen.has(n)) {
          const set = pending.get(n);
          if (set) { if (runnable(n)) { seen.add(n); report(n, set.src, "script", set.frames); } }
          else if (n.src) { seen.add(n); report(n, n.src, "parser"); }
        }
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

export const INIT_SCRIPT = `(() => {
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

// The page readers below run in the page after a load (Playwright's page.evaluate in the CLI, chrome.scripting in the
// extension), so each is self-contained: no closure over this module.

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
