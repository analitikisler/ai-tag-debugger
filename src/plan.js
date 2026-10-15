import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isConsentCommand } from "./checks.js";

// Sent on every GA4 hit by the tag itself, so a plan doesn't need to require them.
const AUTOMATIC_PARAMS = new Set(["page_location", "page_title", "page_referrer"]);
// Platforms whose hits are not measurement events (Hotjar only reports its own API calls).
const SKIPPED_PLATFORMS = new Set(["hotjar"]);

/** Reads capture.json, given as the file or the report folder that holds it. */
export async function readCapture(from) {
  const file = (await stat(from).catch(() => null))?.isDirectory() ? path.join(from, "capture.json") : from;
  const capture = JSON.parse(await readFile(file, "utf8").catch((err) => {
    throw new Error(`Could not read ${file}: ${err.code === "ENOENT" ? "no such file. Point --from at a run's capture.json or its report folder." : err.message}`);
  }));
  if (!Array.isArray(capture.runs)) throw new Error(`${file} has no "runs": it doesn't look like a capture.json from "aitd run".`);
  return capture;
}

/**
 * Drafts a measurement plan from the hits a run captured: one event per platform and name, the
 * parameters it sent every time as required, and the journeys it was seen on when not all of them.
 */
export function draftPlan(capture) {
  const runs = capture.runs ?? [];
  const journeyIds = [...new Set(runs.map((r) => r.journeyId).filter(Boolean))];
  const events = new Map();
  for (const run of runs) {
    for (const hit of run.hits ?? []) {
      if (!hit.name || hit.name === "(unnamed)" || SKIPPED_PLATFORMS.has(hit.platform)) continue;
      const key = `${hit.platform}\u0000${hit.name}`;
      const params = Object.keys(hit.params ?? {}).filter((p) => !AUTOMATIC_PARAMS.has(p) && hit.params[p] !== "");
      if (hit.items?.length && !params.includes("items")) params.push("items");
      const ev = events.get(key);
      if (!ev) events.set(key, { platform: hit.platform, name: hit.name, params: new Set(params), journeys: new Set([run.journeyId]) });
      else {
        for (const p of ev.params) if (!params.includes(p)) ev.params.delete(p);
        ev.journeys.add(run.journeyId);
      }
    }
  }
  const list = [...events.values()].map((ev) => {
    const journeys = [...ev.journeys].filter(Boolean);
    return {
      platform: ev.platform,
      name: ev.name,
      ...(journeyIds.length > 1 && journeys.length < journeyIds.length ? { journeys } : {}),
      ...(ev.params.size ? { required_params: [...ev.params].sort() } : {}),
    };
  });
  const consentMode = runs.some((r) => (r.dataLayerLog ?? []).some((e) => isConsentCommand(e, "default")));
  return { consent_mode: consentMode, events: list };
}

/** Drafts a plan from a run's capture.json and writes it. */
export async function writePlanFromRun(from, out, opts) {
  return writePlan(draftPlan(await readCapture(from)), out, opts);
}

/** Writes a plan to out, refusing to replace an existing file unless force is set. */
export async function writePlan(plan, out = "measurement-plan.json", { force = false } = {}) {
  if (!force && (await stat(out).catch(() => null))) throw new Error(`${out} already exists. Choose another file with --out, or add --force to replace it.`);
  await writeFile(out, `${JSON.stringify(plan, null, 2)}\n`);
  return { plan, out };
}
