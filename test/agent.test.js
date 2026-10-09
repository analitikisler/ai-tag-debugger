// Drives the real browser against the demo shop with a fake Claude client,
// to test the agent loop, tool plumbing and capture end to end without an API key.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { runJourney } from "../src/agent.js";
import { explainFindings, renderCsv, renderHtml } from "../src/report.js";
import { checkRun } from "../src/checks.js";

const PORT = 4399;
let server;
before(async () => {
  server = spawn(process.execPath, ["examples/serve.js"], { env: { ...process.env, PORT: String(PORT) }, stdio: "pipe" });
  await new Promise((resolve) => server.stdout.once("data", resolve));
});
after(() => server.kill());

// Picks the ref of the first element whose line matches a pattern in the latest page view.
function refFor(messages, pattern) {
  const last = messages[messages.length - 1];
  const text = typeof last.content === "string" ? last.content : last.content.map((c) => c.content ?? c.text ?? "").join("\n");
  const line = text.split("\n").find((l) => /^\[\d+\]/.test(l) && pattern.test(l));
  return line ? Number(line.match(/^\[(\d+)\]/)[1]) : null;
}

function fakeClient(plan) {
  let i = 0;
  const requests = [];
  return {
    requests,
    beta: {
      messages: {
        create: async (params) => {
          requests.push(structuredClone(params)); // the loop keeps appending to the same messages array
          const step = plan[i++];
          const input = step.tool === "finish" ? step.input : { ...step.input, ref: step.match ? refFor(params.messages, step.match) : undefined };
          return {
            stop_reason: "tool_use",
            content: [{ type: "tool_use", id: `toolu_${i}`, name: step.tool, input }],
          };
        },
      },
    },
  };
}

test("the agent loop completes a journey and records consent and hits", async () => {
  const client = fakeClient([
    { tool: "browser_action", match: /Accept all/, input: { action: "click", reason: "Accept cookies", accepts_consent: true } },
    { tool: "browser_action", match: /product\.html/, input: { action: "click", reason: "Open a product" } },
    { tool: "browser_action", match: /Add to cart/, input: { action: "click", reason: "Add to cart" } },
    { tool: "finish", input: { success: true, note: "Product added to cart." } },
  ]);
  const config = { site: `http://localhost:${PORT}` };
  const run = await runJourney(config, { id: "browse", goal: "Add a product to the cart." }, "desktop", { client });

  assert.equal(run.completed, true);
  assert.equal(run.consentStep, 2);
  assert.deepEqual(run.steps.map((s) => s.label), ["start", `Open http://localhost:${PORT}/`, "Accept cookies", "Open a product", "Add to cart"]);
  assert.ok(run.hits.some((h) => h.platform === "ga4" && h.name === "add_to_cart"));
  assert.ok(run.dataLayerLog.some((e) => Array.isArray(e.value) && e.value[1] === "update"));

  // The timeline records the network calls behind each hit, answered locally.
  const addStep = run.steps.findIndex((s) => s.label === "Add to cart");
  const calls = run.network.filter((c) => c.step === addStep);
  assert.ok(calls.some((c) => c.vendor === "Google Analytics" && c.blocked && c.status === 204));

  // Every hit, push and call appears in the CSV and the HTML timeline.
  const findings = checkRun({ events: [] }, run);
  const csv = renderCsv({ findings, runs: [run] });
  assert.equal(csv.trim().split("\n").length, 1 + run.hits.length + run.dataLayerLog.length + run.network.length);
  const html = renderHtml({ title: "t", generatedAt: "now", findings, explained: null, runs: [run], lang: "tr" });
  assert.match(html, /Ağ istekleri/);
  assert.match(html, /add_to_cart/);

  // Every request carries the tools and the fallback setting, and the first one shows the page.
  const first = client.requests[0];
  assert.equal(first.model, "claude-opus-5-5");
  assert.deepEqual(first.tools.map((t) => t.name), ["browser_action", "finish"]);
  assert.equal(first.fallbacks, "default");
  assert.match(first.messages[0].content, /Accept all/);
});

test("invalid tool input is returned to the model as an error instead of crashing", async () => {
  const client = fakeClient([
    { tool: "browser_action", input: { action: "click", reason: "no ref" } },
    { tool: "finish", input: { success: false, note: "Gave up." } },
  ]);
  const run = await runJourney({ site: `http://localhost:${PORT}` }, { id: "x", goal: "test" }, "mobile", { client });
  assert.equal(run.completed, false);
  const toolResult = client.requests[1].messages.at(-1).content[0];
  assert.equal(toolResult.is_error, true);
});

test("explanations are matched to grouped findings", async () => {
  const plan = { events: [{ platform: "ga4", name: "purchase", required_params: ["value"] }] };
  const run = { journeyId: "j", viewport: "desktop", completed: true, steps: [{ index: 0, label: "start" }], consentStep: null, dataLayerLog: [], hits: [{ platform: "ga4", name: "purchase", step: 0, params: {}, url: "https://x/" }] };
  const findings = checkRun(plan, run);
  const client = {
    beta: {
      messages: {
        stream: (params) => {
          assert.equal(params.output_config.format.type, "json_schema");
          assert.match(params.system, /in Turkish/);
          return { finalMessage: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ summary: "One problem.", explanations: [{ finding: 0, likely_cause: "c", fix: "f" }] }) }] }) };
        },
      },
    },
  };
  const explained = await explainFindings({ findings, plan, runs: [run], client, lang: "tr" });
  assert.equal(explained.summary, "One problem.");
});
