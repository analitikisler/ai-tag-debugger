// An opened hit (§5.4, §5.7): the meta line, the view switch, then Readable (labelled cards), All parameters
// (every key that arrived, grouped by the platform's dictionary) or Raw (the request as sent, one key=value a line).
import { state, m, render, actions, save } from "../state.js";
import { el, icon, button, copy, since, upper, infoButton, renderSoon } from "../ui.js";
import { groupsOf, isCustomParam, paramGroup, paramHint, paramLabel, paramTip, RECOMMENDED_ORDER } from "../../core/glossary.js";
import { isUserDataKey, redactParams } from "../../core/redact.js";
import { CONSENT_SIGNALS, decodeGcd } from "../../core/parsers.js";
import { card, statePill, GOOGLE, sentBeforeConsent, cookieless } from "./common.js";
import { itemsCard } from "./items.js";

const VIEWS = ["readable", "all", "raw"];

/** A value as the panel shows it: masked when Mask personal data is on and the key or value is personal. */
export function shown(key, value) {
  const v = String(value ?? "");
  if (!state.mask) return v;
  const personal = ["uid", "user_id", "up.user_id", "em", "_id"].includes(key) || isUserDataKey(key) || redactParams({ [key]: v })[key] !== v;
  return personal && v ? `${v.slice(0, 3)}••••` : v;
}

/** str / num / arr / obj / bool, from the key's prefix (epn. is a number) or the value itself. */
export function typeOf(key, value) {
  const v = String(value ?? "").trim();
  // IDs that happen to be digits (cid 555.666, sid, a pixel ID) are text: nobody adds them up.
  const idLike = /(^|[._[])(c?id|sid|tid|uid|eid|_p|gtm|oid|_s|label|ts|it|timestamp)(\]|$)/.test(key);
  if (/^(epn|upn)\./.test(key) || (!idLike && v !== "" && Number.isFinite(Number(v)) && !/^0\d/.test(v))) return "num";
  if (v.startsWith("[")) return "arr";
  if (v.startsWith("{")) return "obj";
  if (v === "true" || v === "false") return "bool";
  return "str";
}

let ctxKey = ""; // the hit being drawn, so each ⓘ names its own row

/** The explanation under a parameter row: the key and label, the dictionary's text, and for gcd where its letters come from. */
function tipLine(key, platform) {
  const p = m().params;
  const text = paramTip(key, state.lang, platform) ?? p.noTip;
  return el("div", { class: "tipline", id: "tipline", role: "note" }, el("span", { class: "tk", text: `${key} · ${paramLabel(key, state.lang, platform)}` }), text,
    key === "gcd" ? el("span", { class: "src", text: p.gcdSource(m().name) }) : null);
}

/** This hit's gcd, decoded: one line per signal with its default and its update (§5.7). */
function gcdTable(value) {
  const g = decodeGcd(value);
  if (!g) return null;
  const d = m().detail;
  const word = (v) => (v === "granted" ? `✓ ${d.granted}` : v === "denied" ? `✕ ${d.denied}` : "–");
  return el("table", { class: "gcdt" }, el("thead", {}, el("tr", {}, el("th", { text: m().consent.signal }), el("th", { text: m().consent.default }), el("th", { text: m().consent.update }))),
    el("tbody", {}, Object.entries(g).map(([signal, s]) => el("tr", {}, el("td", { text: `${signal} · ${s.letter}` }),
      el("td", { class: s.default ?? "", text: s.known ? word(s.default) : "?" }), el("td", { class: s.update ?? "", text: s.known ? word(s.update) : "?" })))));
}

/**
 * One label-over-key row of a parameter grid, and its explanation under it when its ⓘ is open. opts: label (else
 * the dictionary's), custom, absent, changed, hint, extra, title, keepKey.
 */
