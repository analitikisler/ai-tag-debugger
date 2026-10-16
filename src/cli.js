#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadConfig, runAudit } from "./audit.js";
import { LANGUAGES, messages } from "./i18n.js";
import { PROVIDERS } from "./providers.js";
import { JOURNEY_PRESETS } from "./journeys.js";
import { PROVIDERS as TRACKING_PROVIDERS, DEFAULT_PROVIDERS } from "./parsers.js";
import { replaySavedSite, writeSavedSteps } from "./replay.js";
import { savePlan } from "./plan.js";
import { DEFAULT_DATA_DIR } from "./workspace.js";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const USAGE = `ai-tag-debugger: an open-source AI agent that QA-tests your analytics and ad tracking.

Usage:
  ai-tag-debugger run --site <url> --journey purchase [options]   Audit ready-made journeys, no config needed.
  ai-tag-debugger run --site <url> --goal "<what to do>"          Audit a journey you describe in plain language.
  ai-tag-debugger run --site <url> --against latest               Audit the site against its latest plan.
  ai-tag-debugger run --config <file> [options]                   Run an audit from a config file.
  ai-tag-debugger replay <dir>... [--update]      Audit sites saved with --save-site again, offline and without AI,
                                                  and list findings that changed. Exits with code 1 when any did.
  ai-tag-debugger plan --site <url>
                                                  Let the AI explore one page of each type and propose a measurement
                                                  plan: events (custom ones too), parameters and user properties.
                                                  Prints the page types it found and those the site doesn't have.
                                                  Saved in aitd/<domain>/plans/<id>/ (measurement-plan.json and a readable plan.html).
  ai-tag-debugger plan list --site <url>          List the site's plan IDs, oldest first.
  ai-tag-debugger plan export <plan> --site <url> [--format csv]
                                                  Write a plan as plan.xlsx (or events.csv and user_properties.csv)
                                                  in its folder, to edit it in a spreadsheet. <plan>: latest, first,
                                                  a plan ID, or a path to a plan file or folder.
  ai-tag-debugger plan import <file> --site <url>
                                                  Save a .xlsx or .csv plan spreadsheet as a new plan.
  ai-tag-debugger mcp [--http] [--port <n>]       Start the MCP server for Claude, ChatGPT, Gemini and other chat apps.

Run options:
  --site <url>         The site to audit (overrides "site" in the config).
  --config <file>      Audit config (JSON). See examples/demo.config.json.
  --against <plan>     Check the run against a plan: latest (or last), first, a plan ID, or a path to a plan
                       file or folder (then --site may be left out; the plan's "site" is used). Alone, it walks
                       up to six journeys built from the plan's trigger pages. With --journey or --goal it walks
                       only those and checks the plan events expected there; the rest are not checked.
  --journey <id>       Run this journey (repeatable): a journey id from the config, or a ready-made
                       journey: ${Object.keys(JOURNEY_PRESETS).join(", ")}.
                       A run needs something to test: --against, --journey, --goal or journeys in --config.
                       Without one it stops before opening the browser, so it can't wander and spend
                       API usage. "aitd plan --site <url>" drafts a plan if you're not sure what to test.
  --goal "<text>"      Run a journey you describe in plain language (repeatable).
  --events <names>     Only check these events, comma separated, e.g. purchase,add_to_cart.
  --max-steps <n>      Most AI steps per journey (default 30). Lower it to cap API usage.
  --data-dir <dir>     Where plans and runs are kept (default: ./aitd). Each run writes report.html, report.md,
                       timeline.csv and capture.json to <dir>/<domain>/runs/<id>/, the ID being the local time.
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
  --save-site <dir>    Also save the site's responses and the steps taken in this folder, so "replay" can audit
                       the same pages again offline. Its findings become the expected ones.
  --save-steps <file>  Write the steps each journey took into "journeys[].steps" of this config file (created
                       if missing), so "run --config <file> --scripted --no-ai" repeats them with no AI model
                       or API key. A journey run on several viewports keeps the steps of the first.

Replay options:
  --update             Make this replay's findings the expected ones (after checking that the changes are right).
  --out <dir>          Where to write the replay's reports (default: <dir>/last-replay).

Plan options:
  --site <url>         Explore this site with the AI (no tracking needed) and propose a plan. Also takes
                       --provider, --model, --base-url, --max-steps (default 25), --allow-host and --headed.
  --data-dir <dir>     Where plans are kept (default: ./aitd). Each plan gets a new <dir>/<domain>/plans/<id>/ folder.
  --format <type>      For plan export: xlsx (default) or csv.

Plan spreadsheet: an "events" tab with one row per event parameter and the columns event, platform,
parameter, required (yes/no), example, trigger and description (an event with no parameters is one row
with an empty parameter), and a "user_properties" tab with name, description and example. As CSV, these
are events.csv and user_properties.csv side by side. Import never changes a plan; it saves a new one.

MCP options:
  --http               Serve over Streamable HTTP instead of stdio (for apps that connect to a URL).
  --port <n>           HTTP port (default 8787).
  --host <addr>        HTTP host (default 127.0.0.1).
  --token <secret>     Secret URL path segment, at least 16 characters (default: random, printed at start).
  --allow-private-network  Over HTTP, let audits open localhost and private network addresses (blocked by default).
  --reports <dir>      Where finished audits write reports (default: ~/ai-tag-debugger-reports).
  --public-url <url>   The HTTPS address your tunnel or host gives this server, so audits can link to their reports.

  -h, --help           Show this help.
  -v, --version        Print the version.

Short alias: aitd (aitd run ... is the same as ai-tag-debugger run ...).

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
      "save-site": { type: "string" },
      "save-steps": { type: "string" },
      update: { type: "boolean", default: false },
      "data-dir": { type: "string" },
      against: { type: "string" },
      from: { type: "string" },
      format: { type: "string" },
      force: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });
  const command = positionals[0];
  if (values.version) {
    console.log(VERSION);
    return;
  }

  if (command === "mcp" && !values.help) {
    const { startMcp } = await import("./mcp.js");
    await startMcp({ http: values.http, port: values.port ? Number(values.port) : undefined, host: values.host, token: values.token, reportsDir: values.reports, publicUrl: values["public-url"], allowPrivateNetwork: values["allow-private-network"] });
    return;
  }
  if (command === "replay" && !values.help) {
    const dirs = positionals.slice(1);
    if (!dirs.length) throw new Error("replay needs the folder of at least one site saved with --save-site.");
    let changed = false;
    for (const dir of dirs) {
      const r = await replaySavedSite(dir, { update: values.update, outDir: dirs.length === 1 ? values.out : undefined }).catch((err) => {
        console.log(`✗ ${dir}: could not replay: ${err.message.split("\n")[0]}`);
        changed = true;
        return null;
      });
      if (!r) continue;
      const same = !r.missing.length && !r.extra.length;
      changed ||= !same;
      console.log(`${same ? "✓" : values.update ? "↻" : "✗"} ${r.site} (${dir}): ${same ? "same findings" : `${r.extra.length} new, ${r.missing.length} gone${values.update ? ", saved as expected" : ""}`}`);
      for (const k of r.extra) console.log(`    + ${k}`);
      for (const k of r.missing) console.log(`    - ${k}`);
      for (const note of r.incomplete) console.log(`    ! ${note}`);
      for (const note of r.foundByText) console.log(`    ~ ${note}`);
    }
    if (changed && !values.update) process.exitCode = 1;
    return;
  }
  if (command === "plan" && positionals[1] === "list" && !values.help) {
    if (!values.site) throw new Error("plan list needs --site <url>: aitd plan list --site https://www.example.com");
    const { domainOf, listPlanIds } = await import("./workspace.js");
    const ids = await listPlanIds(values["data-dir"] ?? DEFAULT_DATA_DIR, values.site);
    if (!ids.length) throw new Error(`No plan yet for ${domainOf(values.site)}. Draft one with: aitd plan --site ${values.site}`);
    for (const id of ids) console.log(id);
    return;
  }
  if (command === "plan" && !values.help && ["import", "export"].includes(positionals[1])) {
    await planSheet(positionals[1], positionals[2], values);
    return;
  }
  if (command === "plan" && !values.help) {
    if (values.from) throw new Error("--from was removed. Draft a plan with: aitd plan --site <url>");
    if (values.out) throw new Error("plan --out was removed. Plans are saved in aitd/<domain>/plans/<id>/; use --data-dir <dir> to keep them elsewhere.");
    if (values.force) throw new Error("--force was removed. Each plan is saved in a new folder, so nothing is replaced.");
    if (!values.site) throw new Error("plan needs --site <url>: aitd plan --site https://www.example.com");
    const dataDir = values["data-dir"] ?? DEFAULT_DATA_DIR;
    const { domainOf } = await import("./workspace.js");
    domainOf(values.site); // Checked before the browser starts.
    const maxSteps = values["max-steps"] ? Number(values["max-steps"]) : undefined;
    if (maxSteps !== undefined && !(Number.isInteger(maxSteps) && maxSteps > 0)) throw new Error("--max-steps must be a positive whole number.");
    const { createProvider } = await import("./providers.js");
    const { discoverPlan } = await import("./discover.js");
    const provider = await createProvider({ name: values.provider, model: values.model, baseUrl: values["base-url"] });
    console.log(`Exploring ${values.site} to draft its measurement plan…`);
    const { plan } = await discoverPlan({ site: values.site, provider, maxSteps, headed: values.headed, allowedHosts: values["allow-host"], log: console.log });
    const { id, dir } = await savePlan(plan, { dataDir, site: values.site, branding: !values["no-branding"] });
    const custom = plan.events.filter((e) => e.custom).length;
    const rel = path.relative(process.cwd(), dir);
    console.log(`✓ Saved plan ${id}: ${plan.events.length} events (${custom} custom) and ${plan.user_properties.length} user properties in ${rel.startsWith("..") ? dir : rel}`);
    return;
  }
  if (values.help || command !== "run" || (!values.config && !values.site && !values.against)) {
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
  if (!values.against && !values.journey?.length && !values.goal?.length && !loaded.config.journeys?.length) {
    throw new Error('Nothing to test. Add --against latest, --journey <id> or --goal "<text>".');
  }
  let against = null;
  if (values.against) {
    const { readJson } = await import("./audit.js");
    const { resolvePlan } = await import("./workspace.js");
    if (loaded.config.site) {
      try {
        new URL(loaded.config.site);
      } catch {
        throw new Error(`"${loaded.config.site}" is not a full URL. Use e.g. https://www.example.com`);
      }
    }
    against = await resolvePlan(values.against, { dataDir: values["data-dir"] ?? DEFAULT_DATA_DIR, site: loaded.config.site });
    const plan = await readJson(against.file);
    if (!Array.isArray(plan?.events)) throw new Error(`${against.file} is not a plan: it needs an "events" list.`);
    if (!loaded.config.site) {
      if (!plan.site) throw new Error(`${against.file} has no "site". Add --site <url>.`);
      loaded.config = { ...loaded.config, site: plan.site };
    }
    loaded.plan = plan;
  }
  if (values["keep-bodies"]) loaded.config = { ...loaded.config, keep_bodies: true };
  if (values["allow-host"]?.length) loaded.config = { ...loaded.config, allowed_hosts: [...(loaded.config.allowed_hosts ?? []), ...values["allow-host"]] };
  try {
    new URL(loaded.config.site);
  } catch {
    throw new Error(`"${loaded.config.site}" is not a full URL. Use e.g. https://www.example.com`);
  }
  const maxSteps = values["max-steps"] ? Number(values["max-steps"]) : undefined;
  if (maxSteps !== undefined && !(Number.isInteger(maxSteps) && maxSteps > 0)) throw new Error("--max-steps must be a positive whole number.");
  // run --out is a hidden alias kept for one minor version; --data-dir replaces it.
  if (values.out) console.log("Note: run --out will be removed in a later version. Runs are saved in aitd/<domain>/runs/<id>/; use --data-dir <dir> to keep them elsewhere.");
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
    dataDir: values["data-dir"],
    saveSite: values["save-site"],
    against,
    log: (msg) => console.log(msg),
  });

  console.log(`\n${messages(result.lang).ui.counts(result.counts)}`);
  const rel = path.relative(process.cwd(), result.reportPath);
  console.log(`Report: ${rel.startsWith("..") ? result.reportPath : rel}`);

  if (failOn !== "never") {
    const threshold = levels.indexOf(failOn);
    if (levels.slice(0, threshold + 1).some((l) => result.counts[l] > 0)) process.exitCode = 1;
  }
  if (result.saveError) process.exitCode = 1;
  if (values["save-steps"]) {
    try {
      const { saved, skipped } = await writeSavedSteps(values["save-steps"], { site: loaded.config.site, plan: result.plan, journeys: result.journeys, runs: result.runs });
      if (saved.length) console.log(`Saved the steps of ${saved.join(", ")} in ${values["save-steps"]}. Repeat them with: aitd run --config ${values["save-steps"]} --scripted --no-ai`);
      if (skipped.length) console.log(`No steps to save for ${skipped.join(", ")}.`);
    } catch (err) {
      console.log(`Could not save the steps in ${values["save-steps"]}: ${err.message}`);
      process.exitCode = 1;
    }
  }
}

