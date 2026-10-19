// `aitd doctor`: one line per thing an audit needs, so a broken setup is found before a run starts.
import { existsSync, readFileSync } from "node:fs";
import { access, constants } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import path from "node:path";
import { aiStatus } from "./providers.js";
import { DEFAULT_DATA_DIR } from "./workspace.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// The same as minNodeMajor() in scripts/setup.js, which the published package doesn't ship.
const minNodeMajor = (range) => Number(/(\d+)/.exec(range ?? "")?.[1] ?? 0);

/** The nearest existing directory at or above dir, since the data dir is only created by the first run. */
function existingAncestor(dir, exists) {
  let d = dir;
  while (!exists(d) && path.dirname(d) !== d) d = path.dirname(d);
  return d;
}

/**
 * Runs the checks and returns [{ ok, hard, text }]. A failed hard check means audits can't run;
 * a soft one is advice. Everything that touches the machine can be injected, so tests need no
 * browser or network.
 */
export async function doctorChecks({ site, dataDir = DEFAULT_DATA_DIR, nodeVersion = process.version, chromiumPath, env = process.env, exists = existsSync, writable = (d) => access(d, constants.W_OK), resolve = lookup } = {}) {
  const checks = [];
  const range = pkg.engines?.node;
  const nodeOk = Number(/^v?(\d+)/.exec(nodeVersion)?.[1] ?? 0) >= minNodeMajor(range);
  checks.push({ ok: nodeOk, hard: true, text: nodeOk ? `Node ${nodeVersion} (needs ${range})` : `Node ${nodeVersion} is too old: this needs Node ${range}. Install a newer Node, for example with nvm: nvm install 22` });

  const pw = pkg.dependencies.playwright;
  chromiumPath ??= (await import("playwright")).chromium.executablePath();
  const chromiumOk = Boolean(chromiumPath && exists(chromiumPath));
  checks.push({ ok: chromiumOk, hard: true, text: chromiumOk ? `Playwright ${pw} with Chromium at ${chromiumPath}` : `Playwright ${pw} has no Chromium installed. Run: npx -y playwright@${pw} install chromium` });

  // The same line `aitd` with no arguments prints. No key is not a failure: --no-ai and replay work without one.
  const ai = aiStatus({}, env);
  const aiOk = !ai.startsWith("AI: no key set");
  checks.push({ ok: aiOk, hard: false, text: aiOk ? ai : `${ai}. Optional: --no-ai and replay work without a key` });

  const dir = path.resolve(dataDir);
  const probe = existingAncestor(dir, exists);
  const dirOk = await writable(probe).then(() => true, () => false);
  checks.push({ ok: dirOk, hard: true, text: dirOk ? `Data folder ${dir} is writable${probe === dir ? "" : " (it will be created)"}` : `Data folder ${dir} is not writable (checked ${probe}). Pick another with --data-dir <dir>` });

  if (site !== undefined) checks.push(await siteCheck(site, resolve));
  return checks;
}

/** The site is an http(s) address whose host resolves. Nothing is fetched. */
async function siteCheck(site, resolve) {
  let u;
  try {
    u = new URL(site);
  } catch {
    return { ok: false, hard: true, text: `"${site}" is not a full URL. Use the form https://www.example.com` };
  }
  if (!["http:", "https:"].includes(u.protocol)) return { ok: false, hard: true, text: `${site} is not an http or https address, so the browser can't open it` };
  const found = await resolve(u.hostname).then(() => true, () => false);
  return { ok: found, hard: true, text: found ? `${u.hostname} resolves` : `${u.hostname} does not resolve. Check the address, or your network and DNS` };
}