export function kvRow(key, value, platform, opts = {}) {
  const p = m().params;
  const d = m().detail;
  const group = paramGroup(key, platform);
  const label = opts.label ?? (group === "other" && !opts.keepKey ? p.unknown : paramLabel(key, state.lang, platform));
  const custom = opts.custom ?? isCustomParam(key, platform);
  const v = shown(key, value);
  const hint = opts.hint === false ? null : paramHint(key, v, state.lang, platform);
  const id = `${ctxKey}|${key}`;
  const lab = el("div", { class: "lab", "data-param": key, title: opts.title ?? null },
    label, infoButton(key, id),
    el("span", { class: "w" }, key, custom ? el("span", { class: "tag-custom", text: d.custom }) : null));
  const val = opts.absent
    ? el("div", { class: "val absent" }, el("span", { class: "x", text: opts.absentText ?? d.notSent }))
    : el("div", { class: "val" }, el("span", { class: `x${v === "" ? " muted" : ""}` }, v === "" ? d.empty : v, hint ? el("span", { class: "hint2", text: ` · ${hint}` }) : null, opts.extra ?? null),
    el("span", { class: "ty", text: d.types[typeOf(key, value)] }));
  if (opts.changed) { lab.classList.add("chg"); val.classList.add("chg"); }
  // gcd decoded in place, across the whole row so its three columns have room.
  const decoded = key === "gcd" && !opts.absent ? gcdTable(value) : null;
  const out = [lab, val, decoded ? el("div", { class: "gcdrow" }, decoded) : null].filter(Boolean);
  return state.tipOpen === id ? [...out, tipLine(key, platform)] : out;
}

const wireOf = (row) => row.wire ?? [];
const get = (row, key) => wireOf(row).find(([k]) => k === key)?.[1];

// ---------- meta line ----------

function metaLine(row, step) {
  const d = m().detail;
  const idLabel = row.platform === "meta" || row.platform === "tiktok" ? d.pixel : row.platform === "google_ads" ? d.conversionId : d.property;
  const id = row.platform === "google_ads" && row.hit?.id ? `AW-${row.hit.id}` : row.hit?.id;
  const sent = new Date(row.t);
  const stamp = `${sent.toLocaleTimeString(state.lang === "tr" ? "tr-TR" : "en-GB", { hour12: false })}.${String(sent.getMilliseconds()).padStart(3, "0")}`;
  const item = (k, ...v) => el("span", {}, el("span", { class: "k", text: `${k} ` }), el("span", { class: "v" }, v));
  const ep = row.endpoint;
  return el("div", { class: "d-head" },
    id ? item(idLabel, id) : null,
    item(d.request, `${row.e.method ?? "GET"} ${row.status ?? "…"}`),
    row.batch ? item(d.batch, d.batchOf(row.batch.index, row.batch.size)) : null,
    item(d.sent, `${since(row.t, step.t)} · ${stamp}`),
    ep ? item(d.endpoint, ep.kind === "gateway" ? `${m().routes.endpoint.gateway} → ${ep.to}` : m().routes.endpoint[ep.kind]) : null,
    row.route && row.route.kind !== "google" ? item(d.via, el("span", { class: `route${row.route.kind === "direct" ? " direct" : ""}`, text: m().routes.badge[row.route.kind] }), ` ${row.route.host}`) : null);
}

function viewSwitch(row) {
  const v = m().detail.views;
  const n = wireOf(row).length;
  return el("div", { class: "viewseg", role: "group", "aria-label": v.label },
    VIEWS.map((k) => el("button", { type: "button", "aria-pressed": String(state.detailView === k), "data-view": k,
      onclick: () => { state.detailView = k; save({ detailView: k }); render(); } }, k === "all" ? v.all(n) : v[k])));
}

// ---------- Readable ----------

