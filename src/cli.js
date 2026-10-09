#!/usr/bin/env node
import path from "node:path";
import { parseArgs } from "node:util";
import { loadConfig, runAudit } from "./audit.js";
import { LANGUAGES, messages } from "./i18n.js";
import { PROVIDERS } from "./providers.js";
import { JOURNEY_PRESETS } from "./journeys.js";
import { PROVIDERS as TRACKING_PROVIDERS, DEFAULT_PROVIDERS } from "./parsers.js";

const USAGE = `ai-tag-debugger: an open-source AI agent that QA-tests your analytics and ad tracking.

Usage:
  ai-tag-debugger run --site <url> --journey purchase [options]   Audit ready-made journeys, no config needed.
  ai-tag-debugger run --site <url> --goal "<what to do>"          Audit a journey you describe in plain language.
  ai-tag-debugger run --config <file> [options]                   Run an audit from a config file.
  ai-tag-debugger mcp [--http] [--port <n>]       Start the MCP server for Claude, ChatGPT, Gemini and other chat apps.

Run options:
  --site <url>         The site to audit (overrides "site" in the config).
  --config <file>      Audit config (JSON). See examples/demo.config.json.
  --journey <id>       Run this journey (repeatable): a journey id from the config, or a ready-made
                       journey: ${Object.keys(JOURNEY_PRESETS).join(", ")}.
  --goal "<text>"      Run a journey you describe in plain language (repeatable).
  --events <names>     Only check these events, comma separated, e.g. purchase,add_to_cart.
  --max-steps <n>      Most AI steps per journey (default 30). Lower it to cap API usage.
  --out <dir>          Where to write report.html, report.md, timeline.csv and capture.json (default: reports/<timestamp>).
  --provider <name>    AI provider: ${Object.keys(PROVIDERS).join(", ")} (default: whichever API key is set).
  --model <id>         Model id (defaults: ${Object.entries(PROVIDERS).filter(([, p]) => p.defaultModel).map(([k, p]) => `${k} ${p.defaultModel}`).join(", ")}).
  --base-url <url>     API address for --provider openai-compatible (Kimi, GLM, DeepSeek, OpenRouter, Ollama...).
  --lang <code>        Report language: ${Object.keys(LANGUAGES).join(" or ")} (default: en, or "language" in the config).
  --providers <list>   Tracking providers to check, comma separated (default: ${DEFAULT_PROVIDERS.join(",")}).
                       Choose from ${Object.keys(TRACKING_PROVIDERS).join(", ")}. Requests to the
                       others are still answered locally, but only counted ("providers" in the config).
  --viewport <name>    Only run this viewport: desktop or mobile (repeatable).
  --allow-host <host>  Let journeys visit this host too, e.g. a hosted checkout (repeatable). By default the
                       browser stays on the audited site and its subdomains ("allowed_hosts" in the config).
  --scripted           Replay each journey's fixed "steps" instead of letting the AI browse.
  --no-ai              Use no AI model at all (requires --scripted). The report then has no explanations.
  --fail-on <level>    Exit with code 1 when findings reach this level: broken, risk, warning or never (default: broken).
  --headed             Show the browser window.
  --keep-bodies        Store tracking requests as sent. By default, emails, phone numbers and user ids sent
                       for ad matching are redacted in the report and capture.json ("keep_bodies" in the config).
  --no-branding        Leave the Analitik İşler logo and credit line out of the reports ("branding": false in the config).

MCP options:
  --http               Serve over Streamable HTTP instead of stdio (for apps that connect to a URL).
  --port <n>           HTTP port (default 8787).
  --host <addr>        HTTP host (default 127.0.0.1).
  --token <secret>     Secret URL path segment, at least 16 characters (default: random, printed at start).
  --allow-private-network  Over HTTP, let audits open localhost and private network addresses (blocked by default).
  --reports <dir>      Where finished audits write reports (default: ~/ai-tag-debugger-reports).
  --public-url <url>   The HTTPS address your tunnel or host gives this server, so audits can link to their reports.

  -h, --help           Show this help.

API keys: set one of ${Object.values(PROVIDERS).map((p) => p.env).join(", ")}.
Any OpenAI-compatible API: --provider openai-compatible --base-url <url> --model <id>, with the key in OPENAI_COMPATIBLE_API_KEY.`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: "string" },
      site: { type: "string" },
      goal: { type: "string", multiple: true },
      events: { type: "string", multiple: true },
      "max-steps": { type: "string" },
      out: { type: "string" },
      journey: { type: "string", multiple: true },
      viewport: { type: "string", multiple: true },
      providers: { type: "string", multiple: true },
      "allow-host": { type: "string", multiple: true },
      "allow-private-network": { type: "boolean", default: false },
      scripted: { type: "boolean", default: false },
      "no-ai": { type: "boolean", default: false },
      provider: { type: "string" },
      model: { type: "string" },
      "base-url": { type: "string" },
      lang: { type: "string" },
      "fail-on": { type: "string", default: "broken" },
      headed: { type: "boolean", default: false },
      "no-branding": { type: "boolean", default: false },
      "keep-bodies": { type: "boolean", default: false },
      http: { type: "boolean", default: false },
      port: { type: "string" },
      host: { type: "string" },
      token: { type: "string" },
      reports: { type: "string" },
      "public-url": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const command = positionals[0];

  if (command === "mcp" && !values.help) {
    const { startMcp } = await import("./mcp.js");
    await startMcp({ http: values.http, port: values.port ? Number(values.port) : undefined, host: values.host, token: values.token, reportsDir: values.reports, publicUrl: values["public-url"], allowPrivateNetwork: values["allow-private-network"] });
    return;
  }
  if (values.help || command !== "run" || (!values.config && !values.site)) {
    console.log(USAGE);
    process.exit(values.help ? 0 : 2);
  }
  if (values["no-ai"] && !values.scripted) {
    throw new Error("--no-ai needs --scripted: without an AI model, journeys must have fixed steps.");
  }
  const levels = ["broken", "risk", "warning"];
  const failOn = values["fail-on"];
  if (failOn !== "never" && !levels.includes(failOn)) throw new Error(`--fail-on must be one of ${levels.join(", ")}, never.`);

  const loaded = values.config ? await loadConfig(values.config) : { config: {}, plan: null, gtmContainer: null };
  if (values.site) loaded.config = { ...loaded.config, site: values.site };
  if (values["keep-bodies"]) loaded.config = { ...loaded.config, keep_bodies: true };
  if (values["allow-host"]?.length) loaded.config = { ...loaded.config, allowed_hosts: [...(loaded.config.allowed_hosts ?? []), ...values["allow-host"]] };
  try {
    new URL(loaded.config.site);
  } catch {
    throw new Error(`"${loaded.config.site}" is not a full URL. Use e.g. https://www.example.com`);
  }
  const maxSteps = values["max-steps"] ? Number(values["max-steps"]) : undefined;
  if (maxSteps !== undefined && !(Number.isInteger(maxSteps) && maxSteps > 0)) throw new Error("--max-steps must be a positive whole number.");
  const result = await runAudit({
    ...loaded,
    journeys: values.journey,
    goals: values.goal,
    events: (values.events ?? []).flatMap((e) => e.split(",")).map((e) => e.trim()).filter(Boolean),
    maxSteps,
    viewports: values.viewport,
    providers: values.providers?.length ? values.providers.flatMap((p) => p.split(",")) : undefined,
    scripted: values.scripted,
    ai: !values["no-ai"],
    provider: values.provider,
    model: values.model,
    baseUrl: values["base-url"],
    lang: values.lang,
    headed: values.headed,
    branding: values["no-branding"] ? false : undefined,
    outDir: values.out,
    log: (msg) => console.log(msg),
  });

  console.log(`\n${messages(result.lang).ui.counts(result.counts)}`);
  const rel = path.relative(process.cwd(), result.reportPath);
  console.log(`Report: ${rel.startsWith("..") ? result.reportPath : rel}`);

  if (failOn !== "never") {
    const threshold = levels.indexOf(failOn);
    if (levels.slice(0, threshold + 1).some((l) => result.counts[l] > 0)) process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(2);
});
