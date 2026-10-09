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
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AuditSession } from "./browser.js";
import { navigationError, privateHostChecker } from "./guard.js";
import { collect, pageView, SYSTEM_PROMPT } from "./agent.js";
import { checkRun, groupFindings, summarize } from "./checks.js";
import { LANGUAGES, messages } from "./i18n.js";
import { loadConfig, readJson, runAudit, writeReports } from "./audit.js";
import { DEFAULT_PROVIDERS, PROVIDERS as TRACKING_PROVIDERS } from "./parsers.js";
import { expectEvents, filterFindings, JOURNEY_PRESETS, onlyEvents, presetFor, withPresetEvents } from "./journeys.js";

const VERSION = "0.5.2";
const MAX_OPEN_AUDITS = 4;
const IDLE_MS = 15 * 60 * 1000; // an audit untouched this long is closed
const MAX_BODY_BYTES = 1024 * 1024;
const MIN_TOKEN_LENGTH = 16;

const INSTRUCTIONS = `ai-tag-debugger checks a website's analytics and ad tracking (GA4, Google Ads, Meta Pixel, TikTok Pixel, Consent Mode).

Before starting, ask the user which platforms to check and suggest the default (${DEFAULT_PROVIDERS.map((k) => TRACKING_PROVIDERS[k]).join(", ")}); pass their choice as providers.

To audit a journey yourself: call start_audit with the site URL and a journey (a ready-made one: ${Object.keys(JOURNEY_PRESETS).join(", ")}, or the user's own description), then browser_action one step at a time until the journey is done (each result shows the page and the tracking hits that step sent), then finish_audit with the measurement plan to get the findings and a full HTML report. Explain the findings to the user in plain language.

While browsing:
${SYSTEM_PROMPT.split("How to work:\n")[1]}`;

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

const text = (t) => ({ content: [{ type: "text", text: t }] });
const fail = (t) => ({ content: [{ type: "text", text: t }], isError: true });

