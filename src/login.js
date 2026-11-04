// A test account for journeys that log in. The email (or username) and password come from environment variables on
// the computer running the tool; the model only ever sees placeholders such as {{login.password}}, the browser fills
// in the real values (on the audited site's pages only, see AuditSession.perform), and every text the tool records
// or shows has them turned back into their placeholders.

import { existsSync } from "node:fs";
import path from "node:path";
import { domainOf } from "./workspace.js";

export const LOGIN_ENV = { email: "AITD_LOGIN_EMAIL", username: "AITD_LOGIN_USERNAME", password: "AITD_LOGIN_PASSWORD" };

const PLACEHOLDER = /\{\{\s*login\.(email|username|password)\s*\}\}/g;

/**
 * The test account the environment sets, as { email, username, password }, or null when none is set. username is
 * AITD_LOGIN_USERNAME, else the email, for sites that ask for a username; email is the same the other way round.
 */
export function loginFromEnv(env = process.env) {
  const email = env[LOGIN_ENV.email]?.trim() || "";
  const username = env[LOGIN_ENV.username]?.trim() || "";
  const password = env[LOGIN_ENV.password] ?? "";
  if (!email && !username && !password) return null;
  return { email: email || username, username: username || email, password };
}

/** Whether a value asks for the test account: it holds {{login.email}}, {{login.username}} or {{login.password}}. */
export const hasLoginPlaceholder = (value) => typeof value === "string" && new RegExp(PLACEHOLDER.source).test(value);

/**
 * The value with its placeholders replaced by the test account's. Throws an error with code NO_LOGIN, naming the
 * environment variables to set, when a placeholder asks for something the environment doesn't hold.
 */
export function fillLoginValue(value, login) {
  return String(value).replace(PLACEHOLDER, (_, field) => {
    const v = login?.[field];
    if (!v) {
      const name = field === "password" ? LOGIN_ENV.password : `${LOGIN_ENV.email} (or ${LOGIN_ENV.username})`;
      const err = new Error(`No test account is set up for {{login.${field}}}: set ${name} on the computer running ai-tag-debugger. Without one, stop and report that the journey needs a login.`);
      err.code = "NO_LOGIN";
      throw err;
    }
    return v;
  });
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A function that turns the test account's values back into their placeholders wherever they appear in a text, as
 * typed or URL-encoded. Values shorter than 3 characters are left alone, since they would match ordinary text.
 * Identity when there is no test account.
 */
export function loginScrubber(login) {
  if (!login) return (text) => text;
  const pairs = [];
  const taken = new Set();
  // The password first: an email inside a password must not leave the rest of the password behind. A username that is
  // the email (the default) reads as {{login.email}}.
  for (const [field, value] of [["password", login.password], ["email", login.email], ["username", login.username]]) {
    if (!value || value.length < 3 || taken.has(value)) continue;
    taken.add(value);
    for (const form of new Set([value, encodeURIComponent(value), encodeURIComponent(value).replace(/%20/g, "+")])) pairs.push([form, `{{login.${field}}}`]);
  }
  if (!pairs.length) return (text) => text;
  const re = new RegExp(pairs.map(([v]) => escape(v)).sort((a, b) => b.length - a.length).join("|"), "g");
  const to = new Map(pairs);
  return (text) => (typeof text === "string" && text ? text.replace(re, (m) => to.get(m) ?? m) : text);
}

/** A copy of a value with every string in it scrubbed: for hits' parameters, dataLayer pushes and the like. */
export function scrubDeep(value, scrub) {
  if (typeof value === "string") return scrub(value);
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, scrub));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDeep(v, scrub)]));
  return value;
}

/** Where `aitd login` saves a site's logged-in session by default: aitd/<domain>/session.json, a gitignored folder. */
export function sessionFileFor(site, dataDir) {
  return path.join(dataDir, domainOf(site), "session.json");
}

/**
 * The session file a run should start from: "saved" for the one `aitd login` saved for the site, else a path.
 * Throws when the file doesn't exist, with the command that saves one.
 */
export function resolveSessionFile(value, { site, dataDir }) {
  const file = value === "saved" ? sessionFileFor(site, dataDir) : path.resolve(String(value));
  if (!existsSync(file)) throw new Error(`No saved login session at ${file}. Save one with: aitd login --site ${site}`);
  return file;
}
