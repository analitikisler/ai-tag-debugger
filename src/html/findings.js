// The Findings section: a filter bar over three groups. Failed rows (broken, risk, warning) are collapsed cards with
// Evidence / Fix / Where / Verify tabs; Unverified (info) and Passed rows are single lines that link to their proof.
// Filtering, tabs, groups and cards are the shell script's generic behaviors, driven by attributes; this module only
// writes markup. The evidence, GTM, verify and "fine on" data are read the way the 0.17 finding card read them.
import { verifyLinks } from "../verify.js";
import { consentTable } from "../consent.js";
import { changeLabel, fixSteps, platformRank } from "../report-shared.js";
import {
  PLATFORM_ART, OWNERS, alsoFineOn, badge, chip, detailHtml, esc, fmt, hitAnchor, hitFor, hitsOf, hostPath, missingParamRows, ownerOf,
  passedRows, pathOf, platformLabel, pushesOf, safeKey, secs, sectionBlock, sortPlatforms, stepTitle, use, whereTarget,
} from "./lib.js";

const SEVERITIES = ["broken", "risk", "warning", "info", "ok"];
const FAILED = new Set(["broken", "risk", "warning"]);
const VIEWPORTS = ["desktop", "mobile"];

/* ---------- small pieces ---------- */

const uniq = (xs) => [...new Set(xs.filter((x) => x !== undefined && x !== null && x !== ""))];
const placeKey = (w) => `${w.journey}\u0000${w.viewport}`;
/** The distinct runs (journey and viewport) a list of places covers, in first-seen order. */
const placesOf = (where) => uniq(where.map(placeKey)).map((k) => {
  const [journey, viewport] = k.split("\u0000");
  return { journey, viewport };
});
const placeText = (p) => `${p.journey} · ${p.viewport}`;
// Titles quote event and parameter names, as the checks' detail sentences do; on the page they become <code>.
const unquote = (s) => String(s ?? "").replace(/"/g, "");

/** A platform's artwork for a chip, or its initials when it has none. The chip's text names it, so no sr label here. */
function platArt(key) {
  const k = safeKey(key);
  if (PLATFORM_ART[k]) return use(`p-${k}`, 13);
  const initials = platformLabel(key).split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return `<span class="plat-fb s14" aria-hidden="true">${esc(initials)}</span>`;
}
const platChip = (p) => chip("plat", p, `${platArt(p)}${esc(platformLabel(p))}`);
const ownerChip = (m, o) => chip("owner", o, `<span class="dot"></span>${esc(m.ui.owners[o])}`);
const vpIcon = (vp) => use(vp === "mobile" ? "ui-mobile" : "ui-desktop", 13);
/** A run as a chip: journey hue and viewport icon. With an href it is a link to that place. */
function runChip(p, href) {
  const inner = `${vpIcon(p.viewport)}${esc(placeText(p))}`;
  return href ? `<a class="chip chip-vp ${safeKey(p.viewport)}" href="${href}">${inner}</a>` : chip("vp", p.viewport, inner);
}

/** The where cell of a row: one run as its chip, every run as "all n runs", one journey on both viewports as one chip
 *  with both icons, anything else as a count. The list of runs is in the tooltip. */
function whereCell(ctx, places) {
  if (!places.length) return "";
  if (places.length === 1) return runChip(places[0]);
  const list = esc(places.map(placeText).join(", "));
  if (ctx.runs.length > 1 && places.length === ctx.runs.length) return `<span class="chip plain" title="${list}">${esc(ctx.m.html.allRuns(places.length))}</span>`;
  const journeys = uniq(places.map((p) => p.journey));
  if (journeys.length === 1) return `<span class="chip plain run-multi" title="${list}">${places.map((p) => `<span class="vp-${safeKey(p.viewport)}">${vpIcon(p.viewport)}</span>`).join("")}${esc(journeys[0])}</span>`;
  return `<span class="chip plain" title="${list}">${esc(ctx.m.html.findings.runs(places.length))}</span>`;
}

/** The filter attributes of a row: space-separated tokens per key (safeKey, so a token never holds a space) and the
 *  lowercased search text. Accepted rows say so, so a count can leave them out as the rail's does. */
function attrs({ sev, owner, plats, places, text, accepted }) {
  const tokens = (xs) => esc(uniq(uniq(xs).map(safeKey)).join(" "));
  return ` data-sev="${tokens([sev])}" data-owner="${tokens(owner ? [owner] : [])}" data-plat="${tokens(plats)}" data-journey="${tokens(places.map((p) => p.journey))}" data-vp="${tokens(places.map((p) => p.viewport))}" data-text="${esc(String(text).toLowerCase().replace(/\s+/g, " ").trim())}"${accepted ? " data-accepted" : ""}`;
}

/* ---------- reading the capture ---------- */

// Pixel event names and their GA4 / dataLayer counterparts, so a Meta "Purchase" finds the "purchase" push (as the
// 0.17 step rows paired them; Journeys has the same table).
const EVENT_ALIASES = {
  pageview: "pageview", viewcontent: "viewitem", addtocart: "addtocart", addtowishlist: "addtowishlist", initiatecheckout: "begincheckout",
  addpaymentinfo: "addpaymentinfo", purchase: "purchase", completepayment: "purchase", placeanorder: "purchase", lead: "generatelead",
  completeregistration: "signup", search: "search", contact: "generatelead", submitform: "generatelead", subscribe: "subscribe", starttrial: "starttrial",
  viewbasket: "viewcart", tracktransaction: "purchase",
};
const normName = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const eventKey = (s) => EVENT_ALIASES[normName(s)] ?? normName(s);
// GTM-style pushes are objects ({event: "add_to_cart"}); gtag.js records arrays (["event", "add_to_cart", {...}]).
const pushEvent = (value) => (Array.isArray(value) ? (value[0] === "event" ? value[1] : undefined) : value && typeof value === "object" ? value.event : undefined);
const pushText = (value) => (Array.isArray(value) && typeof value[0] === "string" ? `gtag(${value.map((v) => JSON.stringify(v, null, 2)).join(", ")})` : JSON.stringify(value, null, 2));
const cell = (v) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** The parameters a missing_params row lacks: the grouped row drops them, the raw findings keep them. */
const paramsOf = (ctx, f) => ctx.findings.find((x) => x.severity === f.severity && x.check === f.check && x.platform === f.platform && x.event === f.event && x.detail === f.detail && x.params)?.params ?? null;

/** The first place of a row that names a step, resolved to its run and step. */
function firstStep(runs, f) {
  for (const w of f.where) {
    const t = w.step ? whereTarget(runs, w, f) : null;
    if (t?.step) return { run: runs[t.ri], ri: t.ri, step: t.step, w };
  }
  return null;
}

/** How many separate sends of the row's event its first step holds; hits that repeat an event ID count once, as the check counts them. */
function sendsOf(runs, f) {
  const at = firstStep(runs, f);
  if (!at) return 0;
  const hits = hitsOf(at.run, at.step.index).filter((h) => h.platform === f.platform && h.name === f.event);
  return new Set(hits.map((h, i) => (h.eventId ? `id:${h.eventId}` : `n:${i}`))).size;
}

/** The step the row's journeys stopped at, when they all stopped at the same one; null otherwise. */
function stoppedStep(runs, f) {
  const last = uniq(placesOf(f.where).map((p) => runs.find((r) => r.journeyId === p.journey && r.viewport === p.viewport)?.steps?.at(-1)?.index));
  return last.length === 1 && last[0] > 0 ? last[0] : null;
}

const firstSentence = (s) => String(s ?? "").match(/^.*?[.!?](?=\s|$)/s)?.[0] ?? String(s ?? "");

/** A row's short title as plain text with quoted names: the i18n title of its check when the capture gives what it
 *  needs, else the first sentence of the check's own detail. */
function titleOf(ctx, f) {
  const T = ctx.m.html.findings.title;
  if (f.check === "missing_params" && f.event) {
    const params = paramsOf(ctx, f);
    if (params?.length) return T.missing_params(f.event, params);
  } else if (f.check === "duplicate" && f.event) {
    const sends = sendsOf(ctx.runs, f);
    if (sends > 1) return T.duplicate(f.event, sends);
  } else if (["before_consent", "after_reject", "missing_event"].includes(f.check) && f.event) return T[f.check](f.event);
  else if (f.check === "consent_default_missing") return T.consent_default_missing();
  else if (f.check === "journey_incomplete") return T.journey_incomplete(stoppedStep(ctx.runs, f));
  return firstSentence(f.detail);
}

/** The check's own consequence or fix text from i18n; a function gets the row. */
const checkText = (block, f) => {
  const v = block?.[f.check];
  return typeof v === "function" ? v(f) : typeof v === "string" ? v : "";
};

/* ---------- the Evidence tab ---------- */

const kvTable = (label, rows) => (rows.length ? `<table class="fnd-kv" aria-label="${esc(label)}"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${v}</td></tr>`).join("")}</tbody></table>` : "");
const missingChip = (m) => chip("sev", "broken", esc(m.ui.missing));
const consentChips = (consent) => Object.entries(consent).map(([k, v]) => chip("consent", v === "granted" ? "granted" : "denied", `${esc(k)} ${esc(v)}`)).join("");

/** The captured parameters, the hit the row points at or the request that never went, as the 0.17 card read them. */
function evidenceRows(ctx, f) {
  const { m, runs, plan } = ctx;
  const t = m.html.findings;
  let captured = null;
  if (f.evidence) {
    try {
      const v = JSON.parse(f.evidence);
      if (v && typeof v === "object" && !Array.isArray(v)) captured = Object.entries(v).map(([k, x]) => [k, esc(cell(x))]);
    } catch { /* plain text */ }
    if (!captured) return { pre: `<pre>${esc(f.evidence)}</pre>`, rows: [] };
  }
  // An empty capture ({}: a pixel with no parameters) says nothing; the hit itself does.
  const rows = captured?.length ? captured : [];
  if (!rows.length) {
    const found = hitFor(runs, f);
    if (found) {
      rows.push(...Object.entries(found.hit.params ?? {}).map(([k, v]) => [k, esc(cell(v))]));
      rows.push([m.ui.request, `<span class="mono">${esc(hostPath(found.hit.url))}</span> · ${esc(secs(found.run, found.hit.t))}`]);
      if (found.hit.consent) rows.push([m.ui.consent, consentChips(found.hit.consent)]);
      else if (f.check === "before_consent" || f.check === "after_reject") rows.push([m.ui.consent, chip("consent", "none", esc(t.noSignal))]);
    } else if (f.check === "missing_event" && f.platform) rows.push([m.ui.requestTo(platformLabel(f.platform)), missingChip(m)]);
  }
  for (const p of missingParamRows(plan, f, Object.fromEntries(rows))) rows.push([p, missingChip(m)]);
  return { pre: "", rows };
}

/** Rows only some checks have: sends per platform for a duplicate, the Reject all scenario for a consent problem, where
 *  a journey stopped, how many runs pushed a Consent Mode default. */
function checkRows(ctx, f) {
  const { m, runs } = ctx;
  const t = m.html.findings;
  if (f.check === "duplicate" && f.event) {
    const at = firstStep(runs, f);
    if (!at) return [];
    const per = new Map();
    for (const h of hitsOf(at.run, at.step.index)) if (eventKey(h.name) === eventKey(f.event)) per.set(h.platform, (per.get(h.platform) ?? 0) + 1);
    return [...per].sort(([a], [b]) => platformRank(a) - platformRank(b)).map(([p, k]) => [platformLabel(p), esc(t.perAction(k))]);
  }
  if ((f.check === "before_consent" || f.check === "after_reject") && ctx.consentScenarios && f.platform && f.event) {
    const row = consentTable(ctx.consentScenarios).rows.find((r) => r.platform === f.platform && r.event === f.event);
    const reject = row?.cells.find((c) => c.state === "reject");
    if (!reject || reject.count === null) return [];
    const state = reject.problem ? chip("sev", "risk", `${use("sev-risk", 13)}${esc(t.stillSent)}`) : chip("sev", "ok", `${use("sev-ok", 13)}${esc(t.stopped)}`);
    return [[m.ui.scenarioCols.reject, `${state} <a href="#consent-scenarios">${esc(m.ui.scenarios)}</a>`]];
  }
  if (f.check === "journey_incomplete") {
    const p = placesOf(f.where)[0];
    const run = p && runs.find((r) => r.journeyId === p.journey && r.viewport === p.viewport);
    const last = run?.steps?.at(-1);
    if (!last || last.index < 1) return [];
    const rows = [[t.stoppedAt, `${esc(m.ui.md.step(last.index))} · ${esc(stepTitle(run, last))}`]];
    const error = last.error ?? null;
    if (error) rows.push([t.error, `<code>${esc(error)}</code>`]);
    return rows;
  }
  if (f.check === "consent_default_missing" && runs.length) {
    const present = (ctx.metrics.consent?.consentMode?.runs ?? []).filter((r) => r.present).length;
    return [[m.html.consentMode, esc(t.defaultIn(present, runs.length))]];
  }
  return [];
}

/** The runs where the event was fine, as OK chips linking to them; for missing parameters, with the value they carried. */
function fineChips(ctx, f) {
  const { m, runs } = ctx;
  const fine = alsoFineOn(runs, f);
  if (!fine.length) return "";
  return `<p class="fnd-fine">${fine.map((r) => {
    const hit = f.check === "missing_params" ? r.hits.find((h) => h.platform === f.platform && h.name === f.event) : null;
    const amount = hit?.params?.value !== undefined && hit?.params?.currency ? `${cell(hit.params.value)} ${cell(hit.params.currency)}` : "";
    return `<a class="chip chip-sev ok" href="#j${runs.indexOf(r)}">${use("sev-ok", 13)}${esc(m.html.findings.fineOn(`${r.journeyId} · ${r.viewport}`, amount))}</a>`;
  }).join("")}</p>`;
}

/** For missing parameters: whether the dataLayer push behind the hit already lacked them, and the push itself. */
function pushLine(ctx, f) {
  const at = firstStep(ctx.runs, f);
  const params = paramsOf(ctx, f);
  if (!at || !params?.length) return "";
  const push = pushesOf(at.run, at.step.index).find((d) => pushEvent(d.value) !== undefined && eventKey(pushEvent(d.value)) === eventKey(f.event));
  if (!push) return "";
  const v = push.value;
  const fields = Array.isArray(v) ? [v[2] ?? {}, v[2]?.ecommerce ?? {}] : [v, v.ecommerce ?? {}];
  const lacks = params.every((p) => fields.every((o) => !o || typeof o !== "object" || o[p] === undefined));
  const t = ctx.m.html.findings;
  return `<p class="fnd-line">${lacks ? detailHtml(t.pushLacks(params)) : esc(t.pushCarries)}</p><details class="fnd-raw"><summary>${esc(t.pushRaw)}</summary><pre>${esc(pushText(v))}</pre></details>`;
}

/** The tags in the GTM container export that send this event, with their triggers and why each did or did not fire. */
function gtmHtml(m, tags) {
  if (!tags) return "";
  const head = `<h4 class="fnd-h">${use("ui-gtm", 14)}${esc(m.ui.gtmTags)}</h4>`;
  if (!tags.length) return `${head}<p class="muted">${esc(m.ui.gtmNoTag)}</p>`;
  const trig = (t) => `${esc(t.name)}${t.event ? ` <span class="muted">(${esc(t.event)})</span>` : ""}`;
  const rows = tags.map((t) => {
    const notes = [t.paused ? m.ui.gtmPaused : "", t.consent?.length ? m.ui.gtmConsent(t.consent.join(", ")) : ""].filter(Boolean);
    const why = t.evaluation ? `<div class="xs gtm-why">${esc(m.ui.gtmWhy(t.name, m.ui.gtmVerdict[t.evaluation.fired], t.evaluation.why))}</div>` : "";
    const fires = t.triggers?.length ? `${esc(m.ui.gtmFiresOn)} ${t.triggers.map(trig).join(", ")}` : chip("sev", "broken", esc(m.ui.gtmNoTrigger));
    return `<tr><th scope="row">${esc(t.name)}${notes.length ? `<div class="muted xs">${esc(notes.join(" · "))}</div>` : ""}</th><td>${fires}${t.blocking?.length ? `<div class="muted xs">${esc(m.ui.gtmBlockedBy)} ${t.blocking.map(trig).join(", ")}</div>` : ""}${why}</td></tr>`;
  });
  return `${head}<table class="fnd-kv gtm-tags" aria-label="${esc(m.ui.gtmTags)}"><tbody>${rows.join("")}</tbody></table>`;
}

function evidenceTab(ctx, f, title) {
  const { m } = ctx;
  const e = f.explanation;
  const impact = e?.impact ? fmt(e.impact) : esc(checkText(m.consequence, f));
  // The detail is the check's full sentence; it says more than a short title, except for missing parameters.
  const detail = f.detail && f.check !== "missing_params" && unquote(f.detail) !== unquote(title) ? `<p class="fnd-detail">${detailHtml(f.detail)}</p>` : "";
  const { pre, rows } = evidenceRows(ctx, f);
  const table = kvTable(m.ui.evidence, [...checkRows(ctx, f), ...rows]);
  return `${impact ? `<p class="fnd-impact">${use("ui-impact", 14)}<span>${impact}</span></p>` : ""}${detail}${pre}${table}${fineChips(ctx, f)}${f.check === "missing_params" ? pushLine(ctx, f) : ""}${gtmHtml(m, f.gtm)}`;
}

/* ---------- the Fix, Where and Verify tabs ---------- */

function fixTab(ctx, f, owner) {
  const { m } = ctx;
  const t = m.html.findings;
  const text = checkText(m.fix, f);
  const e = f.explanation;
  const steps = fixSteps(e);
  const cause = e?.likely_cause ? `<p><span class="muted">${esc(m.ui.likelyCause)}:</span> ${fmt(e.likely_cause)}</p>` : "";
  const ai = steps.length || cause
    ? `<div class="fnd-ai"><p class="fnd-ai-h">${use("ui-ai", 14)}${esc(t.ai)}</p>${cause}${steps.length ? `<ol class="fix-steps">${steps.map((s) => `<li><span>${fmt(s)}</span></li>`).join("")}</ol>` : ""}</div>`
    : `<p class="fnd-ai muted">${esc(t.noModel)}</p>`;
  return `<p class="fnd-fix">${text ? `<span>${esc(text)}</span>` : ""}${ownerChip(m, owner)}</p>${ai}`;
}

/** A replay step as one line of the recipe: the action and its target, as the journey recorded it. */
function recipeLine(r) {
  if (!r?.action) return null;
  const target = r.action === "goto" ? pathOf(r.url) : r.selector ?? "";
  return [r.action, target, r.value !== undefined && r.value !== null ? JSON.stringify(String(r.value)) : ""].filter(Boolean).join(" ");
}

function whereTab(ctx, f) {
  const { m, runs } = ctx;
  const seen = new Set();
  const items = f.where.filter((w) => {
    const k = `${placeKey(w)}\u0000${w.step ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).map((w) => {
    const a = hitAnchor(runs, f, w);
    const step = a?.step;
    const page = step?.pagePath ? `<code>${esc(pathOf(step.pagePath))}</code>` : esc(m.html.pageUnknown);
    const where = step ? `<span class="fnd-step"><span class="muted">${esc(m.ui.md.step(step.index))} ·</span> ${esc(stepTitle(runs[a.ri], step))} <span class="muted">· ${page}</span></span>` : "";
    return `<li>${runChip(w, a ? `#${a.id}` : null)}${where}</li>`;
  });
  const at = firstStep(runs, f);
  let recipe = "";
  if (at) {
    const lines = at.run.steps.filter((s) => s.index >= 1 && s.index <= at.step.index).map((s) => recipeLine(s.replay)).filter(Boolean);
    if (lines.length) recipe = `<h4 class="fnd-h">${esc(m.html.findings.replay)}${placesOf(f.where).length > 1 ? ` ${runChip(at.w)}` : ""}</h4><ol class="fnd-recipe">${lines.map((l) => `<li><code>${esc(l)}</code></li>`).join("")}</ol>`;
  }
  return `<ul class="fnd-where">${items.join("")}</ul>${recipe}`;
}

