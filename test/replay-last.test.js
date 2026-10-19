// Every run leaves steps.json in its folder, and a --scripted run repeats the last completed run's
// steps for a journey that has none of its own, so a site needs the AI only once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAudit, writeReports } from "../src/audit.js";
import { lastSteps, STEPS_FILE } from "../src/replay.js";
import { runsDir } from "../src/workspace.js";

const SITE = "https://www.example.com";
const entry = (id, viewport, extra = {}) => ({ id, viewport, steps: [{ action: "click", text: viewport }], ...extra });

/** Fake run folders, newest last; a null entry is a run from before steps were saved. */
async function runFolders(dataDir, site, folders) {
  for (const [id, journeys] of Object.entries(folders)) {
    const dir = path.join(runsDir(dataDir, site), id);
    await mkdir(dir, { recursive: true });
    if (journeys) await writeFile(path.join(dir, STEPS_FILE), JSON.stringify({ site, journeys }));
  }
}

test("lastSteps takes the newest completed run on the same viewport, else on another, and skips incomplete entries", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "aitd-last-steps-"));
  try {
    await runFolders(dataDir, SITE, {
      "2026-10-01_0900": [entry("browse", "desktop", { start: `${SITE}/shop` })],
      "2026-10-02_0900": [entry("browse", "desktop", { incomplete: "no cart" }), entry("browse", "mobile")],
      "2026-10-03_0900": [entry("browse", "desktop", { incomplete: "bot check" }), entry("other", "desktop")],
      "2026-10-04_0900": null,
    });
    assert.deepEqual(await lastSteps(dataDir, SITE, { journeyId: "browse", viewport: "desktop" }), {
      runId: "2026-10-01_0900", viewport: "desktop", start: `${SITE}/shop`, steps: [{ action: "click", text: "desktop" }],
    });
    assert.equal((await lastSteps(dataDir, SITE, { journeyId: "browse", viewport: "mobile" })).runId, "2026-10-02_0900");
    const fallback = await lastSteps(dataDir, SITE, { journeyId: "browse", viewport: "tablet" });
    assert.deepEqual({ runId: fallback.runId, viewport: fallback.viewport }, { runId: "2026-10-02_0900", viewport: "mobile" });
    assert.equal((await lastSteps(dataDir, SITE, { journeyId: "other", viewport: "desktop" })).runId, "2026-10-03_0900");
    assert.equal(await lastSteps(dataDir, SITE, { journeyId: "checkout", viewport: "desktop" }), null);
    assert.equal(await lastSteps(dataDir, "https://other.example", { journeyId: "browse", viewport: "desktop" }), null);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("writeReports saves steps.json with the repeatable steps of each journey and viewport", async () => {
  const out = await mkdtemp(path.join(tmpdir(), "aitd-steps-json-"));
  try {
    const step = (index, replay, extra = {}) => ({ index, label: `step ${index}`, t: index, replay, ...extra });
    const base = { hits: [], consentStep: null, dataLayerLog: [], network: [], providers: ["ga4"], startedAt: 0 };
    const runs = [
      { ...base, journeyId: "buy", viewport: "desktop", completed: true, note: "done", steps: [step(0), step(1, { action: "goto", url: `${SITE}/p` }), step(2, { action: "click", selector: "#add" }, { acceptsConsent: true })] },
      { ...base, journeyId: "buy", viewport: "mobile", completed: false, note: "no cart", steps: [step(0), step(1, { action: "click", text: "Shop" }, { error: "covered" })] },
      { ...base, journeyId: "empty", viewport: "desktop", completed: true, note: "done", steps: [step(0)] },
    ];
    await writeReports({ outDir: out, config: { site: SITE }, plan: null, runs, findings: [], explained: null, lang: "en" });
    assert.deepEqual(JSON.parse(await readFile(path.join(out, STEPS_FILE), "utf8")), {
      site: SITE,
      journeys: [
        { id: "buy", viewport: "desktop", start: `${SITE}/p`, steps: [{ action: "click", selector: "#add", reason: "step 2", accepts_consent: true }] },
        { id: "buy", viewport: "mobile", incomplete: "no cart", steps: [{ action: "click", text: "Shop", reason: "step 1", optional: true }] },
      ],
    });
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

const send = (en) => `fetch("https://region1.google-analytics.com/g/collect?v=2&tid=G-1&cid=1.2&_s=1&en=${en}", { method: "POST", keepalive: true });`;
const PAGES = {
  "/": `<!doctype html><script>${send("page_view")}</script><a href="/product">Product</a>`,
  "/product": `<!doctype html><script>${send("view_item")}</script><p>Product</p>`,
};

test("a --scripted run repeats the steps the last completed run saved for a journey that has none, and says when they no longer fit", async () => {
  const server = createServer((req, res) => {
    const page = PAGES[new URL(req.url, "http://x").pathname];
    res.writeHead(page === undefined ? 404 : 200, { "content-type": "text/html" }).end(page ?? "");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const dataDir = await mkdtemp(path.join(tmpdir(), "aitd-replay-last-"));
  const lines = [];
  const log = (m) => lines.push(m);
  try {
    const config = { site: url, providers: ["ga4"], consent_scenarios: false, journeys: [{ id: "browse", goal: "Open a product", steps: [{ action: "click", text: "Product", reason: "Open the product" }] }] };
    const first = await runAudit({ config, scripted: true, ai: false, dataDir, log });
    const firstId = path.basename(first.outDir);
    assert.ok(first.runs[0].completed, first.runs[0].note);
    const saved = JSON.parse(await readFile(path.join(first.outDir, STEPS_FILE), "utf8"));
    assert.deepEqual(saved.journeys.map((j) => [j.id, j.viewport, j.steps.length]), [["browse", "desktop", 1]]);

    // The same journey with only an id and a goal, as a config without fixed steps has it.
    const bare = { ...config, journeys: [{ id: "browse", goal: "Open a product" }] };
    const again = await runAudit({ config: bare, scripted: true, ai: false, dataDir, log });
    assert.ok(lines.includes(`  Replaying the steps of run ${firstId}`), lines.join("\n"));
    assert.ok(again.runs[0].completed, again.runs[0].note);
    assert.equal(again.runs[0].goal, "Open a product");
    assert.ok(again.runs[0].hits.some((h) => h.name === "view_item"));

    await assert.rejects(
      runAudit({ config: { ...config, journeys: [{ id: "checkout", goal: "Buy something" }] }, scripted: true, ai: false, dataDir }),
      /can't be replayed with --scripted: checkout\. Run them once with an AI model first; every completed run saves its steps\./,
    );

    // As if the site changed since its newest run: the saved click finds nothing.
    await runFolders(dataDir, url, { "2999-01-01_0000": [{ id: "browse", viewport: "desktop", steps: [{ action: "click", selector: "#gone", reason: "Open the old product link" }] }] });
    const changed = await runAudit({ config: bare, scripted: true, ai: false, dataDir, log });
    assert.equal(changed.runs[0].completed, false);
    assert.match(changed.runs[0].note, /^Step "Open the old product link" failed: .*The steps saved by run 2999-01-01_0000 no longer fit the site\. Run the journey with an AI model once to save new ones\.$/);
  } finally {
    server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
