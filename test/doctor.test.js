// doctorChecks() takes everything that touches the machine as an argument, so these run without
// a browser, a network or the real environment.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { doctorChecks } from "../src/doctor.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// A machine where everything is in place; each test breaks one thing.
const healthy = {
  nodeVersion: "v22.12.0",
  chromiumPath: "/opt/chrome/chrome",
  env: { OPENAI_API_KEY: "sk-test" },
  dataDir: "/data/aitd",
  exists: (p) => p === "/opt/chrome/chrome" || p === "/data",
  writable: async () => {},
  resolve: async (host) => (host === "example.com" ? [{ address: "93.184.216.34" }] : Promise.reject(new Error("ENOTFOUND"))),
};
const failed = (checks) => checks.filter((c) => !c.ok);
const hardFailed = (checks) => checks.filter((c) => c.hard && !c.ok);

test("a healthy machine passes every check, and the data folder may not exist yet", async () => {
  const checks = await doctorChecks(healthy);
  assert.equal(checks.length, 4, "without --site there are four checks");
  assert.deepEqual(failed(checks), []);
  assert.match(checks[0].text, new RegExp(`Node v22\\.12\\.0 \\(needs ${pkg.engines.node.replace(/[>=]/g, "\\$&")}\\)`));
  assert.match(checks[1].text, new RegExp(`Playwright ${pkg.dependencies.playwright.replace(/\\./g, "\\.")} with Chromium at /opt/chrome/chrome`));
  assert.match(checks[2].text, /^AI: openai \(/);
  assert.match(checks[3].text, /Data folder \/data\/aitd is writable \(it will be created\)/);
});

test("an old Node fails hard and says how to upgrade", async () => {
  const checks = await doctorChecks({ ...healthy, nodeVersion: "v18.19.1" });
  assert.equal(hardFailed(checks).length, 1);
  assert.match(hardFailed(checks)[0].text, /Node v18\.19\.1 is too old.*nvm install 22/);
});

test("a missing Chromium fails hard with the exact install command for the pinned Playwright", async () => {
  const checks = await doctorChecks({ ...healthy, exists: (p) => p === "/data" });
  assert.equal(hardFailed(checks).length, 1);
  assert.ok(hardFailed(checks)[0].text.endsWith(`Run: npx -y playwright@${pkg.dependencies.playwright} install chromium`), hardFailed(checks)[0].text);
});

test("no AI key is reported but is not a failure, and other keys are listed like the main help", async () => {
  const none = await doctorChecks({ ...healthy, env: {} });
  assert.deepEqual(hardFailed(none), []);
  assert.equal(none[2].ok, false);
  assert.match(none[2].text, /^AI: no key set \(ANTHROPIC_API_KEY.*Optional: --no-ai and replay work without a key$/);
  const two = await doctorChecks({ ...healthy, env: { ANTHROPIC_API_KEY: "a", GEMINI_API_KEY: "g" } });
  assert.match(two[2].text, /^AI: anthropic \(.*\) · also set: gemini \(pick with --provider\)$/);
});

test("an unwritable data folder fails hard and names the folder that was checked", async () => {
  const checks = await doctorChecks({ ...healthy, writable: async () => Promise.reject(new Error("EACCES")) });
  assert.equal(hardFailed(checks).length, 1);
  assert.match(hardFailed(checks)[0].text, /Data folder \/data\/aitd is not writable \(checked \/data\)\. Pick another with --data-dir/);
  const relative = await doctorChecks({ ...healthy, dataDir: "aitd", exists: (p) => p === "/opt/chrome/chrome" || p === process.cwd() });
  assert.match(relative[3].text, new RegExp(`Data folder ${path.resolve("aitd").replace(/[\\\\/]/g, "[\\\\/]")} is writable`));
});

test("--site must be an http(s) URL whose host resolves, and nothing is fetched", async () => {
  const ok = await doctorChecks({ ...healthy, site: "https://example.com/shop" });
  assert.equal(ok.length, 5);
  assert.deepEqual(failed(ok), []);
  assert.equal(ok[4].text, "example.com resolves");
  for (const [site, pattern] of [
    ["example.com", /not a full URL/],
    ["ftp://example.com", /not an http or https address/],
    ["https://nope.invalid", /nope\.invalid does not resolve/],
  ]) {
    const checks = await doctorChecks({ ...healthy, site });
    assert.equal(hardFailed(checks).length, 1, site);
    assert.match(hardFailed(checks)[0].text, pattern);
  }
});