async function planSheet(action, arg, values) {
  const dataDir = values["data-dir"] ?? DEFAULT_DATA_DIR;
  const shown = (p) => {
    const rel = path.relative(process.cwd(), p);
    return rel.startsWith("..") ? p : rel;
  };
  const { readPlanSheet, writePlanSheet } = await import("./sheet.js");
  if (action === "import") {
    if (!arg) throw new Error("plan import needs a file: aitd plan import plan.xlsx --site https://www.example.com");
    if (!values.site) throw new Error(`plan import needs --site <url>: aitd plan import ${arg} --site https://www.example.com`);
    const { domainOf } = await import("./workspace.js");
    domainOf(values.site);
    const { plan, warnings } = await readPlanSheet(arg, { site: values.site });
    for (const w of warnings) console.log(`Warning: ${w}`);
    const { id, dir } = await savePlan(plan, { dataDir, site: values.site });
    console.log(`✓ Imported plan ${id}: ${plan.events.length} events and ${plan.user_properties.length} user properties in ${shown(dir)}`);
    return;
  }
  if (!arg) throw new Error("plan export needs a plan: aitd plan export latest --site https://www.example.com");
  const format = (values.format ?? "xlsx").toLowerCase();
  if (!["xlsx", "csv"].includes(format)) throw new Error(`--format must be xlsx or csv (found "${values.format}").`);
  const { resolvePlan } = await import("./workspace.js");
  const { file } = await resolvePlan(arg, { dataDir, site: values.site });
  const plan = JSON.parse(readFileSync(file, "utf8"));
  const written = await writePlanSheet(plan, path.dirname(file), { format });
  console.log(`✓ Exported the plan to ${written.map(shown).join(" and ")}. Edit it, then save it as a new plan with: aitd plan import ${shown(written[0])} --site ${values.site ?? plan.site ?? "<url>"}`);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(2);
});
