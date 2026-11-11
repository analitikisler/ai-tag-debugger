// Copies the modules the Chrome extension shares with the CLI from src/ into extension/core/, unchanged, and writes
// the page hook the extension injects. Chrome only loads files inside an extension's own folder, so extension/
// cannot import ../src/ directly; this is a copy, not a build: no file is transformed. extension/core/ is gitignored.
//
//   node scripts/extension.js          copy into extension/core/ (run before loading extension/ unpacked)
//   node scripts/extension.js --pack   also write dist/aitd-recorder-<version>.zip for the Chrome Web Store
import { mkdir, readFile, readdir, rename, rm, writeFile, copyFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORE = path.join(ROOT, "extension", "core");

/** The src/ modules the extension imports itself; everything they import comes along. */
export const EXTENSION_ROOTS = [
  "src/parsers.js",
  "src/redact.js",
  "src/checks.js",
  "src/gtm.js",
  "src/journeys.js",
  "src/frames.js",
  "src/metrics.js",
  "src/i18n.js",
  "src/report-shared.js",
  "src/html/shell.js",
  "src/version.js",
  "src/page-hook.js",
  "src/glossary.js",
  "src/cmp.js",
];

const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^;]*?\sfrom\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']/g;

/**
 * The files the extension needs, by walking static imports from EXTENSION_ROOTS, and every import that leaves src/
 * (node:*, playwright, an npm package), which would break the extension. Dynamic import() is not followed: the shared
 * modules use none.
 * @returns {Promise<{ files: string[], outside: { file: string, spec: string }[] }>}
 */
export async function browserSafeFiles() {
  const files = new Set();
  const outside = [];
  const queue = [...EXTENSION_ROOTS];
  while (queue.length) {
    const rel = queue.shift();
    if (files.has(rel)) continue;
    files.add(rel);
    const text = await readFile(path.join(ROOT, rel), "utf8");
    for (const m of text.matchAll(IMPORT)) {
      const spec = m[1] ?? m[2];
      if (!spec.startsWith("./") && !spec.startsWith("../")) {
        outside.push({ file: rel, spec });
        continue;
      }
      const target = path.relative(ROOT, path.resolve(path.dirname(path.join(ROOT, rel)), spec)).split(path.sep).join("/");
      if (!target.startsWith("src/")) outside.push({ file: rel, spec });
      else queue.push(target);
    }
  }
  return { files: [...files].sort(), outside };
}

/**
 * The page hook as a classic script: the bridge functions the shared INIT_SCRIPT reports through, then INIT_SCRIPT.
 * Each one hands its entry to the extension's isolated-world bridge (extension/bridge.js) as a DOM event; a page can
 * send the same event, so the extension treats what arrives as data, never as instructions.
 */
export function pageHookSource(initScript) {
  const prelude = `(() => {
  const send = (kind, entry) => {
    try { window.dispatchEvent(new CustomEvent("__aitd_recorder", { detail: JSON.stringify({ kind, entry }) })); } catch {}
  };
  for (const [name, kind] of [["__atdRecord", "push"], ["__atdLoad", "load"], ["__atdMessage", "message"]]) {
    try { Object.defineProperty(window, name, { value: (entry) => send(kind, entry), configurable: false, writable: false }); } catch {}
  }
})();`;
  return `// Written by scripts/extension.js from src/page-hook.js; do not edit.\n${prelude}\n${initScript}\n`;
}

/** Copies the shared modules into extension/core/ and writes core/page-hook.js. Returns the files written. */
export async function copyCore() {
  const { files, outside } = await browserSafeFiles();
  if (outside.length) throw new Error(`The extension cannot load these imports:\n${outside.map((o) => `  ${o.file} imports "${o.spec}"`).join("\n")}`);
  // Test files run in parallel and each copies first, so nothing is deleted wholesale and each file lands by rename:
  // a module another process is importing is always either the old copy or the new one, never half written.
  const keep = new Set(files.map((rel) => path.relative("src", rel).split(path.sep).join("/")).concat("page-hook-main.js"));
  const atomic = async (to, write) => {
    await mkdir(path.dirname(to), { recursive: true });
    const tmp = `${to}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await write(tmp);
    await rename(tmp, to);
  };
  for (const rel of files) await atomic(path.join(CORE, path.relative("src", rel)), (tmp) => copyFile(path.join(ROOT, rel), tmp));
  const { INIT_SCRIPT } = await import(pathToFileURL(path.join(ROOT, "src", "page-hook.js")).href);
  await atomic(path.join(CORE, "page-hook-main.js"), (tmp) => writeFile(tmp, pageHookSource(INIT_SCRIPT)));
  // A module removed from src/ goes from core/ too; another process's temporary files are left to it.
  for (const rel of await walk(CORE).catch(() => [])) {
    if (!keep.has(rel) && !rel.endsWith(".tmp")) await rm(path.join(CORE, rel), { force: true });
  }
  return [...files, "page-hook-main.js"];
}

/** Every file under a folder, relative to it, skipping dot files. */
async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

/** Zips extension/ into dist/ with the optional fflate package, the one the plan export already uses. */
async function pack() {
  let fflate;
  try {
    fflate = await import("fflate");
  } catch {
    throw new Error('Packing needs the optional "fflate" package (npm install fflate), or zip the extension/ folder yourself.');
  }
  const dir = path.join(ROOT, "extension");
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
  const entries = {};
  for (const rel of await walk(dir)) entries[rel] = new Uint8Array(await readFile(path.join(dir, rel)));
  const out = path.join(ROOT, "dist", `aitd-recorder-${manifest.version}.zip`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, fflate.zipSync(entries, { level: 9 }));
  return { out, size: (await stat(out)).size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const written = await copyCore();
    console.log(`Copied ${written.length} files into extension/core/. Load extension/ unpacked at chrome://extensions.`);
    if (process.argv.includes("--pack")) {
      const { out, size } = await pack();
      console.log(`Wrote ${path.relative(ROOT, out)} (${Math.round(size / 1024)} KB).`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
