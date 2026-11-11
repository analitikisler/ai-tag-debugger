// MCP server: lets the AI in a chat app (Claude, ChatGPT, Gemini, or any MCP client)
// drive the audit itself, so no separate API key is needed.
//
//   stdio (default): for apps that start local servers, e.g. Claude Desktop, Gemini CLI, Cursor.
//   --http:          Streamable HTTP, for apps that connect to a URL, e.g. ChatGPT and Gemini
//                    (expose it over HTTPS with a tunnel or host it).
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AuditSession, BROWSER_INSTALL_COMMAND } from "./browser.js";
import { navigationError, privateHostChecker } from "./guard.js";
import { collect, pageView, SYSTEM_PROMPT } from "./agent.js";
import { canonicalEvent, checkRun, groupFindings, isConsentCommand, summarize } from "./checks.js";
import { LANGUAGES, messages } from "./i18n.js";
import { loadConfig, readJson, runAudit, writeReports } from "./audit.js";
import { validatePlan } from "./schema.js";
import { readBaseline } from "./baseline.js";
import { MAX_CONCURRENCY } from "./pool.js";
import { scriptCell, scriptCspSource } from "./report.js";
import { DEFAULT_DATA_DIR, resolvePlan } from "./workspace.js";
import { discoverPlan, TOPICS } from "./discover.js";
import { createProvider } from "./providers.js";
import { savePlan } from "./plan.js";
import { changesLines, sinceLastRun } from "./changes.js";
import { decodeGcd, DEFAULT_PROVIDERS, googleConsent, isCollectionEndpoint, parseTrackingRequest, PROVIDERS as TRACKING_PROVIDERS } from "./parsers.js";
import { hitParams } from "./hit-params.js";
import { CAMPAIGN_PARAMS, campaignParamsIn, withCampaignParams } from "./campaign.js";
import { cmpFacts } from "./cmp.js";
import { resolveSessionFile } from "./login.js";
import { containerRows, containersNotRun, loadSources, unseenContainers } from "./containers.js";
import { isEventMessage, isWidgetHit, messageOutcomes, pushedEvent, siteIds, splitRun, widgetSummaries } from "./frames.js";
import { consentMatrixMarkdown, consentTable, runConsentScenarios } from "./consent.js";
import { expectEvents, filterFindings, JOURNEY_PRESETS, onlyEvents, presetFor, withPresetEvents } from "./journeys.js";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const MAX_OPEN_AUDITS = 4;
const IDLE_MS = 15 * 60 * 1000; // an audit untouched this long is closed
const MAX_BODY_BYTES = 1024 * 1024;
const MIN_TOKEN_LENGTH = 16;

// The CLI agent's working rules, said in this server's terms: its model ends a journey with a finish tool and a
// success flag, a chat app with finish_audit and completed.
const BROWSING_RULES = SYSTEM_PROMPT.split("How to work:\n")[1]
  .replaceAll("call finish with success false", "call finish_audit with completed false")
  .replaceAll("finish with success false", "call finish_audit with completed false")
  .replace("Call finish as soon as", "Call finish_audit as soon as");

const INSTRUCTIONS = `ai-tag-debugger checks a website's analytics and ad tracking (GA4, Google Ads, Meta Pixel, TikTok Pixel, Consent Mode).

Two kinds of request: a PLAN is what should be tracked, an AUDIT is what the site actually sends. If the user wants to know what to track, which events a site needs, or asks for a tracking or measurement plan, call make_plan (with topic when they only care about one kind of event: ${Object.keys(TOPICS).join(", ")}). If they want to know whether tracking works, what a site sends, or what changed, run an audit. To audit against the plan afterwards, pass against to finish_audit.

Before starting, ask the user which platforms to check and suggest the default (${DEFAULT_PROVIDERS.map((k) => TRACKING_PROVIDERS[k]).join(", ")}, plus any other platform the site turns out to use); pass their choice as providers, or leave it out for the default.

To audit a journey yourself: call start_audit with the site URL and a journey (a ready-made one: ${Object.keys(JOURNEY_PRESETS).join(", ")}, or the user's own description), then browser_action one step at a time until the journey is done (each result shows the page and the tracking hits that step sent), then finish_audit (with against to check the run against a saved plan) to get the findings and the report. Explain the findings to the user in plain language. When a question needs a hit's raw parameters (client id, gcs, gcd decoded per consent signal, session flags), call get_hit with the step number and the hit's [h] number; get_step shows an earlier step again.

While browsing:
${BROWSING_RULES}`;

/** "Checked: GA4, Meta. Out of scope: Microsoft Clarity 5 (5 requests skipped)." */
function skippedLine(run) {
  const totals = {};
  for (const counts of Object.values(run.skipped ?? {})) for (const [v, n] of Object.entries(counts)) totals[v] = (totals[v] ?? 0) + n;
  const checked = `Providers checked: ${(run.providers ?? []).map((k) => TRACKING_PROVIDERS[k] ?? k).join(", ")}.`;
  const entries = Object.entries(totals);
  return entries.length ? `${checked} Out of scope, answered locally and not checked: ${entries.map(([v, n]) => `${v} ${n}`).join(", ")}.` : checked;
}

/** Open audits, by id. One browser each. */
const audits = new Map();
/** Browsers being started for an audit that has no id yet; they count toward MAX_OPEN_AUDITS. */
let starting = 0;
/** Browsers consent_matrix and make_plan have open right now; they count toward MAX_OPEN_AUDITS too. */
let sideBrowsers = 0;
const browsersInUse = () => audits.size + starting + sideBrowsers;
const BUSY = (n) => `${n} browsers are already in use on this server (open audits, consent_matrix or make_plan). Finish an audit with finish_audit, or try again when the other call is done.`;
/**
 * The reports this process wrote, by folder name: get_report reads these and nothing else. Kept here and not in
 * buildServer, because over HTTP every request gets a server of its own.
 */
const written = new Map();

// A tool result is read by the chat app's model, which answers the user in the user's own language, so results are
// English. Only what a tool returns to be shown as it is (a table, a diff) follows that tool's language parameter.
const text = (t) => ({ content: [{ type: "text", text: t }] });
const fail = (t) => ({ content: [{ type: "text", text: t }], isError: true });

// Kept whole in the step result, wherever they appear: the end of a page address is where a UTM
// parameter or a gclid gets lost, so cutting it hides exactly what a campaign check needs.
const WHOLE_FIELDS = new Set(["page_location", "page_referrer"]);
const VALUE_LIMIT = 120;
const PUSH_LIMIT = 200;
const cut = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
const show = (v) => (typeof v === "string" ? v : JSON.stringify(v));

/** The page address fields anywhere in a pushed object, a few levels deep, as [name, value]. */
function wholeFieldsIn(value, depth = 0, out = []) {
  if (!value || typeof value !== "object" || depth > 3) return out;
  for (const [k, v] of Object.entries(value)) {
    if (WHOLE_FIELDS.has(k) && typeof v === "string") out.push([k, v]);
    else wholeFieldsIn(v, depth + 1, out);
  }
  return out;
}

const consentText = (c) => Object.entries(c).map(([k, v]) => `${k}=${v}`).join(" ");
/** The Google protocol fields of a hit, short: values for the ids and consent strings, bare names for the 1-flags. */
const protocolText = (p) => Object.entries(p).map(([k, v]) => (["_fv", "_ss", "_nsi"].includes(k) && v === "1" ? k : `${k}=${v}`)).join(" ");

/** Where an iframe's hit came from, and whether the plan checks will count it (see src/frames.js). */
function frameNote(h, ids) {
  if (!h.frame) return "";
  if (h.frame.party === "site") return ` (from an iframe on the site: ${h.frame.origin})`;
  return isWidgetHit(h, ids)
    ? ` (from an embedded widget at ${h.frame.origin}, to an account the site's tags don't use: left out of the plan checks, kept for consent and personal data)`
    : ` (from a third-party iframe at ${h.frame.origin}, to the site's own account)`;
}

function describeHit(h, steps, index, ids = new Set()) {
  const entries = Object.entries(h.params ?? {}).filter(([k]) => !["v", "tid", "gtm", "_p", "cid", "sid", "_s", "sct", "seg", "dl", "dr", "dt", "ul", "sr", "_et", "en"].includes(k));
  const params = [
    ...entries.filter(([k]) => !WHOLE_FIELDS.has(k)).slice(0, 12).map(([k, v]) => cut(`${k}=${show(v)}`, VALUE_LIMIT)),
    ...entries.filter(([k]) => WHOLE_FIELDS.has(k)).map(([k, v]) => `${k}=${show(v)}`),
  ].join(", ");
  const late = h.late ? ` (arrived ${(h.late.ms / 1000).toFixed(1)} s late, after the step that loaded its page: "${steps[h.step]?.label ?? `step ${h.step}`}")` : "";
  return `- [h${index}] ${h.platform} ${h.name}${h.consent ? ` [consent ${consentText(h.consent)}]` : ""}${h.protocol ? ` {${protocolText(h.protocol)}}` : ""}${params ? `: ${params}` : ""}${late}${frameNote(h, ids)}`;
}

