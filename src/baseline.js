// A baseline file: findings a team has looked at and accepted. A run with a baseline still
// lists them in the report, but they don't count toward the exit code, so a deploy fails only
// on new problems. Only each entry's key is matched; the other fields are there for whoever
// reads the file.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * The key a finding is accepted by. It names what went wrong and where, and for missing
 * parameters which ones, and leaves out everything that differs from run to run: the step a
 * hit was seen on, timings, counts and the wording of the detail.
 */
export function findingKey(f) {
  return [f.check, f.platform ?? "-", f.event ?? "-", f.journey, f.viewport, f.params?.length ? f.params.join(",") : "-"].join(" ");
}

/** Reads a baseline file written by writeBaseline. A missing file throws with code ENOENT. */
export async function readBaseline(file) {
  let baseline;
  try {
    baseline = JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    const wrapped = new Error(`Could not read the baseline ${file}: ${err.message}`);
    wrapped.code = err.code;
    throw wrapped;
  }
  if (!Array.isArray(baseline?.findings) || baseline.findings.some((b) => typeof b?.key !== "string")) {
    throw new Error(`${file} is not a baseline: it needs a "findings" list with a "key" on each entry. Write one with --update-baseline.`);
  }
  return baseline;
}

/**
 * Marks the findings the baseline accepts with accepted: true.
 * @returns {{ accepted: number, partial: number, stale: string[] }} how many findings were accepted, how many
 *   problems are accepted in some of their places but not all (the report still counts those, see groupFindings),
 *   and the baseline keys no finding matched any more.
 */
export function applyBaseline(findings, baseline) {
  const keys = new Set(baseline.findings.map((b) => b.key));
  const seen = new Set();
  // Per problem, as groupFindings merges the places: how many of its findings the baseline accepts.
  const problems = new Map();
  let accepted = 0;
  for (const f of findings) {
    if (f.severity === "ok") continue;
    const key = findingKey(f);
    const problem = [f.severity, f.check, f.platform, f.event, f.detail].join("|");
    const p = problems.get(problem) ?? { total: 0, accepted: 0 };
    p.total += 1;
    problems.set(problem, p);
    if (!keys.has(key)) continue;
    f.accepted = true;
    accepted += 1;
    p.accepted += 1;
    seen.add(key);
  }
  const partial = [...problems.values()].filter((p) => p.accepted && p.accepted < p.total).length;
  return { accepted, partial, stale: [...keys].filter((k) => !seen.has(k)) };
}

/**
 * Writes every current finding except the ok ones as the baseline, creating the file when it
 * doesn't exist. A note someone wrote on an entry that is still in the file is kept.
 * @returns {Promise<number>} how many findings the file now holds.
 */
export async function writeBaseline(file, { site, findings }) {
  const notes = new Map();
  const previous = await readBaseline(file).catch(() => null);
  for (const b of previous?.findings ?? []) if (b.note) notes.set(b.key, b.note);
  const entries = new Map();
  for (const f of findings) {
    if (f.severity === "ok") continue;
    const key = findingKey(f);
    if (entries.has(key)) continue;
    entries.set(key, {
      key,
      check: f.check,
      severity: f.severity,
      ...(f.platform ? { platform: f.platform } : {}),
      ...(f.event ? { event: f.event } : {}),
      journey: f.journey,
      viewport: f.viewport,
      ...(notes.has(key) ? { note: notes.get(key) } : {}),
    });
  }
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await writeFile(file, `${JSON.stringify({ site, updated: new Date().toISOString(), findings: [...entries.values()] }, null, 2)}\n`);
  return entries.size;
}
