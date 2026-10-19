// The Coverage, Inventory and Run sections (three sections, one module). Every block is a collapsed card whose summary
// line carries the answer; Run's facts are an always-visible grid because they are that section's answer. The data
// handling (which runs check which platform, the funnel cells, the inventory's parties and cookies, the skipped
// vendors, the trend) is the 0.17 renderer's, so the numbers match the Markdown report and the CLI.
import { buildInventory } from "../inventory.js";
import { providerOf } from "../parsers.js";
import { siteOf } from "../redact.js";
import { VERSION, BUCKET_ORDER, coverageLines, pcSort, planChangeItems, routeList } from "../report-shared.js";
import {
  PLATFORM_ART, badge, chip, detailHtml, esc, n, pathOf, platformLabel, safeKey, sectionBlock, sortPlatforms, use,
} from "./lib.js";

/* ---------- small markup helpers (candidates for lib.js) ---------- */

/** A platform chip: logo (or initials for a platform without artwork) and name. */
function pchip(key) {
  const k = safeKey(key);
  const label = platformLabel(key);
  const art = PLATFORM_ART[k] ? use(`p-${k}`, 13) : `<span class="plat-fb s14" aria-hidden="true">${esc(label.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase())}</span>`;
  return chip("plat", k, `${art}${esc(label)}`);
}
/** A viewport chip, its label the journey when given; the viewport's name is read out with it. */
const vchip = (vp, label = vp) => chip("vp", vp, `${use(vp === "mobile" ? "ui-mobile" : "ui-desktop", 13)}${esc(label)}${label === vp ? "" : `<span class="sr"> · ${esc(vp)}</span>`}`);
/** A severity chip: glyph and word. label is HTML. */
const sevchip = (sev, label, cls = "") => `<span class="chip chip-sev ${sev}${cls ? ` ${cls}` : ""}">${use(`sev-${sev}`, 13)}${label}</span>`;
/** A neutral chip for a count or a label. html is HTML. */
const plain = (html, cls = "") => `<span class="chip plain${cls ? ` ${cls}` : ""}">${html}</span>`;
/** A glyph-only chip for a table cell; the word is for screen readers. */
const glyph = (sev, word) => `<span class="chip chip-sev ${sev} cv-g">${use(`sev-${sev}`, 13)}<span class="sr"> ${esc(word)}</span></span>`;
const code = (s) => `<code>${esc(s)}</code>`;
const bold = (x) => `<b>${esc(x)}</b>`;
const secs = (msValue) => `${(msValue / 1000).toFixed(1)} s`;
const ms = (v) => (v === null || v === undefined ? "–" : `${Math.round(v)} ms`);
const uniq = (xs) => [...new Set(xs)];
const hostOf = (u) => {
  try { return new URL(u).hostname; } catch { return ""; }
};

/** The providers that were checked: from the runs, or for older captures the platforms seen. */
function checkedProviders(runs) {
  const chosen = new Set(runs.flatMap((r) => r.providers ?? []));
  if (!chosen.size) for (const r of runs) for (const h of r.hits ?? []) chosen.add(h.platform);
  return sortPlatforms(chosen);
}

/** Out-of-scope vendors and how many of their requests the audit skipped, most first. */
function skippedTotals(runs) {
  const totals = {};
  for (const r of runs) for (const counts of Object.values(r.skipped ?? {})) for (const [v, k] of Object.entries(counts)) totals[v] = (totals[v] ?? 0) + k;
  return Object.entries(totals).sort((a, b) => b[1] - a[1]);
}

const callProvider = (c) => safeKey(c.provider ?? providerOf(c.url)?.key ?? c.vendor);

/* ---------- Coverage ---------- */

const ST_SEV = { ok: "ok", params: "broken", missing: "warning" };

/** Each planned event × each run: sent with its parameters, sent without them, not sent, or not expected there. */
function coverageRows(plan, runs, metrics) {
  const events = plan.events.map((e) => ({ ...e, platform: String(e.platform ?? "").toLowerCase() }));
  const checks = (r, e) => !r.providers?.length || r.providers.includes(e.platform);
  const taken = new Map();
  return events.map((e) => {
    const cells = runs.map((r, ri) => {
      const row = metrics.funnel?.[ri]?.events.find((x) => x.platform === e.platform && x.event === e.name);
      if (!row || !checks(r, e)) return { st: "na" };
      if (row.status === "ok") return { st: "ok" };
      if (row.status === "missing_params") return { st: "params", miss: row.missingParams ?? [] };
      return { st: "missing" };
    });
    const sts = cells.map((c) => c.st);
    const st = sts.includes("missing") ? "missing" : sts.includes("params") ? "params" : sts.includes("ok") ? "ok" : "na";
    const base = `cov-${safeKey(e.platform)}-${safeKey(e.name)}`;
    const k = (taken.get(base) ?? 0) + 1;
    taken.set(base, k);
    return { e, cells, st, unchecked: !runs.some((r) => checks(r, e)), miss: new Set(cells.flatMap((c) => c.miss ?? [])), id: k === 1 ? base : `${base}-${k}` };
  });
}

