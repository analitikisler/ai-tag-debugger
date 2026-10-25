// Transient failures are tried again a bounded number of times: model requests in providers.js, page loads in browser.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createProvider, withRetry, isTransientModelError, retryAfterMs } from "../src/providers.js";
import { AuditSession, isTransientNavigationError } from "../src/browser.js";

const apiError = (status, extra = {}) => Object.assign(new Error(`HTTP ${status}`), { status, ...extra });
const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };

/** A Gemini-style client whose generateContent fails with the given errors first, then answers. */
function geminiClient(failures) {
  const client = { calls: 0, models: { generateContent: async () => {
    client.calls++;
    if (failures.length) throw failures.shift();
    return { text: '{"ok":true}' };
  } } };
  return client;
}

/** A Gemini provider with injected waiting and logging, so a test sees every retry without waiting. */
async function geminiWith(client, retry = {}) {
  const lines = [];
  const slept = [];
  const provider = await createProvider({ name: "gemini", client, log: (l) => lines.push(l), retry: { attempts: 3, baseDelayMs: 1000, sleep: async (ms) => slept.push(ms), ...retry } });
  return { provider, lines, slept };
}

test("Gemini: a request that fails twice with 503 succeeds on the third try, one log line per retry", async () => {
  const client = geminiClient([apiError(503), apiError(503)]);
  const { provider, lines, slept } = await geminiWith(client);
  assert.deepEqual(await provider.json({ system: "s", texts: ["t"], schema }), { value: { ok: true } });
  assert.equal(client.calls, 3);
  assert.deepEqual(lines.map((l) => l.replace(/\d+s/, "Ns")), [
    "  Model request failed (503); retrying in Ns (attempt 2 of 3)",
    "  Model request failed (503); retrying in Ns (attempt 3 of 3)",
  ]);
  // Exponential backoff from the base delay, with up to a quarter of jitter on top.
  assert.ok(slept[0] >= 1000 && slept[0] <= 1250, `first wait ${slept[0]}`);
  assert.ok(slept[1] >= 2000 && slept[1] <= 2500, `second wait ${slept[1]}`);
});

test("Gemini: the agent conversation retries too, and a network error counts as transient", async () => {
  const client = { calls: 0, models: { generateContent: async () => {
    if (++client.calls === 1) throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNRESET"), { code: "ECONNRESET" }) });
    return { candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: "done" }] } }] };
  } } };
  const { provider, lines } = await geminiWith(client);
  const chat = provider.conversation({ system: "s", tools: [], firstMessage: "go" });
  assert.deepEqual(await chat.next(), { toolCalls: [], stop: "end" });
  assert.equal(client.calls, 2);
  assert.match(lines[0], /^ {2}Model request failed \(ECONNRESET\); retrying in \d+s \(attempt 2 of 3\)$/);
});

test("a 401 is thrown at once, without a retry", async () => {
  const client = geminiClient([apiError(401)]);
  const { provider, lines, slept } = await geminiWith(client);
  await assert.rejects(provider.json({ system: "s", texts: ["t"], schema }), /HTTP 401/);
  assert.equal(client.calls, 1);
  assert.deepEqual(lines, []);
  assert.deepEqual(slept, []);
});

test("when the attempts are used up, the last error is thrown", async () => {
  const client = geminiClient([apiError(503), apiError(529), apiError(429, { message: "last one" })]);
  const { provider, lines } = await geminiWith(client);
  await assert.rejects(provider.json({ system: "s", texts: ["t"], schema }), /last one/);
  assert.equal(client.calls, 3);
  assert.equal(lines.length, 2);
});

test("a retry-after header sets the wait, in seconds or as a date, within a minute", async () => {
  const client = geminiClient([apiError(429, { headers: { "retry-after": "7" } }), apiError(429, { headers: new Headers({ "retry-after": "3" }) })]);
  const { provider, lines, slept } = await geminiWith(client);
  assert.deepEqual(await provider.json({ system: "s", texts: ["t"], schema }), { value: { ok: true } });
  assert.deepEqual(slept, [7000, 3000]);
  assert.match(lines[0], /retrying in 7s/);

  const now = Date.parse("2026-01-01T00:00:00Z");
  assert.equal(retryAfterMs(apiError(503, { headers: { "retry-after": "Thu, 01 Jan 2026 00:00:05 GMT" } }), now), 5000);
  assert.equal(retryAfterMs(apiError(503, { headers: { "retry-after": "600" } })), 60_000, "a long wait is capped");
  assert.equal(retryAfterMs(apiError(503, { headers: { "retry-after-ms": "250" } })), 250);
  assert.equal(retryAfterMs(apiError(503)), null);
  assert.equal(retryAfterMs(apiError(503, { headers: { "retry-after": "-5" } })), null);
});

