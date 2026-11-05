// The published package's npm-shrinkwrap.json: package-lock.json without the development-only packages. npm honors a
// published package's shrinkwrap, so every install from the registry (npx, npm install -g, the Claude plugin) gets the
// exact versions and checksums the release was tested with, instead of resolving the version ranges afresh and running
// whatever a newer dependency ships. It installs everything a shrinkwrap lists, development entries included, so they
// are left out. Runs as prepack (written) and postpack (removed): in the repository, npm would prefer a shrinkwrap over
// package-lock.json and leave out the tools tests and lint need.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHRINKWRAP = path.join(root, "npm-shrinkwrap.json");

/** The shrinkwrap for a lockfile: the same tree without development-only entries, and the root without devDependencies. */
export function shrinkwrapFrom(lock) {
  const packages = {};
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (entry.dev) continue;
    if (key === "") {
      const { devDependencies: _dev, ...rootEntry } = entry;
      packages[key] = rootEntry;
    } else packages[key] = entry;
  }
  return { ...lock, packages };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--remove")) rmSync(SHRINKWRAP, { force: true });
  else {
    const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
    writeFileSync(SHRINKWRAP, `${JSON.stringify(shrinkwrapFrom(lock), null, 2)}\n`);
  }
}
