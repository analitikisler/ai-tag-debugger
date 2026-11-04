// The Claude plugin (plugin/) must start the version package.json says, or users of the plugin directory get a stale
// server; the directory refuses an unpinned npx launcher, so the version is pinned and has to move with each release.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const read = async (f) => JSON.parse(await readFile(new URL(`../${f}`, import.meta.url), "utf8"));

test("the plugin's manifest and server match package.json", async () => {
  const pkg = await read("package.json");
  const manifest = await read("plugin/.claude-plugin/plugin.json");
  const mcp = await read("plugin/.mcp.json");
  assert.equal(manifest.name, "ai-tag-debugger");
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.license, pkg.license);
  const server = mcp.mcpServers["ai-tag-debugger"];
  assert.equal(server.command, "npx");
  assert.deepEqual(server.args, ["-y", `${pkg.name}@${pkg.version}`, "mcp"]);
});

test("the marketplace lists the plugin from its folder", async () => {
  const market = await read(".claude-plugin/marketplace.json");
  assert.deepEqual(market.plugins.map((p) => [p.name, p.source]), [["ai-tag-debugger", "./plugin"]]);
});

test("the plugin folder has what the directory asks for", async () => {
  const icon = await readFile(new URL("../plugin/.claude-plugin/icon.png", import.meta.url));
  // A square PNG, 512 to 2048 px a side, under 2 MB.
  assert.equal(icon.subarray(1, 4).toString(), "PNG");
  const [w, h] = [icon.readUInt32BE(16), icon.readUInt32BE(20)];
  assert.ok(w === h && w >= 512 && w <= 2048, `${w}x${h}`);
  assert.ok(icon.length < 2 * 1024 * 1024);
  const readme = await readFile(new URL("../plugin/README.md", import.meta.url), "utf8");
  assert.ok(readme.replace(/```[\s\S]*?```/g, "").split(/\s+/).length > 40);
  // What the plugin runs, fetches and sends is disclosed.
  for (const word of ["npx", "Chromium", "ANTHROPIC_API_KEY", "notify", "ai-tag-debugger-reports"]) assert.match(readme, new RegExp(word));
  assert.ok((await stat(new URL("../plugin/LICENSE", import.meta.url))).size > 0);
  const skill = await readFile(new URL("../plugin/skills/audit-tracking/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /^---\nname: audit-tracking\ndescription: .+\n---\n/);
});