/** A consent command in full, as key=value; any other push as JSON, cut, with its page address fields whole. */
function describePush(p) {
  // Pushes to a dataLayer of another name (a container's l=) say which.
  const layer = `${p.frame ? `[iframe ${p.frame.origin}] ` : ""}${p.layer ? `[${p.layer}] ` : ""}`;
  if (isConsentCommand(p, "default") || isConsentCommand(p, "update")) {
    const signals = p.value[2] && typeof p.value[2] === "object" ? Object.entries(p.value[2]).map(([k, v]) => `${k}=${show(v)}`).join(" ") : show(p.value[2]);
    return `- ${layer}consent ${p.value[1]}: ${signals}`;
  }
  const json = JSON.stringify(p.value) ?? String(p.value);
  const whole = json.length > PUSH_LIMIT ? wholeFieldsIn(p.value) : [];
  return `- ${layer}${cut(json, PUSH_LIMIT)}${whole.length ? ` (${whole.map(([k, v]) => `${k}=${v}`).join(", ")})` : ""}`;
}

/** A call to a tracking endpoint that carries no event the tool reads, such as a Consent Mode ping, with its consent. */
function describeCall(c) {
  let u;
  try {
    u = new URL(c.url);
  } catch {
    return `- ${c.vendor ?? c.provider} ${cut(c.url, VALUE_LIMIT)}`;
  }
  const consent = googleConsent(u.searchParams);
  // gclid is the landing click id the ping reports (0 when ads_data_redaction blanks it), gclaw the one _gcl_aw holds.
  const signals = ["gcs", "gcd", "dma", "npa", "gclid", "gclaw"].filter((k) => u.searchParams.has(k))
    .map((k) => `${k}=${u.searchParams.get(k)}${k === "gclid" && u.searchParams.get(k) === "0" ? " (redacted)" : ""}`).join(" ");
  return `- ${c.vendor ?? c.provider}: ${u.hostname}${u.pathname}${signals ? ` [${signals}]` : ""}${consent ? ` [consent ${consentText(consent)}]` : ""}`;
}

const NAMES_SHOWN = 15;
/** The cookies a step added, changed or removed, by name, and what the analytics and ad cookies say when that changed. */
function cookieLines(session, step) {
  const lines = [];
  const changes = (session.cookieChanges ?? []).filter((c) => c.step === step);
  const names = (kind) => [...new Set(changes.filter((c) => c.change === kind).map((c) => c.name))];
  const part = (label, list) => (list.length ? `${label} ${list.slice(0, NAMES_SHOWN).join(", ")}${list.length > NAMES_SHOWN ? ` and ${list.length - NAMES_SHOWN} more` : ""}` : null);
  const parts = [part("added", names("added")), part("changed", names("changed")), part("removed", names("removed"))].filter(Boolean);
  if (parts.length) lines.push(`Cookies (names only): ${parts.join("; ")}`);
  const id = session.steps[step]?.identity;
  const before = session.steps.slice(0, step).map((st) => st.identity).filter(Boolean).at(-1);
  if (!id || (!parts.length && JSON.stringify(id) === JSON.stringify(before))) return lines;
  const facts = [];
  if (id.ga_client_id) {
    const prev = before?.ga_client_id;
    const since = session.steps.findIndex((st) => st.identity?.ga_client_id === id.ga_client_id);
    facts.push(`GA4 client id (_ga) ${id.ga_client_id}, ${!prev ? "new at this step" : prev === id.ga_client_id ? `the same since step ${since}` : `changed from ${prev}`}`);
  }
  if (id.gcl_aw) facts.push(id.gcl_aw === "landing" ? "_gcl_aw holds the landing gclid" : "_gcl_aw holds a gclid other than the landing one");
  if (id.fbc) facts.push(id.fbc === "landing" ? "_fbc holds the landing fbclid" : "_fbc holds an fbclid other than the landing one");
  if (facts.length) lines.push(`${facts.join("; ")}.`);
  return lines;
}

/** One container load in words: its ID, what inserted it, its dataLayer and where it came from. */
function describeLoad(l) {
  const c = messages("en").ui.containers;
  const script = scriptCell(c, l);
  const extra = [script,l.layer !== "dataLayer" && `dataLayer ${l.layer}`, l.served === "site" && `served from ${l.host}`, l.environment && c.environment(l.environment), l.frame && c.iframe(l.frame.origin, l.frame.party)].filter(Boolean);
  return `  ${l.id} (${c.script[l.script]}): ${c.kinds[l.kind](l.by)}${extra.length ? `; ${extra.join(", ")}` : ""}`;
}

export function stepCapture(audit, step) {
  const { session } = audit;
  const hits = session.hits.filter((h) => h.step === step);
  const ids = siteIds(session);
  const pushes = session.dataLayerLog.filter((e) => e.step === step);
  // Hits that arrived during this step for a page an earlier step loaded are listed there, and noted here.
  const lateHere = session.hits.filter((h) => h.late?.during === step);
  const pings = session.network.filter((c) => c.step === step && isCollectionEndpoint(c.url) && !parseTrackingRequest(c.url, c.postData ?? null));
  const problem = session.steps[step]?.pageProblem;
  const lines = [
    ...(problem?.kind === "challenge" ? [`WARNING: the page is a bot challenge from ${problem.vendor}, not the site. Nothing captured here says anything about the site's tracking; run the audit from a network the site trusts.`] : []),
    ...(problem?.kind === "crash" ? [`WARNING: the page crashed in the browser (the ${problem.vendor} error screen)${problem.refusedScripts ? `; ${problem.refusedScripts} of its own scripts came back as HTML pages, which bot protection or a mismatched deployment does` : ""}. Its tags may never have run.`] : []),
    `Step ${step}: "${session.steps[step]?.label ?? ""}". Read a hit's full parameters with get_hit (audit_id, step ${step}, its [h] number).`,
    `Tracking hits sent by this step: ${hits.length}`,
    ...hits.map((h, i) => describeHit(h, session.steps, i, ids)),
  ];
  if (lateHere.length) lines.push(`Arrived during this step but belong to the step that loaded their page: ${lateHere.map((h) => `${h.platform} ${h.name} (step "${session.steps[h.step]?.label ?? h.step}")`).join(", ")}`);
  if (pings.length) lines.push("Other calls to analytics and ad endpoints, not read as events (Consent Mode pings, resends, remarketing):", ...pings.map(describeCall));
  if (pushes.length) lines.push("dataLayer pushes:", ...pushes.map(describePush));
  const loads = loadSources({ containerLoads: (session.containerLoads ?? []).filter((l) => l.step === step), containerScripts: session.containerScripts, dataLayerLog: session.dataLayerLog });
  if (loads.length) lines.push("Google containers loaded:", ...loads.map(describeLoad));
  const posted = (session.frameMessages ?? []).filter((x) => x.step === step);
  if (posted.length) lines.push("Messages iframes posted to the page (name and field names only):", ...posted.map((x) => `  ${x.name} from ${x.origin} (${x.party === "site" ? "same site" : "third party"})${x.keys?.length ? `, fields ${x.keys.join(", ")}` : ""}${isEventMessage(x) ? "" : "; housekeeping, not checked"}`));
  lines.push(...cookieLines(session, step));
  const tag = session.steps[step]?.tagConsent;
  if (tag) {
    const state = (e) => (e.default && e.update ? `${e.default} → ${e.update}` : e.default ? `${e.default} (default)` : e.update ? `${e.update} (update)` : "not set");
    const flags = [tag.usedDefault ? "default applied" : "no default applied", tag.usedUpdate && "update applied", tag.wasSetLate && "default set late", tag.waitPeriodTimedOut && "wait_for_update ran out"].filter(Boolean);
    lines.push(`Google tag consent state (google_tag_data.ics), changed at this step: ${Object.entries(tag.entries).map(([k, e]) => `${k} ${state(e)}`).join(", ")}; ${flags.join(", ")}.`);
  }
  // The consent platform once, on the step it was first seen at.
  const platform = session.cmp?.step === step ? cmpFacts(messages("en"), [{ cmp: session.cmp, network: session.network }]) : null;
  if (platform) lines.push(`Consent platform: ${platform.vendor}. ${platform.facts.join(" ")}`);
  return lines.join("\n");
}

const MAX_PARAM_VALUE = 2000;
/** What a gcd letter says about one signal, in words. */
function gcdWords({ letter, default: d, update: u, known }) {
  if (!known) return `${letter}: a letter this tool doesn't know`;
  if (!d && !u) return `${letter}: consent mode not used`;
  return `${letter}: ${d ? `${d} by default` : "no default"}, ${u ? `${u} by update` : "no update"}`;
}