const externalLink = (m, url, name) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${esc(name)}${use("ui-external", 12)}<span class="sr"> (${esc(m.html.newTab)})</span></a>`;

/* ---------- rows ---------- */

/** A Failed row: a collapsed card whose summary is one line and whose body holds the four tabs. */
function failedRow(ctx, f) {
  const { m, runs } = ctx;
  const id = ctx.ids.get(f);
  const owner = ownerOf(f);
  const places = placesOf(f.where);
  const title = titleOf(ctx, f);
  const links = verifyLinks(f).slice(0, 3);
  const tabs = [
    ["ev", m.ui.evidence, "", evidenceTab(ctx, f, title)],
    ["fix", m.ui.fixSteps, "", fixTab(ctx, f, owner)],
    ["where", m.ui.where, places.length, whereTab(ctx, f)],
    ...(links.length ? [["verify", m.ui.verify, "", `<ul class="fnd-links">${links.map((l) => `<li>${externalLink(m, l.url, l.name)}</li>`).join("")}</ul>`]] : []),
  ];
  const steps = f.where.map((w) => {
    const t = whereTarget(runs, w, f);
    return t?.step ? stepTitle(runs[t.ri], t.step) : "";
  });
  const text = [unquote(title), platformLabel(f.platform ?? ""), f.event, ...(paramsOf(ctx, f) ?? []), unquote(f.detail), ...places.map(placeText), ...steps, m.ui.owners[owner]].filter(Boolean).join(" ");
  const accepted = f.accepted === true;
  const note = accepted ? `<p class="note xs"><span class="badge">${use("sev-ok", 14)}${esc(m.html.accepted)}</span> ${esc(m.html.acceptedNote)}</p>` : "";
  return `<details class="card sev-${f.severity}" id="${id}" data-print-open${attrs({ sev: f.severity, owner, plats: [f.platform], places, text, accepted })}>
