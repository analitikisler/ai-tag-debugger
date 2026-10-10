import { createProvider } from "./providers.js";
import { groupFindings, summarize } from "./checks.js";
import { messages } from "./i18n.js";
import { parseTrackingRequest, providerOf, PROVIDERS } from "./parsers.js";
import { decodeGa4Item, isEventParam, paramTip } from "./glossary.js";
import { LOGOS } from "./brand.js";
import { readFileSync } from "node:fs";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const EXPLAIN_SYSTEM = `You are a senior digital analytics consultant reviewing an automated tracking audit. You receive findings from deterministic checks, the measurement plan, the hits captured on each step of each journey, and optionally a Google Tag Manager container export.

For each finding with severity broken, risk or warning, give:
- impact: one sentence on what this does to the data, the reports or ad spend;
- likely_cause: the most likely cause, in plain language a marketing manager can follow and an analyst can act on;
- fix_steps: the fix as short, ordered steps.
When a GTM container is provided, name the specific tags, triggers or variables involved. Only state causes the evidence supports; when the cause is uncertain, say what to check.

Then write the summary:
- headline: one sentence naming what matters most for data quality and ad spend;
- points: the main problems, most important first, each one sentence with its severity;
- also_check: things you can see in the captured hits that the findings list does not cover (for example a conversion that fires on page load, or a cookie banner click counted as a conversion). Only include what the captured data shows; leave the list empty otherwise.

Formatting: in the headline, points, also_check, impact, likely_cause and fix_steps, wrap numbers and counts in double asterisks (for example sent **2** times, at **+70.4s**) and event, parameter, tag and trigger names in backticks (for example \`begin_checkout\`). Use no other formatting: no headings, lists, links or HTML.`;

const SEVERITIES = ["broken", "risk", "warning", "info"];
const EXPLAIN_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "object",
      properties: {
        headline: { type: "string", description: "One sentence on what matters most." },
        points: {
          type: "array",
          items: {
            type: "object",
            properties: { severity: { type: "string", enum: SEVERITIES }, text: { type: "string" } },
            required: ["severity", "text"],
            additionalProperties: false,
          },
        },
        also_check: { type: "array", items: { type: "string" } },
      },
      required: ["headline", "points", "also_check"],
      additionalProperties: false,
    },
    explanations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          finding: { type: "integer", description: "Index of the finding in the input list." },
          impact: { type: "string" },
          likely_cause: { type: "string" },
          fix_steps: { type: "array", items: { type: "string" } },
        },
        required: ["finding", "impact", "likely_cause", "fix_steps"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "explanations"],
  additionalProperties: false,
};

/** The summary as { headline, points, also_check }. Older plain-text summaries become a headline-only paragraph. */
function summaryParts(summary) {
  if (!summary) return null;
  if (typeof summary === "string") return { text: summary, points: [], also_check: [] };
  return {
    headline: String(summary.headline ?? ""),
    points: (Array.isArray(summary.points) ? summary.points : []).filter((p) => p && p.text).map((p) => ({ severity: SEVERITIES.includes(p.severity) ? p.severity : "info", text: String(p.text) })),
    also_check: (Array.isArray(summary.also_check) ? summary.also_check : []).map(String).filter(Boolean),
  };
}

/** Fix steps of an explanation; older explanations had one "fix" string. */
const fixSteps = (e) => (Array.isArray(e?.fix_steps) && e.fix_steps.length ? e.fix_steps.map(String) : e?.fix ? [String(e.fix)] : []);

function hitsByStep(run) {
  return run.steps.map((step) => ({
    step: step.label,
    hits: run.hits
      .filter((h) => h.step === step.index)
      .map((h) => ({ platform: h.platform, event: h.name, params: h.params, ...(h.consent ? { consent: h.consent } : {}) })),
  }));
}

/**
 * Asks the AI model to explain the findings. Returns null on failure so the
 * deterministic report is still written.
 */
export async function explainFindings({ findings, plan, runs, gtmContainer, provider, providerName, client, model, lang = "en", log = () => {} }) {
  const actionable = groupFindings(findings).map((f, i) => ({ index: i, ...f })).filter((f) => ["broken", "risk", "warning"].includes(f.severity));
  if (actionable.length === 0) return { summary: { headline: messages(lang).ui.allGood, points: [], also_check: [] }, explanations: [] };
  try {
    const input = {
      findings: actionable,
      measurement_plan: plan,
      journeys: runs.map((r) => ({ journey: r.journeyId, viewport: r.viewport, completed: r.completed, note: r.note, steps: hitsByStep(r), page_errors: r.pageErrors })),
    };
    const texts = [`Audit data:\n${JSON.stringify(input, null, 1)}`];
    if (gtmContainer) texts.push(`GTM container export:\n${JSON.stringify(gtmContainer)}`);

    const ai = provider ?? (await createProvider({ name: providerName, model, client }));
    const result = await ai.json({
      system: lang === "en" ? EXPLAIN_SYSTEM : `${EXPLAIN_SYSTEM}\n\nWrite the summary, impacts, likely causes and fix steps in ${messages(lang).name}. Keep event, parameter, tag and trigger names exactly as they are.`,
      texts,
      schema: EXPLAIN_SCHEMA,
    });
    if (result.error) {
      log(`The model did not return explanations (${result.error}); writing the report without them.`);
      return null;
    }
    return result.value;
  } catch (err) {
    log(`Could not get explanations from the model: ${err.message}`);
    return null;
  }
}

const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function attachExplanations(findings, explained) {
  const byIndex = new Map((explained?.explanations ?? []).map((e) => [e.finding, e]));
  return groupFindings(findings).map((f, i) => ({ ...f, explanation: byIndex.get(i) }));
}

const SEVERITY_RANK = { broken: 0, risk: 1, warning: 2 };

/** The most severe finding that points at this hit, if any (for highlighting in the timeline). */
function hitSeverity(findings, run, step, hit) {
  let worst = null;
  for (const f of findings) {
    if (!(f.severity in SEVERITY_RANK)) continue;
    if (f.journey !== run.journeyId || f.viewport !== run.viewport || f.step !== step.label) continue;
    if (f.platform !== hit.platform || f.event !== hit.name) continue;
    if (worst === null || SEVERITY_RANK[f.severity] < SEVERITY_RANK[worst]) worst = f.severity;
  }
  return worst;
}

const seconds = (run, t) => `+${((t - run.startedAt) / 1000).toFixed(1)}s`;
const isConsentEntry = (value) => Array.isArray(value) && value[0] === "consent";
const formatPush = (value) => (isConsentEntry(value) ? `gtag(${value.map((v) => JSON.stringify(v)).join(", ")})` : JSON.stringify(value));

// Values from the audited page go into Markdown as text: no raw HTML, and no way out of a code span.
const mdText = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const mdCode = (v) => String(v ?? "").replace(/`/g, "'").replace(/\n/g, " ");

export function renderMarkdown({ title, generatedAt, findings, explained, runs, lang = "en", branding = true }) {
  const m = messages(lang);
  const rows = attachExplanations(findings, explained);
  const counts = summarize(rows);
  const lines = [`# ${mdText(title)}`, "", m.ui.generated(generatedAt), "", `**${m.ui.counts(counts)}**`, ""];
  const sum = summaryParts(explained?.summary);
  if (sum) {
    lines.push(`## ${m.ui.summary}`, "", sum.text ? mdText(sum.text) : `**${mdText(sum.headline)}**`, "");
    if (sum.points.length) lines.push(...sum.points.map((p) => `- **${m.severity[p.severity]}**: ${mdText(p.text)}`), "");
    if (sum.also_check.length) lines.push(`### ${m.ui.alsoCheck}`, "", ...sum.also_check.map((t) => `- ${mdText(t)}`), "");
  }
  lines.push(`## ${m.ui.findings}`, "");
  for (const f of rows.filter((r) => r.severity !== "ok")) {
    lines.push(`### ${m.severity[f.severity]}: ${mdText(f.detail)}`, "");
    lines.push(`- ${m.ui.where}: ${mdText(f.where.map((w) => m.ui.whereStep(w.journey, w.viewport, w.step)).join("; "))}`);
    if (f.evidence) lines.push(`- ${m.ui.captured}: \`${mdCode(f.evidence)}\``);
    if (f.explanation) {
      if (f.explanation.impact) lines.push(`- ${m.ui.impact}: ${mdText(f.explanation.impact)}`);
      lines.push(`- ${m.ui.likelyCause}: ${mdText(f.explanation.likely_cause)}`, `- ${m.ui.fix}:`, ...fixSteps(f.explanation).map((t, i) => `   ${i + 1}. ${mdText(t)}`));
    }
    lines.push("");
  }
  for (const f of rows.filter((r) => r.severity === "ok")) lines.push(`- ${m.severity.ok}, ${mdText(f.where[0].journey)} (${mdText(f.where[0].viewport)}): ${mdText(f.detail)}`);
  lines.push("", `## ${m.ui.timeline}`, "");
  for (const r of runs) {
    lines.push(`### ${mdText(r.journeyId)} (${mdText(r.viewport)}): ${r.completed ? m.ui.completed : m.ui.notCompleted}`, "", mdText(r.note), "");
    for (const step of r.steps.filter((s) => s.index > 0)) {
      lines.push(`${step.index}. **${mdText(step.label)}** (${seconds(r, step.t)})${step.forced ? ` _${m.ui.clickedThrough}_` : ""}`);
      for (const h of r.hits.filter((x) => x.step === step.index)) {
        const flag = hitSeverity(findings, r, step, h);
        const params = Object.entries(h.params).map(([k, v]) => `${k}=${v}`).join(", ");
        lines.push(`   - ${flag ? `**${m.severity[flag]}** ` : ""}${mdText(`${h.platform}:${h.name}${params ? ` (${params})` : ""}`)}`);
      }
      for (const e of (r.dataLayerLog ?? []).filter((x) => x.step === step.index)) {
        lines.push(`   - dataLayer: \`${mdCode(isConsentEntry(e.value) ? formatPush(e.value) : JSON.stringify(e.value))}\``);
      }
    }
    lines.push("");
  }
  if (branding) lines.push("---", "", `_${m.ui.generatedBy} · [analitikisler.com](https://analitikisler.com)_`, "");
  return lines.join("\n");
}

