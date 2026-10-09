import { createProvider } from "./providers.js";
import { groupFindings, summarize } from "./checks.js";
import { messages } from "./i18n.js";
import { parseTrackingRequest, providerOf, PROVIDERS } from "./parsers.js";
import { decodeGa4Item, isEventParam, paramTip } from "./glossary.js";

const EXPLAIN_SYSTEM = `You are a senior digital analytics consultant reviewing an automated tracking audit. You receive findings from deterministic checks, the measurement plan, the hits captured on each step of each journey, and optionally a Google Tag Manager container export.

For each finding with severity broken, risk or warning, give:
- impact: one sentence on what this does to the data, the reports or ad spend;
- likely_cause: the most likely cause, in plain language a marketing manager can follow and an analyst can act on;
- fix_steps: the fix as short, ordered steps.
When a GTM container is provided, name the specific tags, triggers or variables involved. Only state causes the evidence supports; when the cause is uncertain, say what to check.

Then write the summary:
- headline: one sentence naming what matters most for data quality and ad spend;
- points: the main problems, most important first, each one sentence with its severity;
- also_check: things you can see in the captured hits that the findings list does not cover (for example a conversion that fires on page load, or a cookie banner click counted as a conversion). Only include what the captured data shows; leave the list empty otherwise.`;

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