function planCard(row) {
  const c = row.check;
  if (!c) return null;
  const d = m().detail;
  const lines = c.problems.length
    ? c.problems.map((p) => el("div", { class: `check-line ${p.kind === "missing" ? "badc" : "warnc"}` }, icon(p.kind === "missing" ? "x" : "warn", "s"),
      el("span", { text: p.kind === "missing" ? d.problems.missing(p.param) : p.kind === "valueTotal" ? d.problems.valueTotal(p.value, p.total) : d.problems.noCurrency })))
    : [el("div", { class: "check-line okc" }, icon("check", "s"), el("span", { text: d.planOk }))];
  const right = c.state === "ok" ? el("span", { style: { color: "var(--ok)" } }, icon("check", "s"), ` ${d.matches}`) : el("span", { style: { color: c.state === "broken" ? "var(--broken)" : "var(--warning)" }, text: c.state === "broken" ? d.broken : d.warnings });
  return card(d.planCheck, { right, body: lines });
}

const grid = (rows) => el("div", { class: "kv" }, rows);

function eventParams(row) {
  const d = m().detail;
  const keys = wireOf(row).filter(([k]) => k === "cu" || (/^epn?\./.test(k) && !/^epn?\.(page_location|page_referrer|page_title)$/.test(k)));
  const rank = (k) => {
    const name = k === "cu" ? "currency" : k.replace(/^epn?\./, "");
    const i = RECOMMENDED_ORDER.indexOf(name);
    return i < 0 ? RECOMMENDED_ORDER.length : i;
  };
  keys.sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
  if (!keys.length) return null;
  return card(d.eventParams, { count: keys.length, body: grid(keys.map(([k, v]) => kvRow(k, v, "ga4"))) });
}

function userProps(row) {
  const d = m().detail;
  const props = row.userProps ?? [];
  if (!props.length) return null;
  const uid = props.find(([k]) => k === "uid");
  const rest = props.filter(([k]) => k !== "uid").sort(([a], [b]) => a.replace(/^upn?\./, "").localeCompare(b.replace(/^upn?\./, "")));
  const right = uid ? el("span", { class: "uid-chip", text: upper(d.userIdSent) }) : el("span", { text: d.noUserId });
  const rows = [uid, ...rest].filter(Boolean).map(([k, v]) => {
    const ch = row.propChanges?.[k];
    return kvRow(k, v, "ga4", { changed: Boolean(ch), title: ch ? d.changedFrom(ch.was, ch.step + 1) : null });
  });
  return card(d.userProps, { count: props.length, right, key: `up:${row.key}`, body: grid(rows) });
}

function consentCard(row, model) {
  const d = m().detail;
  const google = GOOGLE.has(row.platform) && row.hit?.consent;
  const state0 = google ? row.hit.consent : row.consentAt;
  if (!state0) return null;
  const grant = model.consent.find((c) => c.mode === "update" && c.signals.ad_storage === "granted");
  const def = model.consent.find((c) => c.mode === "default");
  let foot;
  if (google && cookieless(row) && row.consentAt?.ad_storage === "denied") foot = d.deniedHit;
  else if (!google && sentBeforeConsent(row)) foot = d.sentDenied;
  else if (grant && def && row.t >= grant.t && def.summary !== "granted") foot = d.acceptedAt(grant.step + 1, ((grant.t - model.steps[grant.step].t) / 1000).toFixed(1));
  else if (!google) foot = d.inferred;
  const gcs = get(row, "gcs");
  const gcd = get(row, "gcd");
  const keys = CONSENT_SIGNALS;
  return card(google ? d.consentHit : d.consentAtSend, {
    right: gcs ? el("span", { class: "mono", text: `gcs ${gcs}` }) : null,
    key: `c:${row.key}`,
    body: [el("div", { class: "cgrid" }, keys.map((k) => el("div", {}, el("span", { class: "cl", text: d.signals[k] }), statePill(state0[k])))),
      foot || gcd ? el("div", { class: "cfoot" }, foot ?? "", gcd ? [" ", el("span", { class: "mono", text: `gcd ${gcd}` })] : null) : null],
  });
}

