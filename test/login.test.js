// The test account: placeholders in, real values typed only on the audited site, and never kept or shown. Plus the
// login journey's user ID check and sessions saved with `aitd login`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AuditSession, browserEnv } from "../src/browser.js";
import { collect } from "../src/agent.js";
import { checkRun } from "../src/checks.js";
import { presetFor } from "../src/journeys.js";
import { fillLoginValue, hasLoginPlaceholder, loginFromEnv, loginScrubber, resolveSessionFile, scrubDeep, sessionFileFor } from "../src/login.js";
import { helpText } from "../src/help.js";

const LOGIN = { email: "qa-login@shop.test", username: "qa-login@shop.test", password: "S3cret pass/42!" };

// A login form that does everything a leaky site can: shows the email back, pushes the password to the dataLayer and
// sends it in a GA4 hit. Beside it, a form from another site, which must never get the test account.
const hit = (en, extra) => `fetch("https://region1.google-analytics.com/g/collect?v=2&tid=G-1&cid=1.2&_p=" + Math.random() + "&en=${en}${extra}&dl=" + encodeURIComponent(location.href), { method: "POST", keepalive: true });`;
const page = (uid) => `<!doctype html><title>Login</title>
<form id="f"><input id="email" name="email" type="email"><input id="password" name="password" type="password"><button id="submit" type="submit">Log in</button></form>
<p id="who"></p>
<iframe src="http://localhost:${server.address().port}/widget"></iframe>
<script>window.dataLayer = window.dataLayer || [];
document.getElementById("f").addEventListener("submit", function (e) {
  e.preventDefault();
  var email = document.getElementById("email").value, pw = document.getElementById("password").value;
  document.getElementById("who").textContent = "Logged in as " + email;
  dataLayer.push({ event: "login", debug: "pw=" + pw });
  ${hit("login", '&ep.debug=" + encodeURIComponent(pw) + "')}
  setTimeout(function () { ${hit("page_view", uid ? "&uid=acct-42" : "")} }, 50);
});</script>`;