/** "4 planned events matched the plan: ga4:page_view, meta:AddToCart." as a lead line and event chips. */
function planMatchHtml(detail) {
  const at = detail.indexOf(": ");
  if (at < 0) return escapeHtml(detail);
  const chips = detail.slice(at + 2).replace(/\.$/, "").split(", ").map((key) => {
    const i = key.indexOf(":");
    const p = i > 0 ? key.slice(0, i) : "";
    return `<span class="ptag${p ? ` p-${escapeHtml(p)}` : ""}">${p ? `${escapeHtml(platformLabel(p))} <b>${escapeHtml(key.slice(i + 1))}</b>` : `<b>${escapeHtml(key)}</b>`}</span>`;
  });
  return `<span>${escapeHtml(detail.slice(0, at))}</span><span class="chips">${chips.join("")}</span>`;
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

function stepHtml(m, lang, findings, run, ri, step) {
  const hits = run.hits.filter((h) => h.step === step.index);
  const flagged = hits.some((h) => hitFlag(findings, run, step, h));
  const groups = [...new Set(hits.map((h) => h.platform))].sort((a, b) => platformRank(a) - platformRank(b) || platformLabel(a).localeCompare(platformLabel(b)));
  const counts = groups.map((p) => `<span class="ptag p-${safeKey(p)}">${escapeHtml(platformLabel(p))} <b>${hits.filter((h) => h.platform === p).length}</b></span>`).join("");
  const id = `s${ri}-${step.index}`;
  const sortedHits = [...hits].sort((a, b) => platformRank(a.platform) - platformRank(b.platform) || a.t - b.t);
  const eventRows = sortedHits.map((h) => ({ key: safeKey(h.platform), label: platformLabel(h.platform), html: eventRow(m, findings, run, step, h) }));
  const pushes = (run.dataLayerLog ?? []).filter((e) => e.step === step.index);
  const reqRows = requestRows(m, lang, run, step);
  const skipped = skippedText(run.skipped?.[step.index]);
  const skippedN = skipped.reduce((a, [, n]) => a + n, 0);
  const tab = (n, label, count) => `<input type="radio" name="${id}" id="${id}-${n}"${n === 1 ? " checked" : ""}><label for="${id}-${n}">${label} <span class="n">${count}</span></label>`;
  return `<li class="step" id="${stepAnchor(ri, step.index)}"><details${flagged ? " open" : ""}>
<summary><span class="idx">${step.index}</span><span class="label"><b>${escapeHtml(step.label)}</b>${step.forced ? `<span class="muted"> · ${m.ui.clickedThrough}</span>` : ""}</span><span class="time">${escapeHtml(seconds(run, step.t))}</span><span class="counts">${counts || `<span class="muted">${m.ui.noHits}</span>`}</span>${flagged ? `<span class="tag broken dot" title="${m.ui.hasProblems}"></span>` : ""}</summary>
<div class="step-body v2"><div class="tabs steptabs">${tab(1, m.ui.tabEvents, eventRows.length)}${tab(2, "dataLayer", pushes.length)}${tab(3, m.ui.tabNetwork, reqRows.length)}
<div class="panel">${eventRows.length ? filtered(m, `${id}e`, eventRows, eventRows.map((r) => r.html).join("")) : `<p class="muted small">${m.ui.noHits}</p>`}</div>
<div class="panel">${pushes.length ? `<ul class="evlist">${pushes.map((e) => pushRow(m, run, e)).join("")}</ul>` : `<p class="muted small">${m.ui.noPushes}</p>`}</div>
<div class="panel">${reqRows.length ? filtered(m, `${id}n`, reqRows, reqRows.map((r) => r.html).join("")) : `<p class="muted small">${m.ui.noRequests}</p>`}${skippedN ? `<p class="muted small scope-note">${escapeHtml(m.ui.skippedInStep(skipped.map(([v, n]) => `${v} ${n}`).join(", "), skippedN))}</p>` : ""}</div>
</div></div></details></li>`;
}

function journeysHtml(m, lang, findings, runs) {
  const overview = runs
    .map((r, ri) => {
      const flagged = findings.filter((f) => f.severity in SEVERITY_RANK && f.journey === r.journeyId && f.viewport === r.viewport).length;
      return `<a class="jcard" href="#j${ri}"><span class="jname">${escapeHtml(r.journeyId)} <span class="muted">· ${escapeHtml(r.viewport)}</span></span><span class="tag ${r.completed ? "ok" : "warning"}">${r.completed ? m.ui.completed : m.ui.notCompleted}</span><span class="jstats"><span><b>${r.steps.length - 1}</b> ${m.ui.stepsShort}</span><span><b>${r.hits.length}</b> ${m.ui.eventsShort}</span><span${flagged ? ' class="bad"' : ""}><b>${flagged}</b> ${m.ui.problemsShort}</span></span></a>`;
    })
    .join("");
  const journeys = runs
    .map((r, ri) => `<article class="journey" id="j${ri}"><header><h3>${escapeHtml(r.journeyId)} <span class="muted">· ${escapeHtml(r.viewport)}</span></h3><span class="tag ${r.completed ? "ok" : "warning"}">${r.completed ? m.ui.completed : m.ui.notCompleted}</span></header>${r.note ? `<p class="note">${escapeHtml(r.note)}</p>` : ""}
<ol class="steps">${r.steps.filter((s) => s.index > 0).map((s) => stepHtml(m, lang, findings, r, ri, s)).join("\n")}</ol></article>`)
    .join("\n");
  return `<nav class="jgrid" aria-label="${m.ui.timeline}">${overview}</nav>${journeys}`;
}

function whereLink(runs, w, f) {
  const ri = runs.findIndex((r) => r.journeyId === w.journey && r.viewport === w.viewport);
  // Findings name the step by label; when labels repeat, prefer the step where the finding's event fired.
  const candidates = ri >= 0 && w.step ? runs[ri].steps.filter((s) => s.index > 0 && s.label === w.step) : [];
  const step = candidates.find((s) => runs[ri].hits.some((h) => h.step === s.index && h.platform === f.platform && h.name === f.event)) ?? candidates[0];
  const href = ri < 0 ? null : step ? `#${stepAnchor(ri, step.index)}` : `#j${ri}`;
  const text = `<b>${escapeHtml(w.journey)}</b> · ${escapeHtml(w.viewport)}${w.step ? `<span class="muted"> · ${escapeHtml(w.step)}</span>` : ""}`;
  return href ? `<li><a href="${href}">${text}</a></li>` : `<li>${text}</li>`;
}

/** Evidence as a table when it is a JSON object (captured parameters), otherwise as text. */
function evidenceHtml(evidence) {
  try {
    const v = JSON.parse(evidence);
    if (v && typeof v === "object" && !Array.isArray(v)) return kvTable(Object.entries(v).map(([k, x]) => [k, cell(x)]));
  } catch { /* plain text */ }
  return `<pre>${escapeHtml(evidence)}</pre>`;
}

function findingHtml(m, runs, f, open) {
  const e = f.explanation;
  const steps = fixSteps(e);
  return `<li class="finding ${f.severity}"><details${open ? " open" : ""}><summary>${icon.chevron}<span class="tag ${f.severity}">${m.severity[f.severity]}</span><span class="title">${escapeHtml(f.detail)}</span><span class="where-mini">${escapeHtml(m.ui.places(f.where.length))}</span></summary>
<div class="fbody">${e?.impact ? `<p class="impact"><b>${m.ui.impact}.</b> ${escapeHtml(e.impact)}</p>` : ""}
<div class="fcols"><section><h5>${m.ui.likelyCause}</h5>${e ? `<p>${escapeHtml(e.likely_cause)}</p>` : `<p class="muted">${m.ui.noExplanation}</p>`}${f.evidence ? `<h5>${m.ui.evidence}</h5>${evidenceHtml(f.evidence)}` : ""}</section>
<section>${steps.length ? `<h5>${m.ui.fixSteps}</h5><ol class="fix-steps">${steps.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ol>` : ""}<h5>${m.ui.where}</h5><ul class="where">${f.where.map((w) => whereLink(runs, w, f)).join("")}</ul></section></div></div></details></li>`;
}

function findingsHtml(m, runs, rows) {
  const problems = rows.filter((f) => f.severity !== "ok");
  if (!problems.length) return `<p class="lead">${m.ui.noProblems}</p>`;
  let first = true;
  return ["broken", "risk", "warning", "info"]
    .map((sev) => {
      const list = problems.filter((f) => f.severity === sev);
      if (!list.length) return "";
      const html = list.map((f) => {
        const out = findingHtml(m, runs, f, first && sev !== "info");
        first = false;
        return out;
      });
      return `<div class="sevgroup">${m.severity[sev]} · ${list.length}</div><ul class="findings">${html.join("")}</ul>`;
    })
    .join("");
}

function summaryHtml(m, summary) {
  const s = summaryParts(summary);
  if (!s) return "";
  if (s.text) return `<div class="summary">${escapeHtml(s.text)}</div>`;
  return `<div class="summary v2">${s.headline ? `<p class="headline">${escapeHtml(s.headline)}</p>` : ""}${s.points.length ? `<ol>${s.points.map((p) => `<li><span class="tag ${p.severity}">${m.severity[p.severity]}</span><span>${escapeHtml(p.text)}</span></li>`).join("")}</ol>` : ""}${s.also_check.length ? `<h5>${m.ui.alsoCheck}</h5><ul class="also">${s.also_check.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>` : ""}</div>`;
}

/** "Providers checked: GA4, Meta · Out of scope: Microsoft Clarity (5 requests skipped)". */
function scopeHtml(m, runs) {
  const chosen = [...new Set(runs.flatMap((r) => r.providers ?? []))];
  if (!chosen.length) return "";
  const totals = {};
  for (const r of runs) for (const counts of Object.values(r.skipped ?? {})) for (const [v, n] of Object.entries(counts)) totals[v] = (totals[v] ?? 0) + n;
  const skipped = skippedText(totals);
  const n = skipped.reduce((a, [, x]) => a + x, 0);
  return `<div class="scope"><span>${m.ui.providersChecked}</span>${chosen.map((k) => `<span class="ptag p-${safeKey(k)}">${escapeHtml(platformLabel(k))}</span>`).join("")}${n ? `<span>· ${escapeHtml(m.ui.outOfScope(skipped.map(([v]) => v).join(", "), n))}</span>` : ""}</div>`;
}

/** Filter rules for the platform keys in this report: picking a source hides the other rows. */
function filterCss(runs) {
  const keys = new Set(PLATFORM_ORDER);
  for (const r of runs) {
    for (const h of r.hits) keys.add(safeKey(h.platform));
    for (const c of r.network ?? []) keys.add(safeKey(c.provider ?? providerOf(c.url)?.key ?? c.vendor));
  }
  return `${[...keys].map((k) => `.filter>.f-${k}:checked~.evlist>li:not([data-p="${k}"])`).join(",")}{display:none}`;
}

const CSS = `
:root{
--bg:#F7F9FC;--surface:#FFFFFF;--surface-2:#F0F3F9;--border:#E1E6F0;--text:#0A0E1A;--muted:#5A6480;--heading:#0A0E1A;
--accent:#4F8EF7;--accent-ink:#2F6FDB;--accent-soft:#EBF1FE;--orange:#FF6D33;--orange-soft:#FFF0E9;
--danger:#C5221F;--danger-soft:#FCE8E6;--warn:#B45309;--warn-soft:#FEF3E2;--ok:#137333;--ok-soft:#E6F4EA;
--font-sans:'Google Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;--font-mono:'Google Sans Code',ui-monospace,SFMono-Regular,Menlo,monospace;
--radius-sm:2px;--radius-md:4px;--radius-lg:6px}
@media (prefers-color-scheme:dark){:root{
--bg:#0A0E1A;--surface:#141927;--surface-2:#182035;--border:#1E2640;--text:#F0F4FF;--muted:#8892AA;--heading:#FFFFFF;
--accent:#4F8EF7;--accent-ink:#7EAAF9;--accent-soft:#1A2F5C;--orange:#FF6D33;--orange-soft:#2A1A0F;
--danger:#F28B82;--danger-soft:#3A1F1D;--warn:#FDBA74;--warn-soft:#33241A;--ok:#81C995;--ok-soft:#16301F}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:400 1rem/1.6 var(--font-sans);-webkit-font-smoothing:antialiased}
a{color:var(--accent-ink);text-decoration:none}a:hover{text-decoration:underline}
main{max-width:1120px;margin:0 auto;padding:24px 16px 96px}
.muted{color:var(--muted)}
code,pre,.time,.mono{font-family:var(--font-mono)}
h1,h2,h3,h4{color:var(--heading);line-height:1.2;margin:0}
h1{font-size:1.875rem;font-weight:700;letter-spacing:-.02em}
h2{font-size:1.5rem;font-weight:700;margin:64px 0 8px}
h3{font-size:1.25rem;font-weight:600}
h5{margin:16px 0 8px;font:500 .75rem/1.4 var(--font-mono);text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.lead{color:var(--muted);margin:0 0 24px;max-width:720px}
.brand{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:16px;margin-bottom:40px;border-bottom:1px solid var(--border)}
.credit{margin:32px 0 8px;font-size:13px;text-align:center}
.logo{display:inline-flex;align-items:center;gap:.4em;font:800 18px/1 var(--font-sans);letter-spacing:-.03em;color:var(--heading)}
.bars{display:inline-flex;align-items:flex-end;gap:.12em;height:.9em}.bars i{display:block;width:.22em;border-radius:1px;background:linear-gradient(var(--accent),var(--accent-soft))}
.bars i:nth-child(1){height:45%}.bars i:nth-child(2){height:100%}.bars i:nth-child(3){height:70%;background:linear-gradient(var(--orange),var(--orange-soft))}
.product{font:500 .75rem var(--font-mono);color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
.eyebrow{font:500 .75rem var(--font-mono);color:var(--accent-ink);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px}
.generated{color:var(--muted);font-size:.875rem;margin-top:8px}
.metrics{display:grid;grid-template-columns:repeat(2,1fr);gap:1px;background:var(--border);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;margin:32px 0 24px}
.metric{background:var(--surface);padding:16px 20px}
.metric .num{display:block;font:500 26px/1.2 var(--font-mono);color:var(--heading)}
.metric .lbl{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}
.metric .lbl::before{content:"";width:8px;height:8px;border-radius:var(--radius-sm);background:var(--muted)}
.metric.broken .lbl::before{background:var(--danger)}.metric.broken .num{color:var(--danger)}
.metric.risk .lbl::before,.metric.warning .lbl::before{background:var(--warn)}.metric.ok .lbl::before{background:var(--ok)}
.summary{background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:var(--radius-lg);padding:16px 20px;font-size:1.125rem;line-height:1.5}
.tag{display:inline-block;font:500 10px/1.5 var(--font-mono);padding:3px 8px;border-radius:var(--radius-sm);text-transform:uppercase;letter-spacing:.08em;white-space:nowrap;background:var(--accent-soft);color:var(--accent-ink)}
.tag.broken{background:var(--danger-soft);color:var(--danger)}.tag.risk,.tag.warning{background:var(--warn-soft);color:var(--warn)}.tag.ok,.tag.info{background:var(--ok-soft);color:var(--ok)}
.tag.dot{width:8px;height:8px;padding:0;background:var(--danger)}
.findings{list-style:none;margin:16px 0 0;padding:0;display:grid;gap:12px}
.finding{background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--warn);border-radius:var(--radius-lg);padding:20px;transition:border-color .2s ease}
.finding.broken{border-left-color:var(--danger)}
.finding .head{display:flex;gap:12px;align-items:flex-start}
.finding .title{font-size:1.0625rem;font-weight:600;color:var(--heading);line-height:1.4}
.finding .cols{display:grid;gap:16px;margin-top:16px}
.where{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;font-size:.875rem}
.where a,.where li>b{color:var(--text)}.where a:hover{color:var(--accent-ink);text-decoration:none}
.where a::before{content:"→ ";color:var(--accent)}
.fix p{margin:0 0 8px;font-size:.9375rem}.fix b{font-weight:600}
details.evidence{margin-top:12px}
details.evidence>summary{font-size:.875rem;color:var(--muted)}
.okplan{list-style:none;margin:16px 0 0;padding:0;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface)}
.okplan li{padding:12px 16px;border-top:1px solid var(--border);font-size:.9375rem;display:flex;flex-direction:column;gap:8px}
.okplan li:first-child{border-top:0}.okplan .who{flex:none;min-width:150px;font-weight:500}
.okplan .what{display:flex;flex-direction:column;gap:8px}.chips{display:flex;flex-wrap:wrap;gap:6px}
.step .counts>.muted{font-size:.8125rem}
summary{cursor:pointer;list-style:none}summary::-webkit-details-marker{display:none}
summary:focus-visible,.tabs>input:focus-visible+label,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.chev{flex:none;color:var(--muted);transition:transform .15s ease}details[open]>summary>.chev{transform:rotate(90deg)}
.jgrid{display:grid;grid-template-columns:1fr;gap:1px;background:var(--border);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;margin:24px 0 8px}
.jcard{display:grid;grid-template-columns:1fr auto;gap:8px;background:var(--surface);padding:16px 20px;color:var(--text);transition:background .15s ease}
.jcard:hover{background:var(--surface-2);text-decoration:none}
.jname{font-weight:600}.jstats{grid-column:1/-1;display:flex;gap:16px;font-size:.875rem;color:var(--muted)}
.jstats b{font:500 1rem var(--font-mono);color:var(--heading);margin-right:2px}.jstats .bad b{color:var(--danger)}
.journey{margin-top:48px;scroll-margin-top:16px}
.journey>header{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding-bottom:12px;border-bottom:1px solid var(--border)}
.note{color:var(--muted);font-size:.875rem;margin:8px 0 0}
.steps{list-style:none;margin:16px 0 0;padding:0;position:relative}
.steps::before{content:"";position:absolute;left:13px;top:8px;bottom:8px;width:1px;background:var(--border)}
.step{position:relative;margin:0 0 8px;scroll-margin-top:16px}
.step>details>summary{display:grid;grid-template-columns:28px 1fr auto;column-gap:12px;row-gap:6px;align-items:center;padding:8px 12px 8px 0;border-radius:var(--radius-lg)}
.step>details>summary:hover .label b{color:var(--accent-ink)}
.idx{position:relative;display:grid;place-items:center;width:28px;height:28px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);font:500 .8125rem var(--font-mono);color:var(--muted)}
.step>details[open]>summary .idx{background:var(--accent);border-color:var(--accent);color:#fff}
.step .label{min-width:0;overflow-wrap:anywhere}
.step .time,.event .time{font-size:.75rem;color:var(--muted);white-space:nowrap}
.step .counts{grid-column:2/-1;display:flex;flex-wrap:wrap;gap:6px}
.step .tag.dot{position:absolute;left:22px;top:6px}
.step-body{margin:4px 0 16px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:12px}
.ptag{display:inline-flex;align-items:center;gap:6px;font:500 .75rem var(--font-mono);color:var(--muted);padding:2px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)}
.ptag b{font-weight:500;color:var(--heading)}
.ptag::before{content:"";width:8px;height:8px;border-radius:var(--radius-sm);background:var(--muted)}
.ptag.p-ga4::before{background:var(--orange)}.ptag.p-meta::before{background:var(--accent)}.ptag.p-google_ads::before{background:var(--ok)}.ptag.p-tiktok::before{background:var(--heading)}
.platform+.platform{margin-top:16px}
.platform h4{margin:0 0 8px}
.events{list-style:none;margin:0;padding:0;border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden}
.events>li+li{border-top:1px solid var(--border)}
.event>summary{display:flex;align-items:center;gap:10px;padding:10px 12px;flex-wrap:wrap}
.event>summary:hover{background:var(--surface-2)}
.event.flag-broken>summary{background:var(--danger-soft)}.event.flag-risk>summary,.event.flag-warning>summary{background:var(--warn-soft)}
.ev{font:500 .875rem var(--font-mono);color:var(--heading);overflow-wrap:anywhere}
.event .meta,.context .meta{font-size:.75rem;color:var(--muted)}
.event .time{margin-left:auto}
.tabs{display:grid;grid-template-columns:repeat(3,minmax(0,auto)) 1fr;border-top:1px solid var(--border);background:var(--surface)}
.tabs>input{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
.tabs>label{padding:8px 6px;font-size:.75rem;white-space:nowrap;min-width:0;font-weight:500;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
.tabs>label:hover{color:var(--text)}
.tabs>label .n{font:500 .6875rem var(--font-mono);background:var(--surface-2);color:var(--muted);padding:1px 4px;border-radius:var(--radius-sm)}
.tabs>input:checked+label{color:var(--accent-ink);border-bottom-color:var(--accent)}
.tabs>input:checked+label .n{background:var(--accent-soft);color:var(--accent-ink)}
.tabs>.panel{display:none;grid-column:1/-1;padding:12px;border-top:1px solid var(--border)}
.tabs>input:nth-of-type(1):checked~.panel:nth-of-type(1),.tabs>input:nth-of-type(2):checked~.panel:nth-of-type(2),.tabs>input:nth-of-type(3):checked~.panel:nth-of-type(3){display:block}
dl.kv{display:grid;grid-template-columns:1fr;gap:0 16px;margin:0;font:.8125rem/1.5 var(--font-mono)}
dl.kv dt{color:var(--muted)}dl.kv dd+dt{margin-top:6px}dl.kv dd{margin:0;overflow-wrap:anywhere;color:var(--text)}
.consent{font-size:.75rem;padding:1px 6px;border-radius:var(--radius-sm)}.consent.granted{background:var(--ok-soft);color:var(--ok)}.consent.denied{background:var(--warn-soft);color:var(--warn)}
.hint{font-size:.8125rem;color:var(--muted);margin:0 0 8px}
pre{margin:0;font:.8125rem/1.5 var(--font-mono);background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-md);padding:10px 12px;white-space:pre-wrap;overflow-wrap:anywhere}
pre.url{font-size:.75rem}
.push{display:grid;grid-template-columns:1fr;gap:4px;align-items:start;margin-bottom:8px}
.push .time{font-size:.75rem;color:var(--muted)}
.req{margin-bottom:8px}
.req-head{display:flex;flex-wrap:wrap;gap:10px;align-items:center;font-size:.8125rem;margin-bottom:6px}
.req-head .method{font:500 .6875rem var(--font-mono);padding:2px 6px;border-radius:var(--radius-sm);background:var(--accent-soft);color:var(--accent-ink)}
.req-head .status{font:500 .8125rem var(--font-mono);color:var(--ok)}
.req-head .time{font-size:.75rem;color:var(--muted)}
details.context{margin-top:16px;border-top:1px solid var(--border);padding-top:12px}
details.context>summary{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:.875rem;font-weight:500;color:var(--muted)}
@media (min-width:768px){
main{padding:40px 24px 96px}
h1{font-size:2.25rem}
.metrics{grid-template-columns:repeat(4,1fr)}
.finding .cols{grid-template-columns:minmax(220px,1fr) 2fr}
.jgrid{grid-template-columns:repeat(2,1fr)}
.okplan li{flex-direction:row;gap:16px}
.step>details>summary{grid-template-columns:28px 1fr auto auto}
.step .counts{grid-column:auto;justify-content:flex-end}
.step-body{margin-left:40px;padding:16px}
.tabs>label{padding:8px 14px;font-size:.8125rem}
.push{grid-template-columns:52px 1fr;gap:8px}.push .time{padding-top:11px}
dl.kv{grid-template-columns:minmax(110px,max-content) 1fr;gap:4px 16px}dl.kv dd+dt{margin-top:0}
}
@media (max-width:339px){.tabs>label{white-space:normal}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;animation:none!important}}
@media print{details>*{display:block}.tabs>.panel{display:block}.tabs>label{display:none}}
.small{font-size:.8125rem}
.scope{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin:0 0 24px;font-size:.875rem;color:var(--muted)}
.summary.v2{font-size:1rem;line-height:1.6;padding:20px 24px}
.summary.v2 .headline{font-size:1.125rem;font-weight:600;color:var(--heading);margin:0 0 12px;line-height:1.45}
.summary.v2 ol{margin:0;padding:0;list-style:none;display:grid;gap:8px}
.summary.v2 ol li{display:grid;grid-template-columns:64px 1fr;gap:12px;align-items:baseline}
.summary.v2 ol li .tag{justify-self:start}
.summary.v2 h5{margin-top:20px}
.summary.v2 ul.also{margin:0;padding-left:18px;display:grid;gap:6px}
.finding{padding:0}
.finding>details>summary{display:flex;align-items:center;gap:12px;padding:16px 20px}
.finding .title{flex:1;min-width:0}
.where-mini{font-size:.75rem;color:var(--muted);white-space:nowrap}
.fbody{padding:0 16px 20px}
.impact{margin:0 0 16px;padding:10px 12px;background:var(--surface-2);border-radius:var(--radius-md);font-size:.9375rem}
.fcols{display:grid;gap:24px}
.fcols p{margin:0;font-size:.9375rem}
.fix-steps{margin:0;padding-left:20px;display:grid;gap:6px;font-size:.9375rem}
.sevgroup{margin:24px 0 8px;font:500 .75rem var(--font-mono);text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.sevgroup+.findings{margin-top:0}
.step-body.v2{padding:0;overflow:visible}
.steptabs{border-top:0;border-radius:var(--radius-lg)}
.steptabs>label{font-size:.875rem;padding:12px 16px}
.steptabs>.panel{padding:12px}
.filter{display:flex;flex-wrap:wrap;gap:6px;position:relative}
.filter>input{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
.filter>label{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid var(--border);border-radius:var(--radius-md);font-size:.8125rem;cursor:pointer;color:var(--muted);background:var(--surface)}
.filter>label:hover{border-color:var(--accent)}
.filter>input:checked+label{border-color:var(--accent);color:var(--accent-ink);background:var(--accent-soft)}
.filter>input:focus-visible+label{outline:2px solid var(--accent);outline-offset:2px}
.filter .n{font:500 .6875rem var(--font-mono)}
.dot{width:8px;height:8px;border-radius:var(--radius-sm);background:var(--muted)}
.dot.p-ga4{background:var(--orange)}.dot.p-meta{background:var(--accent)}.dot.p-google_ads{background:var(--ok)}.dot.p-tiktok{background:var(--heading)}
.evlist{list-style:none;margin:0;padding:0;border:1px solid var(--border);border-radius:var(--radius-lg);flex-basis:100%}
.evlist>li+li{border-top:1px solid var(--border)}
.event-body{padding:4px 12px 16px}
.flagnote{margin:4px 0 12px;padding:8px 12px;border-radius:var(--radius-md);background:var(--warn-soft);color:var(--warn);font-size:.875rem}
.flagnote.broken{background:var(--danger-soft);color:var(--danger)}
.ebgrid{display:grid;gap:16px}
.ptable{width:100%;border-collapse:collapse;font:.8125rem/1.5 var(--font-mono)}
.ptable th,.ptable td{text-align:left;vertical-align:top;padding:5px 8px;border-bottom:1px solid var(--border)}
.ptable th{color:var(--muted);font-weight:400;white-space:nowrap;width:1%;min-width:120px}
.glossary th{min-width:170px}
.ptable td{overflow-wrap:anywhere}
.ptable tr:last-child>*{border-bottom:0}
details.ctx>summary .n,h5 .n{font:500 .6875rem var(--font-mono);background:var(--surface-2);padding:1px 5px;border-radius:var(--radius-sm)}
h5 .n{margin-left:4px}
.consents{display:flex;flex-wrap:wrap;gap:6px}
.srclist{list-style:none;margin:0;padding:0;display:grid;gap:8px;font-size:.8125rem}
.srclist li{display:grid;gap:2px}.srclist .lbl{font-size:.75rem;color:var(--muted)}
.method{font:500 .6875rem var(--font-mono);padding:2px 6px;border-radius:var(--radius-sm);background:var(--accent-soft);color:var(--accent-ink)}
.status{color:var(--ok);font-family:var(--font-mono);font-size:.8125rem}
.item{border:1px solid var(--border);border-radius:var(--radius-md);padding:12px;margin-bottom:8px;background:var(--surface)}
.item-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 12px;margin-bottom:10px}
.item-idx{font:500 .75rem var(--font-mono);color:var(--muted)}
.item-price{margin-left:auto;color:var(--heading)}
.grid4{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 16px;margin:0}
.grid4 dt{font:.6875rem var(--font-mono);color:var(--muted);overflow-wrap:anywhere}.grid4 dd{margin:0;font:.8125rem var(--font-mono);overflow-wrap:anywhere}
h6{margin:12px 0 6px;font:500 .6875rem var(--font-mono);text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.pk{margin-right:4px}
.q{position:relative;display:inline-grid;place-items:center;width:15px;height:15px;border:1px solid var(--border);border-radius:50%;font:500 10px var(--font-sans);color:var(--muted);cursor:help;vertical-align:1px}
.q:hover,.q:focus{border-color:var(--accent);color:var(--accent-ink);outline:none}
.q:hover::after,.q:focus::after{content:attr(data-tip);position:absolute;left:0;top:calc(100% + 6px);z-index:5;width:260px;padding:8px 10px;background:var(--heading);color:var(--bg);font:400 .8125rem/1.45 var(--font-sans);border-radius:var(--radius-md);white-space:normal;text-align:left}
tr.pr td{color:var(--muted)}
details.raw{margin-top:12px}details.raw>summary{display:flex;align-items:center;gap:6px;font-size:.8125rem;color:var(--muted)}details.raw pre{margin-top:8px}
.scope-note{margin:12px 0 0}
@media (min-width:768px){
.fcols{grid-template-columns:3fr 2fr}
.event-body{padding:4px 16px 16px 38px}
.steptabs>.panel{padding:16px}
.ebgrid{grid-template-columns:2fr 1fr}
.grid4{grid-template-columns:repeat(4,minmax(0,1fr))}
.summary.v2 ol li{grid-template-columns:72px 1fr}
.fbody{padding:0 20px 20px 48px}
}
@media print{.filter>label,.filter>input{display:none}}
`;

export function renderHtml({ title, generatedAt, findings, explained, runs, lang = "en", branding = true }) {
  const m = messages(lang);
  const rows = attachExplanations(findings, explained);
  const counts = summarize(rows);
  const okItems = rows.filter((f) => f.severity === "ok").map((f) => `<li><span class="who">${escapeHtml(f.where[0].journey)} <span class="muted">· ${escapeHtml(f.where[0].viewport)}</span></span><span class="what">${planMatchHtml(f.detail)}</span></li>`).join("");
  const metric = (sev) => `<div class="metric ${sev}"><span class="num">${counts[sev]}</span><span class="lbl">${m.severity[sev]}</span></div>`;

  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${CSS}${filterCss(runs)}</style></head><body><main>
<div class="brand">${branding ? `<span class="logo"><span class="bars" aria-hidden="true"><i></i><i></i><i></i></span>analitik işler</span>` : ""}<span class="product">AI Tag Debugger</span></div>
<header>
<div class="eyebrow">${m.ui.eyebrow}</div>
<h1>${escapeHtml(title)}</h1>
<div class="generated">${escapeHtml(m.ui.generated(generatedAt))}</div>
</header>
<section class="metrics" aria-label="${m.ui.findings}">${metric("broken")}${metric("risk")}${metric("warning")}${metric("ok")}</section>
${scopeHtml(m, runs)}
${summaryHtml(m, explained?.summary)}
<section><h2>${m.ui.findings}</h2>
${findingsHtml(m, runs, rows)}</section>
${okItems ? `<section><h2>${m.ui.matchingPlan}</h2><ul class="okplan">${okItems}</ul></section>` : ""}
<section><h2>${m.ui.timeline}</h2>
<p class="lead">${m.ui.timelineLeadV2}</p>
${journeysHtml(m, lang, findings, runs)}</section>
${branding ? `<footer class="credit muted">${m.ui.generatedBy} · <a href="https://analitikisler.com" rel="noopener noreferrer">analitikisler.com</a></footer>` : ""}
</main></body></html>`;
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
