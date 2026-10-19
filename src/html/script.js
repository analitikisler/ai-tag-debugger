// The report's one inline script, allowed by its hash in the page's CSP and the MCP server's header. Every behavior
// hangs off data attributes (CONTRACT-IMPL.md lists them); every word it shows comes from the markup, so the script is
// the same in every language and its hash never changes with the report's content.
import { createHash } from "node:crypto";

// ---------- shell: routing, rail, tabs, filters, single select, expand all, theme ----------
const SHELL = `/* Direction D shell: routing, rail, tabs, filters, single select, expand all, theme. The only script on the page,
   so the product can hash it for its CSP; every behavior hangs off data attributes documented in NOTES-shell.md. */
(function () {
  "use strict";
  var html = document.documentElement, body = document.body;
  html.classList.add("js");
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var byId = function (s) { return s ? document.getElementById(s.replace(/^#/, "")) : null; };
  var main = byId("main"), sections = $$("main > .sec");
  var store = function (k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
  var typing = function (el) { return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)); };
  var on = function (el, attr) { return el.getAttribute(attr) === "true"; };
  var step = function (list, i, key, prev, next) { // arrow, Home and End movement through a list, wrapping
    var j = key === next ? i + 1 : key === prev ? i - 1 : key === "Home" ? 0 : key === "End" ? list.length - 1 : null;
    return j === null || !list.length ? null : list[(j + list.length) % list.length];
  };

  /* ---------- tabs: [data-tabs] > [role=tablist] > [role=tab][aria-controls] ---------- */
  var enabled = function (t) { return !t.disabled && t.getAttribute("aria-disabled") !== "true"; };
  var tabsOf = function (box) { var l = box.querySelector("[role=tablist]"); return l ? $$("[role=tab]", l) : []; };
  var tabIndex = function (box) { return box ? tabsOf(box).findIndex(function (t) { return on(t, "aria-selected"); }) : -1; };
  function selectTab(tab, focus) {
    tabsOf(tab.closest("[data-tabs]")).forEach(function (t) {
      var sel = t === tab, p = byId(t.getAttribute("aria-controls"));
      t.setAttribute("aria-selected", sel); t.tabIndex = sel ? 0 : -1;
      if (p) p.hidden = !sel;
    });
    if (focus) tab.focus();
  }
  $$("[data-tabs]").forEach(function (box, b) {
    box.classList.add("js");
    var tabs = tabsOf(box);
    tabs.forEach(function (t, i) {
      var p = byId(t.getAttribute("aria-controls"));
      if (!t.id) t.id = "tab-" + b + "-" + i;
      if (p && !p.hasAttribute("aria-labelledby")) p.setAttribute("aria-labelledby", t.id);
    });
    var first = tabs.filter(function (t) { return on(t, "aria-selected") && enabled(t); })[0] || tabs.filter(enabled)[0];
    if (first) selectTab(first);
  });

  /* ---------- single select: [data-inspector] holds [data-select-target] buttons and [data-select-pane] panes ---------- */
  var mine = function (sel, insp) { return $$(sel, insp).filter(function (n) { return n.parentElement.closest("[data-inspector]") === insp; }); };
  var itemsOf = function (insp) { return mine("[data-select-target]", insp); };
  var currentPane = function (insp) { var v = mine("[data-select-pane]", insp).filter(function (p) { return !p.hidden; }); return v.length === 1 ? v[0] : null; };
  // The tab chosen in the old pane (Hits, Data layer, Requests) carries over to the new one, by position.
  function selectPane(insp, pane, tabAt) {
    var old = currentPane(insp);
    if (tabAt === undefined && old && old !== pane) tabAt = tabIndex(old.querySelector("[data-tabs]"));
    mine("[data-select-pane]", insp).forEach(function (p) { p.hidden = p !== pane; });
    itemsOf(insp).forEach(function (b) { if (byId(b.getAttribute("data-select-target")) === pane) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current"); });
    var box = pane.querySelector("[data-tabs]"), t = box && tabAt >= 0 ? tabsOf(box)[tabAt] : null;
    if (t && enabled(t)) selectTab(t);
  }
  $$("[data-inspector]").forEach(function (insp) {
    var panes = mine("[data-select-pane]", insp), btn = mine("[data-select-target][data-selected]", insp)[0];
    var first = panes.filter(function (p) { return p.hasAttribute("data-selected"); })[0] || (btn && byId(btn.getAttribute("data-select-target"))) || panes.filter(function (p) { return p.hasAttribute("data-flagged"); })[0] || panes[0];
    if (first) selectPane(insp, first);
  });
  // [data-vp-switch] buttons each show one inspector ([data-vp-target]) and keep the step and tab of the one they replace.
  function pressVp(btn, keep) {
    var from = null, to = byId(btn.getAttribute("data-vp-target"));
    $$("[data-vp-target]", btn.closest("[data-vp-switch]")).forEach(function (b) {
      var insp = byId(b.getAttribute("data-vp-target"));
      if (insp && !insp.hidden && b !== btn) from = insp;
      b.setAttribute("aria-pressed", b === btn);
      if (insp) insp.hidden = b !== btn;
    });
    if (!keep || !from || !to) return;
    var src = itemsOf(from), i = src.findIndex(function (b) { return b.hasAttribute("aria-current"); });
    var key = i >= 0 && src[i].getAttribute("data-step"), dst = itemsOf(to);
    var match = (key && dst.filter(function (b) { return b.getAttribute("data-step") === key; })[0]) || dst[Math.min(Math.max(i, 0), dst.length - 1)];
    var pane = currentPane(from);
    if (match) selectPane(to, byId(match.getAttribute("data-select-target")), tabIndex(pane && pane.querySelector("[data-tabs]")));
  }
  $$("[data-vp-switch]").forEach(function (sw) {
    var bs = $$("[data-vp-target]", sw);
    var first = bs.filter(function (b) { return on(b, "aria-pressed"); })[0] || bs[0];
    if (first) pressVp(first, false);
  });

  /* ---------- filters: .filterbar[data-filterbar="#LIST"]; rows are the [data-text] elements of LIST ---------- */
  var bars = $$("[data-filterbar]").map(function (bar) {
    var list = document.querySelector(bar.getAttribute("data-filterbar"));
    if (!list) return null;
    var rows = $$("[data-text]", list), chips = $$("[data-filter]", bar), search = bar.querySelector("[data-filter-search]");
    var count = bar.querySelector("[data-filter-count]"), tpl = count && (count.getAttribute("data-filter-count") || (main && main.getAttribute("data-filter-count")) || "{n}/{m}");
    var groups = $$("[data-filter-group]", list).map(function (g) { return { el: g, open: g.open }; });
    var clear = bar.querySelector("[data-filter-clear]"), timer;
    if (!clear) { clear = document.createElement("button"); clear.type = "button"; clear.className = "btn fb-clear"; clear.setAttribute("data-filter-clear", ""); clear.textContent = bar.getAttribute("data-clear-label") || (main && main.getAttribute("data-clear-label")) || "×"; bar.insertBefore(clear, count); }
    var kv = function (c) { var s = c.getAttribute("data-filter"), i = s.indexOf("="); return [s.slice(0, i), s.slice(i + 1)]; };
    var has = function (row, k, vals) { var toks = (row.getAttribute("data-" + k) || "").split(/\\s+/); return vals.some(function (v) { return toks.indexOf(v) >= 0; }); };
    chips.forEach(function (c) { // static count of the rows this chip alone would show
      if (!c.hasAttribute("data-count-for")) return;
      var p = kv(c), n = c.querySelector(".n") || c.appendChild(document.createElement("span"));
      n.className = "n"; n.textContent = rows.filter(function (r) { return has(r, p[0], [p[1]]); }).length;
    });
    function pressed() { var o = {}; chips.forEach(function (c) { if (on(c, "aria-pressed")) { var p = kv(c); (o[p[0]] = o[p[0]] || []).push(p[1]); } }); return o; }
    function apply(write) {
      var o = pressed(), keys = Object.keys(o), q = search ? search.value.trim() : "", ql = q.toLowerCase(), shown = 0, active = keys.length > 0 || !!q;
      rows.forEach(function (r) {
        var ok = (!ql || (r.getAttribute("data-text") || "").toLowerCase().indexOf(ql) >= 0) && keys.every(function (k) { return has(r, k, o[k]); });
        r.hidden = !ok; if (ok) shown++;
      });
      groups.forEach(function (g) { // with a filter on, a group with matches opens and one without hides; off, back to default
        var n = $$("[data-text]", g.el).filter(function (r) { return !r.hidden; }).length;
        g.el.hidden = active && !n;
        if (g.el.tagName === "DETAILS") g.el.open = active ? n > 0 : g.open;
        $$("[data-group-count]", g.el).forEach(function (c) { c.textContent = n; });
      });
      if (count) count.textContent = tpl.replace("{n}", shown).replace("{m}", rows.length);
      $$("[data-filter-empty]", list).forEach(function (e) { e.hidden = shown > 0; });
      clear.hidden = !active;
      var sec = bar.closest("main > .sec");
      if (write && sec) history.replaceState(null, "", "#" + sec.id + (active ? "?" + keys.map(function (k) { return k + "=" + o[k].join(","); }).concat(q ? ["q=" + encodeURIComponent(q)] : []).join("&") : ""));
    }
    function set(params, write) { // params: { key: [values], q: text }; {} clears
      chips.forEach(function (c) { var p = kv(c); c.setAttribute("aria-pressed", !!(params[p[0]] && params[p[0]].indexOf(p[1]) >= 0)); });
      if (search) search.value = params.q || "";
      apply(write);
    }
    bar.addEventListener("click", function (e) {
      var c = e.target.closest("[data-filter]");
      if (c && enabled(c)) { c.setAttribute("aria-pressed", !on(c, "aria-pressed")); apply(true); }
      else if (e.target.closest("[data-filter-clear]")) { set({}, true); if (search) search.focus(); }
    });
    if (search) search.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(function () { apply(true); }, 150); });
    apply(false);
    return { bar: bar, list: list, set: set };
  }).filter(Boolean);

  /* ---------- routing: #section, #section?key=v1,v2&q=text, #element-id ---------- */
  var mock = document.querySelector(".mock-switch");
  function show(sec) {
    var state = sec.id.indexOf("failed-") === 0 ? "failed" : "demo";
    sections.forEach(function (s) { s.hidden = s !== sec; });
    body.setAttribute("data-state", state);
    $$("[data-only]").forEach(function (n) { n.hidden = n.getAttribute("data-only") !== state; });
    if (mock) { mock.setAttribute("aria-pressed", state === "failed"); mock.querySelector(".m-val").textContent = mock.getAttribute(state === "failed" ? "data-on" : "data-off"); }
    $$(".rail a").forEach(function (a) { if (a.getAttribute("href") === "#" + sec.id) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  }
  function reveal(el) {
    var chain = [];
    for (var n = el; n && n !== main; n = n.parentElement) chain.unshift(n);
    chain.forEach(function (n) { // outermost first, so an inner tab choice wins over the tab a pane carries over
      if (n.hidden && n.hasAttribute("data-text")) bars.forEach(function (b) { if (b.list.contains(n)) b.set({}, false); });
      if (n.getAttribute("role") === "tabpanel") { var t = document.querySelector('[role=tab][aria-controls="' + n.id + '"]'); if (t) selectTab(t); }
      if (n.hasAttribute("data-inspector") && n.hidden) { var v = document.querySelector('[data-vp-target="#' + n.id + '"]'); if (v) pressVp(v, false); }
      if (n.hasAttribute("data-select-pane")) selectPane(n.parentElement.closest("[data-inspector]"), n);
      if (n.tagName === "DETAILS") n.open = true;
    });
    var inner = el.querySelector(":scope > details");
    if (inner) inner.open = true;
    var f = el.tagName === "DETAILS" ? el.querySelector("summary") : el;
    if (!f.matches("a[href],button,summary,input,[tabindex]")) f.setAttribute("tabindex", "-1");
    el.scrollIntoView({ block: "start" });
    f.focus({ preventScroll: true });
    el.classList.add("flash");
    setTimeout(function () { el.classList.remove("flash"); }, 1500);
  }
  function route(nav) {
    var h = location.hash.slice(1), qi = h.indexOf("?"), el;
    try { el = byId(decodeURIComponent(qi < 0 ? h : h.slice(0, qi))); } catch (err) { el = null; }
    var sec = el && el.closest("main > .sec");
    if (!sec) { el = sec = byId("summary") || sections[0]; qi = -1; if (!sec) return; }
    show(sec);
    if (el !== sec) return reveal(el);
    var params = {};
    if (qi >= 0) h.slice(qi + 1).split("&").forEach(function (p) {
      var i = p.indexOf("="), k = p.slice(0, i), v = p.slice(i + 1);
      try { v = decodeURIComponent(v); } catch (err) { /* keep the raw text */ }
      if (i > 0) params[k] = k === "q" ? v : v.split(",");
    });
    bars.forEach(function (b) { if (sec.contains(b.bar)) b.set(params, false); });
    window.scrollTo(0, 0);
    var h2 = sec.querySelector("h2");
    if (nav && h2) { h2.setAttribute("tabindex", "-1"); h2.focus({ preventScroll: true }); }
  }
  var go = function (hash) { if (location.hash === hash) route(true); else location.hash = hash; };
  window.addEventListener("hashchange", function () { route(true); });

  /* ---------- rail collapse ---------- */
  var railBtn = document.querySelector("[data-rail-toggle]");
  function setRail(collapsed, save) {
    html.setAttribute("data-rail", collapsed ? "collapsed" : "expanded");
    if (railBtn) {
      var label = railBtn.getAttribute(collapsed ? "data-expand" : "data-collapse");
      railBtn.setAttribute("aria-expanded", !collapsed); railBtn.setAttribute("aria-label", label); railBtn.setAttribute("data-tip", label);
    }
    if (save) store("aitd.rail", collapsed ? "collapsed" : "expanded");
  }
  setRail(store("aitd.rail") === "collapsed");
  // The width transition starts after the first paint, so a remembered collapsed rail does not animate on load.
  requestAnimationFrame(function () { requestAnimationFrame(function () { html.classList.add("rail-anim"); }); });

  /* ---------- clicks and keys ---------- */
  document.addEventListener("click", function (e) {
    var t = e.target, a = t.closest("a[href^='#']"), x;
    if (a && a.getAttribute("href") === location.hash) { e.preventDefault(); route(true); }
    else if ((x = t.closest("[data-tabs] [role=tab]")) && enabled(x)) selectTab(x);
    else if ((x = t.closest("[data-select-target]")) && x.closest("[data-inspector]")) select(x);
    else if ((x = t.closest("[data-vp-target]"))) pressVp(x, true);
    else if ((x = t.closest("[data-expand-all],[data-collapse-all]"))) $$("details.card", x.closest(".sec")).forEach(function (d) { d.open = x.hasAttribute("data-expand-all"); });
    else if (t.closest("[data-rail-toggle]")) setRail(html.getAttribute("data-rail") !== "collapsed", true);
    else if (t.closest(".mock-switch")) go(body.getAttribute("data-state") === "failed" ? "#summary" : "#failed-summary");
  });
  function select(btn, focus) {
    var insp = btn.closest("[data-inspector]"), pane = byId(btn.getAttribute("data-select-target"));
    if (!pane) return;
    selectPane(insp, pane);
    if (focus) btn.focus();
    if (pane.id) history.replaceState(null, "", "#" + pane.id);
  }
  document.addEventListener("keydown", function (e) {
    var t = e.target, x, n;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if ((x = t.closest && t.closest("[data-tabs] [role=tab]"))) {
      n = step(tabsOf(x.closest("[data-tabs]")).filter(enabled), tabsOf(x.closest("[data-tabs]")).filter(enabled).indexOf(x), e.key, "ArrowLeft", "ArrowRight");
      if (n) { e.preventDefault(); return selectTab(n, true); }
    }
    if ((x = t.closest && t.closest("[data-select-target]")) && x.closest("[data-inspector]")) {
      var items = itemsOf(x.closest("[data-inspector]")), vert = { ArrowUp: "ArrowUp", ArrowDown: "ArrowDown" }[e.key];
      n = step(items, items.indexOf(x), e.key, vert ? "ArrowUp" : "ArrowLeft", vert ? "ArrowDown" : "ArrowRight");
      if (n) { e.preventDefault(); return select(n, true); }
    }
    if (typing(t)) return;
    var state = body.getAttribute("data-state") === "failed" ? "failed-" : "";
    if (e.key === "[") { e.preventDefault(); setRail(html.getAttribute("data-rail") !== "collapsed", true); }
    else if (/^[1-7]$/.test(e.key)) {
      var a = $$('.rail ul:not([hidden]) > li > a')[+e.key - 1];
      if (a && a.getAttribute("href")) { e.preventDefault(); go(a.getAttribute("href")); }
    } else if (e.key === "/") {
      var s = byId(state + "findings"), q = s && s.querySelector("[data-filter-search]");
      if (s && s.hidden) { history.pushState(null, "", "#" + s.id); route(false); }
      if (q) { e.preventDefault(); q.focus(); }
    }
  });

  /* ---------- theme: auto → light → dark, remembered when storage allows ---------- */
  var btn = byId("theme"), order = ["auto", "light", "dark"], mode = store("aitd.theme");
  function apply(m) {
    if (m === "auto") html.removeAttribute("data-theme"); else html.setAttribute("data-theme", m);
    if (btn) { btn.setAttribute("aria-label", btn.getAttribute("data-" + m)); btn.title = btn.getAttribute("data-" + m); }
  }
  if (order.indexOf(mode) < 0) mode = "auto";
  apply(mode);
  if (btn) btn.addEventListener("click", function () { mode = order[(order.indexOf(mode) + 1) % order.length]; apply(mode); store("aitd.theme", mode); });

  route(false);
})();`;
// ---------- end of shell ----------