const PLATFORM_ORDER = ["ga4", "google_ads", "meta", "tiktok", "x"];
const platformLabel = (p) => PROVIDERS[p] ?? String(p).replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const platformRank = (p) => (PLATFORM_ORDER.includes(p) ? PLATFORM_ORDER.indexOf(p) : PLATFORM_ORDER.length);

// Pixel event names and their GA4 / dataLayer counterparts, so a Meta or TikTok hit can be shown next to the push behind it.
const EVENT_ALIASES = {
  pageview: "pageview", viewcontent: "viewitem", addtocart: "addtocart", addtowishlist: "addtowishlist", initiatecheckout: "begincheckout",
  addpaymentinfo: "addpaymentinfo", purchase: "purchase", completepayment: "purchase", placeanorder: "purchase", lead: "generatelead",
  completeregistration: "signup", search: "search", contact: "generatelead", submitform: "generatelead", subscribe: "subscribe", starttrial: "starttrial",
};
const normName = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const eventKey = (s) => EVENT_ALIASES[normName(s)] ?? normName(s);
// GTM-style pushes are objects ({event: "add_to_cart"}); gtag.js records arrays (["event", "add_to_cart", {...}]).
const pushEvent = (value) => (Array.isArray(value) ? (value[0] === "event" ? value[1] : undefined) : value && typeof value === "object" ? value.event : undefined);
const pushText = (value) => (Array.isArray(value) && typeof value[0] === "string" ? `gtag(${value.map((v) => JSON.stringify(v, null, 2)).join(", ")})` : JSON.stringify(value, null, 2));

// Per run: step index -> event key -> the pushes with that event name. Built once so rendering stays linear.
const pushIndexCache = new WeakMap();
function pushIndex(run) {
  let index = pushIndexCache.get(run);
  if (!index) {
    index = new Map();
    for (const e of run.dataLayerLog ?? []) {
      const name = pushEvent(e.value);
      if (typeof name !== "string" || !eventKey(name)) continue;
      if (!index.has(e.step)) index.set(e.step, new Map());
      const byKey = index.get(e.step);
      const key = eventKey(name);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(e);
    }
    pushIndexCache.set(run, index);
  }
  return index;
}

/** Every dataLayer push in the hit's step whose event name matches it (directly or through a pixel alias). */
const matchingPushes = (run, hit) => pushIndex(run).get(hit.step)?.get(eventKey(hit.name)) ?? [];

/** The push behind the hit. When the same event fires as often as it was pushed (duplicates), they are paired in order. */
function pushesForHit(run, hit) {
  const pushes = matchingPushes(run, hit);
  const key = eventKey(hit.name);
  const twins = run.hits.filter((h) => h.step === hit.step && h.platform === hit.platform && eventKey(h.name) === key);
  return twins.length > 1 && pushes.length === twins.length ? [pushes[twins.indexOf(hit)]] : pushes;
}

/** The network request that carried the hit. Identical hits (duplicates) are paired with identical requests in order. */
function callsForHit(run, hit) {
  const calls = (run.network ?? []).filter((c) => c.step === hit.step && c.url === hit.url);
  const twins = run.hits.filter((h) => h.step === hit.step && h.url === hit.url);
  return twins.length > 1 && calls.length === twins.length ? [calls[twins.indexOf(hit)]] : calls;
}


const icon = {
  chevron: '<svg class="chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
};

const kvTable = (rows) => `<table class="ptable"><tbody>${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}</tbody></table>`;
// Platform keys go into class names, ids and attribute selectors.
const safeKey = (k) => String(k ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "") || "other";
const cell = (v) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

const STANDARD_ITEM_KEYS = new Set(["item_id", "item_name", "affiliation", "coupon", "discount", "index", "item_brand", "item_category", "item_category2", "item_category3", "item_category4", "item_category5", "item_list_id", "item_list_name", "item_variant", "location_id", "price", "quantity", "promotion_id", "promotion_name", "creative_name", "creative_slot"]);
const ECOMMERCE_EVENTS = new Set(["view_item", "view_item_list", "select_item", "add_to_cart", "remove_from_cart", "view_cart", "begin_checkout", "add_shipping_info", "add_payment_info", "purchase", "refund", "add_to_wishlist", "view_promotion", "select_promotion"]);

/** GA4 item strings (pr1=…) as { fields, custom } pairs. */
const ga4Items = (strings) => (strings ?? []).map(decodeGa4Item);
/** dataLayer ecommerce.items objects as { fields, custom } pairs: standard GA4 item keys, then the site's own. */
const objectItems = (list) =>
  list.filter((it) => it && typeof it === "object").map((it) => {
    const entries = Object.entries(it).map(([k, v]) => [k, cell(v)]);
    return { fields: entries.filter(([k]) => STANDARD_ITEM_KEYS.has(k)), custom: entries.filter(([k]) => !STANDARD_ITEM_KEYS.has(k)) };
  });
/** The items array of a GTM-style ({ecommerce: {items}}) or gtag.js-style (["event", name, {items}]) push. */
function pushItems(value) {
  const items = Array.isArray(value) ? value[2]?.items : value?.ecommerce?.items ?? value?.items;
  return Array.isArray(items) ? items : [];
}

