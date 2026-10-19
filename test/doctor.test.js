// doctorChecks() takes everything that touches the machine as an argument, so these run without
// a browser, a network or the real environment.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

// `aitd doctor` on this machine: Node and Chromium are in place (the end-to-end tests need them), so only the data folder decides the exit code.
test("aitd doctor prints one ✓ or ✗ line per check and exits 1 only when a hard check fails", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "atd-doctor-"));
  const run = (dataDir) => {
    try {
      return { status: 0, stdout: execFileSync(process.execPath, ["src/cli.js", "doctor", "--data-dir", dataDir], { encoding: "utf8", stdio: "pipe" }) };
    } catch (e) {
      return { status: e.status, stdout: e.stdout };
    }
  };
  const ok = run(path.join(dir, "aitd"));
  const lines = ok.stdout.trim().split("\n");
  assert.equal(ok.status, 0, ok.stdout);
  assert.equal(lines.length, 4);
  assert.ok(lines.every((l) => /^[✓✗] /.test(l)), ok.stdout);
  assert.match(lines[0], /^✓ Node v\d+/);
  assert.match(lines[1], /^✓ Playwright .* with Chromium at /);
  assert.match(lines[2], /^[✓✗] AI: /);
  assert.match(lines[3], new RegExp(`^✓ Data folder ${path.join(dir, "aitd").replace(/[\\/]/g, "[\\\\/]")} is writable \\(it will be created\\)$`));
  // A data folder under a file can never be created, so the check fails and the command exits 1.
  writeFileSync(path.join(dir, "file"), "");
  const bad = run(path.join(dir, "file", "aitd"));
  assert.equal(bad.status, 1, bad.stdout);
  assert.match(bad.stdout, /^✗ Data folder .* is not writable \(checked .*file\)\. Pick another with --data-dir <dir>$/m);
  assert.equal((bad.stdout.match(/^✓ /gm) ?? []).length, bad.stdout.includes("✗ AI:") ? 2 : 3);
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
