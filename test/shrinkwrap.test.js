// The published package carries npm-shrinkwrap.json: the lockfile's runtime packages with their exact versions and
// checksums, so installs from the registry get the tested tree. npm installs everything a shrinkwrap lists, so the
// development-only packages must not be in it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { shrinkwrapFrom } from "../scripts/shrinkwrap.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (f) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));

test("the shrinkwrap is the lockfile's runtime tree, pinned and checksummed, without development packages", () => {
  const lock = read("package-lock.json");
  const pkg = read("package.json");
  const wrap = shrinkwrapFrom(lock);
  const entries = Object.entries(wrap.packages).filter(([k]) => k);
  assert.ok(entries.length > 100, `${entries.length} runtime packages`);
  assert.equal(entries.filter(([, v]) => v.dev).length, 0, "no development-only package");
  assert.deepEqual(entries.length, Object.entries(lock.packages).filter(([k, v]) => k && !v.dev).length, "every runtime package kept");
  for (const [k, v] of entries) {
    assert.match(v.resolved, /^https:\/\/registry\.npmjs\.org\//, `${k} comes from the npm registry over https`);
    assert.match(v.integrity, /^sha512-/, `${k} has a checksum`);
  }
  assert.equal(wrap.packages[""].devDependencies, undefined);
  assert.deepEqual(wrap.packages[""].dependencies, pkg.dependencies);
  assert.equal(wrap.version, pkg.version);
  // Every runtime dependency the package names is in the tree.
  for (const name of [...Object.keys(pkg.dependencies), ...Object.keys(pkg.optionalDependencies ?? {})]) assert.ok(wrap.packages[`node_modules/${name}`], name);
});

test("npm pack puts the shrinkwrap in the package and leaves the repository without one", () => {
  const [packed] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--silent"], { cwd: root, encoding: "utf8" }));
  assert.ok(packed.files.some((f) => f.path === "npm-shrinkwrap.json"), "in the package");
  // In the repository npm would prefer it to package-lock.json and leave out the development tools.
  assert.equal(existsSync(new URL("../npm-shrinkwrap.json", import.meta.url)), false, "removed after packing");
});
