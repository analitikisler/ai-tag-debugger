// The OpenAI and Gemini adapters, driven with fake clients against the demo shop.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { runJourney } from "../src/agent.js";
import { createProvider, resolveProviderName } from "../src/providers.js";

const PORT = 4398;
let server;
before(async () => {
  server = spawn(process.execPath, ["examples/serve.js"], { env: { ...process.env, PORT: String(PORT) }, stdio: "pipe" });
  await new Promise((resolve) => server.stdout.once("data", resolve));
});
after(() => server.kill());

const refIn = (text, pattern) => {
  const line = text.split("\n").find((l) => /^\[\d+\]/.test(l) && pattern.test(l));
  return line ? Number(line.match(/^\[(\d+)\]/)[1]) : null;
};

const STEPS = [
  { name: "browser_action", match: /Accept all/, args: { action: "click", reason: "Accept cookies", accepts_consent: true } },
  { name: "browser_action", match: /Add to cart|product\.html/, args: { action: "click", reason: "Open a product" } },
  { name: "finish", args: { success: true, note: "Done." } },
];

test("provider is picked from the API key that is set", () => {
  assert.equal(resolveProviderName(undefined, { OPENAI_API_KEY: "x" }), "openai");
  assert.equal(resolveProviderName(undefined, { GEMINI_API_KEY: "x" }), "gemini");
  assert.equal(resolveProviderName(undefined, { ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "x" }), "anthropic");
  assert.equal(resolveProviderName("gemini", { ANTHROPIC_API_KEY: "x" }), "gemini");
  assert.throws(() => resolveProviderName("llama", {}), /Unknown provider/);
});

test("OpenAI: the agent loop runs through function calls and tool messages", async () => {
  let i = 0;
  const requests = [];
  const client = {
    chat: {
      completions: {
        create: async (params) => {
          requests.push(structuredClone(params));
          const last = params.messages.at(-1).content;
          const step = STEPS[i++];
          const args = step.match ? { ...step.args, ref: refIn(last, step.match) } : step.args;
          return { choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: `call_${i}`, type: "function", function: { name: step.name, arguments: JSON.stringify(args) } }] } }] };
        },
      },
    },
  };
  const provider = await createProvider({ name: "openai", client });
  const run = await runJourney({ site: `http://localhost:${PORT}` }, { id: "j", goal: "Open a product." }, "desktop", { provider });
  assert.equal(run.completed, true);
  assert.equal(run.consentStep, 2);
  assert.equal(requests[0].model, "gpt-5.5");
  assert.equal(requests[0].messages[0].role, "system");
  assert.deepEqual(requests[0].tools.map((t) => t.function.name), ["browser_action", "finish"]);
  assert.equal(requests[1].messages.at(-1).role, "tool");
  assert.equal(requests[1].messages.at(-1).tool_call_id, "call_1");
});

test("Gemini: the agent loop runs through functionCall and functionResponse parts", async () => {
  let i = 0;
  const requests = [];
  const client = {
    models: {
      generateContent: async (params) => {
        requests.push(structuredClone(params));
        const lastParts = params.contents.at(-1).parts;
        const last = lastParts.map((p) => p.text ?? p.functionResponse?.response?.output ?? "").join("\n");
        const step = STEPS[i++];
        const args = step.match ? { ...step.args, ref: refIn(last, step.match) } : step.args;
        return { candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ functionCall: { name: step.name, args } }] } }] };
      },
    },
  };
  const provider = await createProvider({ name: "gemini", client });
  const run = await runJourney({ site: `http://localhost:${PORT}` }, { id: "j", goal: "Open a product." }, "mobile", { provider });
  assert.equal(run.completed, true);
  assert.equal(requests[0].model, "gemini-pro-latest");
  assert.deepEqual(requests[0].config.tools[0].functionDeclarations.map((f) => f.name), ["browser_action", "finish"]);
  assert.equal(requests[1].contents.at(-1).parts[0].functionResponse.name, "browser_action");
});

test("structured JSON output works on every provider", async () => {
  const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
  const openai = await createProvider({
    name: "openai",
    client: { chat: { completions: { create: async (p) => (assert.equal(p.response_format.json_schema.strict, true), { choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] }) } } },
  });
  const gemini = await createProvider({
    name: "gemini",
    client: { models: { generateContent: async (p) => (assert.equal(p.config.responseMimeType, "application/json"), { text: '{"ok":true}' }) } },
  });
  for (const provider of [openai, gemini]) {
    assert.deepEqual(await provider.json({ system: "s", texts: ["t"], schema }), { value: { ok: true } });
  }
});

test("openai-compatible: the real OpenAI SDK talks to a custom base URL, and JSON falls back when strict schemas are refused", async () => {
  const { createServer } = await import("node:http");
  const bodies = [];
  let call = 0;
  const api = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    bodies.push({ url: req.url, auth: req.headers.authorization, body });
    const reply = (obj, status = 200) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(obj));
    if (body.response_format?.type === "json_schema") return reply({ error: { message: "response_format json_schema is not supported" } }, 400);
    if (body.response_format?.type === "json_object") {
      return reply({ id: "x", object: "chat.completion", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: '```json\n{"ok": true}\n```' } }] });
    }
    const step = STEPS[call++];
    const last = body.messages.at(-1).content;
    const args = step.match ? { ...step.args, ref: refIn(last, step.match) } : step.args;
    reply({ id: "x", object: "chat.completion", choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: `c${call}`, type: "function", function: { name: step.name, arguments: JSON.stringify(args) } }] } }] });
  });
  await new Promise((r) => api.listen(0, "127.0.0.1", r));
  const baseUrl = `http://127.0.0.1:${api.address().port}/v1`;
  try {
    assert.equal(resolveProviderName(undefined, { OPENAI_COMPATIBLE_BASE_URL: baseUrl, ANTHROPIC_API_KEY: "x" }), "openai-compatible");
    await assert.rejects(createProvider({ name: "openai-compatible" }, {}), /needs the API address/);
    await assert.rejects(createProvider({ baseUrl }, {}), /needs a model id/);

    const provider = await createProvider({ baseUrl, model: "kimi-test" }, { OPENAI_COMPATIBLE_API_KEY: "sk-test" });
    assert.match(provider.name, /^openai-compatible \(127\.0\.0\.1:\d+\)$/);
    const run = await runJourney({ site: `http://localhost:${PORT}` }, { id: "j", goal: "Open a product." }, "desktop", { provider });
    assert.equal(run.completed, true);
    assert.equal(bodies[0].url, "/v1/chat/completions");
    assert.equal(bodies[0].auth, "Bearer sk-test");
    assert.equal(bodies[0].body.model, "kimi-test");
    assert.equal(bodies[0].body.reasoning_effort, undefined, "compatible APIs get no reasoning_effort");

    const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
    assert.deepEqual(await provider.json({ system: "s", texts: ["t"], schema }), { value: { ok: true } });
    assert.match(bodies.at(-1).body.messages[0].content, /matches this JSON Schema/);
  } finally {
    api.close();
  }
});
