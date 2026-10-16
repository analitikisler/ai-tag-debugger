import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { savePlan } from "../src/plan.js";

test("savePlan writes measurement-plan.json in a new plans/<id>/ folder per save", async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "aitd-plan-"));
  const plan = { consent_mode: true, events: [{ platform: "ga4", name: "purchase" }], user_properties: [] };
  const now = new Date(2026, 9, 16, 9, 5, 7);
  const a = await savePlan(plan, { dataDir, site: "https://www.shop.test/", now });
  assert.equal(a.id, "2026-10-16_0905");
  assert.equal(a.dir, path.join(dataDir, "shop.test", "plans", "2026-10-16_0905"));
  assert.deepEqual(JSON.parse(readFileSync(a.file, "utf8")), plan);
  const b = await savePlan(plan, { dataDir, site: "https://shop.test", now });
  assert.equal(b.id, "2026-10-16_090507");
});