function coverageCard(ctx) {
  const { m, plan, runs, metrics } = ctx;
  const t = m.html.scope;
  if (!plan?.events?.length || !runs.length) return `<p class="muted cv-none">${esc(m.ui.noPlan)}</p>`;
  const rows = coverageRows(plan, runs, metrics);
  const count = (st) => rows.filter((r) => r.st === st).length;
  const nOk = count("ok"), nParams = count("params"), nMiss = count("missing");
  const c = metrics.coverage;
  const done = c?.counts.implemented ?? nOk;
  const total = c?.checkable ?? rows.length;
  const pct = c?.percent.implemented ?? null;
  const notChecked = c?.counts.not_checked ?? 0;
  const bar = `<span class="cv-bar" role="img" aria-label="${esc(t.barLabel(nOk, nParams, nMiss))}">${rows.map((r) => `<i class="${r.st}"></i>`).join("")}</span>`;
  const platCounts = sortPlatforms(Object.keys(c?.platforms ?? {})).map((p) => `<span class="cv-pc">${pchip(p).replace(/<\/span>$/, ` <b>${c.platforms[p].counts.implemented}/${c.platforms[p].checkable}</b></span>`)}</span>`).join("");
  const summary = `<span class="t">${esc(m.ui.planCoverage)}</span>${chip("sev", total && !done ? "broken" : nParams || nMiss ? "warning" : "ok", t.ofEvents(`<b>${done}</b>`, total))}${pct === null ? "" : plain(`<b>${pct}%</b>`, "mono")}${nParams ? sevchip("broken", esc(t.missingParams(nParams))) : ""}${nMiss ? sevchip("warning", esc(t.notSentCount(nMiss))) : ""}${notChecked ? plain(esc(t.notCheckedCount(notChecked))) : ""}${bar}<span class="end cv-pcs">${platCounts}</span>`;

  const plats = sortPlatforms(uniq(rows.map((r) => r.e.platform)));
  const stFilters = [["ok", m.ui.bucket.implemented, nOk], ["params", m.ui.bucket.missing_params, nParams], ["missing", m.html.notSent, nMiss]].filter((x) => x[2]);
  const platBtn = (p) => `<button type="button" data-filter="plat=${safeKey(p)}" aria-pressed="false" class="chip-plat ${safeKey(p)}">${PLATFORM_ART[safeKey(p)] ? use(`p-${safeKey(p)}`, 14) : ""}${esc(platformLabel(p))} ${n(rows.filter((r) => r.e.platform === p).length)}</button>`;
  const stBtn = ([k, label, cnt]) => `<button type="button" data-filter="st=${k}" aria-pressed="false" class="chip-sev ${ST_SEV[k]}">${use(`sev-${ST_SEV[k]}`, 14)}${esc(label)} ${n(cnt)}</button>`;
  const filterbar = `<div class="filterbar" data-filterbar="#cov-rows"><span class="fl">${esc(m.ui.platform)}</span>${plats.map(platBtn).join("")}${stFilters.length > 1 ? `<span class="sep"></span><span class="fl">${esc(m.ui.status)}</span>${stFilters.map(stBtn).join("")}` : ""}<span class="cv-search">${use("ui-search", 14)}<input type="search" data-filter-search placeholder="${esc(t.searchEvents)}" aria-label="${esc(t.searchEvents)}"></span><p data-filter-count aria-live="polite"></p></div>`;

  const cell = (cl) => {
    if (cl.st === "na") return `<td class="cv-c muted">–<span class="sr"> ${esc(m.html.notExpected)}</span></td>`;
    if (cl.st === "ok") return `<td class="cv-c">${glyph("ok", m.html.sent)}</td>`;
    if (cl.st === "params") return `<td class="cv-c">${sevchip("broken", `${esc(m.html.paramsShort)}<span class="sr"> ${esc(m.html.params(cl.miss))}</span>`)}</td>`;
    return `<td class="cv-c">${sevchip("warning", esc(m.html.notSent))}</td>`;
  };
  const body = rows.map(({ e, cells, st, unchecked, miss, id }) => {
    const needs = e.required_params ?? [];
    const text = `${e.platform} ${platformLabel(e.platform)} ${e.name} ${needs.join(" ")}`.toLowerCase();
    const needsHtml = needs.length ? needs.map((k) => `<code${miss.has(k) ? ' class="cv-miss"' : ""}>${esc(k)}</code>`).join("") : `<span class="muted">–</span>`;
    return `<tr id="${id}" data-plat="${safeKey(e.platform)}" data-st="${st}" data-text="${esc(text)}"><th scope="row"><span class="cv-ev">${pchip(e.platform)}${code(e.name)}${unchecked ? badge("muted", m.ui.notChecked) : ""}</span></th><td class="cv-needs">${needsHtml}</td>${cells.map(cell).join("")}</tr>`;
  }).join("");
  const key = `<p class="cv-key xs muted">${glyph("ok", m.html.sent)}<span>${esc(t.keyOk)}</span>${sevchip("broken", esc(m.html.paramsShort))}<span>${esc(t.keyParams)}</span>${sevchip("warning", esc(m.html.notSent))}<span>${esc(t.keyMissing)}</span><span>– ${esc(t.keyNotExpected)}</span></p>`;
  const head = `<tr><th scope="col">${esc(m.ui.event)}</th><th scope="col">${esc(t.needs)}</th>${runs.map((r, ri) => `<th scope="col" class="cv-c"><a href="#j${ri}" class="cv-run">${vchip(r.viewport, r.journeyId)}</a></th>`).join("")}</tr>`;
  return `<details class="card" id="cov-plan"><summary>${summary}</summary><div class="body">
${filterbar}
<div class="tscroll cv-scroll"><table class="tbl cv-tbl"><caption class="sr">${esc(m.ui.planCoverage)}</caption><thead>${head}</thead><tbody id="cov-rows">${body}</tbody></table></div>
${key}</div></details>`;
}