function pageSession(row) {
  const d = m().detail;
  const keys = ["dl", "dr", "dt", "cid", "sid", "sct", "seg", "_fv", "_ss", "_nsi", "dma", "npa"];
  const pairs = keys.map((k) => [k, get(row, k)]).filter(([, v]) => v !== undefined);
  if (!pairs.length) return null;
  const sct = get(row, "sct");
  const right = [sct ? d.session(sct) : null, get(row, "seg") === "1" ? d.engaged : null].filter(Boolean).join(" · ");
  return card(d.pageSession, { right, key: `ps:${row.key}`, openDefault: false, body: grid(pairs.map(([k, v]) => kvRow(k, v, "ga4"))) });
}

function curl(row) {
  const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
  return row.e.method === "POST" && row.e.body ? `curl -X POST ${q(row.e.url)} --data-binary ${q(row.e.body)}` : `curl ${q(row.e.url)}`;
}

function requestCard(row) {
  const d = m().detail;
  let host = "";
  try { host = new URL(row.e.url).hostname; } catch { /* not a URL */ }
  const url = state.mask ? redactUrlForShow(row.e.url) : row.e.url;
  const size = row.e.body ? ` · ${row.e.body.length} B` : "";
  const ep = row.endpoint ?? (row.callKind ? { kind: "setCookie" } : null);
  return card(d.requestSec, { right: host, key: `rq:${row.key}`, openDefault: row.kind === "call", body: [
    el("div", { class: "req" }, el("span", { class: "m", text: `${row.e.method ?? "GET"} ${row.status ?? ""}${size}` }),
      ep ? [" · ", ep.kind === "gateway" ? m().routes.endpoint.forwarded(ep.to) : ep.kind === "setCookie" ? m().events.setCookie : m().routes.endpoint[ep.kind]] : null,
      el("br"), url,
      row.e.body && row.batch ? [el("br"), el("br"), row.e.body.split("\n").filter(Boolean)[row.batch.index - 1] ?? ""] : null),
    el("div", { class: "d-actions", style: { padding: "0 10px 8px" } }, button(d.copyUrl, () => copy(url), { cls: "btn", ico: "copy" }), button(d.copyCurl, () => copy(curl(row)), { cls: "btn", ico: "copy" })),
  ] });
}

function redactUrlForShow(url) {
  try {
    const u = new URL(url);
    for (const [k, v] of [...u.searchParams]) u.searchParams.set(k, shown(k, v));
    return u.href;
  } catch { return url; }
}

