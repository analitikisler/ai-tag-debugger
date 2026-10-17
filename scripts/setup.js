#!/usr/bin/env node
// Gets a fresh clone ready to run: checks the Node version, installs the dependencies and the
// Chromium build Playwright expects, and says whether an AI provider key is set.
// Run it with `npm run setup`. `npm run setup -- --with-deps` also installs Chromium's system
// libraries on Linux (the dev container does this).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Kept in step with hasApiKey() in src/providers.js. This file can't import it, since it runs
// before the dependencies are installed.
export const KEY_VARS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "AI_GATEWAY_API_KEY", "CLOUDFLARE_API_TOKEN", "OPENAI_COMPATIBLE_BASE_URL"];

/** The lowest Node major version allowed by an engines range like ">=20". */
export function minNodeMajor(range) {
  const m = /(\d+)/.exec(range ?? "");
  return m ? Number(m[1]) : 0;
}

export function nodeVersionOk(version, range) {
  return Number(/^v?(\d+)/.exec(version)?.[1] ?? 0) >= minNodeMajor(range);
}

/** The key variables that are set, by name only. */
export const keysSet = (env = process.env) => KEY_VARS.filter((k) => env[k]);

function run(cmd, args) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (res.status !== 0) {
    console.error(`\nSetup stopped: \`${cmd} ${args.join(" ")}\` failed${res.error ? ` (${res.error.message})` : ""}.`);
    process.exit(res.status || 1);
  }
}

function main(argv) {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const range = pkg.engines?.node;
  if (!nodeVersionOk(process.version, range)) {
    console.error(`ai-tag-debugger needs Node ${range}, and this is ${process.version}. Install a newer Node (for example with nvm: nvm install 22) and run npm run setup again.`);
    process.exit(1);
  }
  console.log(`Node ${process.version}: OK (needs ${range}).`);

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npm, [existsSync(path.join(root, "package-lock.json")) ? "ci" : "install"]);
  // The local Playwright CLI installs the Chromium build that matches the pinned Playwright version.
  run(npm, ["exec", "--", "playwright", "install", ...(argv.includes("--with-deps") ? ["--with-deps"] : []), "chromium"]);

  const keys = keysSet();
  if (keys.length) {
    console.log(`\nAI provider key found: ${keys.join(", ")}.`);
  } else {
    console.log(
      "\nNo AI provider key is set. To let a model browse your site, set one of ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY " +
        "(or OPENAI_COMPATIBLE_BASE_URL for an OpenAI-compatible API).\nWithout a key you can still run the tests (npm test) and the demo (npm run demo).",
    );
  }
  console.log("\nSetup done. Try: npm test, or npm run demo:serve and npm run demo in a second terminal.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
