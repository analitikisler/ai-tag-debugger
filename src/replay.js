// Saved sites: the responses a site sent during an audit and the steps taken, so a later
// version of the tool can audit the same pages offline and show what it now reports
// differently. Replays need no network and no AI model, so they cost nothing.
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { harName } from "./agent.js";
import { runAudit } from "./audit.js";

export const SAVED_SITE_FILE = "site.json";

/** The steps a run took, as fixed steps a scripted run can repeat. */
export function replayableJourney(run) {
  const steps = run.steps.filter((s) => s.index > 0);
  const start = steps[0]?.replay?.action === "goto" ? steps[0].replay.url : undefined;
  return {
    id: run.journeyId,
    viewport: run.viewport,
    ...(start ? { start } : {}),
    // A journey the AI could not finish (no cart, a bot check) is still incomplete when its steps replay.
    ...(run.completed ? {} : { incomplete: run.note }),
    steps: (start ? steps.slice(1) : steps)
      .filter((s) => s.replay)
      .map((s) => ({ ...s.replay, reason: s.label, ...(s.acceptsConsent ? { accepts_consent: true } : {}), ...(s.rejectsConsent ? { rejects_consent: true } : {}), ...(s.error ? { optional: true } : {}) })),
  };
}

/**
 * Writes the steps each journey took into journeys[].steps of a config file, so a later
 * --scripted --no-ai run repeats them without an AI model. Creates the file when it doesn't exist.
 * A journey run on several viewports keeps the steps of its first one. Journeys that took no
 * repeatable steps are left as they were. A config with no plan gets the run's, so ready-made
 * journeys keep their expected events.
 * @returns {Promise<{ saved: string[], skipped: string[] }>}
 */
export async function writeSavedSteps(file, { site, plan, journeys, runs }) {
  let config = {};
  const text = await readFile(file, "utf8").catch((err) => {
    if (err.code === "ENOENT") return null;
    throw new Error(`Could not read ${file}: ${err.message}`);
  });
  if (text !== null) {
    try {
      config = JSON.parse(text);
    } catch (err) {
      throw new Error(`Could not read ${file}: ${err.message}`);
    }
  }
  config.site ??= site;
  if (config.plan === undefined && plan?.events?.length) config.plan = plan;
  const list = [...(config.journeys ?? [])];
  const saved = [];
  const skipped = [];
  for (const journey of journeys) {
    const run = runs.find((r) => r.journeyId === journey.id);
    const { viewport: _v, ...steps } = run ? replayableJourney(run) : { steps: [] };
    if (!steps.steps.length && !steps.start) {
      skipped.push(journey.id);
      continue;
    }
    const i = list.findIndex((j) => j.id === journey.id);
    const { start: _s, steps: _st, incomplete: _in, ...kept } = i === -1 ? { id: journey.id, ...(journey.goal ? { goal: journey.goal } : {}) } : list[i];
    const entry = { ...kept, ...steps, id: journey.id };
    if (i === -1) list.push(entry);
    else list[i] = entry;
    saved.push(journey.id);
  }
  if (saved.length) {
    await mkdir(path.dirname(path.resolve(file)), { recursive: true });
    await writeFile(file, `${JSON.stringify({ ...config, journeys: list }, null, 2)}\n`);
  }
  return { saved, skipped };
}

/** One line per finding, sorted: what a replay is compared on. */
export function findingKeys(findings) {
  return findings.map((f) => [f.severity, f.check, f.journey, f.viewport, f.platform ?? "-", f.event ?? "-"].join(" ")).sort();
}

/** Lines in one list and not the other, counting repeats. */
export function compareKeys(expected, actual) {
  const left = [...actual];
  const missing = [];
  for (const k of expected) {
    const i = left.indexOf(k);
    if (i === -1) missing.push(k);
    else left.splice(i, 1);
  }
  return { missing, extra: left };
}

/** Writes site.json next to the recorded responses. The findings of this run become the expected ones. */
export async function writeSavedSite(dir, { config, plan, runs, findings }) {
  await mkdir(dir, { recursive: true });
  for (const run of runs) {
    const har = path.join(dir, harName(run.journeyId, run.viewport));
    if (!(await stat(har).catch(() => null))) {
      throw new Error(`The recording of ${run.journeyId} (${run.viewport}) is missing, probably because the browser closed early. Save the site again.`);
    }
  }
  const { journeys: _journeys, plan: _plan, gtm_container: _gtm, ...site } = config;
  const saved = {
    version: 1,
    saved_at: new Date().toISOString(),
    config: site,
    plan,
    journeys: runs.map(replayableJourney),
    expected: findingKeys(findings),
  };
  await writeFile(path.join(dir, SAVED_SITE_FILE), JSON.stringify(saved, null, 2));
}

/**
 * Audits a saved site again, offline and without AI, and compares the findings with the expected ones.
 * update: make this replay's findings the expected ones.
 * @returns {Promise<{ site: string, missing: string[], extra: string[], reportPaths: string[], incomplete: string[], foundByText: string[] }>}
 */
export async function replaySavedSite(dir, { update = false, outDir, log = () => {} } = {}) {
  const file = path.join(dir, SAVED_SITE_FILE);
  let saved;
  try {
    saved = JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    throw new Error(`Could not read ${file}: ${err.message}`);
  }
  const viewports = [...new Set(saved.journeys.map((j) => j.viewport))];
  const findings = [];
  const reportPaths = [];
  const incomplete = [];
  const foundByText = [];
  for (const viewport of viewports) {
    const journeys = saved.journeys.filter((j) => j.viewport === viewport).map(({ viewport: _v, ...j }) => j);
    const out = path.resolve(outDir ?? path.join(dir, "last-replay"), viewports.length > 1 ? viewport : "");
    const result = await runAudit({
      config: { ...saved.config, journeys },
      plan: saved.plan,
      viewports: [viewport],
      scripted: true,
      ai: false,
      replaySite: dir,
      lang: "en",
      outDir: out,
      log,
    });
    findings.push(...result.findings);
    reportPaths.push(result.reportPath);
    // Journeys that were already unfinished when saved are compared through their findings only.
    const wasIncomplete = (r) => journeys.find((j) => j.id === r.journeyId)?.incomplete === r.note;
    incomplete.push(...result.runs.filter((r) => !r.completed && !wasIncomplete(r)).map((r) => `${r.journeyId} (${r.viewport}): ${r.note}`));
    for (const r of result.runs) {
      for (const s of r.steps.filter((s) => s.foundBy === "text")) foundByText.push(`${r.journeyId} (${r.viewport}): "${s.label}" was clicked by its text, since nothing was at its saved place.`);
    }
  }
  const actual = findingKeys(findings);
  const { missing, extra } = compareKeys(saved.expected ?? [], actual);
  if (update && (missing.length || extra.length)) {
    await writeFile(file, JSON.stringify({ ...saved, expected: actual }, null, 2));
  }
  return { site: saved.config.site, missing, extra, reportPaths, incomplete, foundByText };
}