/** One hit in full: where it was sent, its consent and every parameter its request carried. */
export function hitDetail(audit, step, index) {
  const { session } = audit;
  const hits = session.hits.filter((h) => h.step === step);
  const h = hits[index];
  if (!h) return null;
  const { call, batch, event, context } = hitParams(session, h);
  const label = session.steps[step]?.label ?? "";
  const rows = (entries) => entries.map(([k, v]) => `  ${k} = ${cut(String(v), MAX_PARAM_VALUE)}`);
  const lines = [`[h${index}] ${h.platform} ${h.name}, step ${step} "${label}"${h.late ? `, sent ${(h.late.ms / 1000).toFixed(1)} s late during step ${h.late.during} "${session.steps[h.late.during]?.label ?? ""}"` : ""}`];
  lines.push(`Request: ${call ? `${call.method ?? ""} ${call.url}`.trim() : h.url}${call?.blocked ? " (answered locally, never reached the platform)" : ""}`);
  if (h.consent) lines.push(`Consent: ${consentText(h.consent)}`);
  const gcd = decodeGcd(h.protocol?.gcd);
  if (gcd) lines.push(`gcd ${h.protocol.gcd}: ${Object.entries(gcd).map(([signal, state]) => `${signal} ${gcdWords(state)}`).join("; ")}`);
  if (h.userData?.fields?.length) lines.push(`User data redacted from this hit: ${h.userData.fields.join(", ")}`);
  lines.push(`Event parameters${batch ? ` (event ${batch[0]} of ${batch[1]} in one request)` : ""}:`, ...(event.length ? rows(event) : ["  (none)"]));
  if (context.length) lines.push("Other parameters (ids, page, device, consent):", ...rows(context));
  return lines.join("\n");
}

/** A container load or row as compact JSON: the ID, its source, and the dataLayer, host and environment when they are not the usual ones. */
function containerJson(l) {
  return {
    id: l.id, source: l.kind, ...(l.by ? { by: l.by } : {}),
    ...(l.layer && l.layer !== "dataLayer" ? { data_layer: l.layer } : {}),
    ...(l.served === "site" ? { served_from: l.host } : {}),
    ...(l.environment ? { gtm_environment: l.environment } : {}),
    ...(l.frame ? { iframe: { origin: l.frame.origin, party: l.frame.party } } : {}),
    ...(l.version ? { version: l.version } : {}),
    ...(l.bytes ? { size_bytes: l.bytes } : {}),
    ...(l.transferBytes ? { transfer_bytes: l.transferBytes } : {}),
    ...(l.ms != null ? { load_ms: l.ms } : {}),
    ...(l.failed ? { failed: l.failed } : {}),
    ...(typeof l.ran === "boolean" ? { ran: l.ran } : {}),
    ...(l.pages ? { pages: l.pages } : {}),
  };
}

/** The Google containers of the runs and how each reached the page, as lines for a tool result; [] when none loaded. */
function containerLines(runs) {
  const rows = containerRows(runs);
  if (!rows.length) return [];
  const c = messages("en").ui.containers;
  return [
    "Google containers (how each reached the page):",
    ...rows.map((r) => {
      const extra = [scriptCell(c, r), r.layer && r.layer !== "dataLayer" && `dataLayer ${r.layer}`, r.served === "site" && `served from ${r.host}`, r.environment && c.environment(r.environment), r.frame && c.iframe(r.frame.origin, r.frame.party), `${r.pages.length} ${r.pages.length === 1 ? "page" : "pages"}`].filter(Boolean);
      return `  ${r.id} (${c.script[r.script]}): ${c.kinds[r.kind](r.by)}; ${extra.join(", ")}`;
    }),
  ];
}

/** The embedded widgets of the runs as summaries (see widgetSummaries), compared by canonical event name. */
const widgetsIn = (runs) => widgetSummaries(runs, (a, b) => canonicalEvent(a) === canonicalEvent(b));

/** The events iframes posted to the page, with what the page did next, as lines for a tool result; [] when none. */
export function messageLines(runs) {
  const t = messages("en").ui.messages;
  const list = runs.flatMap((r) => messageOutcomes(r, (a, b) => canonicalEvent(a) === canonicalEvent(b)));
  if (!list.length) return [];
  return [
    "Messages from iframes (events posted to the page with postMessage, and what the page did next):",
    ...list.map((x) => `  ${x.name} from ${x.origin} (${x.party === "site" ? "same site" : "third party"}), step ${x.step}: ${x.outcome === "nothing" ? t.nothing : t[x.outcome](x.relay.kind, x.relay.name, x.relay.ms)}`),
  ];
}

/** The embedded widgets as lines for a tool result; [] when there were none. */
export function widgetLines(runs) {
  const widgets = widgetsIn(runs);
  if (!widgets.length) return [];
  const w = messages("en").ui.widgets;
  const hits = (list) => list.map((e) => w.hits(e.platform, e.id, e.events)).join("; ") || w.none;
  return [
    "Embedded widgets (third-party iframes; their own dataLayer is invisible to the page's tags):",
    ...widgets.map((x) => [
      `  ${x.origin}, embedded in ${x.parents.join(", ") || "?"}${x.containers.length ? `; containers ${x.containers.map((c) => c.id).join(", ")}` : ""}`,
      `    own tracking: ${hits(x.own)}`,
      `    to the site's accounts: ${hits(x.shared)}`,
      `    dataLayer: ${w.pushes(x.pushes.total, x.pushes.consent)}${x.pushes.events.length ? `: ${x.pushes.events.map((e) => w.event(e.name, e.count)).join(", ")}` : ""}`,
      ...(x.unshared.length ? [`    not sent to the site's accounts: ${x.unshared.join(", ")}`] : []),
    ].join("\n")),
  ];
}

/**
 * One entry per step, short enough to return with finish_audit and read without the report: what the step did, the
 * hits it sent with their consent, its consent commands and other tracking calls, the Google tag's consent when it
 * changed, and the cookies and ids that changed.
 */
export function timelineOf(run) {
  let lastIds = null;
  return (run.steps ?? []).map((st) => {
    const hits = (run.hits ?? []).filter((h) => h.step === st.index);
    const commands = (run.dataLayerLog ?? []).filter((e) => e.step === st.index && (isConsentCommand(e, "default") || isConsentCommand(e, "update")));
    const others = (run.network ?? []).filter((c) => c.step === st.index && isCollectionEndpoint(c.url) && !parseTrackingRequest(c.url, c.postData ?? null));
    const changes = (run.cookieChanges ?? []).filter((c) => c.step === st.index);
    const names = (kind) => [...new Set(changes.filter((c) => c.change === kind).map((c) => c.name))];
    const entry = { step: st.index, action: st.label, ...(st.pagePath ? { page: st.pagePath } : {}) };
    if (st.error) entry.error = st.error;
    if (hits.length) entry.hits = hits.map((h) => ({ platform: h.platform, event: h.name, ...(h.consent ? { consent: h.consent } : {}), ...(h.late ? { late_ms: h.late.ms } : {}), ...(h.frame ? { iframe: h.frame.origin } : {}) }));
    // An embedded widget's own hits, kept apart from the site's (see src/frames.js).
    const widget = (run.widgetHits ?? []).filter((h) => h.step === st.index);
    const posted = messageOutcomes({ ...run, frameMessages: (run.frameMessages ?? []).filter((x) => x.step === st.index) }, (a, b) => canonicalEvent(a) === canonicalEvent(b));
    if (posted.length) entry.iframe_messages = posted.map((x) => ({ from: x.origin, name: x.name, outcome: x.outcome, ...(x.relay ? { relay: x.relay } : {}) }));
    const widgetPushes = (run.widgetDataLayerLog ?? []).filter((e) => e.step === st.index && e.frame && pushedEvent(e.value));
    if (widgetPushes.length) entry.widget_pushes = widgetPushes.map((e) => ({ widget: e.frame.origin, event: pushedEvent(e.value) }));
    if (widget.length) entry.widget_hits = widget.map((h) => ({ widget: h.frame.origin, platform: h.platform, event: h.name, ...(h.id ? { id: h.id } : {}), ...(h.consent ? { consent: h.consent } : {}) }));
    if (others.length) entry.other_tracking_calls = others.length;
    if (commands.length) entry.consent_commands = commands.map((e) => ({ [e.value[1]]: e.value[2] }));
    if (st.tagConsent) entry.tag_consent = Object.fromEntries(Object.entries(st.tagConsent.entries).map(([k, e]) => [k, e.update ?? e.default ?? null]));
    const cookies = Object.fromEntries(["added", "changed", "removed"].map((k) => [k, names(k)]).filter(([, list]) => list.length));
    if (Object.keys(cookies).length) entry.cookies = cookies;
    const loads = loadSources({ containerLoads: (run.containerLoads ?? []).filter((l) => l.step === st.index), containerScripts: run.containerScripts, dataLayerLog: run.dataLayerLog });
    if (loads.length) entry.containers = loads.map(containerJson);
    if (st.identity && JSON.stringify(st.identity) !== JSON.stringify(lastIds)) entry.ids = st.identity;
    if (st.identity) lastIds = st.identity;
    return entry;
  });
}