test("withRetry tells transient failures from the rest", async () => {
  for (const status of [408, 409, 425, 429, 500, 502, 503, 504, 529]) assert.ok(isTransientModelError(apiError(status)), `${status}`);
  for (const status of [400, 401, 403, 404, 422]) assert.ok(!isTransientModelError(apiError(status)), `${status}`);
  assert.ok(isTransientModelError(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })));
  assert.ok(isTransientModelError(Object.assign(new Error("getaddrinfo EAI_AGAIN api.example"), { code: "EAI_AGAIN" })));
  assert.ok(isTransientModelError(new TypeError("fetch failed", { cause: { code: "ETIMEDOUT" } })));
  assert.ok(isTransientModelError(new Error("socket hang up")));
  assert.ok(isTransientModelError(new Error("The model is overloaded. Please try again later.")));
  assert.ok(!isTransientModelError(new SyntaxError("Unexpected token < in JSON")));
  assert.ok(!isTransientModelError(new Error("Invalid schema for response_format")));
  // A status wins over a message: an overloaded 400 is still a bad request.
  assert.ok(!isTransientModelError(apiError(400, { message: "overloaded" })));

  let calls = 0;
  const result = await withRetry(async () => (++calls < 2 ? Promise.reject(apiError(503)) : "ok"), { attempts: 2, sleep: async () => {} });
  assert.equal(result, "ok");
  calls = 0;
  await assert.rejects(withRetry(async () => (calls++, Promise.reject(apiError(503))), { attempts: 1, sleep: async () => {} }), /HTTP 503/);
  assert.equal(calls, 1, "one attempt means no retry");
});

test("the Anthropic and OpenAI SDK clients are built with 3 retries and a bounded timeout", async () => {
  // The OpenAI SDK reads its key from the process environment itself.
  const saved = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "k";
  const openai = await createProvider({}, { OPENAI_API_KEY: "k" }).finally(() => (saved === undefined ? delete process.env.OPENAI_API_KEY : (process.env.OPENAI_API_KEY = saved)));
  const clients = [
    (await createProvider({}, { ANTHROPIC_API_KEY: "k" })).client,
    openai.client,
    (await createProvider({ baseUrl: "http://localhost:11434/v1", model: "llama3" }, {})).client,
    (await createProvider({}, { AI_GATEWAY_API_KEY: "v" })).client,
    (await createProvider({}, { CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "acc" })).client,
    (await createProvider({}, { ANTHROPIC_API_KEY: "k", AI_GATEWAY_URL: "https://gateway.ai.cloudflare.com/v1/acc/default" })).client,
  ];
  for (const client of clients) {
    assert.equal(client.maxRetries, 2);
    assert.equal(client.timeout, 300_000);
  }
});

test("openai-compatible: the real OpenAI SDK retries a 503 and honors retry-after-ms", async () => {
  let requests = 0;
  const api = createServer(async (req, res) => {
    for await (const _ of req); // drain the body
    if (++requests < 3) return res.writeHead(503, { "content-type": "application/json", "retry-after-ms": "10" }).end('{"error":{"message":"overloaded"}}');
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "x", object: "chat.completion", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: '{"ok":true}' } }] }));
  });
  await new Promise((r) => api.listen(0, "127.0.0.1", r));
  try {
    const provider = await createProvider({ baseUrl: `http://127.0.0.1:${api.address().port}/v1`, model: "m" }, { OPENAI_COMPATIBLE_API_KEY: "sk" });
    assert.deepEqual(await provider.json({ system: "s", texts: ["t"], schema }), { value: { ok: true } });
    assert.equal(requests, 3);
  } finally {
    api.close();
  }
});

// --- Navigation ---------------------------------------------------------------

