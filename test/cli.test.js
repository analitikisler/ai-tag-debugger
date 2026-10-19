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

test("the top-level help is short and lists the commands and examples", () => {
  const help = cli("--help");
  // 21 since aitd history joined the command list; one line per command, nothing else grows.
  assert.ok(help.trim().split("\n").length <= 21, "top-level help is about 20 lines at most");
  for (const c of ["plan", "run", "replay", "mcp", "doctor", "history"]) assert.match(help, new RegExp(`^  ${c} {2,}\\S`, "m"));
  assert.match(help, /aitd run --site https:\/\/example\.com --against latest/);
  assert.match(help, /-v, --version/);
  assert.doesNotMatch(help, /--max-steps|--base-url|--providers/);
});

test("each command has its own help with its essential options", () => {
  const run = cli("run", "--help");
  for (const o of ["--against", "--journey", "--goal", "--site", "--config", "--events", "--lang", "--headed", "--fail-on", "--provider", "--model", "--platforms", "--data-dir", "--max-steps", "--scripted", "--no-ai", "--save-site", "--save-steps"]) assert.ok(run.includes(o), `run help has ${o}`);
  for (const o of ["--base-url", "--allow-host", "--keep-bodies", "--no-branding", "--providers"]) assert.ok(!run.includes(o), `run help leaves out ${o}`);
  assert.match(run, /ANTHROPIC_API_KEY/);
  const plan = cli("plan", "--help");
  for (const o of ["--site", "list", "import", "export", "--headed", "--data-dir", "--topic", "custom-events", "ecommerce", "forms", "consent"]) assert.ok(plan.includes(o), `plan help has ${o}`);
  assert.doesNotMatch(plan, /--from|--force|--out/);
  const replay = cli("replay", "--help");
  assert.ok(replay.includes("--update") && replay.includes("--out"));
  const mcp = cli("mcp", "--help");
  for (const o of ["--http", "--port", "--host", "--token", "--allow-private-network", "--reports", "--public-url"]) assert.ok(mcp.includes(o), `mcp help has ${o}`);
  const history = cli("history", "--help");
  for (const o of ["--site", "--limit", "--json", "--lang", "--data-dir"]) assert.ok(history.includes(o), `history help has ${o}`);
});

const fails = (args, pattern) => assert.throws(() => execFileSync(process.execPath, ["src/cli.js", ...args], { encoding: "utf8", stdio: "pipe" }), (e) => e.status === 2 && pattern.test(e.stderr));

test("removed plan flags say what to run instead", () => {
  fails(["plan", "--from", "x.json"], /--from was removed\. Draft a plan with: aitd plan --site <url>/);
  fails(["plan", "--site", "https://x.test", "--out", "p.json"], /--out was removed[\s\S]*--data-dir/);
  fails(["plan", "--site", "https://x.test", "--force"], /--force was removed/);
  fails(["plan"], /plan needs --site <url>/);
  fails(["plan", "--site", "https://x.test", "--topic", "video"], /Unknown --topic "video"\. Use one of: custom-events, ecommerce, forms, consent/);
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

const runFails = (args) => {
  try {
    execFileSync(process.execPath, ["src/cli.js", "run", "--site", "https://x.test", ...args], { encoding: "utf8", stdio: "pipe", env: { ...process.env, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "" } });
  } catch (e) {
    return e;
  }
  assert.fail("expected the run to stop");
};

test("--providers still works, with a note that it is now --platforms", () => {
  const e = runFails(["--providers", "ga4"]);
  assert.match(e.stdout, /--providers is now --platforms\./);
  assert.match(e.stderr, /Nothing to test/);
  assert.doesNotMatch(runFails(["--platforms", "ga4"]).stdout, /is now --platforms/);
});

test("--no-ai alone is accepted: it implies --scripted", () => {
  assert.doesNotMatch(runFails(["--no-ai"]).stderr, /needs --scripted/);
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