let server;
let url;
before(async () => {
  server = createServer((req, res) => {
    if (req.url === "/widget") return res.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><input id="other" type="password">');
    res.writeHead(200, { "content-type": "text/html" }).end(page(req.url.includes("uid=1")));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server.close());

async function logIn(target, login = LOGIN) {
  const session = new AuditSession({ viewport: "desktop", site: url, providers: ["ga4"], quietMs: 0, login });
  await session.start();
  const results = [];
  try {
    results.push(await session.act({ action: "goto", url: target }));
    results.push(await session.act({ action: "fill", selector: "#email", value: "{{login.email}}" }));
    results.push(await session.act({ action: "fill", selector: "#password", value: "{{login.password}}" }));
    const typed = await session.page.evaluate(() => [document.getElementById("email").value, document.getElementById("password").value]);
    results.push(await session.act({ action: "click", selector: "#submit" }));
    results.push(await session.act({ action: "wait", value: "400" }));
    const view = await session.snapshot();
    return { session, results, typed, view, run: { ...collect(session, { id: "login" }, "desktop"), completed: true } };
  } finally {
    await session.close();
  }
}

test("the browser types the test account, but no page view, step, hit or push ever holds it", async () => {
  const { session, results, typed, view, run } = await logIn(`${url}?uid=1`);
  assert.deepEqual(results, [null, null, null, null, null]);
  assert.deepEqual(typed, [LOGIN.email, LOGIN.password], "the real values were typed");
  assert.equal(run.loginStep, 3, "the step that typed the password");
  // What the model reads: the page shows the email back, as its placeholder; the email field shows its placeholder and
  // the password field its name, never what was typed.
  assert.match(view.text, /Logged in as \{\{login\.email\}\}/);
  assert.match(view.elements, /input\[type=email\] name=email "\{\{login\.email\}\}"\n\[2\] input\[type=password\] name=password "password"/);
  // Nothing the run keeps holds either value, plain or URL-encoded.
  const kept = JSON.stringify({ run, steps: session.steps });
  for (const v of [LOGIN.email, LOGIN.password, encodeURIComponent(LOGIN.password)]) assert.ok(!kept.includes(v), `${v} leaked`);
  // The hit and the push that carried the password say where it was.
  assert.ok(run.hits.some((h) => h.name === "login" && h.params.debug === "{{login.password}}"), JSON.stringify(run.hits.map((h) => h.params)));
  assert.ok(run.dataLayerLog.some((e) => e.value?.debug === "pw={{login.password}}"));
  // Saved steps replay with the placeholders, so a replay types the account again from the environment.
  assert.deepEqual(session.steps.filter((s) => s.replay?.action === "fill").map((s) => s.replay.value), ["{{login.email}}", "{{login.password}}"]);
  // The site sent a user ID after the login: nothing to report.
  assert.deepEqual(checkRun({ events: [] }, run).filter((f) => f.check === "user_id_missing"), []);
});

test("a login with no user ID in the hits that follow is reported", async () => {
  const { run } = await logIn(url);
  const [f] = checkRun({ events: [] }, run).filter((x) => x.check === "user_id_missing");
  assert.equal(f.severity, "info");
  assert.match(f.detail, /^After logging in with the test account, \d+ GA4 hits? went out without a user ID \(uid\)\./);
});

test("the test account is never typed into a frame from another site, and a missing one says what to set", async () => {
  const session = new AuditSession({ viewport: "desktop", site: url, providers: ["ga4"], quietMs: 0, login: LOGIN });
  await session.start();
  try {
    await session.act({ action: "goto", url });
    const frame = session.page.frames().find((f) => f.url().includes("/widget"));
    session.refFrames = new Map([[1, frame]]);
    await frame.evaluate(() => document.getElementById("other").setAttribute("data-atd-ref", "1"));
    const refused = await session.act({ action: "fill", ref: 1, value: "{{login.password}}" });
    assert.match(refused, /^The test account is only filled in on 127\.0\.0\.1, not on localhost\.$/);
    assert.equal(await frame.evaluate(() => document.getElementById("other").value), "");
  } finally {
    await session.close();
  }
  const none = new AuditSession({ viewport: "desktop", site: url, providers: ["ga4"], quietMs: 0, login: null });
  await none.start();
  try {
    await none.act({ action: "goto", url });
    assert.match(await none.act({ action: "fill", selector: "#password", value: "{{login.password}}" }), /^No test account is set up for \{\{login\.password\}\}: set AITD_LOGIN_PASSWORD/);
  } finally {
    await none.close();
  }
});

test("a saved session starts the browser logged in, and a missing one says how to save it", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "atd-login-"));
  const file = path.join(dir, "session.json");
  await writeFile(file, JSON.stringify({ cookies: [{ name: "shop_session", value: "abc", domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }], origins: [] }));
  const session = new AuditSession({ viewport: "desktop", site: url, providers: ["ga4"], quietMs: 0, storageState: file });
  await session.start();
  try {
    assert.ok((await session.context.cookies()).some((c) => c.name === "shop_session"));
  } finally {
    await session.close();
  }
  assert.equal(sessionFileFor("https://www.shop.example/account", "aitd"), path.join("aitd", "shop.example", "session.json"));
  assert.equal(resolveSessionFile(file, { site: url, dataDir: dir }), file);
  assert.throws(() => resolveSessionFile("saved", { site: "https://www.shop.example/", dataDir: dir }), /^Error: No saved login session at .*shop\.example.*session\.json\. Save one with: aitd login --site https:\/\/www\.shop\.example\/$/);
  await assert.rejects(new AuditSession({ viewport: "desktop", site: url, storageState: path.join(dir, "gone.json") }).start(), /No saved login session/);
});

test("placeholders, the environment and scrubbing", () => {
  assert.deepEqual(loginFromEnv({ AITD_LOGIN_EMAIL: " a@b.test ", AITD_LOGIN_PASSWORD: "pw123" }), { email: "a@b.test", username: "a@b.test", password: "pw123" });
  assert.deepEqual(loginFromEnv({ AITD_LOGIN_USERNAME: "qa", AITD_LOGIN_PASSWORD: "pw123" }), { email: "qa", username: "qa", password: "pw123" });
  assert.equal(loginFromEnv({}), null);
  assert.equal(hasLoginPlaceholder("{{ login.password }}"), true);
  assert.equal(hasLoginPlaceholder("password"), false);
  assert.equal(fillLoginValue("{{login.username}}:{{login.password}}", LOGIN), `${LOGIN.email}:${LOGIN.password}`);
  assert.throws(() => fillLoginValue("{{login.password}}", { email: "a@b.test" }), (err) => err.code === "NO_LOGIN");
  const scrub = loginScrubber(LOGIN);
  assert.equal(scrub(`u=${encodeURIComponent(LOGIN.email)}&p=${encodeURIComponent(LOGIN.password)}&q=${encodeURIComponent(LOGIN.password).replace(/%20/g, "+")}`), "u={{login.email}}&p={{login.password}}&q={{login.password}}");
  assert.deepEqual(scrubDeep({ a: [LOGIN.password, 1], b: { c: `hi ${LOGIN.email}` } }, scrub), { a: ["{{login.password}}", 1], b: { c: "hi {{login.email}}" } });
  assert.equal(loginScrubber(null)("anything"), "anything");
  // The browser never gets the account in its environment.
  assert.deepEqual(Object.keys(browserEnv({ AITD_LOGIN_EMAIL: "a", AITD_LOGIN_PASSWORD: "b", AITD_LOGIN_USERNAME: "c", PATH: "/bin" })), ["PATH"]);
});