test("navigation errors worth a second try are told from the rest", () => {
  const pw = (message, name = "Error") => Object.assign(new Error(message), { name });
  assert.ok(isTransientNavigationError(pw("page.goto: net::ERR_CONNECTION_RESET at http://x/")));
  assert.ok(isTransientNavigationError(pw("page.goto: net::ERR_NETWORK_CHANGED at http://x/")));
  assert.ok(isTransientNavigationError(pw("page.goto: net::ERR_TIMED_OUT at http://x/")));
  assert.ok(isTransientNavigationError(pw("page.goto: net::ERR_NAME_NOT_RESOLVED at http://x/")));
  assert.ok(isTransientNavigationError(pw("page.goto: Timeout 30000ms exceeded.", "TimeoutError")));
  assert.ok(!isTransientNavigationError(pw("page.goto: net::ERR_BLOCKED_BY_CLIENT at http://x/")));
  assert.ok(!isTransientNavigationError(pw("page.goto: net::ERR_CERT_AUTHORITY_INVALID at https://x/")));
  assert.ok(!isTransientNavigationError(pw("page.goto: net::ERR_PROXY_CONNECTION_FAILED at http://x/")));
  assert.ok(!isTransientNavigationError(pw("page.goto: net::ERR_TOO_MANY_REDIRECTS at http://x/")));
  assert.ok(!isTransientNavigationError(pw("Target page, context or browser has been closed")));

  // When Chromium's error page commits first, goto's error has no code, so the failed document request's code decides.
  const cutShort = pw('page.goto: Navigation to "http://x/" is interrupted by another navigation to "chrome-error://chromewebdata/"');
  assert.ok(isTransientNavigationError(cutShort, "net::ERR_EMPTY_RESPONSE"));
  assert.ok(isTransientNavigationError(cutShort, "net::ERR_CONNECTION_RESET"));
  assert.ok(!isTransientNavigationError(cutShort, "net::ERR_BLOCKED_BY_CLIENT"));
  assert.ok(!isTransientNavigationError(cutShort, "net::ERR_CERT_AUTHORITY_INVALID"));
  assert.ok(!isTransientNavigationError(cutShort), "an error page without a failed request is not retried");
  const otherPage = pw('page.goto: Navigation to "http://x/" is interrupted by another navigation to "http://x/next"');
  assert.ok(!isTransientNavigationError(otherPage, "net::ERR_EMPTY_RESPONSE"), "only an error page defers to the failed request");
});

test("a page load the network dropped is tried once more; a load the guard refused is not", async () => {
  const hits = {};
  let drop = true;
  let otherHits = 0;
  const other = createServer((req, res) => (otherHits++, res.writeHead(200).end("elsewhere")));
  await new Promise((r) => other.listen(0, "127.0.0.1", r));
  const server = createServer((req, res) => {
    hits[req.url] = (hits[req.url] ?? 0) + 1;
    // The first load dies on the wire, the way a flaky connection or a restarting server drops it.
    if (req.url === "/" && drop) return (drop = false), req.socket.destroy();
    // "localhost" is another host than 127.0.0.1, so this redirect leaves the audited site.
    if (req.url === "/away") return res.writeHead(302, { location: `http://localhost:${other.address().port}/` }).end();
    res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><h1>Landed</h1>");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const lines = [];
  // No wait before the retry, so it starts before Chromium has shown its error page for the dropped load:
  // that error page must not cut the retry short.
  const session = new AuditSession({ viewport: "desktop", site: url, log: (l) => lines.push(l), navigationRetryMs: 0 });
  await session.start();
  try {
    assert.equal(await session.act({ action: "goto", url }), null);
    assert.equal(hits["/"], 2, "the dropped load was requested again");
    assert.equal(session.page.url(), url);
    assert.equal(session.landing.final, url);
    assert.deepEqual(lines.map((l) => l.replace(/net::ERR_[A-Z_]+/, "net::ERR_X")), [`  Opening ${url} failed (net::ERR_X); trying once more in 0s`]);

    // The browser follows the redirect on its own; the guard then sends it back. Neither hop is loaded again.
    const blocked = await session.act({ action: "goto", url: `${url}away` });
    assert.match(blocked, /Navigation blocked: localhost is outside the audited site/);
    assert.equal(hits["/away"], 1, "a refused navigation is not tried again");
    assert.equal(otherHits, 1);
    assert.equal(lines.length, 1);

    // A page outside the site is refused before any request, so there is nothing to try again.
    const outside = await session.act({ action: "goto", url: `http://localhost:${other.address().port}/` });
    assert.match(outside, /outside the audited site/);
    assert.equal(otherHits, 1);
    assert.equal(lines.length, 1);
  } finally {
    await session.close();
    server.close();
    other.close();
  }
});
