// The Events tab: the search and platform filter, the "Where hits go" card when hits went through a server, then
// the recording as steps with their hits in the order they happened, consent changes as dividers between them.
import { state, m, render, actions } from "../state.js";
import { el, icon, button, since, secs, renderSoon } from "../ui.js";
import { BADGE, matchRow, routesOf } from "../model.js";
import { aitsLogo, badge, stepBlock, summaryOf, consentWords, GOOGLE } from "./common.js";
import { hitDetail } from "./detail.js";
import { routesCard } from "./routes.js";
import { platformName } from "./setup.js";
import { allShown, chipClick, shownKeys } from "./filter.js";

const SERVER = new Set(["aits", "sgtm", "gateway", "stape", "elevar"]);
const failed = (s) => s === "failed" || (typeof s === "number" && s >= 400);

/** The platforms chosen in setup (every one seen when none were), and the ones recorded but not chosen. */
export function platformSets(model) {
  const seen = Object.keys(model.counts);
  const selected = model.chosen ?? seen;
  return { selected, unselected: seen.filter((k) => !selected.includes(k)) };
}

/** Which platforms are shown: the pressed chips plus the unselected ones shown from the popover. "other" = other requests. */
export function shownSet(model) {
  return shownKeys(state.filter, platformSets(model));
}
const isDefault = () => state.filter.on === null && !state.filter.extra.size;

/** The rows that pass the search and the Sent to filter, with what the search matched; the platform filter is apart. */
function searched(model) {
  const out = new Map();
  for (const r of model.rows) {
    const match = matchRow(r, state.filter.search);
    if (match === null) continue;
    if (state.filter.sentTo === "server" && !SERVER.has(r.route?.kind)) continue;
    if (state.filter.sentTo === "direct" && (r.kind !== "hit" || SERVER.has(r.route?.kind))) continue;
    out.set(r.key, match);
  }
  return out;
}

/** The visible rows: { rows: Map(key → match), total }. Used by the tab count ("6 / 18"). */
export function visibleRows(model) {
  const shown = shownSet(model);
  const found = searched(model);
  const rows = new Map();
  for (const r of model.rows) {
    if (!found.has(r.key)) continue;
    if (shown.has(r.kind === "call" ? "other" : r.platform)) rows.set(r.key, found.get(r.key));
  }
  return { rows, total: model.rows.filter((r) => r.kind === "hit").length };
}

// ---------- toolbar ----------

function chip({ key, label, count, pressed, swatch, dashed, onclick, ondblclick, title }) {
  return el("button", { class: `chip${dashed ? " dash" : ""}`, type: "button", "aria-pressed": dashed ? null : String(pressed), "data-chip": key, title, onclick, ondblclick },
    swatch ? el("span", { class: `sw ${swatch}` }) : dashed ? icon("plus", "s") : null, label, el("span", { class: "n", text: String(count) }));
}

/** The selected, unselected and "other requests" keys the filter works over. */
function filterSets(model) {
  return { ...platformSets(model), hasOther: model.rows.some((r) => r.kind === "call") };
}

/** A chip or popover click, through the tested reducer in filter.js. */
function toggle(model, key, solo = false) {
  const next = chipClick(state.filter, key, filterSets(model), { solo });
  state.filter.on = next.on;
  state.filter.extra = next.extra;
  // The popover's Show / Hide labels follow: a new layer object asks for it to be drawn again.
  if (state.layer?.kind === "notSelected") state.layer = { ...state.layer };
  actions.saveFilter();
  render();
}

/** Oldest first or newest first, for Events and dataLayer alike; remembered for the panel. */
export function orderToggle() {
  const t = m().events;
  const newest = state.order === "newest";
  return el("button", { class: "btn ghost mini", type: "button", id: "order", "aria-label": t.orderLabel, title: t.orderLabel,
    onclick: () => actions.setOrder(newest ? "oldest" : "newest") }, el("span", { class: newest ? "flip" : null }, icon("arrow-d", "s")), newest ? t.newestFirst : t.oldestFirst);
}