<summary>${badge(f.severity, m.severity[f.severity])}<span class="f-t">${detailHtml(title)}${accepted ? ` ${badge("", m.html.accepted)}` : ""}</span><span class="c-owner">${ownerChip(m, owner)}</span><span class="c-plat">${f.platform ? platChip(f.platform) : ""}</span><span class="c-where">${whereCell(ctx, places)}</span></summary>
<div class="body">${note}<div class="tabs" data-tabs><div role="tablist" aria-label="${esc(m.html.findings.details(unquote(title)))}">${tabs.map(([k, label, count], i) => `<button type="button" role="tab" aria-controls="${id}-${k}" aria-selected="${i === 0}">${esc(label)}${count ? ` <span class="n">${count}</span>` : ""}</button>`).join("")}</div>
${tabs.map(([k, label, , body]) => `<div role="tabpanel" id="${id}-${k}" data-label="${esc(label)}">${body}</div>`).join("\n")}</div></div></details>`;
}

/** A single-line row (Unverified or Passed): glyph, line, platform and run chips, and a link to what proves it. */
function lineRow(ctx, { id, sev, titleHtml, text, owner = "", plats, places, go, accepted = false }) {
  const { m } = ctx;
  const link = go ? `<a class="go" href="#${go}" aria-label="${esc(m.html.findings.showWhere)}">${use("ui-chevron", 16)}</a>` : "";
  return `<div class="card line sev-${sev}" id="${id}"${attrs({ sev, owner, plats, places, text, accepted })}>${badge(sev, m.severity[sev])}<span class="f-t">${titleHtml}${accepted ? ` ${badge("", m.html.accepted)}` : ""}</span><span class="c-owner"></span><span class="c-plat">${sortPlatforms(uniq(plats)).map(platChip).join("")}</span><span class="c-where">${whereCell(ctx, places)}</span>${link}</div>`;
}

/** An info row: an event the journey never reached reads "`event` · not reached" and links to its coverage row. */
function unverifiedRow(ctx, f) {
  const { m } = ctx;
  const places = placesOf(f.where);
  const early = f.check === "missing_event" && f.event;
  const title = early ? `"${f.event}"` : firstSentence(f.detail);
  const titleHtml = early ? `${detailHtml(title)} <span class="muted">· ${esc(m.html.findings.notReached)}</span>` : detailHtml(title);
  const text = [unquote(title), early ? m.html.findings.notReached : "", platformLabel(f.platform ?? ""), unquote(f.detail), ...places.map(placeText)].filter(Boolean).join(" ");
  // Coverage rows exist only when a plan was given.
  const go = early && f.platform && ctx.plan ? `cov-${safeKey(f.platform)}-${safeKey(f.event)}` : null;
  return lineRow(ctx, { id: ctx.ids.get(f), sev: "info", titleHtml, text, owner: ownerOf(f), plats: [f.platform], places, go, accepted: f.accepted === true });
}

/** The Passed rows, one per entry of passedRows (the count the Summary's OK chip and the rail show), with their filter tokens. */
function passedLines(ctx) {
  const { m, runs } = ctx;
  const t = m.html.findings.passed;
  const allRuns = runs.map((r) => ({ journey: r.journeyId, viewport: r.viewport }));
  return passedRows(ctx).map((p, i) => {
    let title = "";
    let plats = [];
    let places = [];
    let go = null;
    if (p.kind === "campaign_params") {
      title = t.campaign;
      places = placesOf(p.row.where);
      const w = p.row.where.find((x) => x.step);
      go = w ? hitAnchor(runs, p.row, w)?.id ?? null : null;
    } else if (p.kind === "coverage") {
      const c = p.coverage;
      title = t.coverage(c.counts.implemented, c.planned, c.percent?.implemented ?? null);
      plats = Object.keys(c.platforms ?? {});
      places = placesOf(allRuns);
      go = "coverage";
    } else if (p.kind === "consent_default") {
      title = t.consentDefault(p.consentMode.defaultOnTime === true);
      plats = runs.some((r) => (r.hits ?? []).some((h) => h.platform === "ga4")) ? ["ga4"] : [];
      places = placesOf(p.consentMode.runs.filter((r) => r.present));
      go = "consent-mode";
    } else if (p.kind === "conversion") {
      const c = p.conv;
      title = t.conversion(c.event, `${cell(c.value)} ${cell(c.currency)}`.trim());
      plats = [c.platform];
      places = [{ journey: c.journey, viewport: c.viewport }];
      go = hitAnchor(runs, { platform: c.platform, event: c.event }, { journey: c.journey, viewport: c.viewport, step: c.stepLabel })?.id ?? null;
    }
    const text = [unquote(title), ...plats.map(platformLabel), ...places.map(placeText), p.kind === "conversion" ? cell(p.conv.transactionId) : ""].filter(Boolean).join(" ");
    return { html: lineRow(ctx, { id: `f-ok-${i + 1}`, sev: "ok", titleHtml: detailHtml(title), text, plats, places, go }), tokens: rowTokens("ok", "", plats, places) };
  });
}

/* ---------- filter bar ---------- */

/** One row's tokens for the static chip counts: what the chip alone would show, as the script filters. */
const rowTokens = (sev, owner, plats, places) => ({ sev: [sev], owner: owner ? [owner] : [], plat: uniq(plats).map(safeKey), journey: uniq(places.map((p) => safeKey(p.journey))), vp: uniq(places.map((p) => safeKey(p.viewport))) });

function filterBar(ctx, items) {
  const { m, runs } = ctx;
  const t = m.html.findings;
  const count = (key, val) => items.filter((it) => it[key].includes(val)).length;
  const button = (key, val, label, cls, zeroShown = false) => {
    const c = count(key, val);
    if (!c && !zeroShown) return "";
    return `<button type="button" data-filter="${key}=${esc(val)}" aria-pressed="false" class="${cls}${c ? "" : " zero"}"${c ? "" : " disabled"}>${label}<span class="n">${c}</span></button>`;
  };
  const sev = SEVERITIES.map((s) => button("sev", s, `<span class="dot"></span>${esc(m.severity[s])}`, `chip-sev ${s}`, true)).join("");
  const owner = OWNERS.map((o) => button("owner", o, `<span class="dot"></span>${esc(m.ui.owners[o])}`, `chip-owner ${o}`)).join("");
  const plats = sortPlatforms(uniq(items.flatMap((it) => it.plat))).map((p) => button("plat", p, `${platArt(p)}${esc(platformLabel(p))}`, `chip-plat ${p}`)).join("");
  // Journeys in capture order, then any a finding names that no run has.
  const journeyNames = uniq([...runs.map((r) => r.journeyId), ...ctx.rows.flatMap((f) => f.where.map((w) => w.journey))]);
  const journeys = uniq(journeyNames.map(safeKey)).map((k) => button("journey", k, esc(journeyNames.find((j) => safeKey(j) === k)), "chip-journey")).join("");
  const vpKeys = uniq([...VIEWPORTS, ...items.flatMap((it) => it.vp)]);
  const vps = vpKeys.map((v) => button("vp", v, `${vpIcon(v)}${esc(v)}`, `chip-vp ${v}`)).join("");
  const group = (label, html) => (html ? `<span class="fg"><span class="fl">${esc(label)}</span>${html}</span>` : "");
  return `<div class="filterbar" data-filterbar="#f-list" role="group" aria-label="${esc(t.filterLabel)}">
