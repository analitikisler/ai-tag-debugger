#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadConfig, runAudit } from "./audit.js";
import { messages } from "./i18n.js";
import { helpText } from "./help.js";
import { replaySavedSite, writeSavedSteps } from "./replay.js";
import { savePlan } from "./plan.js";
import { DEFAULT_DATA_DIR } from "./workspace.js";
import { commandText, intentToArgs, isSentence, needsWhatToTest, translate } from "./ask.js";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args,
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
      platforms: { type: "string", multiple: true },
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
      topic: { type: "string" },
      format: { type: "string" },
      force: { type: "boolean", default: false },
      yes: { type: "boolean", short: "y", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });
  const command = positionals[0];
  if (values.version) {
    console.log(VERSION);
    return;
  }

  if (isSentence(positionals) && !values.help) {
    const next = await fromSentence(positionals[0], values, args);
    if (next) await main(next);
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
    if (values.topic !== undefined) (await import("./discover.js")).checkTopic(values.topic);
    const dataDir = values["data-dir"] ?? DEFAULT_DATA_DIR;
    const { domainOf } = await import("./workspace.js");
    domainOf(values.site); // Checked before the browser starts.
    const maxSteps = values["max-steps"] ? Number(values["max-steps"]) : undefined;
    if (maxSteps !== undefined && !(Number.isInteger(maxSteps) && maxSteps > 0)) throw new Error("--max-steps must be a positive whole number.");
    const { createProvider } = await import("./providers.js");
    const { discoverPlan } = await import("./discover.js");
    const provider = await createProvider({ name: values.provider, model: values.model, baseUrl: values["base-url"] });
    console.log(`Exploring ${values.site} to draft its measurement plan…`);
    const { plan } = await discoverPlan({ site: values.site, topic: values.topic, provider, maxSteps, headed: values.headed, allowedHosts: values["allow-host"], log: console.log });
    const { id, dir } = await savePlan(plan, { dataDir, site: values.site, branding: !values["no-branding"] });
    const custom = plan.events.filter((e) => e.custom).length;
    const rel = path.relative(process.cwd(), dir);
    console.log(`✓ Saved plan ${id}: ${plan.events.length} events (${custom} custom) and ${plan.user_properties.length} user properties in ${rel.startsWith("..") ? dir : rel}`);
    return;
  }
  if (values.help || command !== "run" || (!values.config && !values.site && !values.against)) {
    console.log(helpText(command));
    process.exit(values.help ? 0 : 2);
  }
  if (values["no-ai"]) values.scripted = true; // Without an AI model the journeys can only replay fixed steps.
  if (values.providers?.length) console.log("--providers is now --platforms.");
  const platforms = [...(values.platforms ?? []), ...(values.providers ?? [])];
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
    providers: platforms.length ? platforms.flatMap((p) => p.split(",")) : undefined,
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

  if (!against && !values.out) await offerLearnedPlan(result, loaded.config.site, values);

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

// The first run of a site with no plan: offer what it already tracks as its plan.
async function offerLearnedPlan(result, site, values) {
  const dataDir = values["data-dir"] ?? DEFAULT_DATA_DIR;
  const { listPlanIds } = await import("./workspace.js");
  if ((await listPlanIds(dataDir, site).catch(() => [])).length) return;
  const { learnPlan } = await import("./learn.js");
  const plan = learnPlan(site, result.runs);
  if (!plan) return;
  console.log(`\nNo plan yet for this site. It already sends ${plan.events.length} ${plan.events.length === 1 ? "event" : "events"}: ${plan.events.map((e) => `${e.platform}:${e.name}`).join(", ")}`);
  let save = values.yes;
  if (!save && process.stdin.isTTY) save = ["", "y", "yes"].includes((await ask("Save them as the site's plan? (Y/n) ")).toLowerCase());
  if (!save) {
    if (!process.stdin.isTTY && !values.yes) console.log("Add --yes to save them as the plan, or draft a fuller one with: aitd plan --site " + site);
    return;
  }
  const { id, dir } = await savePlan(plan, { dataDir, site, branding: !values["no-branding"] });
  const rel = path.relative(process.cwd(), dir);
  console.log(`✓ Saved plan ${id} in ${rel.startsWith("..") ? dir : rel}. Next runs can check against it with --against latest.`);
}

// aitd "check my GA tags": shows the matching command and runs it once confirmed.
async function fromSentence(sentence, values, extra) {
  const { createProvider } = await import("./providers.js");
  const provider = await createProvider({ name: values.provider, model: values.model, baseUrl: values["base-url"] }).catch((err) => {
    if (err.code === "NO_API_KEY") return null;
    throw err;
  });
  let { intent } = await translate(sentence, { provider });
  let r = intentToArgs(intent);
  if (r.question) {
    const answer = (await ask(`${r.question} `)).toLowerCase();
    if (!["plan", "run"].includes(answer)) throw new Error('Answer "plan" or "run", or type the command, e.g. aitd run --help.');
    r = intentToArgs({ ...intent, action: answer });
    intent = { ...intent, action: answer };
  }
  if (r.unsupported) throw new Error(r.unsupported);
  let args = r.args;
  const needsSite = !values.site && !args.includes("--site") && (args[0] === "plan" || !args.includes("--against"));
  if (needsSite) {
    const site = await ask("Which site? (e.g. https://www.example.com) ");
    if (!site) throw new Error("A site is needed. Add it to the sentence or pass --site <url>.");
    r = intentToArgs({ ...intent, site });
    args = r.args;
  }
  if (needsWhatToTest(args)) args = await whatToTest(args, values);
  // Options typed next to the sentence (--site, --provider, --headed…) carry over.
  args = [...args, ...extra.filter((a) => a !== sentence && a !== "-y" && a !== "--yes")];
  console.log(commandText(args));
  if (!values.yes) {
    const answer = (await ask("Run this? (Y/n) ")).toLowerCase();
    if (answer && !["y", "yes"].includes(answer)) return null;
  }
  return args;
}

// A run needs something to test: suggest the site's latest plan, else ask for a goal.
async function whatToTest(args, values) {
  const site = values.site ?? args[args.indexOf("--site") + 1];
  const { listPlanIds } = await import("./workspace.js");
  const hasPlan = (await listPlanIds(values["data-dir"] ?? DEFAULT_DATA_DIR, site).catch(() => [])).length > 0;
  if (hasPlan) {
    const answer = values.yes ? "" : (await ask("Check against the latest plan? (Y/n) ")).toLowerCase();
    if (!answer || ["y", "yes"].includes(answer)) return [...args, "--against", "latest"];
  } else if (values.yes) {
    throw new Error('Nothing to test yet. Say what to check, e.g. aitd "check my GA tags on the contact form", or draft a plan first.');
  }
  const goal = await ask("What should I check, e.g. the contact form? ");
  if (!goal) throw new Error('Nothing to test. Say what to check, e.g. aitd "check my GA tags on the contact form".');
  return [...args, "--goal", goal];
}

async function ask(question) {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
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