export function eventsToolbar(model) {
  const t = m().events;
  const found = searched(model);
  const count = (key) => model.rows.filter((r) => found.has(r.key) && (key === "other" ? r.kind === "call" : r.kind === "hit" && r.platform === key)).length;
  const { selected, unselected } = platformSets(model);
  const shown = shownSet(model);
  const allKeys = [...selected, ...unselected, ...(model.rows.some((r) => r.kind === "call") ? ["other"] : [])];
  const everything = allShown(state.filter, filterSets(model));
  const search = el("label", { class: "search" }, icon("search"),
    el("input", { id: "search", type: "search", placeholder: t.search, value: state.filter.search, "aria-label": t.search,
      oninput: (e) => { state.filter.search = e.target.value; renderSoon(); },
      onkeydown: (e) => { if (e.key === "Escape") { state.filter.search = ""; render(); } } }),
    el("span", { class: "kbd", text: "/" }));
  const chips = el("div", { class: "chips", role: "group", "aria-label": t.platformFilter },
    chip({ key: "all", label: t.all, count: model.rows.filter((r) => r.kind === "hit" && found.has(r.key)).length, pressed: everything, onclick: () => toggle(model, "all") }),
    // The short badge names (G Ads, MS Ads) keep every chip on one row at 400 px; the full name is in the tooltip.
    selected.map((k) => chip({ key: k, label: BADGE[k] ?? platformName(k), count: count(k), pressed: shown.has(k), swatch: k in BADGE ? k : "other", title: `${platformName(k)} · ${t.soloHint}`,
      onclick: (e) => toggle(model, k, e.altKey), ondblclick: () => toggle(model, k, true) })),
    unselected.length || allKeys.includes("other") ? chip({ key: "notSelected", label: t.notSelected, count: [...unselected, "other"].reduce((n, k) => n + count(k), 0), dashed: true,
      onclick: (e) => { state.layer = { kind: "notSelected", anchor: e.currentTarget.getBoundingClientRect() }; render(); } }) : null);
  const visible = visibleRows(model).rows.size;
  const note = isDefault() ? null : el("div", { class: "filternote" },
    el("span", { text: t.onlyShowing([...shown].filter((k) => k !== "other").map((k) => BADGE[k] ?? k).join(", ") || "—", model.rows.length - visible) }),
    button(t.showAll, () => { state.filter.on = null; state.filter.extra = new Set(); actions.saveFilter(); render(); }, { cls: "linkbtn" }));
  const servers = model.rows.some((r) => SERVER.has(r.route?.kind));
  let sentTo = null;
  if (servers) {
    // Only when a server route was seen, and as one compact control: most sites have none.
    const inShown = model.rows.filter((r) => r.kind === "hit" && shown.has(r.platform) && matchRow(r, state.filter.search) !== null);
    const s = inShown.filter((r) => SERVER.has(r.route?.kind)).length;
    sentTo = el("select", { class: "minisel", id: "sentTo", "aria-label": t.sentTo, title: t.sentTo, onchange: (e) => { state.filter.sentTo = e.target.value; render(); } },
      [["any", t.anyRoute], ["server", `${t.serverSide} ${s}`], ["direct", `${t.direct} ${inShown.length - s}`]]
        .map(([v, label]) => el("option", { value: v, selected: state.filter.sentTo === v, text: label })));
  }
  return el("div", { class: "toolbar" }, el("div", { class: "toprow" }, search, sentTo, orderToggle()), chips, note);
}

/** The popover behind "+ Not selected": each unselected platform and other requests, with Show and Add to platforms. */
export function notSelectedPopover(model) {
  const t = m().events;
  const { unselected } = platformSets(model);
  const r = state.layer.anchor;
  const rows = unselected.map((k) => el("div", { class: "pr" }, el("span", { class: `sw ${k in BADGE ? k : "other"}`, style: { width: "8px", height: "8px", borderRadius: "2px" } }),
    el("span", { class: "grow", text: platformName(k) }), el("span", { class: "n", text: String(model.counts[k]) }),
    button(state.filter.extra.has(k) ? t.hide : t.show, () => toggle(model, k), { cls: "linkbtn" }),
    button(t.addPlatform, () => actions.addPlatform(k), { cls: "linkbtn" })));
  const others = Object.entries(model.other);
  return el("div", { class: "popover", role: "dialog", "aria-label": t.notSelected, style: { left: `${Math.max(8, Math.min(r.left, window.innerWidth - 288))}px`, top: `${r.bottom + 6}px` } },
    rows,
    others.length ? [el("div", { class: "ph", text: t.otherRequests }),
      el("div", { class: "pr" }, el("span", { class: "grow", text: others.map(([v, n]) => `${v} ${n}`).join(", ") }),
        button(state.filter.extra.has("other") ? t.hide : t.show, () => toggle(model, "other"), { cls: "linkbtn" }))] : null);
}

// ---------- rows ----------

function routeBadge(row) {
  const kind = row.route?.kind;
  if (!kind || kind === "google") return null;
  const rt = m().routes;
  return el("span", { class: `route${kind === "direct" ? " direct" : ""}`, title: rt.tip(kind, row.route.host, row.route.firstParty) }, kind === "aits" ? aitsLogo(11) : null, rt.badge[kind]);
}

