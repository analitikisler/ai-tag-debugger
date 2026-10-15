// A full audit from a config file: run every journey, check, explain, write the reports.
// Shared by the CLI and the MCP server's run_audit tool.
import { readFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { failedRun, runJourney } from "./agent.js";
import { VIEWPORTS } from "./browser.js";
import { checkRun, groupFindings, summarize } from "./checks.js";
import { explainFindings, renderCsv, renderHtml, renderMarkdown } from "./report.js";
import { LANGUAGES, messages } from "./i18n.js";
import { createProvider } from "./providers.js";
import { filterFindings, planRun } from "./journeys.js";
import { resolveProviders } from "./parsers.js";
import { SAVED_SITE_FILE, writeSavedSite } from "./replay.js";

export async function readJson(file, baseDir = ".") {
  const full = path.resolve(baseDir, file);
  try {
    return JSON.parse(await readFile(full, "utf8"));
  } catch (err) {
    throw new Error(`Could not read ${full}: ${err.message}`);
  }
}

/** Reads a config file and everything it points to. */
export async function loadConfig(configFile) {
  const configPath = path.resolve(configFile);
  const configDir = path.dirname(configPath);
  const config = await readJson(configPath);
  const plan = typeof config.plan === "string" ? await readJson(config.plan, configDir) : config.plan;
  if (plan && !Array.isArray(plan.events)) throw new Error('The "plan" needs an "events" list.');
  const gtmContainer = config.gtm_container ? await readJson(config.gtm_container, configDir) : null;
  return { config, plan, gtmContainer };
}

export const defaultOutDir = () => path.resolve("reports", new Date().toISOString().replace(/[:.]/g, "-"));

/** Writes report.md, report.html, timeline.csv and capture.json. */
export async function writeReports({ outDir, config, plan, runs, findings, explained, lang, branding = config.branding !== false }) {
  await mkdir(outDir, { recursive: true });
  const title = messages(lang).ui.title(new URL(config.site).hostname);
  const generatedAt = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const report = { title, generatedAt, findings, explained, runs, plan, lang, branding };
  await writeFile(path.join(outDir, "report.md"), renderMarkdown(report));
  await writeFile(path.join(outDir, "report.html"), renderHtml(report));
  await writeFile(path.join(outDir, "timeline.csv"), renderCsv(report));
  await writeFile(path.join(outDir, "capture.json"), JSON.stringify({ config: { ...config, plan }, runs, findings, explained }, null, 2));
  return path.join(outDir, "report.html");
}

/**
 * @param {{ config: any, plan?: any, gtmContainer?: any, journeys?: string[], goals?: string[], events?: string[], viewports?: string[],
 *   scripted?: boolean, ai?: boolean, provider?: string, model?: string, baseUrl?: string, maxSteps?: number, lang?: string, headed?: boolean,
 *   outDir?: string, branding?: boolean, providers?: string[], saveSite?: string, replaySite?: string, log?: (m: string) => void }} opts
 *   journeys: config journey ids or ready-made journeys (purchase, add_to_cart, sign_up, lead, search).
 *   goals: extra journeys described in plain language. events: only check these events.
 *   providers: tracking providers to check (default: config "providers", else GA4, Google Ads, Meta, TikTok).
 *   saveSite: record the site's responses and the steps taken into this folder, for replaySite (see replay.js).
 *   replaySite: answer every request from a folder saved with saveSite, without the network.
 */
export async function runAudit(opts) {
  const { gtmContainer } = opts;
  let config = opts.config;
  const events = opts.events ?? [];
  if (!config.site) throw new Error('No site to audit. Pass --site or set "site" in the config.');
  const log = opts.log ?? (() => {});
  const lang = opts.lang ?? config.language ?? "en";
  if (!LANGUAGES[lang]) throw new Error(`Language must be one of ${Object.keys(LANGUAGES).join(", ")}.`);
  const useAi = opts.ai !== false;
  if (!useAi && !opts.scripted) throw new Error("Without an AI model, journeys must be replayed from their fixed steps (scripted).");

  const { journeys, plan } = planRun({ config, plan: opts.plan, picks: opts.journeys, goals: opts.goals, events });
  config = { ...config, providers: resolveProviders(opts.providers ?? config.providers, plan) };
  const viewports = opts.viewports?.length ? opts.viewports : config.viewports ?? ["desktop"];
  const allowed = Object.keys(VIEWPORTS).join(", ");
  if (!Array.isArray(viewports)) throw new Error(`"viewports" must be a list, e.g. ["desktop", "mobile"]. Allowed values: ${allowed}.`);
  const unknown = viewports.filter((v) => !Object.hasOwn(VIEWPORTS, v));
  if (unknown.length) throw new Error(`Unknown viewport ${unknown.map((v) => `"${v}"`).join(", ")}. Use: ${allowed}.`);
  if (!journeys.length) throw new Error("No journeys to run. Pick one with --journey (e.g. purchase) or describe one with --goal.");
  if (opts.scripted) {
    const unscripted = journeys.filter((j) => !j.steps?.length && !j.incomplete).map((j) => j.id);
    if (unscripted.length) throw new Error(`Journeys without fixed steps can't be replayed with --scripted: ${unscripted.join(", ")}.`);
  }

  const provider = useAi ? await createProvider({ name: opts.provider ?? config.provider, model: opts.model ?? config.model, baseUrl: opts.baseUrl ?? config.base_url }) : null;
  if (provider) log(`Using ${provider.name} (${provider.model})`);

  if (opts.saveSite) await mkdir(opts.saveSite, { recursive: true });
  const runs = [];
  for (const journey of journeys) {
    for (const viewport of viewports) {
      log(`\n▶ ${journey.id} (${viewport})`);
      // runJourney keeps its own errors in the run. This catches the rest, such as a browser that won't close,
      // so one journey can't cost the report of the others.
      const run = await runJourney(config, journey, viewport, { scripted: opts.scripted, provider, maxSteps: opts.maxSteps, headed: opts.headed, lang, log, saveSite: opts.saveSite, replaySite: opts.replaySite }).catch((err) => failedRun(journey, viewport, err, config.providers));
      log(`  ${run.completed ? "✓" : "✗"} ${run.note} · ${run.hits.length} tracking hits captured`);
      runs.push(run);
    }
  }

  const findings = filterFindings(runs.flatMap((run) => checkRun(plan, run, { lang })), events);
  let saveError = null;
  if (opts.saveSite) {
    try {
      await writeSavedSite(opts.saveSite, { config, plan, runs, findings });
      log(`\nSaved the site for offline replay in ${opts.saveSite}`);
    } catch (err) {
      // A site.json from an earlier save would no longer match the recordings next to it.
      await rm(path.join(opts.saveSite, SAVED_SITE_FILE), { force: true });
      saveError = err.message;
      log(`\nCould not save the site in ${opts.saveSite}: ${err.message}`);
    }
  }
  let explained = null;
  if (provider) {
    log("\nAsking the model to explain the findings…");
    explained = await explainFindings({ findings, plan, runs, gtmContainer, provider, lang, log });
  }

  const outDir = path.resolve(opts.outDir ?? defaultOutDir());
  const reportPath = await writeReports({ outDir, config, plan, runs, findings, explained, lang, branding: opts.branding ?? config.branding !== false });
  const counts = summarize(groupFindings(findings));
  return { journeys, plan, runs, findings, explained, counts, reportPath, outDir, lang, ...(saveError ? { saveError } : {}) };
}
