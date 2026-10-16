import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/** Where plans and runs are kept unless --data-dir says otherwise. */
export const DEFAULT_DATA_DIR = "aitd";
export const PLAN_FILE = "measurement-plan.json";
export const PLAN_HTML_FILE = "plan.html";

const ID = /^\d{4}-\d{2}-\d{2}_\d{4}(\d{2})?$/;

/** The folder name for a site: its host without "www.", e.g. https://www.example.com/x -> example.com. */
export function domainOf(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`"${url}" is not a full URL. Use e.g. https://www.example.com`);
  }
  return host.toLowerCase().replace(/^www\./, "");
}

const pad = (n) => String(n).padStart(2, "0");

/** A local-time ID, YYYY-MM-DD_HHMM, with seconds added (_HHMMSS) when taken lists the minute's ID already. */
export function newId(taken = [], now = new Date()) {
  const minute = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  if (!taken.includes(minute)) return minute;
  return `${minute}${pad(now.getSeconds())}`;
}

export const siteDir = (dataDir = DEFAULT_DATA_DIR, site) => path.resolve(dataDir, domainOf(site));
export const plansDir = (dataDir, site) => path.join(siteDir(dataDir, site), "plans");
export const runsDir = (dataDir, site) => path.join(siteDir(dataDir, site), "runs");

async function listIds(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory() && ID.test(e.name)).map((e) => e.name).sort();
}

/** The site's plan IDs, oldest first and newest last. */
export const listPlanIds = (dataDir, site) => listIds(plansDir(dataDir, site));
export const listRunIds = (dataDir, site) => listIds(runsDir(dataDir, site));

/** A new, not yet created folder for the site's next plan. */
export async function newPlanDir(dataDir, site, now) {
  const id = newId(await listPlanIds(dataDir, site), now);
  return { id, dir: path.join(plansDir(dataDir, site), id) };
}

/** A new, not yet created folder for the site's next run. */
export async function newRunDir(dataDir, site, now) {
  const id = newId(await listRunIds(dataDir, site), now);
  return { id, dir: path.join(runsDir(dataDir, site), id) };
}

/**
 * Finds a plan file from a reference: "latest" or "last", "first", a plan ID, or a path to a plan
 * file or the folder that holds one. Returns { id, file }; id is null for a path outside the site's plans.
 */
export async function resolvePlan(ref, { dataDir = DEFAULT_DATA_DIR, site } = {}) {
  const value = String(ref ?? "latest").trim();
  const byKeyword = ["latest", "last", "first"].includes(value);
  if (byKeyword || ID.test(value)) {
    if (!site) throw new Error(`Add --site <url> to find plan "${value}".`);
    const ids = await listPlanIds(dataDir, site);
    if (!ids.length) throw new Error(`No plan yet for ${domainOf(site)}. Draft one with: aitd plan --site ${site}`);
    const id = value === "first" ? ids[0] : byKeyword ? ids.at(-1) : ids.includes(value) ? value : null;
    if (!id) throw new Error(`No plan ${value} for ${domainOf(site)}. Available: ${ids.join(", ")}`);
    return { id, file: path.join(plansDir(dataDir, site), id, PLAN_FILE) };
  }
  const info = await stat(value).catch(() => null);
  if (!info) throw new Error(`No plan found at ${value}. Use latest, first, a plan ID, or a path to a plan file or folder.`);
  const file = info.isDirectory() ? path.join(value, PLAN_FILE) : value;
  if (info.isDirectory() && !(await stat(file).catch(() => null))) throw new Error(`${value} has no ${PLAN_FILE}.`);
  const id = path.basename(path.dirname(path.resolve(file)));
  return { id: ID.test(id) ? id : null, file: path.resolve(file) };
}