function checkIcon(row) {
  const c = row.check;
  if (!c) return null;
  const d = m().detail;
  const reasons = c.problems.map((p) => (p.kind === "missing" ? d.problems.missing(p.param) : p.kind === "valueTotal" ? d.problems.valueTotal(p.value, p.total) : d.problems.noCurrency)).join("\n");
  const [cls, ico] = c.state === "ok" ? ["ok", "check"] : c.state === "broken" ? ["bad", "x"] : ["warn", "warn"];
  return el("span", { class: `pc ${cls}`, title: reasons || d.matches, role: "img", "aria-label": reasons || d.matches }, icon(ico, "s"));
}

function rowLabel(row, summary, step) {
  const d = m().detail;
  const plan = row.check ? (row.check.state === "ok" ? m().events.aria.ok : row.check.state === "broken" ? m().events.aria.broken : m().events.aria.warning) : "";
  return [`${BADGE[row.platform] ?? row.vendor ?? ""} ${row.name}`.trim(), summary, m().events.aria.time(secs(row.t, step.t)), plan, failed(row.status) ? String(row.status) : "", row.kind === "hit" && row.batch ? `${d.batch} ${d.batchOf(row.batch.index, row.batch.size)}` : ""].filter(Boolean).join(", ");
}

// Set by eventsList for the rows it draws.
let multiId = {};

/** Which pixel or property a hit went to, shown only when its platform sent to more than one (two Meta pixels). */
function idTag(row) {
  const id = row.kind === "hit" ? row.hit.id : null;
  if (!id || !multiId[row.platform]) return null;
  return el("span", { class: "idtag", title: id, text: id.length > 10 ? `…${id.slice(-6)}` : id });
}

function eventRow(row, step, match, batchPos) {
  const t = m().events;
  const open = state.open.has(row.key);
  const sum = summaryOf(row, match);
  const cls = ["ev", open && "open", row.auto && "muted", row.kind === "call" && "call", state.newKeys.has(row.key) && "new", state.flash === row.key && "flash",
    batchPos && `batch ${row.platform} ${batchPos}`].filter(Boolean).join(" ");
  const node = el("div", {
    class: cls, role: "treeitem", "aria-level": "2", "aria-expanded": String(open), tabindex: "-1", id: `row-${CSS.escape(row.key)}`, "data-key": row.key,
    "aria-label": rowLabel(row, sum.text, step),
    onclick: (e) => { if (e.target.closest("button, a")) return; actions.toggleRow(row.key, e.shiftKey); },
  },
  row.kind === "hit" ? badge(row.platform) : el("span", { class: "pb other", text: t.other }),
  el("span", { class: "nm" }, el("b", { text: row.kind === "call" ? row.name.split("/").filter(Boolean).slice(-2).join("/") || row.name : row.name }), idTag(row), sum.text ? el("span", { class: `sum${sum.cls ? ` ${sum.cls}` : ""}`, text: sum.text }) : null),
  el("span", { class: "rt" },
    (row.flags ?? []).map((f) => el("span", { class: "flag", title: t.flags[f], text: f === "_nsi" ? "NSI" : f.slice(1).toUpperCase() })),
    // A request that failed never reached the platform: its error is the row's state, and the plan check (which
    // only says what was sent) stays inside the detail.
    routeBadge(row), failed(row.status) ? el("span", { class: "err", title: t.failedTip }, "✕ ", row.status === "failed" ? t.failed : String(row.status)) : checkIcon(row),
    el("span", { class: "t", text: since(row.t, step.t) }),
    el("span", { class: "chv" }, icon("chev-d", "s"))));
  return open ? [node, hitDetail(row, step)] : [node];
}

/**
 * Which consent commands become dividers: the first default in full, then a one-line divider each time the state
 * really changes. A site that repeats the same default and update on every page load shows them once.
 */
function consentShown(model) {
  const show = new Map();
  let first = null;
  let cur = null;
  for (const c of model.consent) {
    if (!first && c.mode === "default") { first = c; cur = { ...c.signals }; show.set(c.key, "full"); continue; }
    if (c.mode === "default" && first && JSON.stringify(c.signals) === JSON.stringify(first.signals)) continue;
    const next = { ...(cur ?? {}), ...c.signals };
    if (cur && Object.keys(next).every((k) => next[k] === cur[k])) continue;
    show.set(c.key, cur ? "line" : "full");
    cur = next;
  }
  return show;
}

