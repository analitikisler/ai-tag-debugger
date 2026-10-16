import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PLAN_FILE, newPlanDir } from "./workspace.js";

/** Saves a plan in a new aitd/<domain>/plans/<id>/ folder and returns where. */
export async function savePlan(plan, { dataDir, site, now } = {}) {
  const { id, dir } = await newPlanDir(dataDir, site, now);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, PLAN_FILE);
  await writeFile(file, `${JSON.stringify(plan, null, 2)}\n`);
  return { id, dir, file };
}
