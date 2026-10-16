import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { domainOf, listPlanIds, newId, newRunDir, resolvePlan } from "../src/workspace.js";

test("domainOf drops www. and the path", () => {
  assert.equal(domainOf("https://www.Example.com/shop?x=1"), "example.com");
  assert.equal(domainOf("http://localhost:4173/"), "localhost");
  assert.throws(() => domainOf("example.com"), /not a full URL/);
});

test("newId uses local minutes and adds seconds when the minute is taken", () => {
  const now = new Date(2026, 0, 2, 3, 4, 5);
  assert.equal(newId([], now), "2026-01-02_0304");
  assert.equal(newId(["2026-01-02_0304"], now), "2026-01-02_030405");
});

function workspace() {
  const dataDir = mkdtempSync(path.join(tmpdir(), "aitd-ws-"));
  for (const id of ["2026-10-16_0900", "2026-10-15_1200", "2026-10-16_090030"]) {
    const dir = path.join(dataDir, "shop.test", "plans", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "measurement-plan.json"), "{}");
  }
  mkdirSync(path.join(dataDir, "shop.test", "plans", "notes"));
  return dataDir;
}

test("listPlanIds sorts the site's plan IDs newest last and skips other folders", async () => {
  assert.deepEqual(await listPlanIds(workspace(), "https://www.shop.test"), ["2026-10-15_1200", "2026-10-16_0900", "2026-10-16_090030"]);
  assert.deepEqual(await listPlanIds(workspace(), "https://other.test"), []);
});

test("resolvePlan takes latest, last, first, an ID or a path", async () => {
  const dataDir = workspace();
  const site = "https://shop.test";
  const opts = { dataDir, site };
  assert.equal((await resolvePlan("latest", opts)).id, "2026-10-16_090030");
  assert.equal((await resolvePlan("last", opts)).id, "2026-10-16_090030");
  assert.equal((await resolvePlan("first", opts)).id, "2026-10-15_1200");
  const byId = await resolvePlan("2026-10-16_0900", opts);
  assert.equal(byId.file, path.join(dataDir, "shop.test", "plans", "2026-10-16_0900", "measurement-plan.json"));
  const folder = path.join(dataDir, "shop.test", "plans", "2026-10-15_1200");
  assert.deepEqual(await resolvePlan(folder), { id: "2026-10-15_1200", file: path.join(folder, "measurement-plan.json") });
  assert.equal((await resolvePlan(path.join(folder, "measurement-plan.json"))).id, "2026-10-15_1200");
  await assert.rejects(resolvePlan("2026-01-01_0000", opts), /No plan 2026-01-01_0000 for shop\.test\. Available: 2026-10-15_1200, 2026-10-16_0900, 2026-10-16_090030/);
  await assert.rejects(resolvePlan("latest", { dataDir, site: "https://new.test" }), /No plan yet for new\.test\. Draft one with: aitd plan --site https:\/\/new\.test/);
  await assert.rejects(resolvePlan(path.join(dataDir, "nope")), /No plan found at/);
});

test("newRunDir puts runs under <domain>/runs/<id>", async () => {
  const dataDir = workspace();
  const { id, dir } = await newRunDir(dataDir, "https://www.shop.test", new Date(2026, 9, 16, 9, 0));
  assert.equal(dir, path.join(dataDir, "shop.test", "runs", id));
});
