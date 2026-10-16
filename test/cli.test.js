import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const cli = (...args) => execFileSync(process.execPath, ["src/cli.js", ...args], { encoding: "utf8" });

test("--version and -v print the package version", () => {
  assert.equal(cli("--version"), `${version}\n`);
  assert.equal(cli("-v"), `${version}\n`);
});

test("the help lists --version", () => {
  assert.match(cli("--help"), /-v, --version\s+Print the version\./);
});

test("the help lists --save-steps", () => {
  assert.match(cli("--help"), /--save-steps <file>/);
});

test("the help lists the plan command and --data-dir", () => {
  const help = cli("--help");
  assert.match(help, /plan --site <url>/);
  assert.match(help, /--data-dir <dir>/);
  assert.doesNotMatch(help, /--from|--force/);
});

const fails = (args, pattern) => assert.throws(() => execFileSync(process.execPath, ["src/cli.js", ...args], { encoding: "utf8", stdio: "pipe" }), (e) => e.status === 2 && pattern.test(e.stderr));

test("removed plan flags say what to run instead", () => {
  fails(["plan", "--from", "x.json"], /--from was removed\. Draft a plan with: aitd plan --site <url>/);
  fails(["plan", "--site", "https://x.test", "--out", "p.json"], /--out was removed[\s\S]*--data-dir/);
  fails(["plan", "--site", "https://x.test", "--force"], /--force was removed/);
  fails(["plan"], /plan needs --site <url>/);
});

test("a run without --journey, --goal or config journeys stops before any browser or model starts", () => {
  let err;
  try {
    execFileSync(process.execPath, ["src/cli.js", "run", "--site", "https://x.test"], { encoding: "utf8", stdio: "pipe", env: { ...process.env, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "" } });
  } catch (e) {
    err = e;
  }
  assert.equal(err?.status, 2);
  assert.equal(err.stderr.trim(), 'Error: Nothing to test. Add --against latest, --journey <id> or --goal "<text>".');
});

test("the help says a run needs something to test", () => {
  assert.match(cli("--help"), /A run needs something to test: --against, --journey, --goal/);
  assert.match(cli("--help"), /--against <plan>/);
  assert.match(cli("--help"), /plan list --site <url>/);
});

test("--against says how to draft a plan when the site has none, and lists IDs for an unknown one", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aitd-"));
  fails(["run", "--site", "https://www.example.com", "--against", "latest", "--data-dir", dir], /No plan yet for example\.com\. Draft one with: aitd plan --site https:\/\/www\.example\.com/);
  mkdirSync(path.join(dir, "example.com", "plans", "2026-10-16_0900"), { recursive: true });
  writeFileSync(path.join(dir, "example.com", "plans", "2026-10-16_0900", "measurement-plan.json"), "{}");
  fails(["run", "--site", "https://www.example.com", "--against", "2026-01-01_0000", "--data-dir", dir], /No plan 2026-01-01_0000 for example\.com\. Available: 2026-10-16_0900/);
  fails(["run", "--against", path.join(dir, "missing")], /No plan found at/);
});

test("plan list prints the site's plan IDs, oldest first", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aitd-"));
  fails(["plan", "list", "--site", "https://example.com", "--data-dir", dir], /No plan yet for example\.com/);
  for (const id of ["2026-10-16_0900", "2026-10-15_1200"]) mkdirSync(path.join(dir, "example.com", "plans", id), { recursive: true });
  assert.equal(cli("plan", "list", "--site", "https://www.example.com", "--data-dir", dir), "2026-10-15_1200\n2026-10-16_0900\n");
});
