// Plan import and export as a spreadsheet: one row per event parameter on an "events" tab and
// one row per user property on a "user_properties" tab. CSV needs nothing extra; .xlsx uses the
// optional fflate package (zip), loaded only when an .xlsx file is read or written.
import { readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { PROVIDERS as PLATFORMS } from "./parsers.js";
import { validatePlan } from "./schema.js";

export const EVENT_COLUMNS = ["event", "platform", "parameter", "required", "example", "trigger", "description"];
// Optional columns that keep the rest of a plan on a round trip.
export const EXTRA_EVENT_COLUMNS = ["custom", "journeys"];
export const USER_PROPERTY_COLUMNS = ["name", "description", "example"];
const TRIGGER_SEP = " > ";

// ---------- plan <-> rows ----------

const yesNo = (v) => (v ? "yes" : "no");

/** The plan as the two tabs' rows: { events: object[], user_properties: object[] }. */
export function planToRows(plan) {
  const events = [];
  for (const ev of plan.events ?? []) {
    const trigger = ev.trigger ? [ev.trigger.page, ev.trigger.element].filter(Boolean).join(TRIGGER_SEP) : "";
    const params = { ...(ev.parameters ?? {}) };
    for (const p of ev.required_params ?? []) params[p] ??= {};
    const required = new Set(ev.required_params ?? []);
    const base = { event: ev.name, platform: ev.platform ?? "ga4", custom: ev.custom ? "yes" : "", journeys: (ev.journeys ?? []).join(", ") };
    const names = Object.keys(params);
    // An event row (empty parameter) carries the event's own description; it is left out when the
    // event has parameters and nothing to say.
    if (!names.length || ev.description) events.push({ ...base, parameter: "", required: "", example: "", trigger, description: ev.description ?? "" });
    for (const name of names) {
      const p = params[name] ?? {};
      events.push({
        ...base,
        parameter: name,
        required: yesNo(required.has(name)),
        example: p.example ?? "",
        trigger,
        description: p.description ?? "",
        custom: [ev.custom ? "event" : "", p.custom ? "parameter" : ""].filter(Boolean).join(", "),
      });
    }
  }
  const user_properties = (plan.user_properties ?? []).map((u) => ({ name: u.name, description: u.description ?? "", example: u.example ?? "" }));
  return { events, user_properties };
}

const fail = (msg) => {
  const err = new Error(msg);
  err.sheetError = true;
  return err;
};

function headerOf(tab, rows, needed, optional, warnings) {
  if (!rows.length) throw fail(`${tab}: the tab is empty. Its first row must name the columns: ${needed.join(", ")}.`);
  const header = rows[0].map((h) => String(h ?? "").trim().toLowerCase());
  const missing = needed.filter((c) => !header.includes(c) && !(c === "description" && tab === "events"));
  if (missing.length) throw fail(`${tab}, row 1: missing column${missing.length > 1 ? "s" : ""} ${missing.map((c) => `"${c}"`).join(", ")}. The first row must name the columns: ${needed.join(", ")}.`);
  const unknown = header.filter((h) => h && !needed.includes(h) && !optional.includes(h));
  for (const h of unknown) warnings.push(`${tab}: column "${h}" is not used and was ignored.`);
  return header;
}

function records(rows, header) {
  return rows.slice(1).map((cells, i) => {
    const rec = { row: i + 2 };
    header.forEach((h, j) => {
      if (h) rec[h] = String(cells[j] ?? "").trim();
    });
    return rec;
  }).filter((r) => header.some((h) => h && r[h]));
}

/**
 * Builds a plan from the two tabs' rows (arrays of cell arrays, header first).
 * Returns { plan, warnings }. Throws an error naming the tab, row and fix.
 */
export function rowsToPlan({ events: eventRows = [], user_properties: upRows = null }, { site } = {}) {
  const warnings = [];
  const header = headerOf("events", eventRows, EVENT_COLUMNS, EXTRA_EVENT_COLUMNS, warnings);
  const byKey = new Map();
  for (const r of records(eventRows, header)) {
    const at = `events, row ${r.row}`;
    if (!r.event) throw fail(`${at}: "event" is empty. Give the event name, e.g. purchase.`);
    const platform = (r.platform || "ga4").toLowerCase();
    if (!PLATFORMS[platform]) throw fail(`${at}: "platform" must be one of ${Object.keys(PLATFORMS).join(", ")} (found "${r.platform}").`);
    // Google Sheets checkboxes export as TRUE/FALSE.
    const required = { true: "yes", false: "no" }[(r.required ?? "").toLowerCase()] ?? (r.required ?? "").toLowerCase();
    if (!["yes", "no", ""].includes(required)) throw fail(`${at}: "required" must be yes or no (found "${r.required}").`);
    if (required && !r.parameter) throw fail(`${at}: "required" is set but "parameter" is empty. Name the parameter, or leave "required" empty on the event's own row.`);
    const custom = (r.custom ?? "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
    const okCustom = ["yes", "no", "event", "parameter"];
    const bad = custom.find((c) => !okCustom.includes(c));
    if (bad) throw fail(`${at}: "custom" must be yes, no, event or parameter (found "${r.custom}").`);

    const key = `${platform}:${r.event}`;
    let ev = byKey.get(key);
    if (!ev) {
      ev = { platform, name: r.event, parameters: {}, required_params: [] };
      byKey.set(key, ev);
    }
    if (custom.includes("event") || (!r.parameter && custom.includes("yes"))) ev.custom = true;
    if (r.trigger && !ev.trigger) {
      const [page, ...rest] = r.trigger.split(TRIGGER_SEP);
      ev.trigger = { page: page.trim(), ...(rest.length ? { element: rest.join(TRIGGER_SEP).trim() } : {}) };
    }
    if (r.journeys && !ev.journeys) ev.journeys = r.journeys.split(",").map((s) => s.trim()).filter(Boolean);
    if (!r.parameter) {
      if (r.description) ev.description = r.description;
      continue;
    }
    if (ev.parameters[r.parameter]) throw fail(`${at}: parameter "${r.parameter}" of ${r.event} is listed twice. Keep one row per parameter.`);
    ev.parameters[r.parameter] = {
      ...(custom.includes("parameter") || custom.includes("yes") ? { custom: true } : {}),
      ...(r.description ? { description: r.description } : {}),
      ...(r.example ? { example: r.example } : {}),
    };
    if (required === "yes") ev.required_params.push(r.parameter);
  }
  if (!byKey.size) throw fail("events: no events found. Add one row per event parameter below the column names.");

  const events = [...byKey.values()].map(({ platform, name, custom, description, trigger, journeys, required_params, parameters }) => ({
    platform,
    name,
    ...(custom ? { custom: true } : {}),
    ...(description ? { description } : {}),
    ...(trigger ? { trigger } : {}),
    ...(journeys ? { journeys } : {}),
    ...(required_params.length ? { required_params } : {}),
    ...(Object.keys(parameters).length ? { parameters } : {}),
  }));

  const user_properties = [];
  if (upRows) {
    const upHeader = headerOf("user_properties", upRows, USER_PROPERTY_COLUMNS, [], warnings);
    const seen = new Set();
    for (const r of records(upRows, upHeader)) {
      if (!r.name) throw fail(`user_properties, row ${r.row}: "name" is empty. Give the user property name, e.g. customer_type.`);
      if (seen.has(r.name)) throw fail(`user_properties, row ${r.row}: "${r.name}" is listed twice. Keep one row per user property.`);
      seen.add(r.name);
      user_properties.push({ name: r.name, description: r.description ?? "", example: r.example ?? "" });
    }
  }
  const plan = { ...(site ? { site } : {}), consent_mode: true, events, user_properties };
  // The same check every plan gets when it is read, so a bad import fails here, not in a later run.
  validatePlan(plan);
  return { plan, warnings };
}

const toCells = (objs, columns) => [columns, ...objs.map((o) => columns.map((c) => o[c] ?? ""))];

// ---------- CSV ----------

const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows) => `${rows.map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;

/** Parses CSV text (RFC 4180, comma or semicolon separated) into an array of cell arrays. */
export function parseCsv(text) {
  text = text.replace(/^﻿/, "");
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ---------- XLSX (minimal: inline strings out, shared or inline strings and numbers in) ----------

async function loadFflate() {
  try {
    return await import("fflate");
  } catch {
    throw new Error('Reading and writing .xlsx files needs the optional "fflate" package, which is not installed. Install it with: npm install fflate (or use CSV: --format csv for export, a .csv file for import).');
  }
}

const xmlEscape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const xmlUnescape = (s) => s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (_, e) => {
  const named = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" }[e.toLowerCase()];
  if (named) return named;
  return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
});
const colName = (i) => (i >= 26 ? colName(Math.floor(i / 26) - 1) : "") + String.fromCharCode(65 + (i % 26));
const colIndex = (letters) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

function sheetXml(rows) {
  const body = rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => (v === "" || v == null ? "" : `<c r="${colName(j)}${i + 1}" t="inlineStr"${i === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`)).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${body}</sheetData></worksheet>`;
}

/** An .xlsx file (Uint8Array) with one sheet per entry of { name: rows }. */
export async function writeXlsx(sheets) {
  const { zipSync, strToU8 } = await loadFflate();
  const names = Object.keys(sheets);
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`,
  };
  names.forEach((n, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sheets[n])));
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}

const textOf = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map((m) => xmlUnescape(m[1] ?? "")).join("");

/** Reads an .xlsx file's sheets as { name: rows } (rows are arrays of cell text). */
export async function readXlsx(bytes) {
  const { unzipSync, strFromU8 } = await loadFflate();
  let zip;
  try {
    zip = unzipSync(bytes);
  } catch {
    throw new Error("This is not a readable .xlsx file. Save it as an Excel workbook (.xlsx) or as CSV.");
  }
  const get = (p) => (zip[p] ? strFromU8(zip[p]) : null);
  const workbook = get("xl/workbook.xml");
  if (!workbook) throw new Error("This is not a readable .xlsx file. Save it as an Excel workbook (.xlsx) or as CSV.");
  const rels = Object.fromEntries([...(get("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\b[^>]*>/g)].map((m) => [m[0].match(/Id="([^"]+)"/)?.[1], m[0].match(/Target="([^"]+)"/)?.[1]]));
  const shared = [...(get("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, "")));
  const sheets = {};
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = xmlUnescape(m[0].match(/name="([^"]*)"/)?.[1] ?? "");
    const target = rels[m[0].match(/r:id="([^"]+)"/)?.[1]];
    if (!target) continue;
    const file = target.startsWith("/") ? target.slice(1) : path.posix.normalize(`xl/${target}`);
    const xml = get(file) ?? "";
    const rows = [];
    for (const r of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rowNum = Number(r[1].match(/r="(\d+)"/)?.[1] ?? rows.length + 1);
      const cells = [];
      for (const c of (r[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = c[1].match(/r="([A-Z]+)\d+"/)?.[1];
        const type = c[1].match(/t="([^"]+)"/)?.[1];
        const inner = c[2] ?? "";
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let value = "";
        if (type === "s") value = shared[Number(v)] ?? "";
        else if (type === "inlineStr") value = textOf(inner.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? "");
        else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
        else if (v != null) value = xmlUnescape(v);
        cells[ref ? colIndex(ref) : cells.length] = value;
      }
      rows[rowNum - 1] = Array.from(cells, (x) => x ?? "");
    }
    sheets[name] = Array.from(rows, (x) => x ?? []);
  }
  return sheets;
}

// ---------- files ----------

const exists = (p) => stat(p).then(() => true, () => false);

/** Reads a plan spreadsheet (.xlsx, or events.csv with an optional user_properties.csv beside it). */
export async function readPlanSheet(file, { site } = {}) {
  const ext = path.extname(file).toLowerCase();
  if (!(await exists(file))) throw new Error(`No file at ${file}.`);
  let tabs;
  if (ext === ".xlsx") {
    const sheets = await readXlsx(await readFile(file));
    const find = (n) => Object.entries(sheets).find(([k]) => k.trim().toLowerCase() === n)?.[1];
    const events = find("events");
    if (!events) throw new Error(`${path.basename(file)} has no tab named "events" (found ${Object.keys(sheets).map((k) => `"${k}"`).join(", ") || "none"}). Rename the tab with the events to "events".`);
    tabs = { events, user_properties: find("user_properties") ?? null };
  } else if (ext === ".csv") {
    // Google Sheets downloads each tab as "<Document> - <tab>.csv"; the sibling file keeps that prefix.
    const base = path.basename(file);
    const prefix = base.match(/^(.*?)events\.csv$/i)?.[1] ?? "";
    const upFile = path.join(path.dirname(file), `${prefix}user_properties.csv`);
    if (/user_properties\.csv$/i.test(base)) throw new Error(`Import the events file (${base.replace(/user_properties\.csv$/i, "events.csv")}); ${base} beside it is read too.`);
    tabs = { events: parseCsv(await readFile(file, "utf8")), user_properties: (await exists(upFile)) ? parseCsv(await readFile(upFile, "utf8")) : null };
  } else {
    throw new Error(`Import a .xlsx or .csv file (got ${path.basename(file)}).`);
  }
  const result = rowsToPlan(tabs, { site });
  if (!tabs.user_properties) result.warnings.push(ext === ".csv" ? `No ${path.basename(upFile)} beside the file, so the plan has no user properties.` : 'No "user_properties" tab, so the plan has no user properties.');
  return result;
}

/** Writes a plan as plan.xlsx (or events.csv and user_properties.csv) in dir; returns the files written. */
export async function writePlanSheet(plan, dir, { format = "xlsx" } = {}) {
  const { events, user_properties } = planToRows(plan);
  const hasExtra = (c) => events.some((r) => r[c]);
  const eventColumns = [...EVENT_COLUMNS, ...EXTRA_EVENT_COLUMNS.filter(hasExtra)];
  const tabs = { events: toCells(events, eventColumns), user_properties: toCells(user_properties, USER_PROPERTY_COLUMNS) };
  if (format === "csv") {
    const files = [path.join(dir, "events.csv"), path.join(dir, "user_properties.csv")];
    await writeFile(files[0], `﻿${toCsv(tabs.events)}`);
    await writeFile(files[1], `﻿${toCsv(tabs.user_properties)}`);
    return files;
  }
  if (format !== "xlsx") throw new Error(`--format must be xlsx or csv (found "${format}").`);
  const file = path.join(dir, "plan.xlsx");
  await writeFile(file, await writeXlsx(tabs));
  return [file];
}