function itemCards(m, items) {
  return items
    .map(({ fields, custom }, i) => {
      const get = (k) => fields.find(([n]) => n === k)?.[1];
      const price = get("price");
      const qty = get("quantity");
      const head = `<div class="item-head"><span class="item-idx">${i + 1}</span><b>${escapeHtml(get("item_name") ?? "")}</b><span class="mono muted">${escapeHtml(get("item_id") ?? "")}</span>${price !== undefined || qty !== undefined ? `<span class="item-price mono">${escapeHtml(price ?? "–")} × ${escapeHtml(qty ?? "1")}</span>` : ""}</div>`;
      const rest = fields.filter(([n]) => !["item_name", "item_id", "price", "quantity"].includes(n));
      const grid = (rows) => `<dl class="grid4">${rows.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v === "" ? "–" : v)}</dd></div>`).join("")}</dl>`;
      return `<div class="item">${head}${rest.length ? grid(rest) : ""}${custom.length ? `<h6>${m.ui.customItemParams}</h6>${grid(custom)}` : ""}</div>`;
    })
    .join("");
}
const itemsBlock = (m, items) => (items.length ? `<h5>${m.ui.items} <span class="n">${items.length}</span></h5>${itemCards(m, items)}` : "");

/** The most severe finding that points at this hit, as { severity, detail }, or null. */
function hitFlag(findings, run, step, hit) {
  let worst = null;
  for (const f of findings) {
    if (!(f.severity in SEVERITY_RANK)) continue;
    if (f.journey !== run.journeyId || f.viewport !== run.viewport || f.step !== step.label) continue;
    if (f.platform !== hit.platform || f.event !== hit.name) continue;
    if (worst === null || SEVERITY_RANK[f.severity] < SEVERITY_RANK[worst.severity]) worst = f;
  }
  return worst && { severity: worst.severity, detail: worst.detail };
}

const hostPath = (url) => {
  try {
    const u = new URL(url);
    return u.host + u.pathname;
  } catch {
    return String(url ?? "");
  }
};

/** Radio buttons that filter the list after them by data-p. Only sources present are offered. */
function filterBar(m, name, rows) {
  const counts = new Map();
  for (const r of rows) counts.set(r.key, { label: r.label, n: (counts.get(r.key)?.n ?? 0) + 1 });
  if (counts.size < 2) return "";
  const keys = [...counts.keys()].sort((a, b) => platformRank(a) - platformRank(b) || counts.get(a).label.localeCompare(counts.get(b).label));
  return `<input type="radio" name="${name}" id="${name}-all" class="f-all" checked><label for="${name}-all">${m.ui.all} <span class="n">${rows.length}</span></label>${keys
    .map((k) => `<input type="radio" name="${name}" id="${name}-${k}" class="f-${k}"><label for="${name}-${k}"><span class="dot p-${k}"></span>${escapeHtml(counts.get(k).label)} <span class="n">${counts.get(k).n}</span></label>`)
    .join("")}`;
}
const filtered = (m, name, rows, listHtml) => `<div class="filter" role="group" aria-label="${m.ui.filterBy}">${filterBar(m, name, rows)}<ul class="evlist">${listHtml}</ul></div>`;

function eventRow(m, findings, run, step, hit) {
  const flag = hitFlag(findings, run, step, hit);
  const pushes = pushesForHit(run, hit);
  const calls = callsForHit(run, hit);
  const items = ga4Items(hit.items);
  const params = Object.entries(hit.params ?? {}).filter(([k]) => !(k === "items" && items.length));
  const bits = [];
  if (items.length) bits.push(m.ui.itemsCount(items.length));
  if (hit.params?.value) bits.push(`${hit.params.value} ${hit.params.currency ?? ""}`.trim());
  if (!items.length && hit.platform === "ga4" && ECOMMERCE_EVENTS.has(hit.name)) bits.push(m.ui.noItems);
  const consent = hit.consent ? `<h5>${m.ui.consent}</h5><div class="consents">${Object.entries(hit.consent).map(([k, v]) => `<span class="consent ${v === "granted" ? "granted" : "denied"}">${escapeHtml(k)}: ${escapeHtml(v)}</span>`).join("")}</div>` : "";
  const pushLine = pushes.length ? pushes.map((e) => `<span class="mono">${escapeHtml(pushEvent(e.value) ?? "")} · ${escapeHtml(seconds(run, e.t))}</span>`).join("") : `<span class="muted">${m.ui.noMatchingPush}</span>`;
  const reqText = calls.length
    ? calls.map((c) => `<span class="mono"><span class="method">${escapeHtml(c.method)}</span> ${escapeHtml(hostPath(c.url))} <span class="status">${escapeHtml(c.status ?? "")}</span>${c.blocked ? ` <span class="muted">${m.ui.blockedNote}</span>` : ""}</span>`).join("")
    : `<span class="mono">${escapeHtml(hostPath(hit.url))}</span>`;
  return `<li data-p="${safeKey(hit.platform)}"><details class="event${flag ? ` flag-${flag.severity}` : ""}"${flag ? " open" : ""}>
<summary>${icon.chevron}<span class="ptag p-${safeKey(hit.platform)}">${escapeHtml(platformLabel(hit.platform))}</span><code class="ev">${escapeHtml(hit.name)}</code>${flag ? `<span class="tag ${flag.severity}">${m.severity[flag.severity]}</span>` : ""}<span class="meta">${escapeHtml(bits.join(" · ") || `${params.length} ${m.ui.paramsShort}`)}</span><span class="time">${escapeHtml(seconds(run, hit.t))}</span></summary>
<div class="event-body">${flag ? `<p class="flagnote ${flag.severity}">${escapeHtml(flag.detail)}</p>` : ""}
<div class="ebgrid"><section><h5>${m.ui.parameters} <span class="n">${params.length}</span></h5>${params.length ? kvTable(params) : `<p class="muted small">${m.ui.noParameters}</p>`}${consent}</section>
<aside><h5>${m.ui.source}</h5><ul class="srclist"><li><span class="lbl">dataLayer</span>${pushLine}</li><li><span class="lbl">${m.ui.request}</span>${reqText}</li></ul></aside></div>
${itemsBlock(m, items)}</div></details></li>`;
}

const clip = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

function pushRow(m, run, e) {
  const name = isConsentEntry(e.value) ? `consent ${e.value[1]}` : pushEvent(e.value) ?? clip(JSON.stringify(e.value) ?? String(e.value), 80);
  const items = objectItems(pushItems(e.value));
  const ec = Array.isArray(e.value) ? e.value[2] : e.value?.ecommerce;
  const bits = items.length ? [m.ui.itemsCount(items.length), ec?.value !== undefined ? `${ec.value} ${ec.currency ?? ""}`.trim() : ""].filter(Boolean).join(" · ") : "";
  return `<li><details class="event"><summary>${icon.chevron}<code class="ev">${escapeHtml(name)}</code>${bits ? `<span class="meta">${escapeHtml(bits)}</span>` : ""}<span class="time">${escapeHtml(seconds(run, e.t))}</span></summary>
<div class="event-body">${itemsBlock(m, items)}${items.length ? `<details class="raw"><summary>${icon.chevron} ${m.ui.rawJson}</summary><pre>${escapeHtml(pushText(e.value))}</pre></details>` : `<pre>${escapeHtml(pushText(e.value))}</pre>`}</div></details></li>`;
}

/** Nested JSON as dotted keys (properties.value); arrays stay JSON text. */
function flatten(obj, prefix = "", out = []) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && prefix.split(".").length < 3) flatten(v, key, out);
    else out.push([key, cell(v)]);
  }
  return out;
}

/**
 * The parameter sets a request carried: one per event in a GA4 batch (query plus
 * each body line), the query plus a flattened JSON body, or just the query.
 */
function paramSets(call) {
  let u;
  try {
    u = new URL(call.url);
  } catch {
    return [[]];
  }
  const query = [...u.searchParams];
  const body = call.postData;
  if (!body) return [query];
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    try {
      return [[...query, ...flatten(JSON.parse(trimmed))]];
    } catch { /* not JSON, or cut at the size limit */ }
  }
  if (/^[^\s{]*=/.test(trimmed)) {
    return trimmed.split("\n").filter(Boolean).map((line) => {
      const merged = new Map(query);
      for (const [k, v] of new URLSearchParams(line)) merged.set(k, v);
      return [...merged];
    });
  }
  return [query];
}

function paramRows(m, lang, entries) {
  return entries
    .map(([k, v]) => {
      const tip = paramTip(k, lang);
      const isItem = /^pr\d+$/.test(k);
      return `<tr${isItem ? ' class="pr"' : ""}><th><span class="pk">${escapeHtml(k)}</span>${tip ? `<span class="q" tabindex="0" role="note" aria-label="${escapeHtml(tip)}" data-tip="${escapeHtml(tip)}">?</span>` : ""}</th><td>${isItem ? `<span class="muted small">${escapeHtml(paramTip(k, lang))}</span>` : escapeHtml(v)}</td></tr>`;
    })
    .join("");
}

/** One row per event in each network request of the step. */
function requestRows(m, lang, run, step) {
  const rows = [];
  for (const c of (run.network ?? []).filter((x) => x.step === step.index)) {
    const sets = paramSets(c);
    const hits = parseTrackingRequest(c.url, c.postData ?? null) ?? [];
    const key = safeKey(c.provider ?? providerOf(c.url)?.key ?? c.vendor);
    sets.forEach((entries, i) => {
      const name = hits[i]?.name ?? (hits.length === 1 ? hits[0].name : "");
      const eventEntries = entries.filter(([k]) => isEventParam(k));
      const context = entries.filter(([k]) => !isEventParam(k));
      const items = ga4Items(entries.filter(([k]) => /^pr\d+$/.test(k)).map(([, v]) => v));
      const raw = c.url + (c.postData ? `\n\n${c.postData}` : "");
      const html = `<li data-p="${key}"><details class="event"><summary>${icon.chevron}<span class="ptag p-${key}">${escapeHtml(c.vendor)}</span><span class="method">${escapeHtml(c.method)}</span>${name ? `<code class="ev">${escapeHtml(name)}</code>` : ""}<span class="meta mono">${escapeHtml(hostPath(c.url))}${sets.length > 1 ? ` · ${escapeHtml(m.ui.inBatch(i + 1, sets.length))}` : ""}</span><span class="status mono">${escapeHtml(c.status ?? "")}</span><span class="time">${escapeHtml(seconds(run, c.t))}</span></summary>
<div class="event-body">${c.blocked ? `<p class="muted small">${m.ui.blockedNote}</p>` : ""}${c.bodyDropped ? `<p class="muted small">${m.ui.bodyDropped}</p>` : ""}${eventEntries.length ? `<h5>${m.ui.eventParams}</h5><table class="ptable glossary"><tbody>${paramRows(m, lang, eventEntries)}</tbody></table>` : ""}
${context.length ? `<details class="raw ctx"${eventEntries.length ? "" : " open"}><summary>${icon.chevron} ${m.ui.contextParams} <span class="n">${context.length}</span></summary><table class="ptable glossary"><tbody>${paramRows(m, lang, context)}</tbody></table></details>` : ""}
${itemsBlock(m, items)}<details class="raw"><summary>${icon.chevron} ${m.ui.rawRequest}</summary><pre class="url">${escapeHtml(raw)}</pre></details></div></details></li>`;
      rows.push({ key, label: PROVIDERS[key] ?? c.vendor ?? key, html });
    });
  }
  return rows;
}

const stepAnchor = (ri, si) => `j${ri}-s${si}`;
const skippedText = (counts) => Object.entries(counts ?? {}).sort((a, b) => b[1] - a[1]);
const sortPlatforms = (keys) => [...keys].sort((a, b) => platformRank(a) - platformRank(b) || platformLabel(a).localeCompare(platformLabel(b)));
const problemCount = (findings, run) => findings.filter((f) => f.severity in SEVERITY_RANK && f.journey === run.journeyId && f.viewport === run.viewport).length;

// AI text marks numbers with **x** and names with `x`. Only those two marks become HTML; everything else is escaped.
const fmt = (s) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>");
// Finding texts quote event and parameter names ("add_to_cart"); show those as code.
const detailHtml = (s) => escapeHtml(s).replace(/&quot;([^&]+?)&quot;/g, "<code>$1</code>");

// Lucide icons.
const ic = (paths, size = 16) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICON = {
  broken: '<path d="m15 9-6 6"/><path d="M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z"/><path d="m9 9 6 6"/>',
  warning: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  impact: '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
  cause: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  evidence: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  fix: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  where: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
};
const sevIcon = (sev) => ICON[sev === "broken" ? "broken" : sev === "info" ? "info" : "warning"];
const sec = (name, label) => `<div class="sec-h">${ic(ICON[name], 14)}<span>${label}</span></div>`;
const badge = (sev, text) => `<span class="badge ${sev}">${escapeHtml(text)}</span>`;
/** A logo with its light and dark versions, switched by the viewer's color scheme. */
const logo = (key, alt, height, cls) => `<picture class="${cls}"><source media="(prefers-color-scheme: dark)" srcset="${LOGOS[`${key}-dark`]}"><img src="${LOGOS[`${key}-light`]}" alt="${alt}" height="${height}"></picture>`;

/** The journey and step a finding's place points at. Steps are named by label; when labels repeat, prefer the step where the finding's event fired. */
function whereTarget(runs, w, f) {
  const ri = runs.findIndex((r) => r.journeyId === w.journey && r.viewport === w.viewport);
  if (ri < 0) return null;
  const candidates = w.step ? runs[ri].steps.filter((s) => s.index > 0 && s.label === w.step) : [];
  const step = candidates.find((s) => runs[ri].hits.some((h) => h.step === s.index && h.platform === f.platform && h.name === f.event)) ?? candidates[0];
  return { ri, step };
}

function stepDetail(m, lang, findings, run, ri, step, isDefault) {
  const hits = run.hits.filter((h) => h.step === step.index);
  const id = `s${ri}-${step.index}`;
  const sortedHits = [...hits].sort((a, b) => platformRank(a.platform) - platformRank(b.platform) || a.t - b.t);
  const eventRows = sortedHits.map((h) => ({ key: safeKey(h.platform), label: platformLabel(h.platform), html: eventRow(m, findings, run, step, h) }));
  const pushes = (run.dataLayerLog ?? []).filter((e) => e.step === step.index);
  const reqRows = requestRows(m, lang, run, step);
  const skipped = skippedText(run.skipped?.[step.index]);
  const skippedN = skipped.reduce((a, [, n]) => a + n, 0);
  const tab = (n, label, count) => `<input type="radio" name="${id}" id="${id}-${n}"${n === 1 ? " checked" : ""}><label for="${id}-${n}">${label} <span class="n">${count}</span></label>`;
  return `<section class="sdetail${isDefault ? " default" : ""}" id="${stepAnchor(ri, step.index)}" aria-label="${escapeHtml(step.label)}">
<header class="shead"><span class="sidx">${step.index}</span><div><h3>${escapeHtml(step.label)}</h3><div class="muted xs">${escapeHtml(m.ui.stepMeta(seconds(run, step.t), hits.length, pushes.length, skippedN))}${step.forced ? ` · ${m.ui.clickedThrough}` : ""}</div></div></header>
<div class="tabs seg">${tab(1, m.ui.tabEvents, eventRows.length)}${tab(2, "dataLayer", pushes.length)}${tab(3, m.ui.tabNetwork, reqRows.length)}
<div class="panel">${eventRows.length ? filtered(m, `${id}e`, eventRows, eventRows.map((r) => r.html).join("")) : `<p class="empty">${m.ui.noHits}</p>`}</div>
<div class="panel">${pushes.length ? `<ul class="evlist">${pushes.map((e) => pushRow(m, run, e)).join("")}</ul>` : `<p class="empty">${m.ui.noPushes}</p>`}</div>
<div class="panel">${reqRows.length ? filtered(m, `${id}n`, reqRows, reqRows.map((r) => r.html).join("")) : `<p class="empty">${m.ui.noRequests}</p>`}${skippedN ? `<p class="muted xs scope-note">${escapeHtml(m.ui.skippedInStep(skipped.map(([v, n]) => `${v} ${n}`).join(", "), skippedN))}</p>` : ""}</div>
</div></section>`;
}

/** One journey: a sticky step list on the left and the selected step on the right. It opens on the first step with a problem. */
function journeyPanel(m, lang, findings, run, ri, flagged) {
  const steps = run.steps.filter((s) => s.index > 0);
  const def = steps.find((s) => flagged.has(stepAnchor(ri, s.index))) ?? steps[0];
  const nav = steps
    .map((s) => {
      const hits = run.hits.filter((h) => h.step === s.index);
      const counts = sortPlatforms(new Set(hits.map((h) => h.platform))).map((p) => `<span class="dot p-${safeKey(p)}"></span>${hits.filter((h) => h.platform === p).length}`);
      const a = stepAnchor(ri, s.index);
      return `<li><a href="#${a}" data-s="${a}"${s === def ? ' class="def"' : ""}><span class="sidx">${s.index}</span><span class="sl">${escapeHtml(s.label)}</span>${flagged.has(a) ? `<span class="dot-flag" title="${m.ui.hasProblems}"></span>` : "<span></span>"}<span class="sc">${counts.join(" ") || '<span class="muted">–</span>'}</span></a></li>`;
    })
    .join("");
  const body = steps.length
    ? `<div class="jgrid2"><nav class="stepnav" aria-label="${m.ui.stepsNav}"><ol>${nav}</ol></nav><div class="sdetails">${steps.map((s) => stepDetail(m, lang, findings, run, ri, s, s === def)).join("\n")}</div></div>`
    : `<p class="empty">${m.ui.noSteps}</p>`;
  return `<article class="jpanel" id="j${ri}"><header class="jhead"><div><h2>${escapeHtml(run.journeyId)} <span class="muted">· ${escapeHtml(run.viewport)}</span></h2>${run.note ? `<p class="muted xs">${escapeHtml(run.note)}</p>` : ""}</div>${run.completed ? badge("ok", m.ui.completed) : badge("warning", m.ui.notCompleted)}</header>
${body}</article>`;
}

function journeysTab(m, lang, findings, runs, flagged) {
  if (!runs.length) return `<p class="empty">${m.ui.noSteps}</p>`;
  const tabs = runs.map((r, ri) => `<a href="#j${ri}">${escapeHtml(r.journeyId)} <span class="muted">· ${escapeHtml(r.viewport)}</span><span class="n">${problemCount(findings, r)}</span></a>`).join("");
  return `<nav class="jtabs" aria-label="${m.ui.chooseJourney}">${tabs}</nav>\n${runs.map((r, ri) => journeyPanel(m, lang, findings, r, ri, flagged)).join("\n")}`;
}

/** Evidence as a table when it is a JSON object (captured parameters), otherwise as text. */
function evidenceHtml(evidence) {
  try {
    const v = JSON.parse(evidence);
    if (v && typeof v === "object" && !Array.isArray(v)) return `<table class="ptable ev-table"><tbody>${Object.entries(v).map(([k, x]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(cell(x))}</td></tr>`).join("")}</tbody></table>`;
  } catch { /* plain text */ }
  return `<pre>${escapeHtml(evidence)}</pre>`;
}

function findingCard(m, runs, f, open) {
  const e = f.explanation;
  const steps = fixSteps(e);
  const journeysN = new Set(f.where.map((w) => `${w.journey}|${w.viewport}`)).size;
  const stepsN = f.where.filter((w) => w.step).length;
  const evidence = f.evidence
    ? evidenceHtml(f.evidence)
    : f.check === "missing_event" && f.platform
      ? `<table class="ptable ev-table"><tbody><tr><th>${escapeHtml(m.ui.requestTo(platformLabel(f.platform)))}</th><td><span class="missing">${m.ui.missing}</span></td></tr></tbody></table>`
      : "";
  const chips = f.where
    .map((w) => {
      const t = whereTarget(runs, w, f);
      const inner = `${t?.step ? `<span class="chip-step">${t.step.index}</span>` : ""}${escapeHtml(w.journey)} · ${escapeHtml(w.viewport)}${w.step ? ` <span class="muted">· ${escapeHtml(w.step)}</span>` : ""}`;
      return t ? `<a href="#${t.step ? stepAnchor(t.ri, t.step.index) : `j${t.ri}`}" class="chip">${inner}</a>` : `<span class="chip">${inner}</span>`;
    })
    .join("");
  return `<li class="finding sev-${f.severity}" data-sev="${f.severity}"><details${open ? " open" : ""}><summary>
<span class="sev-icon">${ic(sevIcon(f.severity), 18)}</span>
<span class="fhead"><span class="ftitle">${detailHtml(f.detail)}</span><span class="fmeta">${f.platform ? `<span class="ptag p-${safeKey(f.platform)}">${escapeHtml(platformLabel(f.platform))}</span>` : ""}<span>${escapeHtml(m.ui.spread(journeysN, stepsN))}</span></span></span>
${badge(f.severity, m.severity[f.severity])}${icon.chevron}</summary>
<div class="fbody">${e?.impact ? `<div class="impact">${ic(ICON.impact, 16)}<div><span class="impact-l">${m.ui.impact}</span>${fmt(e.impact)}</div></div>` : ""}
<div class="fcols"><div class="fcol">${sec("cause", m.ui.likelyCause)}${e?.likely_cause ? `<p>${fmt(e.likely_cause)}</p>` : `<p class="muted">${m.ui.noExplanation}</p>`}${evidence ? `${sec("evidence", m.ui.evidence)}${evidence}` : ""}</div>
<div class="fcol">${steps.length ? `${sec("fix", m.ui.fixSteps)}<ol class="fix-steps">${steps.map((t) => `<li><span>${fmt(t)}</span></li>`).join("")}</ol>` : ""}${sec("where", m.ui.where)}<div class="where">${chips}</div></div></div></div></details></li>`;
}

const FINDING_SEVERITIES = ["broken", "risk", "warning", "info"];
const SEV_COLOR = { broken: "var(--danger-dot)", risk: "var(--risk)", warning: "var(--warn-dot)", info: "var(--accent)" };

function findingsTab(m, runs, rows) {
  const problems = rows.filter((f) => f.severity !== "ok");
  if (!problems.length) return `<p class="empty">${m.ui.noProblems}</p>`;
  const n = Object.fromEntries(FINDING_SEVERITIES.map((s) => [s, problems.filter((f) => f.severity === s).length]));
  const present = FINDING_SEVERITIES.filter((s) => n[s]);
  const radios = ["all", ...present].map((s) => `<input type="radio" name="fs" id="fs-${s}" class="fsr"${s === "all" ? " checked" : ""}>`).join("");
  const bar = present.map((s) => `<span style="flex:${n[s]};background:${SEV_COLOR[s]}"></span>`).join("");
  const legend = present.map((s) => `<span><i style="background:${SEV_COLOR[s]}"></i>${m.severity[s]} <strong>${n[s]}</strong></span>`).join("");
  const labels = [`<label for="fs-all">${m.ui.all} <span class="n">${problems.length}</span></label>`, ...present.map((s) => `<label for="fs-${s}">${m.severity[s]} <span class="n">${n[s]}</span></label>`)].join("");
  const sorted = FINDING_SEVERITIES.flatMap((s) => problems.filter((f) => f.severity === s));
  return `<div class="filter-host">${radios}
<div class="sevbar" aria-hidden="true">${bar}</div><div class="sevlegend">${legend}</div>
<div class="toolbar"><div class="sevfilter" role="group" aria-label="${m.ui.filterBy}">${labels}</div><span class="muted xs">${m.ui.findingHint}</span></div>
<ul class="flist">${sorted.map((f, i) => findingCard(m, runs, f, i === 0 && f.severity !== "info")).join("")}</ul></div>`;
}

function summaryCard(m, explained, problems) {
  const s = summaryParts(explained?.summary);
  let body;
  if (!s) body = `<p class="muted">${problems ? m.ui.noSummary : m.ui.noProblems}</p>`;
  else if (s.text) body = `<p class="summary-text">${fmt(s.text)}</p>`;
  else {
    body = `${s.headline ? `<p class="headline">${fmt(s.headline)}</p>` : ""}${s.points.length ? `<ul class="summary-list">${s.points.map((p) => `<li>${badge(p.severity, m.severity[p.severity])}<span>${fmt(p.text)}</span></li>`).join("")}</ul>` : ""}${s.also_check.length ? `<div><div class="label">${m.ui.alsoCheck}</div><ul class="also">${s.also_check.map((t) => `<li>${fmt(t)}</li>`).join("")}</ul></div>` : ""}`;
  }
  return `<div class="card"><div class="card-h"><div class="card-t">${m.ui.summary}</div><div class="card-d">${m.ui.summaryLead}</div></div><div class="card-c stack">${body}${problems ? `<p><a href="#findings">${m.ui.seeAllFindings}</a></p>` : ""}</div></div>`;
}

/** The providers that were checked: from the runs, or for older captures the platforms seen. */
function checkedProviders(runs) {
  const chosen = new Set(runs.flatMap((r) => r.providers ?? []));
  if (!chosen.size) for (const r of runs) for (const h of r.hits) chosen.add(h.platform);
  return sortPlatforms(chosen);
}

function skippedTotals(runs) {
  const totals = {};
  for (const r of runs) for (const counts of Object.values(r.skipped ?? {})) for (const [v, n] of Object.entries(counts)) totals[v] = (totals[v] ?? 0) + n;
  return skippedText(totals);
}

const callProvider = (c) => safeKey(c.provider ?? providerOf(c.url)?.key ?? c.vendor);

function overviewTab(m, findings, rows, counts, explained, runs) {
  const problems = rows.filter((f) => f.severity !== "ok").length;
  const metric = (sev) => `<div class="card metric ${sev}"><div class="k">${m.severity[sev]}</div><div class="v">${counts[sev]}</div></div>`;
  const journeyRows = runs.map((r, ri) => {
    const n = problemCount(findings, r);
    return `<tr><td><a href="#j${ri}">${escapeHtml(r.journeyId)} <span class="muted">· ${escapeHtml(r.viewport)}</span></a></td><td class="num">${r.steps.filter((s) => s.index > 0).length}</td><td class="num${n ? " bad" : ""}">${n}</td></tr>`;
  });
  const skipped = skippedTotals(runs);
  const skippedN = skipped.reduce((a, [, x]) => a + x, 0);
  const provs = checkedProviders(runs);
  return `<div class="stack">
<div class="metrics">${["broken", "risk", "warning", "ok"].map(metric).join("")}</div>
<div class="ov-grid">${summaryCard(m, explained, problems)}
<div class="stack">
${runs.length ? `<div class="card"><div class="card-h"><div class="card-t">${m.ui.tabJourneys}</div></div><div class="card-c tight"><div class="tscroll"><table class="dt"><thead><tr><th>${m.ui.journey}</th><th>${m.ui.stepsCol}</th><th>${m.ui.problemsCol}</th></tr></thead><tbody>${journeyRows.join("")}</tbody></table></div></div></div>` : ""}
${provs.length ? `<div class="card"><div class="card-h"><div class="card-t">${m.ui.scopeCard}</div></div><div class="card-c"><div class="scope">${provs.map((k) => `<span class="ptag p-${safeKey(k)}">${escapeHtml(platformLabel(k))}</span>`).join("")}</div>${skippedN ? `<p class="muted xs scope-skipped">${escapeHtml(m.ui.skippedLine(skipped.map(([v]) => v).join(", "), skippedN))}</p>` : ""}</div></div>` : ""}
</div></div></div>`;
}

/** Each planned event × each journey: sent, not sent, or not expected there (or its provider not checked). */
function coverageCard(m, plan, runs) {
  const head = `<div class="card-h"><div class="card-t">${m.ui.planCoverage}</div><div class="card-d">${m.ui.planCoverageLead}</div></div>`;
  if (!plan?.events?.length || !runs.length) return `<div class="card">${head}<div class="card-c"><p class="muted">${m.ui.noPlan}</p></div></div>`;
  const events = plan.events.map((e) => ({ ...e, platform: String(e.platform ?? "").toLowerCase() }));
  const checks = (r, e) => !r.providers?.length || r.providers.includes(e.platform);
  const body = events
    .map((e) => {
      const cells = runs.map((r) => {
        if (!checks(r, e) || (e.journeys && !e.journeys.includes(r.journeyId))) return '<td class="c o">–</td>';
        return r.hits.some((h) => h.platform === e.platform && h.name === e.name) ? '<td class="c y">✓</td>' : '<td class="c x">✗</td>';
      });
      const unchecked = !runs.some((r) => checks(r, e));
      return `<tr><td><span class="ptag p-${safeKey(e.platform)}">${escapeHtml(platformLabel(e.platform))}</span> <code>${escapeHtml(e.name)}</code>${unchecked ? ` ${badge("muted", m.ui.notChecked)}` : ""}</td>${cells.join("")}</tr>`;
    })
    .join("");
  return `<div class="card">${head}<div class="card-c"><div class="tscroll"><table class="dt cov"><thead><tr><th>${m.ui.event}</th>${runs.map((r) => `<th>${escapeHtml(r.journeyId)} · ${escapeHtml(r.viewport)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div><p class="muted xs legend">${m.ui.coverageLegend}</p></div></div>`;
}

function providersCard(m, runs) {
  const provs = checkedProviders(runs);
  const skipped = skippedTotals(runs);
  if (!provs.length && !skipped.length) return "";
  const calls = runs.flatMap((r) => r.network ?? []);
  const rows = [
    ...provs.map((k) => [platformLabel(k), badge("ok", m.ui.checked), calls.filter((c) => callProvider(c) === k).length]),
    ...skipped.map(([v, n]) => [v, badge("muted", m.ui.outOfScopeStatus), n]),
  ];
  return `<div class="card"><div class="card-h"><div class="card-t">${m.ui.providers}</div></div><div class="card-c tight"><div class="tscroll"><table class="dt"><thead><tr><th>${m.ui.provider}</th><th>${m.ui.status}</th><th>${m.ui.requestsCol}</th></tr></thead><tbody>${rows.map(([n, s, c]) => `<tr><td>${escapeHtml(n)}</td><td>${s}</td><td class="num">${c}</td></tr>`).join("")}</tbody></table></div></div></div>`;
}

/** Steps a problem finding points at; they get a dot in the step list, and the journey opens on the first one. */
function flaggedSteps(runs, rows) {
  const out = new Set();
  for (const f of rows) {
    if (!(f.severity in SEVERITY_RANK)) continue;
    for (const w of f.where) {
      const t = whereTarget(runs, w, f);
      if (t?.step) out.add(stepAnchor(t.ri, t.step.index));
    }
  }
  return out;
}

/** Filter rules for the platform keys in this report: picking a source hides the other rows. */
function filterCss(runs) {
  const keys = new Set(PLATFORM_ORDER);
  for (const r of runs) {
    for (const h of r.hits) keys.add(safeKey(h.platform));
    for (const c of r.network ?? []) keys.add(callProvider(c));
  }
  return `${[...keys].map((k) => `.filter>.f-${k}:checked~.evlist>li:not([data-p="${k}"])`).join(",")}{display:none}`;
}

// The tabs, journeys and steps are switched by the URL hash (:target and :has()), so links work across tabs and every view can be shared.
function navCss(runs) {
  const top = ["overview", "findings", "journeys", "scope"].map((t) => `body:has(#${t}:target,#${t} :target) .toptabs a[href="#${t}"]`).join(",");
  const out = [`${top}{color:var(--fg);border-bottom-color:var(--accent)}`];
  if (runs.length) {
    out.push(`${runs.map((_, ri) => `body:has(#j${ri}:target,#j${ri} :target) .jtabs a[href="#j${ri}"]`).join(",")}{background:var(--bg);color:var(--fg);box-shadow:var(--shadow-sm)}`);
    const steps = runs.flatMap((r, ri) => r.steps.filter((s) => s.index > 0).map((s) => `body:has(#${stepAnchor(ri, s.index)}:target) a[data-s="${stepAnchor(ri, s.index)}"]`));
    if (steps.length) out.push(`${steps.join(",")}{background:var(--accent-bg);color:var(--fg)}`);
  }
  const sev = ["all", ...FINDING_SEVERITIES];
  out.push(`${sev.map((s) => `#fs-${s}:checked~.toolbar label[for=fs-${s}]`).join(",")}{background:var(--bg);color:var(--fg);box-shadow:var(--shadow-sm)}`);
  out.push(`${sev.map((s) => `#fs-${s}:focus-visible~.toolbar label[for=fs-${s}]`).join(",")}{outline:2px solid var(--accent)}`);
  out.push(`${FINDING_SEVERITIES.map((s) => `#fs-${s}:checked~.flist>li:not([data-sev=${s}])`).join(",")}{display:none}`);
  return out.join("\n");
}

const CSS = `
:root{
--bg:#FFFFFF;--page:#F7F9FC;--fg:#0A0E1A;--muted:#5A6480;--muted-bg:#F1F4F9;--border:#E3E7EF;--input:#E3E7EF;
--accent:#4F8EF7;--accent-fg:#2F6FDB;--accent-bg:#EBF1FE;--orange:#FF6D33;
--danger:#C5221F;--danger-bg:#FCE8E6;--warn:#A16207;--warn-bg:#FEF9C3;--warn-dot:#EAB308;--risk:#C2410C;--risk-bg:#FFEDD5;--danger-dot:#DC2626;--ok:#137333;--ok-bg:#E6F4EA;
--shadow-sm:0 1px 2px rgba(10,14,26,.06);--radius:6px;
--font-sans:'Google Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;--font-mono:'Google Sans Code',ui-monospace,SFMono-Regular,Menlo,monospace}
@media (prefers-color-scheme:dark){:root{
--bg:#141927;--page:#0A0E1A;--fg:#F0F4FF;--muted:#8892AA;--muted-bg:#182035;--border:#1E2640;--input:#26304D;
--accent-fg:#7EAAF9;--accent-bg:#1A2F5C;--danger:#F28B82;--danger-bg:#3A1F1D;--warn:#FACC15;--warn-bg:#332B0A;--warn-dot:#FACC15;--risk:#FB923C;--risk-bg:#3A2312;--danger-dot:#F87171;--ok:#81C995;--ok-bg:#16301F;--shadow-sm:none}}
*{box-sizing:border-box}
html{scroll-padding-top:64px}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;background:var(--page);color:var(--fg);font:400 14px/1.6 var(--font-sans);-webkit-font-smoothing:antialiased}
a{color:var(--accent-fg);text-decoration:none}
h1,h2,h3,h4,h5,h6{margin:0;font-weight:500;line-height:1.3}
h1{font-size:24px;letter-spacing:-.02em;overflow-wrap:anywhere}h2,h3{font-size:14px}
p{margin:0}
strong{font-weight:600;color:var(--fg)}
code,.mono,.time,pre{font-family:var(--font-mono)}
code{font-size:12px;background:var(--muted-bg);padding:1px 5px;border-radius:4px;overflow-wrap:anywhere}
.muted{color:var(--muted)}.xs{font-size:12px}
.label{font-size:12px;color:var(--muted);margin:0 0 6px}
.wrap{width:100%;max-width:1120px;margin:0 auto;padding:0 16px}
.topbar{background:var(--bg);border-bottom:1px solid var(--border)}
.topbar .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;height:56px}
.product-logo img{display:block;height:26px;width:auto}
.byline{display:inline-flex;align-items:center;gap:8px;font-size:12px;color:var(--muted)}.byline:hover{opacity:.85}
.logo-h img{display:block;height:18px;width:auto}
.title{margin-top:28px}
.eyebrow{font:500 12px var(--font-mono);color:var(--accent-fg);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
.title .meta{margin-top:4px;font-size:12px;color:var(--muted)}
.toptabs{position:sticky;top:0;z-index:10;background:var(--page);border-bottom:1px solid var(--border);margin-top:16px}
.toptabs .wrap{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none}
.toptabs a{display:inline-flex;align-items:center;gap:6px;padding:12px 10px;color:var(--muted);font-weight:500;white-space:nowrap;border-bottom:2px solid transparent;margin-bottom:-1px}
.toptabs a:hover{color:var(--fg)}
.n{font:500 12px/1.4 var(--font-mono);background:var(--muted-bg);color:var(--muted);padding:0 6px;border-radius:4px}
body:not(:has(:target)) .toptabs a[href="#overview"]{color:var(--fg);border-bottom-color:var(--accent)}
.tabpanel{display:none;padding:24px 0 64px}
.tabpanel:target,.tabpanel:has(:target){display:block}
body:not(:has(.tabpanel:target,.tabpanel :target)) #overview{display:block}
.card{background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow-sm)}
.card-h{padding:16px 20px 0}.card-c{padding:16px 20px 20px}.card-c.tight{padding:8px}
.card-t{font-weight:500}.card-d{font-size:12px;color:var(--muted);margin-top:2px}
.badge{display:inline-flex;align-items:center;font:500 12px/1 var(--font-sans);padding:4px 8px;border-radius:4px;white-space:nowrap;background:var(--muted-bg);color:var(--muted)}
.badge.broken{background:var(--danger-bg);color:var(--danger)}.badge.risk{background:var(--risk-bg);color:var(--risk)}.badge.warning{background:var(--warn-bg);color:var(--warn)}.badge.ok{background:var(--ok-bg);color:var(--ok)}.badge.info{background:var(--accent-bg);color:var(--accent-fg)}
.stack{display:grid;gap:16px}
.metrics{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.metric{padding:16px;border-top:3px solid var(--border)}
.metric .k{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}
.metric .k::before{content:"";width:8px;height:8px;border-radius:2px;background:var(--muted)}
.metric.broken{border-top-color:var(--danger-dot)}.metric.broken .k::before{background:var(--danger-dot)}.metric.broken .v{color:var(--danger)}
.metric.risk{border-top-color:var(--risk)}.metric.risk .k::before{background:var(--risk)}.metric.risk .v{color:var(--risk)}
.metric.warning{border-top-color:var(--warn-dot)}.metric.warning .k::before{background:var(--warn-dot)}.metric.warning .v{color:var(--warn)}
.metric.ok{border-top-color:var(--ok)}.metric.ok .k::before{background:var(--ok)}
.metric .v{font:600 24px/1.3 var(--font-mono);margin-top:4px}
.headline{font-weight:500}
.summary-list{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.summary-list li{display:grid;grid-template-columns:72px 1fr;gap:8px;align-items:baseline}
.summary-list .badge{justify-self:start}
.also{margin:0;padding-left:18px;display:grid;gap:6px}
.scope{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center;font-size:12px;color:var(--muted)}
.scope-skipped,.legend{margin-top:8px}
table.dt{width:100%;border-collapse:collapse}
table.dt th,table.dt td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--border);vertical-align:middle}
table.dt th{font-weight:500;color:var(--muted);font-size:12px}
table.dt tr:last-child td{border-bottom:0}
table.dt td.num{font-family:var(--font-mono)}
table.dt td.num.bad{color:var(--danger);font-weight:600}
table.dt a{color:var(--fg)}table.dt a:hover{color:var(--accent-fg)}
.tscroll{overflow-x:auto}
.toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;margin-bottom:12px}
.sevfilter{display:inline-flex;flex-wrap:wrap;gap:2px;padding:3px;background:var(--muted-bg);border-radius:var(--radius)}
.fsr{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
.sevfilter label{padding:4px 10px;border-radius:4px;font-weight:500;font-size:12px;color:var(--muted);cursor:pointer}
.filter-host{position:relative}
.flist{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.finding{--sev:var(--warn-dot);--sev-fg:var(--warn);--sev-bg:var(--warn-bg);background:var(--bg);border:1px solid var(--border);border-left:4px solid var(--sev);border-radius:var(--radius);box-shadow:var(--shadow-sm)}
.finding.sev-broken{--sev:var(--danger-dot);--sev-fg:var(--danger);--sev-bg:var(--danger-bg)}
.finding.sev-risk{--sev:var(--risk);--sev-fg:var(--risk);--sev-bg:var(--risk-bg)}
.finding.sev-info{--sev:var(--accent);--sev-fg:var(--accent-fg);--sev-bg:var(--accent-bg)}
.finding>details>summary{display:flex;align-items:center;gap:12px;padding:14px 16px}
.finding>details[open]>summary{background:linear-gradient(90deg,var(--sev-bg),transparent 70%)}
.sev-icon{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:var(--radius);background:var(--sev-bg);color:var(--sev-fg);flex:none}
.fhead{flex:1;min-width:0;display:grid;gap:4px}
.ftitle{color:var(--fg);overflow-wrap:anywhere}
.fmeta{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;color:var(--muted)}
.finding summary .chev{margin-left:4px}
.fbody{padding:16px;border-top:1px solid var(--border)}
.impact{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;background:var(--sev-bg);color:var(--fg);border-radius:var(--radius)}
.impact svg{color:var(--sev-fg);flex:none;margin-top:3px}
.impact-l{display:block;font-size:12px;color:var(--sev-fg);margin-bottom:2px}
.fcols{display:grid;gap:8px 32px;margin-top:4px}
.fcol{min-width:0}
.sec-h{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);margin:16px 0 8px}
.sec-h svg{color:var(--accent-fg)}
.ev-table{border:1px solid var(--border);border-radius:var(--radius);border-collapse:separate;border-spacing:0;overflow:hidden}
.ev-table th{background:var(--muted-bg)}
.missing{display:inline-block;padding:0 6px;border-radius:4px;background:var(--danger-bg);color:var(--danger)}
.fix-steps{list-style:none;margin:0;padding:0;display:grid;gap:10px;counter-reset:fx}
.fix-steps li{display:grid;grid-template-columns:22px 1fr;gap:10px;counter-increment:fx}
.fix-steps li::before{content:counter(fx);display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--accent-bg);color:var(--accent-fg);font:500 12px var(--font-mono)}
.where{display:flex;flex-wrap:wrap;gap:6px}
.chip{display:inline-flex;align-items:center;gap:8px;padding:4px 10px 4px 4px;border:1px solid var(--border);border-radius:var(--radius);color:var(--fg);font-size:12px;background:var(--bg)}
span.chip{padding-left:10px}
a.chip:hover{border-color:var(--accent);color:var(--fg)}
.chip-step{display:inline-grid;place-items:center;min-width:20px;height:20px;border-radius:4px;background:var(--accent);color:#fff;font:500 12px var(--font-mono)}
.sevbar{display:flex;height:8px;border-radius:4px;overflow:hidden;gap:2px;margin:0 0 6px}
.sevbar span{display:block}
.sevlegend{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12px;color:var(--muted);margin-bottom:16px}
.sevlegend i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px}
body>main{flex:1 0 auto;width:100%}
.footer{border-top:1px solid var(--border);background:var(--bg);margin-top:32px;flex:none}
.footer .wrap{display:grid;gap:16px;padding:32px 16px}
.footer p{font-size:12px;color:var(--muted)}
.footer a{color:var(--fg)}.footer a:hover{color:var(--accent-fg)}
.footer .f-links{display:flex;flex-wrap:wrap;gap:8px 20px;font-size:12px;margin-top:6px}
.footer .f-meta{font:12px var(--font-mono);color:var(--muted)}
.logo-link{display:inline-flex}.logo-s img{display:block;height:56px;width:auto}
.f-atd{display:inline-flex;align-items:center;gap:6px;vertical-align:-3px}.f-atd img{height:16px;width:auto}
.jtabs{display:inline-flex;flex-wrap:wrap;gap:2px;padding:3px;background:var(--muted-bg);border-radius:var(--radius);margin-bottom:16px}
.jtabs a{display:inline-flex;align-items:center;gap:8px;padding:5px 10px;border-radius:4px;color:var(--muted);font-weight:500}
.jtabs a:hover{color:var(--fg)}
#journeys:not(:has(.jpanel:target,.jpanel :target)) .jtabs a[href="#j0"]{background:var(--bg);color:var(--fg);box-shadow:var(--shadow-sm)}
.jpanel{display:none}
.jpanel:target,.jpanel:has(:target){display:block}
#journeys:not(:has(.jpanel:target,.jpanel :target)) .jpanel:first-of-type{display:block}
.jhead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px}
.jgrid2{display:grid;gap:16px;align-items:start}
.stepnav{background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:6px}
.stepnav ol{list-style:none;margin:0;padding:0;display:grid;gap:2px}
.stepnav a{display:grid;grid-template-columns:24px minmax(0,1fr) auto auto;gap:6px;align-items:center;padding:7px 8px;border-radius:4px;color:var(--muted)}
.stepnav a:hover{background:var(--muted-bg);color:var(--fg)}
.jpanel:not(:has(.sdetail:target)) .stepnav a.def{background:var(--accent-bg);color:var(--fg)}
.sidx{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:4px;border:1px solid var(--border);font:500 12px var(--font-mono);color:var(--muted);background:var(--bg)}
.sl{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:inherit}
.dot-flag{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--danger-dot)}
.sc{font:12px var(--font-mono);color:var(--muted);white-space:nowrap;display:inline-flex;align-items:center;gap:3px}
.sdetail{display:none;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow-sm);scroll-margin-top:64px;min-width:0}
.sdetail:target{display:block}
.jpanel:not(:has(.sdetail:target)) .sdetail.default{display:block}
.shead{display:flex;gap:12px;align-items:flex-start;padding:16px}
.shead h3{overflow-wrap:anywhere}
.shead .sidx{background:var(--accent);border-color:var(--accent);color:#fff;width:26px;height:26px;flex:none}
.empty{color:var(--muted);padding:8px 0}
.tabs.seg{display:grid;grid-template-columns:repeat(3,auto) 1fr;padding:0 16px 16px}
.tabs.seg>input{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
.tabs.seg>label{padding:6px 12px;font-weight:500;color:var(--muted);cursor:pointer;background:var(--muted-bg);white-space:nowrap;display:inline-flex;gap:6px;align-items:center}
.tabs.seg>label:nth-of-type(1){border-radius:var(--radius) 0 0 var(--radius)}
.tabs.seg>label:nth-of-type(3){border-radius:0 var(--radius) var(--radius) 0}
.tabs.seg>input:checked+label{background:var(--bg);color:var(--fg);box-shadow:inset 0 0 0 1px var(--border)}
.tabs.seg>input:focus-visible+label{outline:2px solid var(--accent)}
.tabs.seg>.panel{display:none;grid-column:1/-1;padding-top:12px;min-width:0}
.tabs.seg>input:nth-of-type(1):checked~.panel:nth-of-type(1),.tabs.seg>input:nth-of-type(2):checked~.panel:nth-of-type(2),.tabs.seg>input:nth-of-type(3):checked~.panel:nth-of-type(3){display:block}
.filter{display:flex;flex-wrap:wrap;gap:6px;position:relative}
.filter>input{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
.filter>label{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border:1px solid var(--input);border-radius:var(--radius);font-size:12px;cursor:pointer;color:var(--muted);background:var(--bg)}
.filter>label:hover{color:var(--fg)}
.filter>input:checked+label{background:var(--fg);border-color:var(--fg);color:var(--bg)}
.filter>input:checked+label .n{background:transparent;color:inherit}
.filter>input:focus-visible+label{outline:2px solid var(--accent);outline-offset:2px}
.filter>label:last-of-type{margin-bottom:4px}
.dot{display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--muted)}
.dot.p-ga4,.ptag.p-ga4::before{background:var(--orange)}.dot.p-meta,.ptag.p-meta::before{background:var(--accent)}.dot.p-google_ads,.ptag.p-google_ads::before{background:var(--ok)}.dot.p-tiktok,.ptag.p-tiktok::before{background:var(--fg)}
.evlist{list-style:none;margin:0;padding:0;border:1px solid var(--border);border-radius:var(--radius);flex-basis:100%;min-width:0}
.evlist>li+li{border-top:1px solid var(--border)}
summary{cursor:pointer;list-style:none}summary::-webkit-details-marker{display:none}
summary:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.chev{flex:none;color:var(--muted);transition:transform .15s ease}details[open]>summary>.chev{transform:rotate(90deg)}
.event>summary{display:flex;align-items:center;gap:10px;padding:8px 12px;flex-wrap:wrap}
.event>summary:hover{background:var(--muted-bg)}
.event[class*=flag-]>summary .ev::after{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--warn-dot);margin-left:8px;vertical-align:2px}
.event.flag-broken>summary .ev::after{background:var(--danger-dot)}.event.flag-risk>summary .ev::after{background:var(--risk)}
.event .tag{display:none}
.ev{font:12px var(--font-mono);background:none;padding:0;overflow-wrap:anywhere}
.event .meta{font-size:12px;color:var(--muted)}
.event .time,.time{font-size:12px;color:var(--muted);margin-left:auto}
.ptag{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}
.ptag::before{content:"";width:8px;height:8px;border-radius:2px;background:var(--muted)}
.event-body{padding:4px 12px 16px}
.flagnote{margin:4px 0 12px;padding:8px 12px;border-radius:var(--radius);background:var(--warn-bg);color:var(--warn)}
.flagnote.broken{background:var(--danger-bg);color:var(--danger)}.flagnote.risk{background:var(--risk-bg);color:var(--risk)}
.event-body h5{font-size:12px;color:var(--muted);font-weight:400;margin:12px 0 6px}
.event-body h5:first-child{margin-top:4px}
h5 .n{margin-left:4px}
.ebgrid{display:grid;gap:12px}
.ebgrid>*{min-width:0}
.ptable{width:100%;border-collapse:collapse;font:12px/1.5 var(--font-mono)}
.ptable th,.ptable td{text-align:left;vertical-align:top;padding:5px 8px;border-bottom:1px solid var(--border)}
.ptable th{color:var(--muted);font-weight:400;white-space:nowrap;width:1%;min-width:120px}
.glossary th{min-width:170px}
.ptable td{overflow-wrap:anywhere}
.ptable tr:last-child>*{border-bottom:0}
.consents{display:flex;flex-wrap:wrap;gap:6px}
.consent{font-size:12px;padding:2px 6px;border-radius:4px}.consent.granted{background:var(--ok-bg);color:var(--ok)}.consent.denied{background:var(--warn-bg);color:var(--warn)}
.ebgrid aside{background:var(--muted-bg);border-radius:var(--radius);padding:10px 12px;align-self:start}
.ebgrid aside h5{margin-top:0!important}
.srclist{list-style:none;margin:0;padding:0;display:grid;gap:8px;font-size:12px}
.srclist li{display:grid;gap:2px;overflow-wrap:anywhere}.srclist .lbl{font-size:12px;color:var(--muted)}
.method{font:500 12px var(--font-mono);padding:0 5px;border-radius:4px;background:var(--accent-bg);color:var(--accent-fg)}
.status{color:var(--ok);font-family:var(--font-mono);font-size:12px}
.small{font-size:12px}
.item{border:1px solid var(--border);border-radius:var(--radius);padding:12px;margin-bottom:8px}
.item-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 10px;margin-bottom:10px}
.item-head b{font-weight:500}
.item-idx{font:12px var(--font-mono);color:var(--muted)}
.item-price{margin-left:auto;font-size:12px}
.grid4{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 16px;margin:0}
.grid4 dt{font:12px var(--font-mono);color:var(--muted);overflow-wrap:anywhere}.grid4 dd{margin:0;font:12px var(--font-mono);overflow-wrap:anywhere}
h6{margin:12px 0 6px;font-size:12px;font-weight:400;color:var(--muted)}
.pk{margin-right:4px}
.q{position:relative;display:inline-grid;place-items:center;width:15px;height:15px;border:1px solid var(--input);border-radius:50%;font:500 10px var(--font-sans);color:var(--muted);cursor:help;vertical-align:1px}
.q:hover,.q:focus{border-color:var(--accent);color:var(--accent-fg);outline:none}
.q:hover::after,.q:focus::after{content:attr(data-tip);position:absolute;left:0;top:calc(100% + 6px);z-index:5;width:260px;padding:8px 10px;background:var(--fg);color:var(--bg);font:400 12px/1.45 var(--font-sans);border-radius:var(--radius);white-space:normal;text-align:left}
tr.pr td{color:var(--muted)}
details.raw{margin-top:10px}details.raw>summary{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}
pre{margin:8px 0 0;font-size:12px;line-height:1.5;background:var(--muted-bg);border-radius:var(--radius);padding:10px 12px;white-space:pre-wrap;overflow-wrap:anywhere}
.scope-note{margin-top:10px}
.cov td.c{text-align:center;font-family:var(--font-mono)}
.cov .y{color:var(--ok)}.cov .x{color:var(--danger);font-weight:600}.cov .o{color:var(--muted)}
@media (min-width:768px){
.wrap{padding:0 24px}
.metrics{grid-template-columns:repeat(4,1fr)}
.ov-grid{display:grid;grid-template-columns:2fr 1fr;gap:16px;align-items:start}
.fcols{grid-template-columns:1fr 1fr}
.footer .wrap{grid-template-columns:auto 1fr auto;align-items:center;padding:32px 24px}
.footer .wrap.plain{grid-template-columns:1fr auto}
.jgrid2{grid-template-columns:260px minmax(0,1fr)}
.stepnav{position:sticky;top:60px}
.ebgrid{grid-template-columns:2fr 1fr}
.grid4{grid-template-columns:repeat(4,minmax(0,1fr))}
.event-body{padding:4px 16px 16px 38px}
}
@media (max-width:767px){.ov-grid{display:grid;gap:16px}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
@media print{.toptabs,.jtabs,.stepnav,.filter>label,.filter>input,.tabs.seg>label,.sevfilter{display:none}.tabpanel,.jpanel,.sdetail,.tabs.seg>.panel{display:block!important}.jpanel{margin-bottom:32px}.sdetail{margin-bottom:16px;break-inside:avoid-page}details>*{display:block}}
`;

export function renderHtml({ title, generatedAt, findings, explained, runs, plan = null, lang = "en", branding = true }) {
  const m = messages(lang);
  const rows = attachExplanations(findings, explained);
  const counts = summarize(rows);
  const problems = rows.filter((f) => f.severity !== "ok").length;
  const flagged = flaggedSteps(runs, rows);
  const atd = `<a class="f-atd" href="https://github.com/analitikisler/ai-tag-debugger" rel="noopener noreferrer"><img src="${LOGOS["atd-icon"]}" alt="" height="16">AI Tag Debugger</a>`;
  const footer = branding
    ? `<div class="wrap"><a href="https://analitikisler.com" class="logo-link" aria-label="analitikisler.com" rel="noopener noreferrer">${logo("stacked", "Analitik İşler", 56, "logo-s")}</a>
<div><p>${m.ui.credit(atd)}</p><div class="f-links"><a href="https://analitikisler.com" rel="noopener noreferrer">analitikisler.com</a><a href="https://github.com/analitikisler/ai-tag-debugger" rel="noopener noreferrer">GitHub</a></div></div>
<div class="f-meta">${escapeHtml(generatedAt)} · v${VERSION}</div></div>`
    : `<div class="wrap plain"><div class="f-meta">AI Tag Debugger</div><div class="f-meta">${escapeHtml(generatedAt)} · v${VERSION}</div></div>`;

  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title><link rel="icon" type="image/png" href="${LOGOS.favicon}">
<style>${CSS}${filterCss(runs)}
${navCss(runs)}</style></head><body>
<div class="topbar"><div class="wrap"><span class="product-logo">${logo("atd-lockup", "AI Tag Debugger", 26, "logo-atd")}</span>${branding ? `<a href="https://analitikisler.com" class="byline" rel="noopener noreferrer"><span>${m.ui.by}</span>${logo("horizontal", "Analitik İşler", 18, "logo-h")}</a>` : ""}</div></div>
<header class="wrap title">
<div class="eyebrow">${m.ui.eyebrow}</div>
<h1>${escapeHtml(title)}</h1>
<div class="meta">${escapeHtml(generatedAt)} · ${escapeHtml(m.ui.headerMeta(runs.length, checkedProviders(runs).length))} · ai-tag-debugger ${VERSION}</div>
</header>
<nav class="toptabs" aria-label="${m.ui.sections}"><div class="wrap">
<a href="#overview">${m.ui.tabOverview}</a><a href="#findings">${m.ui.findings} <span class="n">${problems}</span></a><a href="#journeys">${m.ui.tabJourneys} <span class="n">${runs.length}</span></a><a href="#scope">${m.ui.tabScope}</a></div></nav>
<main class="wrap">
<section class="tabpanel" id="overview" aria-label="${m.ui.tabOverview}">${overviewTab(m, findings, rows, counts, explained, runs)}</section>
<section class="tabpanel" id="findings" aria-label="${m.ui.findings}">${findingsTab(m, runs, rows)}</section>
<section class="tabpanel" id="journeys" aria-label="${m.ui.tabJourneys}">${journeysTab(m, lang, findings, runs, flagged)}</section>
<section class="tabpanel" id="scope" aria-label="${m.ui.tabScope}"><div class="stack">${coverageCard(m, plan, runs)}${providersCard(m, runs)}</div></section>
</main>
<footer class="footer">${footer}</footer>
</body></html>`;
}

const csvCell = (v) => {
  let s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  // Text from the page could run as a formula in Excel or Sheets; a leading ' keeps it text.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per tracking hit, dataLayer push and network call, in time order, for spreadsheets. */
export function renderCsv({ findings, runs }) {
  const header = ["journey", "viewport", "step_index", "step", "time_s", "type", "platform_or_vendor", "event", "details", "status", "flag"];
  const rows = [];
  for (const r of runs) {
    const stepOf = (i) => r.steps[i] ?? { index: i, label: "" };
    const t = (x) => ((x - r.startedAt) / 1000).toFixed(2);
    for (const h of r.hits) {
      const s = stepOf(h.step);
      rows.push({ at: h.t, cells: [r.journeyId, r.viewport, s.index, s.label, t(h.t), "hit", h.platform, h.name, h.params, "", hitSeverity(findings, r, s, h) ?? ""] });
    }
    for (const e of r.dataLayerLog ?? []) {
      const s = stepOf(e.step);
      const name = isConsentEntry(e.value) ? `consent ${e.value[1]}` : e.value?.event ?? "";
      rows.push({ at: e.t, cells: [r.journeyId, r.viewport, s.index, s.label, t(e.t), "datalayer", "", name, e.value, "", ""] });
    }
    for (const c of r.network ?? []) {
      const s = stepOf(c.step);
      rows.push({ at: c.t, cells: [r.journeyId, r.viewport, s.index, s.label, t(c.t), "network", c.vendor, c.method, c.url, c.blocked ? `${c.status} (local)` : c.status, ""] });
    }
  }
  // Keep each run's rows together, in time order within the run.
  const order = new Map(runs.map((r, i) => [`${r.journeyId}|${r.viewport}`, i]));
  rows.sort((a, b) => order.get(`${a.cells[0]}|${a.cells[1]}`) - order.get(`${b.cells[0]}|${b.cells[1]}`) || a.at - b.at);
  // The BOM makes Excel open the file as UTF-8, so Turkish characters display correctly.
  return "﻿" + [header, ...rows.map((r) => r.cells)].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}