function metaCards(row) {
  const d = m().detail;
  const pairs = wireOf(row);
  const cd = pairs.filter(([k]) => /^cd\[/.test(k));
  const out = [];
  if (cd.length) out.push(card(d.customData, { count: cd.length, body: grid(cd.map(([k, v]) => kvRow(k, v, "meta"))) }));
  const match = ["eid", "fbp", "fbc"].map((k) => [k, get(row, k)]);
  const ud = pairs.filter(([k]) => /^ud(ff)?\[/.test(k));
  const rows = match.flatMap(([k, v]) => (v === undefined && k !== "eid" ? [] : v === undefined ? kvRow(k, "", "meta", { absent: true }) : kvRow(k, v, "meta")));
  if (ud.length) rows.push(...ud.flatMap(([k, v]) => kvRow(k, v, "meta", { extra: el("span", { class: "hint2", text: ` · ${/^[a-f0-9]{64}$/.test(v) ? d.hashed : d.notHashed}` }) })));
  else rows.push(...kvRow("ud[em]", "", "meta", { absent: true }));
  out.push(card(d.matching, { body: [grid(rows), el("div", { class: `check-line ${row.hit.eventId ? "okc" : "warnc"}` }, icon(row.hit.eventId ? "check" : "warn", "s"), el("span", { text: row.hit.eventId ? d.eidOk : d.eidMissing }))] }));
  return out;
}

function adsCards(row, model) {
  const d = m().detail;
  const pairs = wireOf(row);
  const conv = [["label", get(row, "label")], ["value", get(row, "value")], ["currency_code", get(row, "currency_code")], ["oid", get(row, "oid")]].filter(([, v]) => v !== undefined);
  const planned = model.plan?.events?.find((e) => String(e.platform).toLowerCase() === "google_ads" && e.label && e.label === get(row, "label"));
  const rows = [...(row.hit.id ? kvRow("conversion_id", `AW-${row.hit.id}`, "google_ads", { label: d.conversionId, hint: false, keepKey: true }) : []),
    ...(planned ? kvRow("plan", planned.name, "google_ads", { label: d.conversionName, hint: false, keepKey: true }) : []),
    ...conv.flatMap(([k, v]) => kvRow(k, v, "google_ads"))];
  const clicks = pairs.filter(([k]) => ["gclaw", "gclgb", "auid", "gcl_ctr"].includes(k));
  return [card(d.conversion, { body: grid(rows) }), clicks.length ? card(d.clickIds, { count: clicks.length, body: grid(clicks.flatMap(([k, v]) => kvRow(k, v, "google_ads"))) }) : null];
}

function genericParams(row) {
  const d = m().detail;
  const pairs = wireOf(row);
  if (!pairs.length) return null;
  return card(d.eventParams, { count: pairs.length, body: grid(pairs.map(([k, v]) => kvRow(k, v, row.platform, { keepKey: true }))) });
}

function readable(row, model) {
  if (row.kind === "call") return [requestCard(row)];
  const out = [planCard(row)];
  if (row.platform === "ga4") out.push(eventParams(row), userProps(row), row.items.length ? itemsCard(row) : null, consentCard(row, model), pageSession(row));
  else if (row.platform === "meta") out.push(...metaCards(row), consentCard(row, model));
  else if (row.platform === "google_ads") out.push(...adsCards(row, model), consentCard(row, model));
  else out.push(genericParams(row), consentCard(row, model));
  out.push(requestCard(row));
  return out;
}

// ---------- All parameters ----------

function allParams(row) {
  const p = m().params;
  const pairs = wireOf(row);
  const platform = row.platform === "other" ? "ga4" : row.platform;
  const q = state.paramFilter.toLowerCase();
  const matches = ([k, v]) => !q || k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q) || paramLabel(k, state.lang, platform).toLowerCase().includes(q);
  const groups = groupsOf(platform).map((g) => [g, pairs.filter(([k]) => paramGroup(k, platform) === g)]).filter(([, list]) => list.length);
  const firstOpen = new Set(groupsOf(platform).slice(0, 4));
  const body = [];
  for (const [g, list] of groups) {
    const shownList = list.filter(matches);
    if (!shownList.length) continue;
    const open = q ? true : state.groupsOpen[g] ?? firstOpen.has(g);
    const absent = g === "session" && platform === "ga4" ? ["_fv", "_ss", "_nsi"].filter((f) => !pairs.some(([k]) => k === f)) : [];
    const summary = open ? (absent.length ? p.absentFlags(absent.map((f) => (f === "_nsi" ? "NSI" : f.slice(1).toUpperCase())).join(", ")) : "") : shownList.slice(0, 3).map(([, v]) => shown("", v).slice(0, 24)).join(" · ");
    body.push(el("button", { class: `gh${open ? "" : " closed"}`, type: "button", "aria-expanded": String(open), onclick: () => { state.groupsOpen[g] = !open; save({ groupsOpen: state.groupsOpen }); render(); } },
      el("span", { class: "chev" }, icon("chev-d", "s")), upper(p.groups[g] ?? g), el("span", { class: "c", text: String(shownList.length) }), summary ? el("span", { class: "r", text: summary }) : null));
    if (open) {
      for (const [k, v] of shownList) {
        if (/^pr\d+$/.test(k)) {
          body.push(...kvRow(k, v.length > 40 ? `${v.slice(0, 40)}…` : v, platform, { hint: false, extra: [" ", button(p.decodedInItems, () => { state.detailView = "readable"; render(); }, { cls: "linkbtn" })] }));
        } else body.push(...kvRow(k, v, platform));
      }
    }
  }
  const json = () => JSON.stringify(Object.fromEntries(groups.map(([g, list]) => [g, Object.fromEntries(list.map(([k, v]) => [k, shown(k, v)]))])), null, 2);
  const tsv = () => groups.flatMap(([g, list]) => list.map(([k, v]) => [p.groups[g] ?? g, paramLabel(k, state.lang, platform), k, shown(k, v)].join("\t"))).join("\n");
  const content = [
    el("label", { class: "search pfilter" }, icon("search"), el("input", { id: "paramFilter", type: "search", placeholder: p.filter(pairs.length), value: state.paramFilter, "aria-label": p.filter(pairs.length),
      oninput: (e) => { state.paramFilter = e.target.value; renderSoon(); } })),
    el("section", { class: "sec" }, el("div", { class: "kv" }, body)),
  ];
  return { content, buttons: [button(m().detail.copyJson, () => copy(json()), { cls: "btn", ico: "copy" }), button(m().detail.copyTable, () => copy(tsv()), { cls: "btn", ico: "copy" })] };
}

// ---------- Raw ----------

function raw(row) {
  const lines = [];
  try {
    const u = new URL(row.e.url);
    lines.push(`${row.e.method ?? "GET"} ${u.origin}${u.pathname}`);
    for (const [k, v] of u.searchParams) lines.push([k, shown(k, v)]);
  } catch { lines.push(row.e.url); }
  if (row.e.body) {
    lines.push("");
    const text = row.e.body.trim();
    if (text.startsWith("{") || text.startsWith("[")) lines.push(text);
    else for (const line of text.split("\n").filter(Boolean)) { for (const [k, v] of new URLSearchParams(line)) lines.push([k, shown(k, v)]); lines.push(""); }
  }
  const asText = lines.map((l) => (Array.isArray(l) ? `${l[0]}=${l[1]}` : l)).join("\n");
  return { content: [el("section", { class: "sec" }, el("pre", { class: "rawtext" }, lines.map((l) => (Array.isArray(l) ? [el("span", { class: "k", text: l[0] }), `=${l[1]}\n`] : `${l}\n`))))],
    buttons: [button(m().detail.copyRaw, () => copy(asText), { cls: "btn", ico: "copy" })] };
}

// ---------- the detail ----------

export function hitDetail(row, step) {
  const d = m().detail;
  const model = actions.model();
  const view = row.kind === "call" ? "readable" : state.detailView;
  ctxKey = row.key;
  const all = view === "all" ? allParams(row) : view === "raw" ? raw(row) : null;
  const content = all ? all.content : readable(row, model);
  const json = () => JSON.stringify(row.hit ? { platform: row.platform, name: row.name, id: row.hit.id, params: row.hit.params, items: row.items, consent: row.hit.consent, url: row.e.url } : { url: row.e.url }, (k, v) => (typeof v === "string" ? shown(k, v) : v), 2);
  const push = row.push ? model.pushes.find((p) => p.key === row.push) : null;
  // The one-time hint: on the first hit opened, in Readable only, gone with the next click.
  if (!state.hints.labels && row.kind === "hit" && view === "readable") { state.hintRow = row.key; actions.seenHint("labels"); }
  const hint = state.hintRow === row.key && view === "readable" ? el("div", { class: "note", style: { margin: "6px 12px 0" } }, icon("info"), el("span", { text: m().hints.labels })) : null;
  return el("div", { class: "detail", role: "group", "aria-labelledby": `row-${CSS.escape(row.key)}`, onclick: (e) => e.stopPropagation() },
    metaLine(row, step), row.kind === "hit" ? viewSwitch(row) : null, hint, content,
    el("div", { class: "d-actions", style: { paddingTop: "8px" } },
      all ? all.buttons : button(d.copyJson, () => copy(json()), { cls: "btn", ico: "copy" }),
      button(d.copyUrl, () => copy(state.mask ? redactUrlForShow(row.e.url) : row.e.url), { cls: "btn", ico: "copy" }),
      push ? button(d.fromPush(push.index + 1), () => actions.showPush(push.key), { cls: "btn" }) : null));
}

