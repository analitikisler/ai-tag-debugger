// The Chrome extension (extension/) runs the same checks and report code as the CLI, copied from src/ by
// scripts/extension.js. That only works while the modules it needs import nothing from Node, Playwright or npm,
// so a readFile added to checks.js fails here instead of in the extension.
import { test } from "node:test";
import assert from "node:assert/strict";
import { browserSafeFiles, EXTENSION_ROOTS } from "../scripts/extension.js";

test("the modules the extension uses import only other modules in src/", async () => {
  const { files, outside } = await browserSafeFiles();
  assert.deepEqual(outside, [], `these imports would break the extension:\n${outside.map((o) => `  ${o.file} imports "${o.spec}"`).join("\n")}`);
  for (const root of EXTENSION_ROOTS) assert.ok(files.includes(root), `${root} is in the graph`);
  // The capture parsers, the checks, redaction, the strings and the HTML report all come along.
  for (const f of ["src/parsers.js", "src/checks.js", "src/redact.js", "src/i18n.js", "src/html/shell.js", "src/metrics.js"]) assert.ok(files.includes(f), f);
});

test("the extension's core leaves out the browser, the model clients and the file system", async () => {
  const { files } = await browserSafeFiles();
  for (const f of ["src/browser.js", "src/providers.js", "src/agent.js", "src/audit.js", "src/whitelabel.js", "src/consent.js", "src/workspace.js"]) assert.ok(!files.includes(f), f);
});