<div class="fb-groups" id="fb-groups">${group(t.severity, sev)}${group(m.ui.md.owner, owner)}<div class="fb-rest">${group(m.ui.platform, plats)}${group(m.ui.journey, journeys)}${group(m.html.viewport, vps)}</div></div>
<label class="fb-search">${use("ui-search", 14)}<input type="search" data-filter-search placeholder="${esc(t.search)}" aria-label="${esc(t.searchLabel)}"></label>
<button type="button" class="fb-clear" data-filter-clear>${esc(m.html.shell.clear)}</button>
<input type="checkbox" class="fb-fold" aria-label="${esc(t.filters)}" data-label="${esc(t.filters)}" aria-controls="fb-groups">
<p data-filter-count aria-live="polite">${esc(m.html.shell.filterCount(items.length, items.length))}</p></div>`;
}

/* ---------- changed since last run ---------- */

const problemKey = (f) => [f.check, f.platform ?? "", f.event ?? ""].join("|");

/** "Changed since last run": what was fixed and what is new against the previous saved run, and route changes. */
function changesCard(ctx) {
  const { m, changes: ch } = ctx;
  if (!ch) return "";
  const line = ch.previous ? m.ui.changesLine(ch) : "";
  const summary = `<summary><h3 class="t">${esc(m.ui.changesTitle)}</h3>${line ? `<span class="end muted">${esc(line)}</span>` : ""}</summary>`;
  if (!ch.previous) return `<details class="card fnd-changes" id="changes">${summary}<div class="body"><p class="muted">${esc(m.ui.noPreviousRun)}</p></div></details>`;
  const open = new Map(ctx.rows.filter((f) => FAILED.has(f.severity) || f.severity === "info").map((f) => [problemKey(f), f]));
  const item = (sev, tag, c, was) => {
    const text = esc(`${changeLabel(c)} (${ch.mode === "findings" ? c.detail : m.ui.bucket[was]})`);
    const row = sev === "broken" ? open.get(problemKey(c)) : null;
    const id = row ? ctx.ids.get(row) : null;
    return `<li>${badge(sev, tag)} ${id ? `<a href="#${id}">${text}</a>` : text}</li>`;
  };
  const items = [...ch.fixed.map((c) => item("ok", m.ui.changeFixed, c, c.was)), ...ch.new.map((c) => item("broken", m.ui.changeNew, c, c.bucket))];
  const routes = (ch.routes ?? []).map((r) => `<li>${esc(`${r.journeyId} (${r.viewport}): ${r.before.join(" → ")} ⇒ ${r.after.join(" → ")}`)}</li>`);
  return `<details class="card fnd-changes" id="changes">${summary}<div class="body"><p class="muted xs">${esc(m.ui.changesLead(ch.previous, ch.mode))}</p>${items.length ? `<ul class="fnd-change-list">${items.join("")}</ul>` : ""}${routes.length ? `<ul class="fnd-change-list">${routes.join("")}</ul>` : ""}</div></details>`;
}

/* ---------- section ---------- */

/** @param {import("./shell.js").Ctx} ctx */
export function render(ctx) {
  const { m, rows, tally } = ctx;
  const t = m.html.findings;
  const failedRows = rows.filter((f) => FAILED.has(f.severity));
  const infoRows = rows.filter((f) => f.severity === "info");
  const passed = passedLines(ctx);
  // The tokens of every row, in list order, for the chip counts and "n of m".
  const items = [
    ...failedRows.map((f) => rowTokens(f.severity, ownerOf(f), [f.platform], placesOf(f.where))),
    ...infoRows.map((f) => rowTokens("info", ownerOf(f), [f.platform], placesOf(f.where))),
    ...passed.map((p) => p.tokens),
  ];
  const head = (kind, label, count) => `<h3><span class="chip lg chip-group ${kind}"><b data-group-count>${count}</b> ${esc(label)}</span></h3>`;
  // Nothing failed: say so under Failed, and the Passed group, open, is what was checked.
  const none = failedRows.length ? "" : `<p class="fnd-none muted">${use("sev-ok", 14)}${esc(m.ui.noProblems)}</p>`;
  const failed = `<div class="group" id="f-failed" data-filter-group>${head("failed", t.groups.failed, tally.failed)}${none}<div class="g-rows">${failedRows.map((f) => failedRow(ctx, f)).join("\n")}</div></div>`;
  const details = (kind, label, count, html, open) => `<details class="group" id="f-${kind}" data-filter-group${open ? " open" : ""}><summary>${head(kind, label, count)}</summary><div class="g-rows">${html}</div></details>`;
  const unverified = infoRows.length ? details("unverified", t.groups.unverified, tally.unverified, infoRows.map((f) => unverifiedRow(ctx, f)).join("\n"), false) : "";
  const passedGroup = passed.length
    ? details("passed", failedRows.length ? t.groups.passed : m.html.whatWasChecked, tally.passed, passed.map((p) => p.html).join("\n"), !failedRows.length)
    : failedRows.length ? "" : `<p class="fnd-none muted">${esc(m.html.whatWasChecked)}: ${esc(m.html.nothingVerified)}</p>`;
  const body = `${filterBar(ctx, items)}
${changesCard(ctx)}
<div class="fnd-list" id="f-list">
${failed}
${unverified}
${passedGroup}
<p class="fnd-empty muted" data-filter-empty hidden>${use("sev-info", 14)}${esc(t.empty)}</p>
</div>`;
  return sectionBlock("findings", esc(m.html.shell.sections.findings), body, "fnd");
}
