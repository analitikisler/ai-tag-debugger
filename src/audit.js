// A full audit from a config file: run every journey, check, explain, write the reports.
// Shared by the CLI and the MCP server's run_audit tool.
import { newRunDir } from "./workspace.js";
import { compareRuns, previousPlanChanges, previousRun, routeHints } from "./changes.js";
import { sendAlerts } from "./notify.js";
import { readFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { failedRun, runJourney } from "./agent.js";
import { VIEWPORTS } from "./browser.js";
import { checkRun, groupFindings, planCheck, summarize } from "./checks.js";
import { explainFindings, renderCsv, renderHtml, renderMarkdown, verdictHeadline, VERSION } from "./report.js";
import { computeMetrics } from "./metrics.js";
import { journeyStability, loadHistory, trend as trendOf, updateHistoryIndex } from "./history.js";
import { buildSummary, renderJunit } from "./ci-output.js";
import { LANGUAGES, messages } from "./i18n.js";
import { loadReportBrand, writePdf } from "./whitelabel.js";
import { createProvider, alsoSet } from "./providers.js";
import { filterFindings, JOURNEY_PRESETS, planRun } from "./journeys.js";
import { resolveProviders } from "./parsers.js";
import { annotateFindings } from "./gtm.js";
import { lastSteps, SAVED_SITE_FILE, savedSteps, STEPS_FILE, writeSavedSite } from "./replay.js";
import { runConsentScenarios } from "./consent.js";
import { validateConfig, validatePlan } from "./schema.js";
import { applyBaseline } from "./baseline.js";
import { parseConcurrency, runPool, taggedLog } from "./pool.js";

export async function readJson(file, baseDir = ".") {
  const full = path.resolve(baseDir, file);
  try {
    return JSON.parse(await readFile(full, "utf8"));
  } catch (err) {
    throw new Error(`Could not read ${full}: ${err.message}`);
  }
}

/**
 * Reads a config file and everything it points to. The config and the plan are checked against their
 * schema first, so a typo fails here with the field named; unknown keys are only warned about, through
 * log (default: stderr). The result carries validated: true, which tells runAudit not to check again.
 */
export async function loadConfig(configFile, { log = console.error } = {}) {
  const configPath = path.resolve(configFile);
  const configDir = path.dirname(configPath);
  const config = await readJson(configPath);
  const { warnings } = validateConfig(config, { file: configFile });
  const plan = typeof config.plan === "string" ? await readJson(config.plan, configDir) : config.plan;
  if (plan) warnings.push(...validatePlan(plan, typeof config.plan === "string" ? { file: config.plan } : { file: configFile, at: "plan" }).warnings);
  for (const w of warnings) log(w);
  const gtmContainer = config.gtm_container ? await readJson(config.gtm_container, configDir) : null;
  const brand = await loadReportBrand(config.report, configDir);
  // The baseline is only resolved here, not read: --update-baseline may create it on this run.
  const baselineFile = typeof config.baseline === "string" ? path.resolve(configDir, config.baseline) : null;
  return { config, plan, gtmContainer, brand, baselineFile, validated: true };
}


/**
 * Writes report.md, report.html, timeline.csv, capture.json and steps.json, plus plan-check.json with --against,
 * and junit.xml and summary.json for CI. failOn: the --fail-on level, so junit.xml fails the same findings the exit code does.
 * previous: the site's last saved run (see previousRun), null when there is none, or undefined to skip
 * the "Changed since last run" section. history: { dataDir } when the run is saved in the site's runs folder,
 * so its history index is updated and the reports get the trend; null for --out and replays.
 * Returns { reportPath, summaryPath, changes, metrics, verdict, trend, stability }.
 */
export async function writeReports({ outDir, config, plan, runs, findings, explained, lang, ai = null, against = null, branding = config.branding !== false, previous = undefined, planChanges = null, consentScenarios = null, brand = null, failOn = "broken", history = null }) {
  await mkdir(outDir, { recursive: true });
  const site = new URL(config.site).hostname;
  const title = messages(lang).ui.title(site);
  const generatedAt = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const check = against ? { plan_id: against.id ?? null, ...planCheck(plan, runs, findings) } : null;
  const changes = previous === undefined ? null : compareRuns(previous, { findings, planCheck: check, runs });
  const metrics = computeMetrics({ plan, runs, findings, consentScenarios });
  const verdict = verdictHeadline({ findings, runs, metrics, lang });
  // The capture goes first: the history index summarises it, and the reports then show the trend including this run.
  await writeFile(path.join(outDir, "capture.json"), JSON.stringify({ version: VERSION, ai, config: { ...config, plan }, ...(against ? { against: { plan_id: against.id, file: against.file } } : {}), runs, findings, explained, metrics, ...(changes ? { changes } : {}), ...(planChanges ? { planChanges } : {}), ...(consentScenarios ? { consentScenarios } : {}) }, null, 2));
  let trend = null;
  let stability = null;
  if (history) {
    // A history that cannot be read or written costs the trend, never the report.
    await updateHistoryIndex(history.dataDir, config.site, { id: path.basename(outDir), capture: { runs, findings }, version: VERSION, ai }).catch(() => null);
    const saved = await loadHistory(history.dataDir, config.site).catch(() => []);
    trend = trendOf(saved);
    stability = journeyStability(saved);
  }
  const report = { title, site, ai, generatedAt, findings, explained, runs, plan, lang, branding, against: against?.label ?? null, planCheck: check, changes, planChanges, consentScenarios, brand, metrics, trend };
  await writeFile(path.join(outDir, "report.md"), renderMarkdown(report));
  await writeFile(path.join(outDir, "report.html"), renderHtml(report));
  await writeFile(path.join(outDir, "timeline.csv"), renderCsv(report));
  if (check) await writeFile(path.join(outDir, "plan-check.json"), JSON.stringify(check, null, 2));
  // The steps taken, so the next --scripted run can repeat them without a model (see lastSteps).
  await writeFile(path.join(outDir, STEPS_FILE), JSON.stringify(savedSteps({ site: config.site, runs }), null, 2));
  const reportPath = path.join(outDir, "report.html");
  const summaryPath = path.join(outDir, "summary.json");
  await writeFile(path.join(outDir, "junit.xml"), renderJunit({ runs, findings, lang, failOn, version: VERSION, site }));
  await writeFile(summaryPath, JSON.stringify(buildSummary({ runs, findings, counts: summarize(groupFindings(findings)), plan, against, ai, lang, reportPath, outDir, changes, consentScenarios, version: VERSION, site, metrics, trend }), null, 2));
  if (brand?.pdf) {
    try {
      await writePdf(reportPath, path.join(outDir, "report.pdf"));
    } catch (err) {
      // The HTML report is the main output; a PDF that can't be made is a warning, not a failed run.
      console.error(`Could not write report.pdf: ${err.message}`);
    }
  }
  return { reportPath, summaryPath, changes, metrics, verdict, trend, stability };
}

/**
 * @param {{ config: any, plan?: any, gtmContainer?: any, journeys?: string[], goals?: string[], events?: string[], viewports?: string[],
 *   scripted?: boolean, ai?: boolean, provider?: string, model?: string, baseUrl?: string, maxSteps?: number, lang?: string, headed?: boolean,
 *   outDir?: string, dataDir?: string, branding?: boolean, brand?: Awaited<ReturnType<typeof loadReportBrand>>, providers?: string[], saveSite?: string, replaySite?: string, concurrency?: number | string, log?: (m: string) => void }} opts
 *   journeys: config journey ids or ready-made journeys (purchase, add_to_cart, sign_up, lead, search).
 *   goals: extra journeys described in plain language. events: only check these events.
 *   providers: tracking providers to check (default: config "providers", else GA4, Google Ads, Meta, TikTok plus
 *     any other known platform the site sends to).
 *   saveSite: record the site's responses and the steps taken into this folder, for replaySite (see replay.js).
 *   replaySite: answer every request from a folder saved with saveSite, without the network.
 *   failOn: the --fail-on level (default "broken"), which decides what junit.xml marks as failed.
 *   concurrency: how many journeys (and consent scenarios) run at once, each in its own browser. Default 1, at most 8.
 *   against: { id, file } of the plan given with --against; opts.plan is then that plan. Used alone, the
 *   journeys come from the plan; with journeys or goals, only the plan events expected on them are checked.
 *   validated: true when config and plan came through loadConfig, which already checked them against the schema.
 *   baseline: a baseline read with readBaseline (see baseline.js). The findings it accepts are flagged
 *     accepted and left out of the counts; the result then has baseline: { accepted, stale }.
 */
export async function runAudit(opts) {
  const { gtmContainer } = opts;
  let config = opts.config;
  const events = opts.events ?? [];
  const log = opts.log ?? (() => {});
  if (!opts.validated) {
    const checked = [validateConfig(config), ...(opts.plan ? [validatePlan(opts.plan)] : [])];
    for (const w of checked.flatMap((c) => c.warnings)) log(w);
  }
  if (!config.site) throw new Error('No site to audit. Pass --site or set "site" in the config.');
  const lang = opts.lang ?? config.language ?? "en";
  if (!LANGUAGES[lang]) throw new Error(`Language must be one of ${Object.keys(LANGUAGES).join(", ")}.`);
  const useAi = opts.ai !== false;
  if (!useAi && !opts.scripted) throw new Error("Without an AI model, journeys must be replayed from their fixed steps (scripted).");

  const against = opts.against ? { ...opts.against, label: opts.against.id ?? path.relative(process.cwd(), opts.against.file) } : null;
  const { journeys, plan } = planRun({ config, plan: opts.plan, picks: opts.journeys, goals: opts.goals, events, against: Boolean(against) });
  const chosen = opts.providers ?? config.providers;
  // Without a choice, any other known platform the site sends to is checked too (see AuditSession).
  config = { ...config, providers: resolveProviders(chosen, plan), detect_providers: !(Array.isArray(chosen) ? chosen.length : chosen) };
  const viewports = opts.viewports?.length ? opts.viewports : config.viewports ?? ["desktop"];
  const allowed = Object.keys(VIEWPORTS).join(", ");
  if (!Array.isArray(viewports)) throw new Error(`"viewports" must be a list, e.g. ["desktop", "mobile"]. Allowed values: ${allowed}.`);
  const unknown = viewports.filter((v) => !Object.hasOwn(VIEWPORTS, v));
  if (unknown.length) throw new Error(`Unknown viewport ${unknown.map((v) => `"${v}"`).join(", ")}. Use: ${allowed}.`);
  const concurrency = parseConcurrency(opts.concurrency ?? config.concurrency);
  if (!journeys.length) throw new Error(`No journeys to run. A run needs one of:\n  --journey <name>   one of: ${Object.keys(JOURNEY_PRESETS).join(", ")} (or a journey id from your config)\n  --goal "<text>"    describe what to do in your own words\n  --config <file>    a config file with "journeys"\nNot sure what to test? "aitd plan --site ${config.site}" drafts a measurement plan.`);
  // A journey without fixed steps of its own repeats the steps of the site's last completed run, which every run saves.
  const replayed = new Map();
  if (opts.scripted) {
    const unscripted = [];
    for (const j of journeys.filter((j) => !j.steps?.length && !j.incomplete)) {
      for (const viewport of viewports) {
        // A saved-site replay stays offline: it never borrows steps from the runs folder.
        const last = opts.replaySite ? null : await lastSteps(opts.dataDir, config.site, { journeyId: j.id, viewport }).catch(() => null);
        if (last) replayed.set(`${j.id}|${viewport}`, last);
        else if (!unscripted.includes(j.id)) unscripted.push(j.id);
      }
    }
    if (unscripted.length) throw new Error(`Journeys without fixed steps can't be replayed with --scripted: ${unscripted.join(", ")}. Run them once with an AI model first; every completed run saves its steps.`);
  }

  if (against) {
    const notChecked = plan.events.filter((e) => Array.isArray(e.journeys) && !e.journeys.some((j) => journeys.some((jj) => jj.id === j))).length;
    log(`Checking against plan ${against.label}: ${journeys.length} ${journeys.length === 1 ? "journey" : "journeys"}${notChecked ? `, ${notChecked} planned ${notChecked === 1 ? "event" : "events"} not checked in this run` : ""}`);
    for (const j of journeys) {
      const expected = plan.events.filter((e) => !e.journeys || e.journeys.includes(j.id)).map((e) => e.name);
      log(`  - ${j.id}: ${j.goal ?? "fixed steps"}${expected.length ? ` [${[...new Set(expected)].join(", ")}]` : ""}`);
    }
  }

  const provider = useAi ? await createProvider({ name: opts.provider ?? config.provider, model: opts.model ?? config.model, baseUrl: opts.baseUrl ?? config.base_url, log }) : null;
  if (provider) log(`Using ${provider.name} (${provider.model})${provider.via ? ` via ${provider.via}` : ""}${alsoSet(provider.key)}`);

  if (opts.saveSite) await mkdir(opts.saveSite, { recursive: true });
  // Repeat runs start from the route the last completed run took. Not with --out or a replay, which have no history to learn from.
  const hints = provider && !opts.outDir && !opts.replaySite ? await routeHints(opts.dataDir, config.site).catch(() => new Map()) : new Map();
  // Every journey × viewport pair has its own browser, so they can run side by side. The runs keep the pairs'
  // order whatever finishes first: the report and the comparison with the last run count on it.
  const jobs = journeys.flatMap((journey) => viewports.map((viewport) => ({ journey, viewport })));
  const runs = await runPool(jobs, concurrency, async ({ journey, viewport }) => {
    // Side by side, each job's lines start with its name, so the interleaved output stays readable.
    const jobLog = concurrency > 1 ? taggedLog(log, `[${journey.id}/${viewport}]`) : log;
    jobLog(`\n▶ ${journey.id} (${viewport})`);
    const hint = hints.get(`${journey.id}|${viewport}`);
    const routeHint = hint && hint.goal === journey.goal ? hint.pages : undefined;
    if (routeHint) jobLog(`  Starting from the route of the last completed run (${routeHint.length} ${routeHint.length === 1 ? "page" : "pages"})`);
    const last = replayed.get(`${journey.id}|${viewport}`);
    if (last) jobLog(`  Replaying the steps of run ${last.runId}${last.viewport === viewport ? "" : ` (${last.viewport})`}`);
    const fixed = last ? { ...journey, ...(last.start ? { start: last.start } : {}), steps: last.steps, stepsFrom: last.runId } : journey;
    // runJourney keeps its own errors in the run. This catches the rest, such as a browser that won't close,
    // so one journey can't cost the report of the others.
    const run = await runJourney(config, fixed, viewport, { scripted: opts.scripted, provider, routeHint, maxSteps: opts.maxSteps, headed: opts.headed, lang, log: jobLog, saveSite: opts.saveSite, replaySite: opts.replaySite }).catch((err) => failedRun(journey, viewport, err, config.providers));
    jobLog(`  ${run.completed ? "✓" : "✗"} ${run.note} · ${run.hits.length} tracking hits captured`);
    return run;
  });

  // Consent scenarios need the live site, so a replay from a saved site skips them. "consent_scenarios": false turns them off.
  const consentScenarios = opts.replaySite || config.consent_scenarios === false
    ? null
    : await runConsentScenarios(config, { headed: opts.headed, log, concurrency }).catch((err) => (log(`  Consent scenarios failed: ${err.message}`), null));

  const findings = annotateFindings(filterFindings(runs.flatMap((run) => checkRun(plan, run, { lang })), events), gtmContainer, runs, { lang });
  // Applied before anything reads the findings, so the explanation, the reports, the alerts and the counts all skip accepted ones.
  const applied = opts.baseline ? applyBaseline(findings, opts.baseline) : null;
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

  // Runs saved in the site's runs folder are compared with the one before; a run sent to --out is not.
  const previous = opts.outDir ? undefined : await previousRun(opts.dataDir, config.site);
  const outDir = path.resolve(opts.outDir ?? (await newRunDir(opts.dataDir, config.site)).dir);
  const { reportPath, summaryPath, changes, metrics, verdict, trend, stability } = await writeReports({ outDir, config, plan, runs, findings, explained, lang, ai: provider ? { name: provider.name, model: provider.model } : null, against, branding: opts.branding ?? config.branding !== false, previous, planChanges: against ? await previousPlanChanges(opts.dataDir, config.site, against.id, plan).catch(() => null) : null, consentScenarios, brand: opts.brand ?? null, failOn: opts.failOn, history: previous === undefined ? null : { dataDir: opts.dataDir } });
  if (config.notify && changes) {
    const { sent, errors } = await sendAlerts({ notify: config.notify, site: new URL(config.site).hostname, changes: { run: path.basename(outDir), ...changes }, lang, reportPath, verdict, trend });
    if (sent.length) log(`\nSent the changes since the last run to ${sent.join(" and ")}.`);
    for (const e of errors) log(`\nCould not send an alert. ${e}`);
  }
  const grouped = groupFindings(findings);
  const counts = summarize(grouped);
  // Accepted is counted on the grouped findings, like the counts shown next to it.
  const baseline = applied ? { accepted: grouped.filter((f) => f.accepted).length, stale: applied.stale } : null;
  return { journeys, plan, runs, findings, explained, counts, metrics, verdict, trend, stability, reportPath, summaryPath, outDir, lang, consentScenarios, ...(against ? { againstId: against.id } : {}), ...(baseline ? { baseline } : {}), ...(saveError ? { saveError } : {}) };
}