function describeHit(h) {
  const params = Object.entries(h.params ?? {})
    .filter(([k]) => !["v", "tid", "gtm", "_p", "cid", "sid", "_s", "sct", "seg", "dl", "dr", "dt", "ul", "sr", "_et", "en"].includes(k))
    .slice(0, 12)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`.slice(0, 120))
    .join(", ");
  return `- ${h.platform} ${h.name}${h.consent ? ` [consent ${Object.entries(h.consent).map(([k, v]) => `${k}=${v}`).join(" ")}]` : ""}${params ? `: ${params}` : ""}`;
}

function stepCapture(audit, step) {
  const hits = audit.session.hits.filter((h) => h.step === step);
  const pushes = audit.session.dataLayerLog.filter((e) => e.step === step);
  const lines = [`Tracking hits sent by this step: ${hits.length}`, ...hits.map(describeHit)];
  if (pushes.length) lines.push(`dataLayer pushes: ${pushes.map((p) => JSON.stringify(p.value).slice(0, 160)).join(" | ")}`);
  return lines.join("\n");
}

function getAudit(id) {
  const audit = audits.get(id);
  if (!audit) throw new Error(`No open audit "${id}". Start one with start_audit. Audits close after ${IDLE_MS / 60000} minutes without activity.`);
  audit.lastUsed = Date.now();
  return audit;
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

/**
 * @param {{ allowFiles: boolean, blockPrivate?: boolean, reportsDir: string, reportsUrl?: string }} opts
 *   allowFiles: local (stdio) servers may read config and plan files; HTTP servers may not.
 *   blockPrivate: the browser refuses loopback, private and link-local addresses (HTTP servers, by default).
 *   reportsUrl: where an HTTP server serves finished reports, if it knows its public URL.
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
          .describe(`Tracking providers to check. Default ${DEFAULT_PROVIDERS.join(", ")}. Requests to the others are still answered locally, but they are only counted, not shown or checked.`),
      },
    },
    async ({ site, journey, viewport, allowed_hosts, providers }) => {
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
      if (audits.size >= MAX_OPEN_AUDITS) return fail(`${audits.size} audits are already open. Finish one with finish_audit first.`);
      let session;
      try {
        session = new AuditSession({ viewport: viewport ?? "desktop", site: url.href, allowedHosts: allowed_hosts, providers, blockPrivate: opts.blockPrivate });
      } catch (err) {
        return fail(err.message);
      }
      try {
        await session.start();
      } catch (err) {
        await session.close().catch(() => {});
        return fail(`Could not start the browser: ${err.message}. If Chromium is missing, run: npx playwright install chromium`);
      }
      const id = randomUUID().slice(0, 8);
      const preset = presetFor(journey);
      const name = preset?.id ?? ((journey || "journey").toLowerCase().replace(/[^\w-]+/g, "-").slice(0, 40) || "journey");
      const audit = { id, session, site: url.href, journey: name, preset, viewport: viewport ?? "desktop", lastUsed: Date.now() };
      audits.set(id, audit);
      const error = await session.act({ action: "goto", url: url.href, reason: `Open ${url.href}` });
      const page = pageView(await session.snapshot(), error);
      const goal = preset ? `Journey goal: ${preset.goal}\nEvents expected on the way: ${preset.events.map((e) => `${e.platform} ${e.name}`).join(", ")}\n\n` : "";
      return text(`audit_id: ${id}\n${goal}\n${page}\n\n${stepCapture(audit, session.currentStep)}`);
    },
  );

  server.registerTool(
    "browser_action",
    {
      title: "Act in the audit browser",
      description:
        "Performs one action in the audit's browser and returns the updated page plus the tracking hits that action sent. Actions: goto (url), click (ref or text), fill (ref or text, value), select (ref or text, value), scroll (value = down or up), wait (value = milliseconds). Refs come from the latest page view, which lists on-screen elements first; if an element has no ref, scroll or pass its visible text in text. If a cookie banner appears, accept it and set accepts_consent to true on that click. Use test data in forms and never enter real payment details.",
      inputSchema: {
        audit_id: z.string(),
        action: z.enum(["goto", "click", "fill", "select", "scroll", "wait"]),
        ref: z.number().int().optional().describe("Element ref for click, fill and select."),
        text: z.string().optional().describe("Instead of ref: the element's visible text or label, e.g. \"Book now\"."),
        value: z.string().optional().describe("Text to type, option to select, or milliseconds to wait."),
        url: z.string().optional().describe("Destination for goto, absolute or relative to the current page."),
        reason: z.string().describe("Short description of the step, e.g. 'Add the first product to the cart'. Shown in the report."),
        accepts_consent: z.boolean().optional().describe("True only when this click accepts the cookie or consent banner."),
      },
    },
    async (input) => {
      const audit = getAudit(input.audit_id);
      if (["click", "fill", "select"].includes(input.action) && !Number.isInteger(input.ref) && !input.text?.trim()) return fail(`${input.action} needs a ref or text.`);
      if (input.action === "goto" && !input.url) return fail("goto needs a url.");
      const error = await audit.session.act(input);
      const page = pageView(await audit.session.snapshot(), error);
      return text(`${page}\n\n${stepCapture(audit, audit.session.currentStep)}`);
    },
  );

  server.registerTool(
    "get_page",
    {
      title: "Show the current page",
      description: "Returns the current page view of an open audit without doing anything.",
      inputSchema: { audit_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ audit_id }) => text(pageView(await getAudit(audit_id).session.snapshot())),
  );

  server.registerTool(
    "finish_audit",
    {
      title: "Finish and check the audit",
      description:
        "Closes the browser, checks every captured hit against the measurement plan (missing events, missing parameters, duplicates, hits before consent, Consent Mode defaults, emails sent in plain text, unplanned events) and writes a full HTML report with the event timeline. Returns the findings.",
      inputSchema: {
        audit_id: z.string(),
        completed: z.boolean().describe("Whether the journey reached its goal."),
        note: z.string().describe("One sentence on how the journey ended."),
        measurement_plan: z
          .string()
          .optional()
          .describe(
            'The measurement plan as JSON text, e.g. {"consent_mode": true, "events": [{"platform": "ga4", "name": "purchase", "required_params": ["transaction_id", "value", "currency"]}]}. On a local server this can also be a file path. Without a plan, a ready-made journey checks its own events; otherwise only consent, duplicate and personal data checks run.',
          ),
        events: z.array(z.string()).optional().describe("Only check these events, e.g. [\"purchase\", \"add_to_cart\"]. On your own journey, these events are also expected to fire."),
        language: z.enum(Object.keys(LANGUAGES)).optional().describe("Report language. Default en."),
        branding: z.boolean().optional().describe("Set false to leave the Analitik İşler logo and credit line out of the report."),
      },
    },
    async ({ audit_id, completed, note, measurement_plan, events = [], language, branding }) => {
      const audit = getAudit(audit_id);
      let plan;
      try {
        plan = await readPlan(measurement_plan, opts.allowFiles);
        if (!Array.isArray(plan.events)) throw new Error('The plan needs an "events" list.');
      } catch (err) {
        return fail(`Could not read the measurement plan: ${err.message}`);
      }
      if (audit.preset) plan = withPresetEvents(plan, audit.journey, audit.preset);
      else plan = expectEvents(plan, audit.journey, events);
      plan = onlyEvents(plan, events);
      const lang = language ?? "en";
      const journey = { id: audit.journey };
      const run = { ...collect(audit.session, journey, audit.viewport), completed, note, cookies: await audit.session.cookies().catch(() => []) };
      await closeAudit(audit_id);

      const findings = filterFindings(checkRun(plan, run, { lang }), events);
      const grouped = groupFindings(findings);
      const counts = summarize(grouped);
      const outDir = path.join(opts.reportsDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${audit.journey}`);
      const reportPath = await writeReports({ outDir, config: { site: audit.site }, plan, runs: [run], findings, explained: null, lang, branding: branding !== false });
      const m = messages(lang);
      const lines = [
        m.ui.counts(counts),
        "",
        ...grouped.filter((f) => f.severity !== "ok").map((f) => `- ${m.severity[f.severity]}: ${f.detail}${f.evidence ? ` (captured: ${f.evidence})` : ""} [${f.where.map((w) => m.ui.whereStep(w.journey, w.viewport, w.step)).join("; ")}]`),
        "",
        `${run.hits.length} tracking hits, ${run.dataLayerLog.length} dataLayer pushes and ${run.network.length} analytics or ad network calls captured over ${run.steps.length} steps.`,
        skippedLine(run),
        opts.allowFiles
          ? `Full report with the event timeline: ${reportPath}`
          : opts.reportsUrl
            ? `Full report with the event timeline: ${opts.reportsUrl}/${path.basename(outDir)}/report.html`
            : "",
        "",
        "Explain each problem to the user with its likely cause and fix.",
      ];
      return text(lines.filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n"));
    },
  );

  if (opts.allowFiles) {
    server.registerTool(
      "run_audit",
      {
        title: "Run a configured audit",
        description:
          "Runs every journey in a ai-tag-debugger config file. With scripted true, it replays each journey's fixed steps and needs no API key. Otherwise the journeys are browsed by the AI provider configured on this computer (ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY). Writes the reports and returns the findings.",
        inputSchema: {
          config: z.string().describe("Path to the config file, e.g. ai-tag-debugger.config.json"),
          scripted: z.boolean().optional().describe("Replay fixed steps instead of browsing with an AI model. Default true."),
          language: z.enum(Object.keys(LANGUAGES)).optional(),
          branding: z.boolean().optional().describe("Set false to leave the Analitik İşler logo and credit line out of the report."),
          providers: z
            .array(z.enum(Object.keys(TRACKING_PROVIDERS)))
            .optional()
            .describe(`Tracking providers to check. Default ${DEFAULT_PROVIDERS.join(", ")}. Requests to the others are still answered locally, but they are only counted, not shown or checked.`),
        },
      },
      async ({ config: configFile, scripted, language, branding, providers }) => {
        const loaded = await loadConfig(configFile);
        const replay = scripted !== false;
        const result = await runAudit({ ...loaded, scripted: replay, ai: !replay, lang: language, branding, providers, outDir: path.join(opts.reportsDir, new Date().toISOString().replace(/[:.]/g, "-")) });
        const m = messages(result.lang);
        const grouped = groupFindings(result.findings).filter((f) => f.severity !== "ok");
        return text(
          [
            m.ui.counts(result.counts),
            ...result.runs.map((r) => `${r.journeyId} (${r.viewport}): ${r.completed ? "completed" : "not completed"}, ${r.note}`),
            ...grouped.map((f) => `- ${m.severity[f.severity]}: ${f.detail}`),
            `Report: ${result.reportPath}`,
          ].join("\n"),
        );
      },
    );
  }

  return server;
}

/** Starts the MCP server on stdio, or on HTTP with --http. */
export async function startMcp({ http = false, port = 8787, host = "127.0.0.1", token, reportsDir, publicUrl, allowPrivateNetwork = false } = {}) {
  const dir = path.resolve(reportsDir ?? path.join(homedir(), "ai-tag-debugger-reports"));
  const shutdown = async () => {
    await Promise.all([...audits.keys()].map(closeAudit));
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  if (!http) {
    const server = buildServer({ allowFiles: true, reportsDir: dir });
    await server.connect(new StdioServerTransport());
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
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
  const reportsUrl = publicUrl ? `${publicUrl.replace(/\/+$/, "")}${endpoint}/reports` : undefined;
  const httpServer = createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://x").pathname;
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
    const server = buildServer({ allowFiles: false, blockPrivate: !allowPrivateNetwork, reportsDir: dir, reportsUrl });
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