const campaignSchema = () => z.union([z.boolean(), z.object(Object.fromEntries(CAMPAIGN_PARAMS.map((k) => [k, z.string().min(1).optional()]))).strict()]).optional();
const CAMPAIGN_DOC = `Default true: test values (utm_source=aitd, gclid=aitd-gclid, fbclid=aitd-fbclid...) unless the site address already carries campaign parameters. false opens the site as given. Or your own values, e.g. {"utm_source": "newsletter", "utm_campaign": "autumn", "gclid": "test123"}; allowed keys: ${CAMPAIGN_PARAMS.join(", ")}.`;

const LIVE_NOTE = "LIVE: tracking requests go to the real analytics and ad accounts, so this test traffic shows in their reports (GA4 Realtime and DebugView, Meta Events Manager).";

const OFFSCREEN_SHOWN = 40;
const UNCHANGED_TEXT = "(unchanged since the last page view)";
const UNCHANGED_ELEMENTS = "(unchanged since the last page view: the same refs still apply)";
const DETAIL_DOC = "compact (default for browser_action): up to 40 elements above or below the screen, and the page text or element list replaced by a note when unchanged since the last view. full: every element and the whole text again.";

/**
 * The page view for the chat app. Long sessions lose their oldest results from the context, so a compact view
 * leaves out what the last one already showed: the same text, the same elements (and so the same refs).
 */
async function viewFor(audit, error, detail = "compact") {
  const full = detail === "full";
  const snap = await audit.session.snapshot({ offscreenLimit: full ? null : OFFSCREEN_SHOWN });
  const last = audit.lastView;
  audit.lastView = { url: snap.url, text: snap.text, elements: snap.elements };
  if (full || !last || last.url !== snap.url) return pageView(snap, error);
  return pageView({ ...snap, text: snap.text === last.text ? UNCHANGED_TEXT : snap.text, elements: snap.elements === last.elements ? UNCHANGED_ELEMENTS : snap.elements }, error);
}

function getAudit(id) {
  const audit = audits.get(id);
  if (!audit) throw new Error(`No open audit "${id}". Start one with start_audit. Audits close after ${IDLE_MS / 60000} minutes without activity.`);
  audit.lastUsed = Date.now();
  return audit;
}

/**
 * Runs fn once everything already asked of this audit is done. A chat app can send two tool calls side by side;
 * two actions in one browser at once would share a step, and each would report the other's page and hits.
 */
function inTurn(audit, fn) {
  const run = (audit.turn ?? Promise.resolve()).then(fn);
  audit.turn = run.catch(() => {});
  return run;
}

/** Closes audits nobody has touched for a while, so abandoned ones don't hold browsers and slots. */
export async function closeIdleAudits(now = Date.now(), idleMs = IDLE_MS) {
  const idle = [...audits.values()].filter((a) => now - a.lastUsed > idleMs).map((a) => a.id);
  await Promise.all(idle.map(closeAudit));
  return idle;
}
setInterval(() => closeIdleAudits().catch(() => {}), 60 * 1000).unref();

async function closeAudit(id) {
  const audit = audits.get(id);
  audits.delete(id);
  await audit?.session.close().catch(() => {});
}

/** The plan can be given inline (JSON text) or, for local servers, as a file path. */
async function readPlan(plan, allowFiles) {
  if (!plan) return { events: [] };
  const trimmed = plan.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  if (!allowFiles) throw new Error("Over HTTP, pass the measurement plan as JSON text, not a file path.");
  return readJson(trimmed);
}

/** finish_audit refuses a bad plan without closing the audit, so the captured run is not lost. */
const STILL_OPEN = "The audit is still open: call finish_audit again with a corrected plan (or none).";

const AGAINST_DOC = "A saved plan to check against: latest (or last), first, a plan ID such as 2026-10-16_0627, or on a local server a path to a plan file or folder. Plans are the ones saved by `aitd plan --site <url>`.";

/** Finds the saved plan named by `against`. Over HTTP only latest, first and plan IDs are allowed, never paths. */
async function loadAgainst(ref, site, opts) {
  if (!opts.allowFiles && !/^(latest|last|first|\d{4}-\d{2}-\d{2}_\d{4}(\d{2})?)$/.test(ref.trim())) {
    throw new Error("Over HTTP, against takes latest, first or a plan ID, not a path.");
  }
  const found = await resolvePlan(ref, { dataDir: opts.dataDir ?? DEFAULT_DATA_DIR, site });
  const plan = await readJson(found.file);
  if (!Array.isArray(plan?.events)) throw new Error(`${found.file} is not a plan: it needs an "events" list.`);
  // The same schema check the CLI gives a plan named with --against; the config's own plan was checked by loadConfig.
  validatePlan(plan, { file: found.file });
  return { found, plan };
}

/**
 * @param {{ allowFiles: boolean, blockPrivate?: boolean, reportsDir: string, reportsUrl?: string, dataDir?: string }} opts
 *   allowFiles: local (stdio) servers may read config and plan files; HTTP servers may not.
 *   blockPrivate: the browser refuses loopback, private and link-local addresses (HTTP servers, by default).
 *   dataDir: where saved plans live (default ./aitd), used by `against`.
 *   reportsUrl: where an HTTP server serves finished reports, if it knows its public URL.
 *   provider: an AI provider for make_plan (default: the one configured on this computer; tests pass a fake).
 */