function divider(c, step, model, kind) {
  const t = m().events;
  const what = consentWords(c.signals);
  const tone = c.summary === "denied" ? "denied" : c.summary === "granted" ? "granted" : "partly";
  const second = c.mode === "default" ? Object.keys(c.signals).filter((k) => c.signals[k] === "denied").join(", ") : model.cmp ? t.viaCmp(model.cmp) : t.viaGtag;
  const line = kind === "line";
  return el("div", { class: `cdiv ${tone}${line ? " slim" : ""}`, role: "treeitem", "aria-level": "2", tabindex: "-1", "data-key": c.key },
    el("span", { class: "ic" }, icon(tone === "granted" ? "shield-c" : tone === "denied" ? "shield-x" : "shield", line ? "" : "l")),
    el("span", { class: "grow" }, el("b", { text: c.mode === "default" ? t.dividerDefault(what) : t.dividerUpdate(what) }), second ? [line ? " · " : el("br"), el("span", { class: "sig", text: second })] : null),
    el("span", { class: "t", text: since(c.t, step.t) }));
}

/** Whether a step is collapsed: by hand, or (while recording) because it is older than the previous one. */
export function stepCollapsed(step, model) {
  if (state.closedSteps.has(step.index)) return true;
  if (state.openSteps.has(step.index)) return false;
  return Boolean(state.live) && step.index < model.steps.length - 2;
}
export function toggleStep(step, model) {
  const collapsed = stepCollapsed(step, model);
  state.closedSteps.delete(step.index);
  state.openSteps.delete(step.index);
  (collapsed ? state.openSteps : state.closedSteps).add(step.index);
  render();
}

function nothingYet(model, stopped) {
  const t = m().events;
  const unselected = Object.entries(model.counts).filter(([k]) => model.chosen && !model.chosen.includes(k)).reduce((n, [, c]) => n + c, 0);
  return el("div", { class: "helpnote", role: "note" }, icon("info"), el("div", {},
    el("b", { text: stopped ? t.noneRecorded : t.nothingTitle }),
    el("ul", {}, t.nothing.map((s) => el("li", { text: s })),
      unselected ? el("li", {}, t.unselectedSeen(unselected), " ", button(t.showThem, () => { if (!allShown(state.filter, filterSets(model))) toggle(model, "all"); }, { cls: "linkbtn" })) : null)));
}

export function eventsList(model) {
  multiId = model.multiId ?? {};
  const t = m().events;
  const { rows: visible } = visibleRows(model);
  const out = [];
  const routes = routesOf(model);
  if (routes) out.push(routesCard(routes, model));
  const shown = shownSet(model);
  const dividers = consentShown(model);
  const newest = state.order === "newest";
  const names = [...shown].filter((k) => k !== "other").map((k) => BADGE[k] ?? k).join(", ");
  for (const step of newest ? [...model.steps].reverse() : model.steps) {
    const kept = step.entries.filter((e) => (e.kind === "consent" ? dividers.has(e.key) : visible.has(e.key)));
    const entries = newest ? kept.reverse() : kept;
    const hits = entries.filter((e) => e.kind !== "consent");
    const all = step.entries.filter((e) => e.kind !== "consent").length;
    const collapsed = stepCollapsed(step, model);
    const children = [];
    if (!collapsed) {
      entries.forEach((e, i) => {
        if (e.kind === "consent") return children.push(divider(e, step, model, dividers.get(e.key)));
        // The bracket joins the rows of one request: GA4 batches several events in one POST.
        const same = (o) => o && o.kind !== "consent" && o.e === e.e;
        const pos = same(entries[i - 1]) || same(entries[i + 1]) ? (!same(entries[i - 1]) ? "first" : !same(entries[i + 1]) ? "last" : "mid") : null;
        children.push(...eventRow(e, step, visible.get(e.key), pos));
      });
    }
    const filtered = hits.length < all;
    out.push(stepBlock(step, {
      collapsed, onToggle: () => toggleStep(step, model),
      count: filtered && !hits.length ? `0 ${names}` : t.eventsCount(hits.length), countClass: filtered && !hits.length ? "zero" : null, children,
    }));
  }
  const anyHit = model.rows.some((r) => r.kind === "hit");
  if (state.live) {
    const waiting = el("div", { class: "waiting" }, el("span", { class: "pulse" }), t.listening);
    if (newest) out.splice(routes ? 1 : 0, 0, waiting); else out.push(waiting);
    if (!anyHit && Date.now() - (state.recording?.startedAt ?? Date.now()) > 15000) out.push(nothingYet(model, false));
  } else if (!anyHit && state.recording) out.push(nothingYet(model, true));
  // A connected ai tagging server that stopped answering: its traces are missing for a reason worth saying.
  if (model.server?.state === "error") out.unshift(el("div", { class: "note", style: { margin: "8px 12px" } }, icon("warn"), el("span", { text: `${m().server.title}: ${m().server.error(model.server.detail)}` })));
  return el("div", { class: "list", role: "tree", "aria-label": m().tabs.events }, out);
}

export { GOOGLE };