test("the login journey and the login command", () => {
  for (const name of ["login", "signin", "sign_in", "log_in"]) assert.equal(presetFor(name)?.id, "login", name);
  assert.match(presetFor("login").goal, /\{\{login\.password\}\}/);
  assert.deepEqual(presetFor("login").events, [{ platform: "ga4", name: "login" }]);
  assert.match(helpText("login"), /^Usage: aitd login --site <url>/);
  assert.match(helpText(), /login {4}Log in to a site by hand once/);
  assert.match(helpText("run"), /--session <file>/);
});

test("over MCP: the account comes from the environment, the model sees placeholders, and a saved session stays local", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { buildServer } = await import("../src/mcp.js");
  const connect = async (opts) => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await buildServer({ reportsDir: await mkdtemp(path.join(tmpdir(), "atd-")), ...opts }).connect(a);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(b);
    return { client, call: async (name, args) => (await client.callTool({ name, arguments: args })).content[0].text };
  };
  const saved = { email: process.env.AITD_LOGIN_EMAIL, password: process.env.AITD_LOGIN_PASSWORD };
  process.env.AITD_LOGIN_EMAIL = LOGIN.email;
  process.env.AITD_LOGIN_PASSWORD = LOGIN.password;
  const { client, call } = await connect({ allowFiles: true });
  try {
    const page = await call("start_audit", { site: url, journey: "login", campaign: false });
    assert.match(page, /^A test account is set up: to log in, fill \{\{login\.email\}\}/m);
    const id = page.match(/audit_id: (\w+)/)[1];
    // The fields have no labels, so a model uses their refs from the page view.
    const ref = (pattern) => Number(page.split("\n").find((l) => pattern.test(l)).match(/^\[(\d+)\]/)[1]);
    await call("browser_action", { audit_id: id, action: "fill", ref: ref(/input\[type=email\]/), value: "{{login.email}}", reason: "Email" });
    const after = await call("browser_action", { audit_id: id, action: "fill", ref: ref(/input\[type=password\] name=password/), value: "{{login.password}}", reason: "Password" });
    const done = await call("browser_action", { audit_id: id, action: "click", text: "Log in", reason: "Log in" });
    for (const t of [page, after, done]) {
      assert.ok(!t.includes(LOGIN.email) && !t.includes(LOGIN.password), "the model never sees the account");
    }
    assert.match(done, /Logged in as \{\{login\.email\}\}/);
    // Ending the audit closes its browser; the findings carry no account either.
    const finished = await call("finish_audit", { audit_id: id, completed: true, note: "Logged in.", measurement_plan: JSON.stringify({ events: [] }) });
    assert.ok(!finished.includes(LOGIN.email) && !finished.includes(LOGIN.password));
  } finally {
    await client.close();
    for (const [k, v] of [["AITD_LOGIN_EMAIL", saved.email], ["AITD_LOGIN_PASSWORD", saved.password]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  // A server that may not read files (the HTTP one) refuses a saved session: it lives on the server's computer.
  const remote = await connect({ allowFiles: false });
  try {
    assert.match(await remote.call("start_audit", { site: url, session: "saved" }), /^A saved login session can only be used on a local server\./);
  } finally {
    await remote.client.close();
  }
});

test("a config's session_file of saved is the session aitd login saved for the site, wherever the run starts", async () => {
  const { runAudit } = await import("../src/audit.js");
  const dir = await mkdtemp(path.join(tmpdir(), "atd-data-"));
  // No session saved yet: the run stops before any browser starts, with the command that saves one.
  await assert.rejects(runAudit({ config: { site: "https://www.shop.example/", session_file: "saved", journeys: [{ id: "j", goal: "g" }] }, dataDir: dir, ai: false, scripted: true }), /No saved login session at .*shop\.example.*session\.json\. Save one with: aitd login --site https:\/\/www\.shop\.example\//);
});

test("the scrubber finds the password as a form encodes it and as JSON escapes it", () => {
  const scrub = loginScrubber({ email: "qa@shop.test", password: 'Sec"ret!42' });
  assert.equal(scrub("https://shop.test/login?p=Sec%22ret%2142&next=%2F"), "https://shop.test/login?p={{login.password}}&next=%2F");
  assert.equal(scrub(JSON.stringify({ password: 'Sec"ret!42' })), '{"password":"{{login.password}}"}');
});
