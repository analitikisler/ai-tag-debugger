import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderPlanHtml } from "./plan-html.js";
import { PLAN_FILE, PLAN_HTML_FILE, newPlanDir } from "./workspace.js";
import { validatePlan } from "./schema.js";

/**
 * Saves a plan (measurement-plan.json and plan.html) in a new aitd/<domain>/plans/<id>/ folder and returns where.
 * The plan is checked first, so nothing a later run would refuse gets saved.
 */
export async function savePlan(plan, { dataDir, site, now, branding = true } = {}) {
  validatePlan(plan);
  const { id, dir } = await newPlanDir(dataDir, site, now);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, PLAN_FILE);
  await writeFile(file, `${JSON.stringify(plan, null, 2)}\n`);
  await writeFile(path.join(dir, PLAN_HTML_FILE), renderPlanHtml(plan, { id, generatedAt: (now ?? new Date()).toISOString().slice(0, 16).replace("T", " "), branding }));
  return { id, dir, file };
}