const CONVERSION_CHECKS = ["value", "currency", "transactionId", "items", "duplicate", "parity", "eventId"];

/** One row per purchase seen, with each integrity check as a pass, fail or not-applicable cell. */
function conversionsCard(ctx) {
  const { m, metrics, runs } = ctx;
  const t = m.html.scope;
  const c = metrics.conversions;
  if (!c?.rows?.length) return "";
  const nFail = c.total - c.passed;
  const cellOf = (v) => (v === "pass" ? `<td class="cv-c">${glyph("ok", m.html.pass)}</td>` : v === "fail" ? `<td class="cv-c">${glyph("broken", m.html.fail)}</td>` : `<td class="cv-c muted">–<span class="sr"> ${esc(m.html.notApplicable)}</span></td>`);
  const runLink = (r) => {
    const ri = runs.findIndex((x) => x.journeyId === r.journey && x.viewport === r.viewport);
    return ri < 0 ? vchip(r.viewport, r.journey) : `<a href="#j${ri}" class="cv-run">${vchip(r.viewport, r.journey)}</a>`;
  };
  const rows = c.rows.map((r) => `<tr><th scope="row">${runLink(r)}</th><td><span class="cv-ev">${pchip(r.platform)}${code(r.event)}</span></td><td class="mono xs">${r.transactionId ? esc(r.transactionId) : "–"}</td><td class="num">${r.value !== null && r.value !== undefined ? `${esc(String(r.value))}${r.currency ? ` ${esc(r.currency)}` : ""}` : sevchip("broken", esc(m.ui.missing))}</td><td class="num">${r.items ?? "–"}</td>${CONVERSION_CHECKS.map((k) => cellOf(r.checks?.[k])).join("")}</tr>`).join("");
  const summary = `<span class="t">${esc(m.html.conversions)}</span>${sevchip(nFail ? "warning" : "ok", t.purchasesPass(`<b>${c.passed}</b>`, c.total))}${nFail ? sevchip("broken", esc(t.purchasesFail(nFail))) : ""}`;
  return `<details class="card" id="cov-conversion"><summary>${summary}</summary><div class="body">
<p class="xs muted cv-lead">${esc(m.html.conversionsLead(c.passed, c.total))}</p>
<div class="tscroll"><table class="tbl cv-tbl cv-conv"><caption class="sr">${esc(m.html.conversions)}</caption><thead><tr><th scope="col">${esc(m.ui.journey)}</th><th scope="col">${esc(m.ui.event)}</th><th scope="col">${esc(m.html.orderId)}</th><th scope="col" class="num">${esc(m.html.value)}</th><th scope="col" class="num">${esc(m.ui.items)}</th>${CONVERSION_CHECKS.map((k) => `<th scope="col" class="cv-c">${esc(m.html.conversionChecks[k])}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div></div></details>`;
}

const BUCKET_SEV = { implemented: "ok", missing: "broken", missing_params: "broken", wrong_values: "warning", unplanned: "info", not_checked: "muted" };

/** With --against: each planned event's bucket and what the site sent, then how the plan changed since the last one. */
function planVsSiteCard(ctx) {
  const { m, planCheck: pc, planChanges } = ctx;
  const [overall, ...perPlatform] = coverageLines(m, pc);
  const counts = BUCKET_ORDER.map((b) => [b, pc.events.filter((e) => e.bucket === b).length]).filter(([, k]) => k);
  const bchip = (b, label) => (BUCKET_SEV[b] === "muted" ? plain(label) : sevchip(BUCKET_SEV[b], label));
  const summary = `<span class="t">${esc(m.ui.planVsSite)}</span>${counts.map(([b, k]) => bchip(b, `${esc(m.ui.bucket[b])} <b>${k}</b>`)).join("")}`;
  const rows = pcSort(pc).map((e) => `<tr><th scope="row"><span class="cv-ev">${pchip(e.platform)}${code(e.event)}</span></th><td>${bchip(e.bucket, esc(m.ui.bucket[e.bucket]))}</td><td class="xs muted">${(e.details ?? []).map(detailHtml).join("<br>")}</td></tr>`).join("");
  const items = planChanges ? planChangeItems(planChanges) : [];
  const changes = planChanges ? `<h3 class="pv-h">${esc(m.html.planChanges)}</h3><p class="xs">${esc(m.ui.planChangesLine(planChanges))}</p>${items.length ? `<ul class="pv-changes xs">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}` : "";
  return `<details class="card" id="plan-vs-site"><summary>${summary}</summary><div class="body">
<p><strong>${esc(overall)}</strong></p>${perPlatform.length ? `<p class="muted xs">${perPlatform.map(esc).join("<br>")}</p>` : ""}
<div class="tscroll pv-scroll"><table class="tbl pv-tbl"><caption class="sr">${esc(m.ui.planVsSite)}</caption><thead><tr><th scope="col">${esc(m.ui.event)}</th><th scope="col">${esc(m.ui.bucketCol)}</th><th scope="col">${esc(m.html.detailsCol)}</th></tr></thead><tbody>${rows}</tbody></table></div>${changes}</div></details>`;
}

function coverageSection(ctx) {
  const { m, planCheck } = ctx;
  return sectionBlock("coverage", esc(m.html.shell.sections.coverage), [planCheck ? planVsSiteCard(ctx) : "", coverageCard(ctx), conversionsCard(ctx)].filter(Boolean).join("\n"));
}

/* ---------- Inventory ---------- */

/** Per platform (checked or seen): its requests by host and by page, the hosts' party, and the cookies tied to it. */
function inventoryLines(ctx) {
  const { runs, tally } = ctx;
  // A run's cookieLog holds the cookies each step set; older captures only kept the cookies at the end of the run.
  const inv = buildInventory(runs.map((r) => (r.cookieLog?.length ? r : { ...r, cookieLog: r.cookies ?? [] })));
  const cookiesOf = new Map(inv.vendors.map((v) => [v.vendor, v.cookies]));
  const calls = runs.flatMap((r) => r.network ?? []);
  const hitPlats = new Set(runs.flatMap((r) => (r.hits ?? []).map((h) => h.platform)));
  const keys = sortPlatforms(uniq([...tally.vendors.checked, ...calls.map(callProvider), ...hitPlats]));
  const lines = keys.map((p) => {
    const mine = calls.filter((c) => callProvider(c) === p);
    const pages = new Map();
    const hosts = new Map();
    for (const c of mine) {
      if (c.pageUrl) pages.set(pathOf(c.pageUrl), (pages.get(pathOf(c.pageUrl)) ?? 0) + 1);
      const h = hostOf(c.url) || String(c.url ?? "");
      const e = hosts.get(h) ?? { n: 0, types: new Set(), first: 0, third: 0 };
      e.n++;
      if (c.type) e.types.add(c.type);
      if (c.pageUrl) e[siteOf(h) === siteOf(hostOf(c.pageUrl)) ? "first" : "third"]++;
      hosts.set(h, e);
    }
    const cookies = uniq(uniq(mine.map((c) => c.vendor).filter(Boolean)).flatMap((v) => cookiesOf.get(v) ?? [])).sort();
    return { p, seen: mine.length > 0 || hitPlats.has(p), requests: mine.length, pages, hosts, cookies };
  });
  return { lines, otherCookies: inv.otherCookies };
}

function inventorySection(ctx) {
  const { m, runs } = ctx;
  const t = m.html.scope;
  const { lines, otherCookies } = inventoryLines(ctx);
  const skipped = skippedTotals(runs);
  if (!lines.length && !skipped.length) return sectionBlock("inventory", esc(m.html.shell.sections.inventory), `<p class="muted">${esc(m.ui.noInventory)}</p>`);
  const counts = (x) => `<span class="inv-m">${t.requests(x.requests, bold(x.requests))}</span><span class="inv-m">${t.pages(x.pages.size, bold(x.pages.size))}</span><span class="inv-m${x.cookies.length ? "" : " zero"}">${t.cookies(x.cookies.length, bold(x.cookies.length))}</span>`;
  const out = lines.map((x) => {
    const id = `inv-${safeKey(x.p)}`;
    if (!x.seen) return `<li><div class="card inv-line" id="${id}" data-seen="no">${pchip(x.p)}${badge("info", m.html.checkedNotSeen)}</div></li>`;
    const tid = (k) => `${id}-${k}`;
    const tab = (k, label, c, sel) => `<button type="button" role="tab" id="${tid(`${k}-tab`)}" aria-controls="${tid(k)}" aria-selected="${sel}">${esc(label)} ${n(c)}</button>`;
    const hosts = [...x.hosts].map(([h, v]) => `<li><code>${esc(h)}</code><span class="inv-n">${t.requests(v.n, bold(v.n))}</span>${v.first || v.third ? plain(esc(m.ui.party[v.first && v.third ? "both" : v.first ? "first" : "third"])) : ""}${[...v.types].map((ty) => plain(esc(ty), "mono")).join("")}</li>`).join("");
    const pages = [...x.pages].map(([pg, k]) => `<li>${use("ui-page", 13)}<code>${esc(pg)}</code><span class="inv-n">${t.requests(k, bold(k))}</span></li>`).join("");
    const none = `<p class="muted xs">${esc(t.noneSeen)}</p>`;
    return `<li><details class="card inv" id="${id}" data-seen="yes"><summary>${pchip(x.p)}${sevchip("ok", esc(t.seen))}${counts(x)}</summary><div class="body">
<div class="tabs" data-tabs><div role="tablist">${tab("hosts", t.hosts, x.hosts.size, "true")}${tab("pages", m.ui.pagesCol, x.pages.size, "false")}${tab("cookies", m.ui.cookiesCol, x.cookies.length, "false")}</div>
<div role="tabpanel" id="${tid("hosts")}" data-label="${esc(t.hosts)}">${hosts ? `<ul class="inv-list">${hosts}</ul>` : none}</div>
<div role="tabpanel" id="${tid("pages")}" data-label="${esc(m.ui.pagesCol)}">${pages ? `<ul class="inv-list">${pages}</ul>` : none}</div>
<div role="tabpanel" id="${tid("cookies")}" data-label="${esc(m.ui.cookiesCol)}">${x.cookies.length ? `<ul class="inv-list">${x.cookies.map((ck) => `<li>${code(ck)}</li>`).join("")}</ul>` : none}</div></div></div></details></li>`;
  });
  const skippedN = skipped.reduce((a, [, k]) => a + k, 0);
  if (skipped.length) {
    out.push(`<li><details class="card inv" id="inv-out-of-scope"><summary><span class="t">${esc(m.ui.outOfScopeStatus)}</span>${plain(t.requests(skippedN, bold(skippedN)))}<span class="inv-m">${esc(skipped.slice(0, 3).map(([v]) => v).join(", "))}${skipped.length > 3 ? " …" : ""}</span></summary><div class="body"><ul class="inv-list">${skipped.map(([v, k]) => `<li><span>${esc(v)}</span>${badge("muted", m.ui.outOfScopeStatus)}<span class="inv-n">${t.requests(k, bold(k))}</span></li>`).join("")}</ul></div></details></li>`);
  }
  const silent = lines.filter((x) => !x.seen).map((x) => platformLabel(x.p));
  const notes = [
    silent.length ? esc(m.html.neverSeen(silent.join(", "))) : "",
    otherCookies.length ? `${esc(m.ui.otherCookies)}: ${otherCookies.map((c) => `${code(c.name)} <span class="muted">(${esc(m.ui.party[c.party])})</span>`).join(", ")}` : "",
  ].filter(Boolean);
  return sectionBlock("inventory", esc(m.html.shell.sections.inventory), `<ul class="inv-rows" aria-label="${esc(m.ui.inventoryTitle)}">${out.join("")}</ul>${notes.map((x) => `<p class="xs muted inv-note">${x}</p>`).join("")}`);
}

/* ---------- Run ---------- */

const FILES = ["report.md", "timeline.csv", "capture.json", "steps.json", "junit.xml", "summary.json"];
const CAMPAIGN_PARAMS = ["utm_source", "gclid", "fbclid"];

/** The run's settings, for the reader who doubts a result: what was checked, how, and with which tool. */
function runFacts(ctx) {
  const { m, runs, metrics, ai, plan, against, planChanges, consentScenarios, planCheck, site, title, generatedAt } = ctx;
  const t = m.html.scope;
  const fact = (label, html, cls = "") => `<div${cls ? ` class="${cls}"` : ""}><dt>${esc(label)}</dt><dd>${html}</dd></div>`;
  const dash = `<span class="muted">–</span>`;
  const provs = checkedProviders(runs);
  const timingOf = (r, ri) => metrics.timing?.find((x) => x.journey === r.journeyId && x.viewport === r.viewport) ?? metrics.timing?.[ri];
  const completed = runs.filter((r) => r.completed).length;
  const runChip = (r, ri) => {
    const d = timingOf(r, ri)?.durationMs;
    const state = r.completed ? "completed" : "incomplete";
    return `<a href="#j${ri}" class="chip chip-run ${state}">${use(r.completed ? "sev-ok" : "sev-warning", 13)}${esc(r.journeyId)} ${use(r.viewport === "mobile" ? "ui-mobile" : "ui-desktop", 13)}${esc(r.viewport)}${d === null || d === undefined ? "" : ` <b>${secs(d)}</b>`}${r.completed ? "" : `<span class="sr"> · ${esc(m.html.runIncomplete)}</span>`}</a>`;
  };
  const states = consentScenarios ? ["before", ...Object.keys(consentScenarios.states ?? {}).filter((s) => consentScenarios.states[s]?.after)] : [];
  const consent = consentScenarios
    ? `${plain(esc(consentScenarios.cmp === "banner" ? m.html.cmpBanner : String(consentScenarios.cmp ?? "")))}${plain(esc(m.html.scenariosRun(states.length)))}`
    : metrics.consent?.consentMode?.defaultPresent ? plain(esc(m.html.consentModeSeen)) : dash;
  const planBits = [
    plain(esc(plan?.events?.length ? m.ui.runPlanEvents(plan.events.length) : m.ui.runNoPlan)),
    plan?.consent_mode ? plain(esc(m.html.consentMode)) : "",
    against ? `<span class="xs">${esc(m.ui.checkedAgainst(against))}</span>` : "",
    planChanges ? `<span class="xs">${planCheck ? `<a href="#plan-vs-site">${esc(m.ui.planChangesLine(planChanges))}</a>` : esc(m.ui.planChangesLine(planChanges))}</span>` : "",
  ].join("");
  const skipped = skippedTotals(runs);
  const skippedN = skipped.reduce((a, [, k]) => a + k, 0);
  const files = [...FILES, ...(planCheck ? ["plan-check.json"] : [])];
  const facts = [
    fact(m.ui.site, plain(`<b>${esc(site ?? title)}</b>`, "mono")),
    fact(t.generated, plain(`${use("ui-clock", 13)}${esc(generatedAt)}`, "mono")),
    fact(m.ui.runVersion, `<code>${esc(VERSION)}</code>`),
    fact(m.ui.runAi, plain(`${use("ui-ai", 13)}${esc(ai ? m.ui.runAiOn(ai.name, ai.model) : m.ui.runAiOff)}`)),
    fact(m.ui.runJourneys, runs.length ? uniq(runs.map((r) => r.journeyId)).map((j) => plain(`${use("ui-journeys", 13)}${esc(j)}`)).join("") : dash),
    fact(m.ui.runViewports, runs.length ? uniq(runs.map((r) => r.viewport)).map((v) => vchip(v)).join("") : dash),
    fact(m.ui.runPlatforms, provs.length ? provs.map(pchip).join("") : dash),
    fact(m.ui.runPlan, planBits),
    fact(m.ui.consent, consent),
    fact(m.html.campaignCheck, runs.some((r) => r.landing) ? CAMPAIGN_PARAMS.map(code).join("") : dash),
    fact(m.ui.runLanguage, plain(esc(m.name))),
    fact(t.runs, runs.length ? `${runs.map(runChip).join("")}<span class="xs muted">${esc(completed === runs.length ? m.html.runsAllCompleted(runs.length) : m.html.runsCompleted(completed, runs.length))}</span>` : dash, "wide"),
    skippedN ? fact(m.ui.outOfScopeStatus, `<span class="xs">${esc(m.ui.skippedLine(skipped.map(([v]) => v).join(", "), skippedN))}</span>`, "wide") : "",
    fact(t.files, files.map((f) => `<code class="file">${use("ui-page", 12)}${esc(f)}</code>`).join(""), "wide"),
  ].join("");
  return `<dl class="run-facts">${facts}</dl>`;
}

/** How long each run took and how far behind each step its first hit came. */
function timingCard(ctx) {
  const { m, metrics } = ctx;
  const t = (metrics.timing ?? []).filter((r) => r.durationMs !== null && r.durationMs !== undefined);
  if (!t.length) return "";
  const total = t.reduce((a, r) => a + r.durationMs, 0);
  const meds = t.map((r) => r.medianFirstHitMs).filter((x) => x !== null && x !== undefined).map(Math.round);
  const maxD = Math.max(1, ...t.map((r) => r.durationMs));
  const range = meds.length ? (Math.min(...meds) === Math.max(...meds) ? `${Math.min(...meds)}` : `${Math.min(...meds)}–${Math.max(...meds)}`) : "";
  const rows = t.map((r) => `<tr><th scope="row">${vchip(r.viewport, r.journey)}</th><td class="num"><span class="tm-d"><span class="tm-bar ${safeKey(r.viewport)}" style="width:${Math.max(4, Math.round((r.durationMs / maxD) * 100))}%"></span></span>${secs(r.durationMs)}</td><td class="num">${ms(r.medianFirstHitMs)}</td><td>${r.slowest?.[0] ? `<span class="tm-s">${pchip(r.slowest[0].platform)}${code(r.slowest[0].event)}<span class="muted xs">${esc(m.ui.step)} ${esc(r.slowest[0].step)} · ${ms(r.slowest[0].ms)}</span></span>` : "–"}</td></tr>`).join("");
  const summary = `<span class="t">${esc(m.html.timing)}</span>${plain(`${use("ui-clock", 13)}<b>${(total / 1000).toFixed(1)}</b> s`, "mono")}${range ? plain(m.html.scope.firstHit(`<b>${range}</b>`)) : ""}`;
  return `<details class="card" id="run-timing"><summary>${summary}</summary><div class="body">
<div class="tscroll"><table class="tbl tm-tbl"><caption class="sr">${esc(m.html.timing)}</caption><thead><tr><th scope="col">${esc(m.ui.journey)}</th><th scope="col" class="num">${esc(m.html.duration)}</th><th scope="col" class="num">${esc(m.html.medianFirstHit)}</th><th scope="col">${esc(m.html.slowestHit)}</th></tr></thead><tbody>${rows}</tbody></table></div></div></details>`;
}

const SPARK_SERIES = ["broken", "risk", "warning"];
const TREND_SEV = { improving: "ok", worsening: "broken", flat: "info" };
const dateOnly = (id) => String(id ?? "").slice(0, 10);
const problemKey = (f) => [f.severity, f.check, f.platform ?? "", f.event ?? ""].join("|");

/** Three count lines over the saved runs, evenly spaced by run; incomplete runs are hollow points. */
function sparklineSvg(m, t) {
  const s = t.series;
  const W = 280, H = 64, P = 6;
  const max = Math.max(3, ...s.flatMap((p) => SPARK_SERIES.map((k) => p[k])));
  const x = (i) => P + (i * (W - 2 * P)) / (s.length - 1);
  const y = (v) => H - P - (v * (H - 2 * P)) / max;
  const lines = SPARK_SERIES.map((k) => `<polyline class="sev-${k}" points="${s.map((p, i) => `${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(" ")}"/>`).join("");
  const points = s.flatMap((p, i) => SPARK_SERIES.map((k) => `<circle class="sev-${k}${p.complete ? "" : " hollow"}" cx="${x(i).toFixed(1)}" cy="${y(p[k]).toFixed(1)}" r="${i === s.length - 1 ? 3.5 : 2.5}"><title>${esc(`${p.date ?? p.id} · ${p[k]} ${m.severity[k]}${p.complete ? "" : ` · ${m.html.runIncomplete}`}`)}</title></circle>`)).join("");
  const label = SPARK_SERIES.map((k) => `${m.severity[k]}: ${s.map((p) => p[k]).join(", ")}`).join("; ");
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">${lines}${points}</svg>`;
}

/** One problem from the history: the current card's title when it is still open, else platform, event and check. */
function historyLine(ctx, e) {
  const f = ctx.rows.find((r) => problemKey(r) === problemKey(e));
  const text = f ? detailHtml(f.detail) : `${e.platform ? `${esc(platformLabel(e.platform))} ` : ""}${e.event ? `${code(e.event)} ` : ""}${esc(e.check)}`;
  return f && ctx.ids.get(f) ? `<a href="#${ctx.ids.get(f)}">${text}</a>` : text;
}

/** The trend over the saved runs: a sparkline, the runs, a link to the diff, flapping problems and the ones open longest. */
function trendCard(ctx) {
  const { m, trend: t, changes } = ctx;
  const s = m.html.scope;
  const dir = m.html.trendDirection[t.direction] ?? t.direction;
  const summary = `<span class="t">${esc(m.html.trend)}</span>${sevchip(TREND_SEV[t.direction] ?? "info", esc(dir))}<span class="xs muted">${esc(m.html.trendSpan(t.runs, dateOnly(t.first), dateOnly(t.last)))}</span>`;
  const legend = `<p class="xs muted spark-legend">${SPARK_SERIES.map((k) => `<span class="sev-${k}"><i></i>${esc(m.severity[k])}</span>`).join(" ")}</p>`;
  const direction = `<p><strong>${esc(dir)}</strong> <span class="muted">${esc(m.html.trendSpan(t.runs, dateOnly(t.first), dateOnly(t.last)))}</span></p>`;
  // The diff itself is the Findings section's "Changed since last run" card (#changes); the trend links to it.
  const diff = changes?.previous ? `<p class="xs"><a href="#changes"><strong>${esc(m.ui.changesLine(changes))}</strong></a> <span class="muted">${esc(m.ui.changesLead(changes.previous, changes.mode))}</span></p>` : "";
  const runsTable = `<div class="tscroll"><table class="tbl tr-tbl"><caption class="sr">${esc(m.html.trend)}</caption><thead><tr><th scope="col">${esc(s.runCol)}</th>${SPARK_SERIES.map((k) => `<th scope="col" class="num">${esc(m.severity[k])}</th>`).join("")}<th scope="col" class="num">${esc(s.problemPoints)}</th></tr></thead><tbody>${[...t.series].reverse().map((p) => `<tr><th scope="row"><span class="mono xs">${esc(p.id)}</span>${p.complete ? "" : ` ${chip("run", "incomplete", `${use("sev-warning", 13)}${esc(m.html.runIncomplete)}`)}`}</th>${SPARK_SERIES.map((k) => `<td class="num${p[k] ? "" : " dim"}">${esc(p[k])}</td>`).join("")}<td class="num">${esc(p.score ?? "–")}</td></tr>`).join("")}</tbody></table></div>`;
  const list = (items, meta) => `<ul class="tr-list">${items.map((e) => `<li>${badge(e.severity, m.severity[e.severity])} <span>${historyLine(ctx, e)} <span class="muted">· ${esc(meta(e))}</span></span></li>`).join("")}</ul>`;
  const flapping = t.flapping?.length ? `<h3 class="tr-h">${esc(m.html.flapping)}</h3>${list(t.flapping, (e) => m.html.seenIn(e.seenIn, t.runs))}` : "";
  const open = t.openLongest?.length ? `<h3 class="tr-h">${esc(m.html.openLongest)}</h3>${list(t.openLongest, (e) => m.html.openSince(dateOnly(e.openSince), e.runsOpen, e.places.length))}` : "";
  return `<details class="card" id="trend"><summary>${summary}</summary><div class="body tr-body">
<div class="tr-chart">${sparklineSvg(m, t)}${legend}${direction}${diff}</div>
${runsTable}${flapping}${open}</div></details>`;
}

function runSection(ctx) {
  const { m, trend, changes } = ctx;
  // A different route can explain new or fixed findings, so it sits next to the run facts as in 0.17; the route
  // pairs themselves are listed in the Findings section's "Changed since last run" card.
  const route = changes?.routes?.length ? `<p class="meta"><a href="#changes">${esc(m.ui.routeChanged(routeList(changes)))}</a></p>` : "";
  return sectionBlock("run", esc(m.html.shell.sections.run), [runFacts(ctx), route, timingCard(ctx), trend?.series?.length >= 2 ? trendCard(ctx) : ""].filter(Boolean).join("\n"));
}

/** @param {import("./shell.js").Ctx} ctx */
export function render(ctx) {
  return [coverageSection(ctx), inventorySection(ctx), runSection(ctx)].join("\n");
}