export function buildServer(opts) {
  const server = new McpServer({ name: "ai-tag-debugger", version: VERSION }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "start_audit",
    {
      title: "Start a tracking audit",
      description:
        "Opens a fresh browser on a website and starts recording every analytics and ad tracking request (GA4, Google Ads, Meta, TikTok) and dataLayer push. Tracking requests are answered locally, so no test data reaches the real analytics or ad accounts. Returns an audit_id and the first page view. Then use browser_action to walk through one journey (for example product, cart, checkout) and finish_audit to check the results.",
      inputSchema: {
        site: z.string().describe("The page to open, e.g. https://staging.example.com/"),
        journey: z
          .string()
          .optional()
          .describe(`A ready-made journey (${Object.keys(JOURNEY_PRESETS).join(", ")}), which comes with its goal and the events to expect, or a short name for your own journey, e.g. newsletter.`),
        viewport: z.enum(["desktop", "mobile"]).optional().describe("Default desktop."),
        allowed_hosts: z
          .array(z.string())
          .optional()
          .describe("Other hosts the journey may visit, e.g. a hosted checkout like checkout.example-payments.com. The browser stays on the site's own host and subdomains otherwise."),
        providers: z
          .array(z.enum(Object.keys(TRACKING_PROVIDERS)))
          .optional()
          .describe(`Tracking providers to check. Default ${DEFAULT_PROVIDERS.join(", ")} plus any other known platform the site sends to. When given, requests to the others are still answered locally, but they are only counted, not shown or checked.`),
        campaign: campaignSchema().describe(`Open the first page the way an ad click does, so finish_audit checks that the campaign parameters survive redirects and reach the hits. ${CAMPAIGN_DOC}`),
        connect: z
          .string()
          .optional()
          .describe("Run the audit in a fresh window of the user's own Chrome instead of the tool's browser: the debugging address Chrome was started with, e.g. http://127.0.0.1:9222 (Chrome started with --remote-debugging-port=9222 and its own --user-data-dir). Only a Chrome on the computer running a local server. Use it only when the user asks to see the audit in their Chrome."),
        session: z
          .enum(["saved"])
          .optional()
          .describe("Start logged in, from the session saved for this site with `aitd login --site <url>` on the computer running this server. For sites whose login needs a person (a CAPTCHA or a code). Local servers only."),
        live: z.boolean().optional().describe("Default false: tracking requests are answered locally and never reach the site's accounts. true lets them through to the real analytics and ad accounts, to check them in GA4 Realtime or DebugView, Meta Events Manager or Tag Assistant: the test traffic then shows in the site's reports. Only when the user asks for it."),
      },
    },
    async ({ site, journey, viewport, allowed_hosts, providers, campaign = true, live = false, session: savedSession, connect }) => {
      let url;
      try {
        url = new URL(site);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      } catch {
        return fail("site must be an http or https URL.");
      }
      if (opts.blockPrivate) {
        const refused = await navigationError(url.href, { isPrivate: privateHostChecker() });
        if (refused) return fail(`${refused} Over HTTP, audits are limited to public websites.`);
      }
      await closeIdleAudits();
      if (browsersInUse() >= MAX_OPEN_AUDITS) return fail(sideBrowsers ? BUSY(browsersInUse()) : `${audits.size + starting} audits are already open. Finish one with finish_audit first.`);
      let session;
      try {
        if (live && !opts.allowLive) return fail("Live audits are off on this server: it was started without --allow-live. Leave live out to audit with tracking requests answered locally.");
        // A saved login lives on the computer running the server; over HTTP, a chat elsewhere must not use it.
        if (savedSession && !opts.allowFiles) return fail("A saved login session can only be used on a local server. Leave session out, or log in with the test account during the journey.");
        // A Chrome on the server's computer belongs to whoever runs it; over HTTP, a chat elsewhere must not drive it.
        if (connect && !opts.allowFiles) return fail("Connecting to your own Chrome works only on a local server. Leave connect out to use the tool's browser.");
        const storageState = savedSession ? resolveSessionFile("saved", { site: url.href, dataDir: opts.dataDir ?? DEFAULT_DATA_DIR }) : undefined;
        session = new AuditSession({ viewport: viewport ?? "desktop", site: url.href, allowedHosts: allowed_hosts, providers, blockPrivate: opts.blockPrivate, blockHits: !live, storageState, connect });
      } catch (err) {
        return fail(err.message);
      }
      const id = randomUUID().slice(0, 8);
      const preset = presetFor(journey);
      const name = preset?.id ?? ((journey || "journey").toLowerCase().replace(/[^\w-]+/g, "-").slice(0, 40) || "journey");
      const audit = { id, session, site: url.href, journey: name, preset, viewport: viewport ?? "desktop", lastUsed: Date.now() };
      // The slot is taken before the browser starts, so calls made side by side can't open more than the limit.
      starting += 1;
      try {
        await session.start();
        audits.set(id, audit);
      } catch (err) {
        await session.close().catch(() => {});
        return fail(connect ? `Could not connect to Chrome: ${err.message}` : `Could not start the browser: ${err.message}. If Chromium is missing, run: ${BROWSER_INSTALL_COMMAND}`);
      } finally {
        starting -= 1;
      }
      const start = campaign === false ? url.href : withCampaignParams(url.href, typeof campaign === "object" ? campaign : null);
      const error = await session.act({ action: "goto", url: start, reason: `Open ${start}` });
      const page = await viewFor(audit, error);
      const goal = preset ? `Journey goal: ${preset.goal}\nEvents expected on the way: ${preset.events.map((e) => `${e.platform} ${e.name}`).join(", ")}\n\n` : "";
      const sent = campaignParamsIn(start);
      const opened = Object.keys(sent).length ? `Opened like an ad click with ${Object.entries(sent).map(([k, v]) => `${k}=${v}`).join(", ")}; finish_audit checks that they survive redirects and reach the hits.\n` : "";
      const liveLine = live ? `${LIVE_NOTE}\n` : "";
      const accountLine = `${session.login ? "A test account is set up: to log in, fill {{login.email}} (or {{login.username}}) and {{login.password}}, written exactly like that; the browser types the real values." : "No test account is set up on this computer (AITD_LOGIN_EMAIL and AITD_LOGIN_PASSWORD), so a journey that needs a login stops at it."}${savedSession ? " The browser started from the saved login session." : ""}\n`;
      return text(`audit_id: ${id}\n${liveLine}${accountLine}${opened}${goal}\n${page}\n\n${stepCapture(audit, session.currentStep)}`);
    },
  );

  server.registerTool(
    "browser_action",
    {
      title: "Act in the audit browser",
      description:
        "Performs one action in the audit's browser and returns the updated page plus the tracking hits that action sent. Actions: goto (url), click (ref or text), fill (ref or text, value), select (ref or text, value), scroll (value = down or up), wait (value = milliseconds, 1000 when left out, at most 10000). Refs come from the latest page view, which lists on-screen elements first; if an element has no ref, scroll or pass its visible text in text. If a cookie banner appears, accept it and set accepts_consent to true on that click (or, on a journey that is about declining cookies, reject it and set rejects_consent to true). Use test data in forms and never enter real payment details.",
      inputSchema: {
        audit_id: z.string(),
        action: z.enum(["goto", "click", "fill", "select", "scroll", "wait"]),
        ref: z.number().int().optional().describe("Element ref for click, fill and select."),
        text: z.string().optional().describe("Instead of ref: the element's visible text or label, e.g. \"Book now\"."),
        value: z.string().optional().describe("Text to type, option to select, or milliseconds to wait."),
        url: z.string().optional().describe("Destination for goto, absolute or relative to the current page."),
        reason: z.string().describe("Short description of the step, e.g. 'Add the first product to the cart'. Shown in the report."),
        accepts_consent: z.boolean().optional().describe("True only when this click accepts the cookie or consent banner."),
        rejects_consent: z.boolean().optional().describe("True only when this click rejects or declines all cookies on the consent banner."),
        detail: z.enum(["compact", "full"]).optional().describe(DETAIL_DOC),
      },
    },
    async (input) => {
      const audit = getAudit(input.audit_id);
      if (["click", "fill", "select"].includes(input.action) && !Number.isInteger(input.ref) && !input.text?.trim()) return fail(`${input.action} needs a ref or text.`);
      if (input.action === "goto" && !input.url) return fail("goto needs a url.");
      return inTurn(audit, async () => {
        const error = await audit.session.act(input);
        const page = await viewFor(audit, error, input.detail);
        return text(`${page}\n\n${stepCapture(audit, audit.session.currentStep)}`);
      });
    },
  );

  server.registerTool(
    "get_page",
    {
      title: "Show the current page",
      description: "Returns the current page view of an open audit without doing anything. By default in full: every element and the whole page text.",
      inputSchema: { audit_id: z.string(), detail: z.enum(["compact", "full"]).optional().describe(`Default full here. ${DETAIL_DOC}`) },
      annotations: { readOnlyHint: true },
    },
    async ({ audit_id, detail = "full" }) => text(await viewFor(getAudit(audit_id), null, detail)),
  );

  server.registerTool(
    "get_hit",
    {
      title: "Show one tracking hit in full",
      description:
        "Returns every parameter one tracking hit's request carried (client and session ids, gcs and gcd with gcd decoded per consent signal, page, device and event parameters), where it was sent, and its consent. Step results list each hit with an [h] number; pass that and the step number.",
      inputSchema: {
        audit_id: z.string(),
        step: z.number().int().min(0).describe("The step number from the step result's first line."),
        hit: z.number().int().min(0).describe("The hit's [h] number in that step."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ audit_id, step, hit }) => {
      const audit = getAudit(audit_id);
      const detail = hitDetail(audit, step, hit);
      if (detail !== null) return text(detail);
      const count = audit.session.hits.filter((h) => h.step === step).length;
      return fail(step >= audit.session.steps.length ? `There is no step ${step}; the last is ${audit.session.steps.length - 1}.` : `Step ${step} has ${count} hit${count === 1 ? "" : "s"}${count ? ` (h0 to h${count - 1})` : ""}.`);
    },
  );

  server.registerTool(
    "get_step",
    {
      title: "Show an earlier step's capture again",
      description:
        "Returns what an earlier step captured, as browser_action showed it: its hits, other tracking calls and dataLayer pushes. Use it to see a step again, for example after a hit that arrived late was added to the step that loaded its page.",
      inputSchema: { audit_id: z.string(), step: z.number().int().min(0).describe("The step number from the step result's first line.") },
      annotations: { readOnlyHint: true },
    },
    async ({ audit_id, step }) => {
      const audit = getAudit(audit_id);
      if (step >= audit.session.steps.length) return fail(`There is no step ${step}; the last is ${audit.session.steps.length - 1}.`);
      return text(stepCapture(audit, step));
    },
  );

  server.registerTool(
    "get_containers",
    {
      title: "List the Google containers loaded so far",
      description:
        "Returns every GTM container (gtm.js) and Google tag (gtag/js) this audit's pages loaded so far, and how each reached the page: a script tag in the HTML, the inline snippet, another script (named by its address, such as a consent platform), a Custom HTML tag or a Google tag in another GTM container, a container loading another itself (a Zone or a tag template), a gtag('config') command, an event's send_to with no config, or a destination of the Google tag. Also the dataLayer each reads, whether it was served from the site's own domain, the GTM environment when one is named, and the step it loaded at. Duplicates, GTM environments and split dataLayers are flagged by finish_audit.",
      inputSchema: { audit_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ audit_id }) => {
      const { session } = getAudit(audit_id);
      const run = {
        containerLoads: session.containerLoads ?? [], containerScripts: session.containerScripts, dataLayerLog: session.dataLayerLog,
        containerPreloads: [...(session.containerPreloads?.values() ?? [])],
        containersRunning: [...(session.containersRunning ?? [])].map(([id, step]) => ({ id, step })),
      };
      const loads = loadSources(run);
      const unseen = unseenContainers(run);
      const notRun = containersNotRun(run);
      if (!loads.length && !unseen.length) return text("No GTM container or Google tag script has loaded on this audit's pages yet.");
      const c = messages("en").ui.containers;
      const lines = loads.map((l) => `Step ${l.step} ("${session.steps[l.step]?.label ?? ""}"), ${l.page ?? "?"}:\n${describeLoad(l)}`);
      if (unseen.length) lines.push("Asked for without a script being seen added:", ...unseen.map((u) => `  ${u.id} (${c.script[u.script]}), step ${u.step}: ${c.kinds[u.kind]()}`));
      if (notRun.length) lines.push(`Never ran so far (Google's registry never held ${notRun.length === 1 ? "it" : "them"}): ${notRun.map((x) => x.id).join(", ")}. If a consent platform holds GTM back, accept consent to see it run.`);
      return text(`${loads.length} container ${loads.length === 1 ? "load" : "loads"}:\n${lines.join("\n")}\n\nAs JSON: ${JSON.stringify([...loads, ...unseen].map((l) => ({ step: l.step, page: l.page, ...containerJson(l), ...(l.id.startsWith("GTM-") ? { ran: run.containersRunning.some((r) => r.id === l.id) } : {}) })))}`);
    },
  );

  server.registerTool(
    "get_widgets",
    {
      title: "List the embedded widgets seen so far",
      description:
        "Returns every third-party iframe (a booking, chat or payment widget, a video) this audit's pages embedded that tracked or loaded a Google container so far: the pages it was embedded in, the containers it loaded, the tracking it sent to its own accounts and to the site's, the events and consent commands in its own dataLayer, and the events it pushed that never reached the site's accounts. The page's tags can't read a widget's dataLayer, so those events only reach the widget's own tracking. Widgets' own hits are left out of the plan checks; finish_audit still checks them for consent and personal data.",
      inputSchema: { audit_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ audit_id }) => {
      const { session } = getAudit(audit_id);
      const run = { ...splitRun(session), containerLoads: session.containerLoads };
      const lines = widgetLines([run]);
      if (!lines.length) return text("No embedded third-party widget has tracked or loaded a Google container on this audit's pages yet.");
      return text(`${lines.join("\n")}\n\nAs JSON: ${JSON.stringify(widgetsIn([run]))}`);
    },
  );

  server.registerTool(
    "get_report",
    {
      title: "Read a report this server wrote",
      description:
        "Returns a report finish_audit or run_audit wrote, so it can be read without access to the computer running this server. part markdown (default): report.md, the verdict, findings, consent and journeys in about 120 lines. summary: summary.json, the counts, journeys and findings as JSON. timeline: one JSON entry per step of each journey (hits with their consent, consent commands, the Google tag's consent, cookies and ids, the Google containers loaded). containers: every GTM container and Google tag the journeys loaded as JSON, with how each reached the page (source html, inline, script, custom_html, google_tag, nested, config, send_to or destination, and by: the container or script that loaded it), its dataLayer, host, GTM environment, version, size, load time and pages. widgets: every embedded third-party widget as JSON: where it was embedded, the containers it loaded, the tracking it sent to its own accounts and to the site's, its own dataLayer events, and the events it pushed that never reached the site's accounts (unshared). messages: every event an iframe posted to the page with postMessage as JSON, with what the page did next (outcome relayed, followed or nothing, and relay: the push or hit that followed).",
      inputSchema: {
        report: z.string().describe("The report name finish_audit or run_audit gave."),
        part: z.enum(["markdown", "summary", "timeline", "containers", "widgets", "messages"]).optional().describe("Default markdown."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ report, part = "markdown" }) => {
      const dir = written.get(report);
      if (!dir) return fail(written.size ? `No report "${report}" from this server. Its reports: ${[...written.keys()].join(", ")}.` : "This server has written no report yet.");
      try {
        if (part === "markdown") return text(await readFile(path.join(dir, "report.md"), "utf8"));
        if (part === "summary") return text(await readFile(path.join(dir, "summary.json"), "utf8"));
        const capture = JSON.parse(await readFile(path.join(dir, "capture.json"), "utf8"));
        if (part === "containers") return text(JSON.stringify(containerRows(capture.runs ?? []).map(containerJson)));
        if (part === "widgets") return text(JSON.stringify(widgetsIn(capture.runs ?? [])));
        if (part === "messages") return text(JSON.stringify((capture.runs ?? []).flatMap((r) => messageOutcomes(r, (a, b) => canonicalEvent(a) === canonicalEvent(b)).map((x) => ({ journey: r.journeyId, viewport: r.viewport, ...x })))));
        return text(JSON.stringify((capture.runs ?? []).map((r) => ({ journey: r.journeyId, viewport: r.viewport, steps: timelineOf(r) }))));
      } catch (err) {
        return fail(`Could not read the report: ${err.message}`);
      }
    },
  );

  server.registerTool(
    "consent_matrix",
    {
      title: "Compare every consent choice side by side",
      description:
        "Opens the site's start page like an ad click in a fresh browser once per consent choice: no choice and on to the next page, accept all, reject all and analytics only. Returns which tags sent after each choice, and a matrix of the first Google hit's consent, whether the campaign parameters reached it, whether the GA4 client id was kept, the _gcl_aw cookie, the cookies set, when each tag was called and the Google tag's own consent, with what should not happen marked. Needs a consent banner the tool can answer. Takes from a few seconds to a couple of minutes, depending on the site.",
      inputSchema: {
        site: z.string().describe("The page to start from, e.g. https://www.example.com/"),
        campaign: campaignSchema().describe(`The campaign parameters to open the start page with, as the UTM check. ${CAMPAIGN_DOC}`),
        providers: z.array(z.enum(Object.keys(TRACKING_PROVIDERS))).optional().describe(`Tracking providers to count. Default ${DEFAULT_PROVIDERS.join(", ")} plus any other known platform the site sends to.`),
        allowed_hosts: z.array(z.string()).optional().describe("Other hosts the pages may load from or redirect to."),
        concurrency: z.number().int().min(1).max(4).optional().describe("How many choices to try at once, each in its own browser. Default 2."),
        language: z.enum(Object.keys(LANGUAGES)).optional().describe("Language of the answer. Default en."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ site, campaign, providers, allowed_hosts, concurrency = 2, language = "en" }) => {
      let url;
      try {
        url = new URL(site);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      } catch {
        return fail("site must be an http or https URL.");
      }
      if (opts.blockPrivate) {
        const refused = await navigationError(url.href, { isPrivate: privateHostChecker() });
        if (refused) return fail(`${refused} Over HTTP, audits are limited to public websites.`);
      }
      const config = { site: url.href, providers, allowed_hosts };
      // Each choice is a browser of its own, so the choices tried at once fit in what the limit leaves free.
      const free = MAX_OPEN_AUDITS - browsersInUse();
      if (free < 1) return fail(BUSY(browsersInUse()));
      const atOnce = Math.min(concurrency, free);
      sideBrowsers += atOnce;
      let sc;
      try {
        sc = await runConsentScenarios(config, { campaign, concurrency: atOnce, ...(opts.blockPrivate ? { blockPrivate: opts.blockPrivate } : {}) });
      } catch (err) {
        // A page that would not open is not a page without a banner.
        return fail(`Could not compare the consent choices on ${url.href}: ${err.message}`);
      } finally {
        sideBrowsers -= atOnce;
      }
      if (!sc) return text(`No consent banner the tool can answer was found on ${url.href}, so the choices could not be compared. Walk the journey with start_audit and browser_action instead.`);
      const m = messages(language);
      const table = consentTable(sc);
      const lines = [m.ui.scenariosVia(sc.cmp), "", `| | ${table.cols.map((c) => m.ui.scenarioCols[c]).join(" | ")} |`, `|${" --- |".repeat(table.cols.length + 1)}`];
      for (const r of table.rows) lines.push(`| ${TRACKING_PROVIDERS[r.platform] ?? r.platform} ${r.event} | ${r.cells.map((c) => (c.count === null ? "–" : `${c.count}${c.problem ? " ⚠" : ""}`)).join(" | ")} |`);
      lines.push("", m.ui.scenariosLegend, "", ...consentMatrixMarkdown(m, sc));
      return text(lines.join("\n"));
    },
  );

  server.registerTool(
    "finish_audit",
    {
      title: "Finish and check the audit",
      description:
        "Closes the browser, checks every captured hit against the plan (missing events, missing parameters, duplicates, hits before consent, Consent Mode defaults, emails sent in plain text, unplanned events) and writes the report with the event timeline. Returns the findings. The plan is what should be tracked: pass a saved one with against, or write one inline with measurement_plan.",
      inputSchema: {
        audit_id: z.string(),
        completed: z.boolean().describe("Whether the journey reached its goal."),
        note: z.string().describe("One sentence on how the journey ended."),
        measurement_plan: z
          .string()
          .optional()
          .describe(
            'The plan (what should be tracked) as JSON text, e.g. {"consent_mode": true, "events": [{"platform": "ga4", "name": "purchase", "required_params": ["transaction_id", "value", "currency"]}]}. On a local server this can also be a file path. Without a plan, a ready-made journey checks its own events; otherwise only consent, duplicate and personal data checks run.',
          ),
        against: z.string().optional().describe(`${AGAINST_DOC} The site comes from this audit. Use either against or measurement_plan, not both.`),
        events: z.array(z.string()).optional().describe("Only check these events, e.g. [\"purchase\", \"add_to_cart\"]. On your own journey, these events are also expected to fire."),
        language: z.enum(Object.keys(LANGUAGES)).optional().describe("Report language. Default en."),
        branding: z.boolean().optional().describe("Set false to leave the Analitik İşler logo and credit line out of the report."),
      },
    },
    async ({ audit_id, completed, note, measurement_plan, against, events = [], language, branding }) => {
      const audit = getAudit(audit_id);
      if (against && measurement_plan) return fail(`Use either against or measurement_plan, not both. ${STILL_OPEN}`);
      let plan;
      let againstPlan = null;
      try {
        if (against) {
          const loaded = await loadAgainst(against, audit.site, opts);
          plan = loaded.plan;
          againstPlan = { ...loaded.found, label: loaded.found.id ?? path.relative(process.cwd(), loaded.found.file) };
        } else {
          plan = await readPlan(measurement_plan, opts.allowFiles);
          if (!Array.isArray(plan?.events)) throw new Error('The plan needs an "events" list.');
          // After this point the browser closes, so a plan the checks can't read has to be refused here.
          validatePlan(plan);
        }
      } catch (err) {
        return fail(`Could not read the plan: ${err.message} ${STILL_OPEN}`);
      }
      if (audit.preset) plan = withPresetEvents(plan, audit.journey, audit.preset);
      else plan = expectEvents(plan, audit.journey, events);
      plan = onlyEvents(plan, events);
      const lang = language ?? "en";
      const journey = { id: audit.journey };
      // After any action still running, so the run holds its step whole.
      const run = await inTurn(audit, async () => ({ ...collect(audit.session, journey, audit.viewport), completed, note, cookies: await audit.session.cookies().catch(() => []) }));
      const outDir = path.join(opts.reportsDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${audit.journey}`);
      let findings;
      let reportPath;
      try {
        findings = filterFindings(checkRun(plan, run, { lang }), events);
        ({ reportPath } = await writeReports({ outDir, config: { site: audit.site }, plan, runs: [run], findings, explained: null, lang, against: againstPlan, branding: branding !== false }));
      } catch (err) {
        // The browser is still open, so what it captured is not lost to a reports folder that can't be written.
        return fail(`Could not write the report: ${err.message} The audit is still open: call finish_audit again once that is fixed.`);
      }
      written.set(path.basename(outDir), outDir);
      await closeAudit(audit_id);
      const grouped = groupFindings(findings);
      const counts = summarize(grouped);
      const m = messages(lang);
      const lines = [
        ...(run.live ? [LIVE_NOTE] : []),
        m.ui.counts(counts),
        ...(againstPlan ? [m.ui.checkedAgainst(againstPlan.label)] : []),
        "",
        ...grouped.filter((f) => f.severity !== "ok").map((f) => `- ${m.severity[f.severity]}: ${f.detail}${f.evidence ? ` (captured: ${f.evidence})` : ""} [${f.where.map((w) => m.ui.whereStep(w.journey, w.viewport, w.step)).join("; ")}]`),
        "",
        `${run.hits.length} tracking hits, ${run.dataLayerLog.length} dataLayer pushes and ${run.network.length} analytics or ad network calls captured over ${run.steps.length} steps.`,
        skippedLine(run),
        ...((platform) => (platform ? [`Consent platform: ${platform.vendor}. ${platform.facts.join(" ")}`] : []))(cmpFacts(messages("en"), [run])),
        ...containerLines([run]),
        ...widgetLines([run]),
        ...messageLines([run]),
        opts.allowFiles
          ? `Full report with the event timeline: ${reportPath}`
          : opts.reportsUrl
            ? `Full report with the event timeline: ${opts.reportsUrl}/${path.basename(outDir)}/report.html`
            : "",
        "",
        `To read the report here: get_report with report "${path.basename(outDir)}" (markdown, summary, timeline, containers, widgets or messages).`,
        "Explain each problem to the user with its likely cause and fix.",
      ];
      return {
        content: [
          { type: "text", text: lines.filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n") },
          { type: "text", text: `Timeline (JSON, one entry per step):\n${JSON.stringify(timelineOf(run))}` },
        ],
      };
    },
  );

  server.registerTool(
    "make_plan",
    {
      title: "Draft a tracking plan",
      description:
        "Explores a website and drafts its measurement plan: the events, parameters and user properties it should track. Same as `aitd plan --site`. The plan is saved (use its ID as against in finish_audit to check an audit against it) and the events are returned. Uses the AI provider configured on the computer running this server (ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY) and takes a few minutes. To see what the site sends today, run an audit instead.",
      inputSchema: {
        site: z.string().describe("The site to plan, e.g. https://www.example.com/"),
        topic: z.enum(Object.keys(TOPICS)).optional().describe(`Limit the plan to one kind of event: ${Object.keys(TOPICS).join(", ")}. Default: the whole plan.`),
      },
    },
    async ({ site, topic }) => {
      let url;
      try {
        url = new URL(site);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      } catch {
        return fail("site must be an http or https URL.");
      }
      if (opts.blockPrivate) {
        const refused = await navigationError(url.href, { isPrivate: privateHostChecker() });
        if (refused) return fail(`${refused} Over HTTP, plans are limited to public websites.`);
      }
      if (browsersInUse() >= MAX_OPEN_AUDITS) return fail(BUSY(browsersInUse()));
      sideBrowsers += 1;
      try {
        const provider = opts.provider ?? (await createProvider());
        const { plan } = await discoverPlan({ site: url.href, topic, provider, blockPrivate: opts.blockPrivate });
        const { id, dir } = await savePlan(plan, { dataDir: opts.dataDir ?? DEFAULT_DATA_DIR, site: url.href });
        const custom = plan.events.filter((e) => e.custom).length;
        return text(
          [
            `Saved plan ${id}${topic ? ` (${topic} only)` : ""}: ${plan.events.length} events (${custom} custom) and ${plan.user_properties.length} user properties${opts.allowFiles ? ` in ${dir}` : ""}.`,
            "",
            ...plan.events.map((e) => `- ${e.platform} ${e.name}${e.custom ? " (custom)" : ""}${e.trigger?.page ? `, on ${e.trigger.page}` : ""}${e.required_params?.length ? `, params: ${e.required_params.join(", ")}` : ""}${e.description ? `: ${e.description}` : ""}`),
            ...(plan.user_properties.length ? ["", `User properties: ${plan.user_properties.map((p) => p.name).join(", ")}`] : []),
            "",
            `Check a site against it with an audit: finish_audit with against "${id}".`,
          ].join("\n"),
        );
      } catch (err) {
        // The CLI wording (--no-ai) means nothing to a chat app, so say it in this tool's terms.
        if (err.code === "NO_API_KEY") return fail("No AI provider key (ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY) is set on the computer running this server, so it can't draft a plan. Set one and restart the server, or write the plan yourself from what an audit shows and pass it to finish_audit as measurement_plan.");
        return fail(`Could not draft the plan: ${err.message}`);
      } finally {
        sideBrowsers -= 1;
      }
    },
  );

  server.registerTool(
    "what_changed",
    {
      title: "What changed since the last run",
      description:
        "Returns only the \"since last run\" diff for a site: which problems were fixed and which are new in its newest saved run (`aitd run`) compared with the run before it. Compares plan coverage when both runs were checked against a plan, health findings otherwise. Does not browse or use an AI. Use it to answer \"what changed on this site?\" without re-reading a whole report.",
      inputSchema: {
        site: z.string().describe("The site, e.g. https://www.example.com/. Its saved runs are the ones in the data folder of the computer running this server."),
        language: z.enum(Object.keys(LANGUAGES)).optional().describe("Language of the answer. Default en."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ site, language }) => {
      try {
        const diff = await sinceLastRun(opts.dataDir ?? DEFAULT_DATA_DIR, site);
        return text(changesLines(diff, language ?? "en").join("\n"));
      } catch (err) {
        return fail(err.message);
      }
    },
  );

  if (opts.allowFiles) {
    server.registerTool(
      "run_audit",
      {
        title: "Run a configured audit",
        description:
          "Runs every journey in a ai-tag-debugger config file and writes the report. With against, the run is checked against a saved plan and, if the config has no journeys, walks the journeys derived from that plan. With scripted true, it replays each journey's fixed steps and needs no API key. Otherwise the journeys are browsed by the AI provider configured on this computer (ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY). Returns the findings.",
        inputSchema: {
          config: z.string().describe("Path to the config file, e.g. ai-tag-debugger.config.json"),
          against: z.string().optional().describe(`${AGAINST_DOC} The site comes from the config.`),
          scripted: z.boolean().optional().describe("Replay fixed steps instead of browsing with an AI model. Default true."),
          language: z.enum(Object.keys(LANGUAGES)).optional(),
          branding: z.boolean().optional().describe("Set false to leave the Analitik İşler logo and credit line out of the report."),
          concurrency: z.number().int().min(1).max(MAX_CONCURRENCY).optional().describe("How many journeys to run at once, each in its own browser. Default 1."),
          providers: z
            .array(z.enum(Object.keys(TRACKING_PROVIDERS)))
            .optional()
            .describe(`Tracking providers to check. Default ${DEFAULT_PROVIDERS.join(", ")} plus any other known platform the site sends to. When given, requests to the others are still answered locally, but they are only counted, not shown or checked.`),
          baseline: z.string().optional().describe('Path to a baseline file of accepted findings, written by the CLI with --update-baseline. Default: the config\'s "baseline". Accepted findings are listed but not counted.'),
        },
      },
      async ({ config: configFile, against, scripted, language, branding, concurrency, providers, baseline: baselineFile }) => {
        const loaded = await loadConfig(configFile);
        let baseline = null;
        if (baselineFile ?? loaded.baselineFile) {
          try {
            baseline = await readBaseline(baselineFile ?? loaded.baselineFile);
          } catch (err) {
            return fail(err.message);
          }
        }
        let againstPlan = null;
        if (against) {
          try {
            const found = await loadAgainst(against, loaded.config.site, opts);
            if (!loaded.config.site) {
              if (!found.plan.site) throw new Error(`${found.found.file} has no "site" and the config has none either.`);
              loaded.config = { ...loaded.config, site: found.plan.site };
            }
            loaded.plan = found.plan;
            againstPlan = found.found;
          } catch (err) {
            return fail(`Could not read the plan: ${err.message}`);
          }
        }
        const replay = scripted !== false;
        let result;
        try {
          result = await runAudit({ ...loaded, scripted: replay, ai: !replay, lang: language, branding, concurrency, providers, against: againstPlan, baseline, dataDir: opts.dataDir, outDir: path.join(opts.reportsDir, new Date().toISOString().replace(/[:.]/g, "-")) });
        } catch (err) {
          // The CLI wording (--scripted --no-ai) means nothing to a chat app, so say it in this tool's terms.
          if (err.code !== "NO_API_KEY") throw err;
          return fail(
            "No AI provider key (ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY) is set on the computer running this server, so scripted false can't browse with a model. Call run_audit again with scripted true (or leave it out) to replay the journeys' fixed steps, or browse the site yourself with start_audit, browser_action and finish_audit. Neither needs a key.",
          );
        }
        written.set(path.basename(result.outDir), result.outDir);
        const m = messages(result.lang);
        const grouped = groupFindings(result.findings).filter((f) => f.severity !== "ok");
        return text(
          [
            m.ui.counts(result.counts),
            ...(result.baseline ? [`${result.baseline.accepted} accepted from the baseline${result.baseline.partial ? `, ${result.baseline.partial} accepted in some places only (still counted)` : ""}, ${result.baseline.stale.length} stale baseline entries`] : []),
            ...result.runs.map((r) => `${r.journeyId} (${r.viewport}): ${r.completed ? "completed" : "not completed"}, ${r.note}`),
            ...grouped.map((f) => `- ${m.severity[f.severity]}${f.accepted ? ` (${m.ui.accepted})` : ""}: ${f.detail}`),
            ...containerLines(result.runs),
            ...widgetLines(result.runs),
            ...messageLines(result.runs),
            `Report: ${result.reportPath}`,
            `To read the report here: get_report with report "${path.basename(result.outDir)}" (markdown, summary, timeline, containers, widgets or messages).`,
          ].join("\n"),
        );
      },
    );
  }

  return server;
}

/** Starts the MCP server on stdio, or on HTTP with --http. */
export async function startMcp({ http = false, port = 8787, host = "127.0.0.1", token, reportsDir, publicUrl, allowPrivateNetwork = false, allowLive = false, dataDir } = {}) {
  const dir = path.resolve(reportsDir ?? path.join(homedir(), "ai-tag-debugger-reports"));
  const shutdown = async () => {
    await Promise.all([...audits.keys()].map(closeAudit));
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  if (!http) {
    // On your own computer live runs are yours to start; a server others reach needs --allow-live.
    const server = buildServer({ allowFiles: true, reportsDir: dir, allowLive: true, dataDir });
    await server.connect(new StdioServerTransport());
    // The app that started the server closes stdin when it goes; without this an open audit's browser keeps the process alive.
    process.stdin.on("end", shutdown);
    // stdout carries the protocol, so status goes to stderr.
    console.error(`ai-tag-debugger MCP server ready on stdio. Reports go to ${dir}`);
    return;
  }

  // The URL carries a secret path, so only someone who has the URL can use the browser.
  if (token !== undefined && (token.length < MIN_TOKEN_LENGTH || !/^[\w-]+$/.test(token))) {
    throw new Error(`--token must be at least ${MIN_TOKEN_LENGTH} characters of letters, digits, - and _. Leave it out to get a random one.`);
  }
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    console.error(`Warning: listening on ${host}, so other machines on the network can reach this server. Anyone with the URL can drive its browser.`);
  }
  if (allowPrivateNetwork) {
    console.error("Warning: --allow-private-network lets audits open localhost and private network addresses. Use it only for a local tunnel you control.");
  }
  if (allowLive) {
    console.error("Warning: --allow-live lets start_audit send tracking requests to the real analytics and ad accounts of the sites it audits.");
  }
  const secret = token ?? randomBytes(18).toString("base64url");
  const endpoint = `/mcp/${secret}`;
  const digest = (s) => createHash("sha256").update(s).digest();
  const secretDigest = digest(secret);
  // Compares the secret segment in constant time: /mcp/<secret> or /mcp/<secret>/...
  const authorized = (pathname) => {
    const m = pathname.match(/^\/mcp\/([^/]+)(\/.*)?$/);
    return m ? { ok: timingSafeEqual(digest(m[1]), secretDigest), rest: m[2] ?? "" } : { ok: false, rest: "" };
  };
  const securityHeaders = {
    // The report's only script is the fixed inline one (tabs, deep links, theme), allowed by its hash; nothing else may load or run.
    "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src ${scriptCspSource()}`,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
  const reportsUrl = publicUrl ? `${publicUrl.replace(/\/+$/, "")}${endpoint}/reports` : undefined;
  const httpServer = createServer(async (req, res) => {
    // A request target that is no URL ("//[") must not throw here: nothing would catch it and the server would exit.
    let pathname = "";
    try {
      pathname = new URL(req.url, "http://x").pathname;
    } catch { /* answered 404 below, like any other wrong path */ }
    const { ok, rest } = authorized(pathname);
    if (!ok) {
      res.writeHead(404).end();
      return;
    }
    // Finished reports, behind the same secret path: /mcp/<secret>/reports/<audit folder>/<file>
    const report = rest.startsWith("/reports/") && rest.slice(9).match(/^(\w[\w.-]*)\/(report\.html|report\.md|timeline\.csv)$/);
    if (report && req.method === "GET") {
      try {
        const body = await readFile(path.join(dir, report[1], report[2]));
        const type = { html: "text/html", md: "text/markdown", csv: "text/csv" }[report[2].split(".").pop()];
        res.writeHead(200, { ...securityHeaders, "Content-Type": `${type}; charset=utf-8` }).end(body);
      } catch {
        res.writeHead(404).end();
      }
      return;
    }
    if (rest !== "") {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST" }).end();
      return;
    }
    if (Number(req.headers["content-length"]) > MAX_BODY_BYTES) {
      res.writeHead(413, { Connection: "close" }).end("Request body too large");
      req.destroy();
      return;
    }
    let body;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          res.writeHead(413, { Connection: "close" }).end("Request body too large");
          req.destroy();
          return;
        }
        chunks.push(chunk);
      }
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      if (!res.headersSent) res.writeHead(400).end("Invalid JSON");
      return;
    }
    // Stateless: a new server and transport per request. Open audits live in the module, keyed by audit_id.
    const server = buildServer({ allowFiles: false, blockPrivate: !allowPrivateNetwork, reportsDir: dir, reportsUrl, allowLive, dataDir });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      if (!res.headersSent) res.writeHead(500).end(err.message);
    }
  });
  await new Promise((resolve) => httpServer.listen(port, host, resolve));
  console.error(`ai-tag-debugger MCP server listening on http://${host}:${port}${endpoint}`);
  if (publicUrl) console.error(`Connect your chat app to ${publicUrl.replace(/\/+$/, "")}${endpoint}`);
  else console.error("Chat apps need an HTTPS URL: expose this port with a tunnel (e.g. cloudflared or ngrok), keep the same path, and pass --public-url <https://your-tunnel> so report links work.");
  console.error(`Reports go to ${dir}`);
  return httpServer;
}