// ---------- journeys: keeps the viewport when the journey changes ----------
const JOURNEYS = `/* Journeys: what the generic behaviors do not do. shell.js keeps the step when the viewport changes
   ([data-vp-switch]); this keeps the viewport when the journey changes, so a reader comparing mobile runs stays
   on mobile, and writes the step now on screen to the hash (replaceState) after either switch. It only clicks
   the generic switch, so shell.js stays in charge of state. */
(function () {
  var pick = document.querySelector("#journeys .jr-pick");
  if (!pick) return;
  var shown = function (el) { return el.offsetParent !== null; };
  var each = function (sel, fn) { Array.prototype.forEach.call(pick.querySelectorAll(sel), fn); };
  function writeHash() {
    each("[data-select-pane]", function (p) { if (shown(p) && history.replaceState) history.replaceState(null, "", "#" + p.id); });
  }
  pick.addEventListener("click", function (e) {
    if (e.target.closest("[data-vp-target]")) return setTimeout(writeHash, 0);
    var tab = e.target.closest("[role=tab]");
    if (!tab || tab.parentNode.parentNode !== pick) return;
    var cur = null;
    each("[data-vp][aria-pressed=true]", function (b) { if (shown(b)) cur = b.getAttribute("data-vp"); });
    setTimeout(function () {
      var panel = document.getElementById(tab.getAttribute("aria-controls"));
      var want = cur && panel && panel.querySelector("[data-vp='" + cur + "']");
      if (want && want.getAttribute("aria-pressed") !== "true") want.click(); else writeHash();
    }, 0);
  });
})();`;
// ---------- end of journeys ----------

export const SCRIPT = [SHELL, JOURNEYS].join("\n");

/** The CSP source for the inline script, for the page's meta tag and the MCP server's Content-Security-Policy header. */
export const scriptCspSource = () => `'sha256-${createHash("sha256").update(SCRIPT).digest("base64")}'`;
