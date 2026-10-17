// server.json (the MCP Registry listing) must track package.json, or the registry points at a stale version.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = async (f) => JSON.parse(await readFile(new URL(`../${f}`, import.meta.url), "utf8"));

test("server.json matches package.json", async () => {
  const pkg = await read("package.json");
  const server = await read("server.json");
  assert.equal(server.name, pkg.mcpName);
  assert.equal(server.version, pkg.version);
  assert.ok(server.description.length <= 100, "the registry rejects descriptions over 100 characters");
  assert.equal(server.packages.length, 1);
  assert.equal(server.packages[0].identifier, pkg.name);
  assert.equal(server.packages[0].version, pkg.version);
});
