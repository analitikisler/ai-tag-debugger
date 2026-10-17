import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { planToRows, rowsToPlan, parseCsv, toCsv, writeXlsx, readXlsx, readPlanSheet, writePlanSheet, EVENT_COLUMNS } from "../src/sheet.js";
import { savePlan } from "../src/plan.js";

const plan = {
  site: "https://shop.test",
  consent_mode: true,
  events: [
    {
      platform: "ga4",
      name: "add_to_cart",
      description: "Visitor adds a product to the cart",
      trigger: { page: "product", element: "Add to cart" },
      required_params: ["currency", "value"],
      parameters: { currency: { description: "ISO code", example: "EUR" }, value: { example: "19.90" }, size: { custom: true, description: 'Size, e.g. "M", with, commas', example: "M" } },
    },
    { platform: "ga4", name: "size_guide_open", custom: true, description: "Opens the size guide", trigger: { page: "product" } },
    { platform: "meta", name: "Purchase", journeys: ["checkout"], required_params: ["value", "currency"], parameters: { value: {}, currency: {} } },
  ],
  user_properties: [{ name: "customer_type", description: "new or returning", example: "returning" }],
};

const tabs = (p) => {
  const { events, user_properties } = planToRows(p);
  const cols = [...EVENT_COLUMNS, "custom", "journeys"];
  return { events: [cols, ...events.map((r) => cols.map((c) => r[c]))], user_properties: [["name", "description", "example"], ...user_properties.map((u) => [u.name, u.description, u.example])] };
};
const events = (...rows) => ({ events: [EVENT_COLUMNS, ...rows] });
const err = (t, msg) => assert.throws(() => rowsToPlan(t), (e) => e.message === msg);

test("rows round trip gives the same plan", () => {
  assert.deepEqual(rowsToPlan(tabs(plan), { site: plan.site }).plan, plan);
});

test("CSV round trip through files gives the same plan", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aitd-sheet-"));
  const files = await writePlanSheet(plan, dir, { format: "csv" });
  assert.deepEqual(files.map((f) => path.basename(f)), ["events.csv", "user_properties.csv"]);
  const { plan: back, warnings } = await readPlanSheet(files[0], { site: plan.site });
  assert.deepEqual(back, plan);
  assert.deepEqual(warnings, []);
});

test("xlsx round trip gives the same plan", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aitd-sheet-"));
  const [file] = await writePlanSheet(plan, dir);
  assert.equal(path.basename(file), "plan.xlsx");
  const { plan: back } = await readPlanSheet(file, { site: plan.site });
  assert.deepEqual(back, plan);
});

test("readXlsx reads shared strings, numbers and gaps", async () => {
  const bytes = await writeXlsx({ events: [["a", "", "c"], [], ["x & <y>"]] });
  const sheets = await readXlsx(bytes);
  assert.deepEqual(sheets.events, [["a", "", "c"], [], ["x & <y>"]]);
});

test("parseCsv handles quotes, newlines and semicolons", () => {
  assert.deepEqual(parseCsv(toCsv([["a", 'b "q", c'], ["line\nbreak", ""]])), [["a", 'b "q", c'], ["line\nbreak", ""]]);
  assert.deepEqual(parseCsv("event;platform\r\npurchase;ga4\r\n"), [["event", "platform"], ["purchase", "ga4"]]);
});

test("an event with no parameters is one row with an empty parameter", () => {
  const { plan: p } = rowsToPlan(events(["page_view", "ga4", "", "", "", "", ""]));
  assert.deepEqual(p.events, [{ platform: "ga4", name: "page_view" }]);
});

test("unknown columns are ignored with a warning", () => {
  const { warnings } = rowsToPlan({ events: [[...EVENT_COLUMNS, "owner"], ["purchase", "ga4", "value", "yes", "", "", "", "Ann"]] });
  assert.deepEqual(warnings, ['events: column "owner" is not used and was ignored.']);
});

