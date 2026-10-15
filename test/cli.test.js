import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

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

test("the help lists the plan command", () => {
  assert.match(cli("--help"), /plan --from <capture\.json>/);
});

test("plan --site refuses to replace an existing file before exploring", () => {
  assert.throws(() => execFileSync(process.execPath, ["src/cli.js", "plan", "--site", "https://x.test", "--out", "package.json"], { encoding: "utf8", stdio: "pipe" }), /package\.json already exists/);
});

test("a run without --journey, --goal or config journeys stops before any browser or model starts", () => {
  let err;
  try {
    execFileSync(process.execPath, ["src/cli.js", "run", "--site", "https://x.test"], { encoding: "utf8", stdio: "pipe", env: { ...process.env, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "" } });
  } catch (e) {
    err = e;
  }
  assert.equal(err?.status, 2);
  assert.match(err.stderr, /No journeys to run[\s\S]*--journey <name>[\s\S]*--goal "<text>"[\s\S]*--config <file>[\s\S]*aitd plan --site https:\/\/x\.test/);
});

test("the help says a run needs a journey", () => {
  assert.match(cli("--help"), /A run needs a journey to test/);
});