test("errors name the tab, row and fix", () => {
  err(events(["purchase", "ga4", "value", "yes", "", "", ""], ["purchase", "ga4", "currency", "maybe", "", "", ""]), 'events, row 3: "required" must be yes or no (found "maybe").');
  err(events(["", "ga4", "value", "yes", "", "", ""]), 'events, row 2: "event" is empty. Give the event name, e.g. purchase.');
  err(events(["purchase", "ga4", "", "yes", "", "", ""]), 'events, row 2: "required" is set but "parameter" is empty. Name the parameter, or leave "required" empty on the event\'s own row.');
  err(events(["purchase", "ga4", "value", "yes", "", "", ""], ["purchase", "ga4", "value", "no", "", "", ""]), 'events, row 3: parameter "value" of purchase is listed twice. Keep one row per parameter.');
  err({ events: [["event", "platform"], ["purchase", "ga4"]] }, 'events, row 1: missing columns "parameter", "required", "example", "trigger". The first row must name the columns: event, platform, parameter, required, example, trigger, description.');
  err({ events: [] }, "events: the tab is empty. Its first row must name the columns: event, platform, parameter, required, example, trigger, description.");
  err(events(), "events: no events found. Add one row per event parameter below the column names.");
  err({ ...events(["purchase", "ga4", "", "", "", "", ""]), user_properties: [["name", "description", "example"], ["", "x", ""]] }, 'user_properties, row 2: "name" is empty. Give the user property name, e.g. customer_type.');
  err({ ...events(["purchase", "ga4", "", "", "", "", ""]), user_properties: [["name", "description", "example"], ["a", "", ""], ["a", "", ""]] }, 'user_properties, row 3: "a" is listed twice. Keep one row per user property.');
});

test("unknown platforms and custom values are rejected", () => {
  assert.throws(() => rowsToPlan(events(["purchase", "mixpanel", "", "", "", "", ""])), /^Error: events, row 2: "platform" must be one of ga4, .+ \(found "mixpanel"\)\.$/);
  assert.throws(() => rowsToPlan({ events: [[...EVENT_COLUMNS, "custom"], ["purchase", "ga4", "", "", "", "", "", "sometimes"]] }), /events, row 2: "custom" must be yes, no, event or parameter \(found "sometimes"\)\./);
});

test("readPlanSheet asks for an events tab and a known file type", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aitd-sheet-"));
  const file = path.join(dir, "x.xlsx");
  writeFileSync(file, await writeXlsx({ Sheet1: [["event"]] }));
  await assert.rejects(readPlanSheet(file), { message: 'x.xlsx has no tab named "events" (found "Sheet1"). Rename the tab with the events to "events".' });
  writeFileSync(path.join(dir, "plan.json"), "{}");
  await assert.rejects(readPlanSheet(path.join(dir, "plan.json")), { message: "Import a .xlsx or .csv file (got plan.json)." });
  writeFileSync(path.join(dir, "bad.xlsx"), "nope");
  await assert.rejects(readPlanSheet(path.join(dir, "bad.xlsx")), { message: "This is not a readable .xlsx file. Save it as an Excel workbook (.xlsx) or as CSV." });
});

test("aitd plan export then import saves a new, identical plan", async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "aitd-sheet-"));
  const site = "https://www.shop.test";
  await savePlan(plan, { dataDir, site, now: new Date(2026, 0, 1, 9, 0) });
  const run = (...a) => execFileSync(process.execPath, ["src/cli.js", "plan", ...a, "--site", site, "--data-dir", dataDir], { encoding: "utf8" });
  const plans = path.join(dataDir, "shop.test", "plans");
  assert.match(run("export", "latest", "--format", "csv"), /Exported the plan to .*events\.csv and .*user_properties\.csv/);
  assert.match(run("export", "latest"), /plan\.xlsx/);
  const out = run("import", path.join(plans, "2026-01-01_0900", "plan.xlsx"));
  assert.match(out, /Imported plan \S+: 3 events and 1 user properties/);
  const ids = readdirSync(plans).sort();
  assert.equal(ids.length, 2);
  assert.deepEqual(JSON.parse(readFileSync(path.join(plans, ids[1], "measurement-plan.json"), "utf8")), { ...plan, site });
  assert.deepEqual(JSON.parse(readFileSync(path.join(plans, ids[0], "measurement-plan.json"), "utf8")), plan);
});

test("plan import and export explain what is missing", () => {
  const fails = (args, msg) => assert.throws(() => execFileSync(process.execPath, ["src/cli.js", "plan", ...args], { encoding: "utf8", stdio: "pipe" }), (e) => e.status === 2 && e.stderr.includes(msg));
  fails(["import"], "plan import needs a file");
  fails(["import", "x.xlsx"], "plan import needs --site <url>");
  fails(["export"], "plan export needs a plan");
  fails(["export", "latest", "--site", "https://a.test", "--format", "ods"], '--format must be xlsx or csv (found "ods")');
});
