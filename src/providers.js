// AI providers. Bring your own API key: Anthropic (Claude), OpenAI, Google Gemini, or any
// OpenAI-compatible API (Kimi, GLM, DeepSeek, Mistral, Groq, OpenRouter, a local Ollama...).
//
// Every provider exposes the same two things:
//   conversation({ system, tools, firstMessage }) -> { next(), addToolResults(results), addUserText(text) }
//     next() returns { toolCalls: [{ id, name, input }], stop: "tool_use" | "end" | "refusal" | "max_tokens" }
//   json({ system, texts, schema }) -> { value } or { error }
// Tools use one neutral shape: { name, description, schema } where schema is JSON Schema.

export const PROVIDERS = {
  // cheapModel is what `--model cheap` picks: a small, inexpensive model for routine CI runs.
  anthropic: { label: "Anthropic (Claude)", env: "ANTHROPIC_API_KEY", defaultModel: "claude-opus-5-5", cheapModel: "claude-haiku-5-5" },
  openai: { label: "OpenAI", env: "OPENAI_API_KEY", defaultModel: "gpt-5.5", cheapModel: "gpt-5.5-mini" },
  gemini: { label: "Google Gemini", env: "GEMINI_API_KEY", defaultModel: "gemini-pro-latest", cheapModel: "gemini-flash-latest" },
  // Vercel AI Gateway: one key, any model as "<provider>/<model>". OpenAI-compatible API.
  vercel: { label: "Vercel AI Gateway", env: "AI_GATEWAY_API_KEY", defaultModel: "anthropic/claude-opus-5.5", cheapModel: "anthropic/claude-haiku-5.5" },
  // Cloudflare Workers AI: open models on Cloudflare's network, billed per use. OpenAI-compatible API.
  cloudflare: { label: "Cloudflare Workers AI", env: "CLOUDFLARE_API_TOKEN", defaultModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", cheapModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
  // Any API that speaks the OpenAI chat completions protocol. Needs a base URL and a model.
  "openai-compatible": { label: "OpenAI-compatible API", env: "OPENAI_COMPATIBLE_API_KEY", defaultModel: null },
};

/** Picks the provider: explicit name first, then whichever API key is set. */
export function resolveProviderName(name, env = process.env) {
  if (name) {
    if (!PROVIDERS[name]) throw new Error(`Unknown provider "${name}". Use: ${Object.keys(PROVIDERS).join(", ")}`);
    return name;
  }
  if (env.OPENAI_COMPATIBLE_BASE_URL) return "openai-compatible";
  if (env.AI_GATEWAY_API_KEY) return "vercel";
  if (env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID) return "cloudflare";
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  if (env.OPENAI_API_KEY) return "openai";
  if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY) return "gemini";
  return "anthropic";
}

const NO_API_KEY = `No AI provider key found. Set one of ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, AI_GATEWAY_API_KEY for Vercel AI Gateway, or CLOUDFLARE_API_TOKEN with CLOUDFLARE_ACCOUNT_ID for Cloudflare Workers AI (or OPENAI_COMPATIBLE_BASE_URL for an OpenAI-compatible API), or pick one with --provider. To run without any AI model, replay saved steps with --no-ai.`;

function hasApiKey(env) {
  return Boolean(env.OPENAI_COMPATIBLE_BASE_URL || env.AI_GATEWAY_API_KEY || (env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID) || env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.OPENAI_API_KEY || env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
}

/**
 * @param {{ name?: string, model?: string, baseUrl?: string, client?: any }} opts
 *   baseUrl: for openai-compatible, e.g. https://api.deepseek.com or http://localhost:11434/v1.
 *   client: an already constructed SDK client (used by tests).
 */
export async function createProvider(opts = {}, env = process.env) {
  // A bare client (tests, embedding) is an Anthropic client unless named otherwise.
  const name = opts.client && !opts.name ? "anthropic" : opts.baseUrl && !opts.name ? "openai-compatible" : resolveProviderName(opts.name, env);
  const provider = await buildProvider(name, opts, env);
  provider.key = name; // The PROVIDERS key, for status lines.
  return provider;
}

async function buildProvider(name, opts, env) {
  // With no provider named and no key set, the SDK would only fail at the first step with an
  // unclear auth error, after the browser has started. A named provider skips this check, since
  // its SDK may find credentials elsewhere (an Anthropic profile, Google Cloud credentials).
  if (!opts.client && !opts.name && !opts.baseUrl && !hasApiKey(env)) throw Object.assign(new Error(NO_API_KEY), { code: "NO_API_KEY" });
  if (name === "openai-compatible") {
    const baseURL = opts.baseUrl ?? env.OPENAI_COMPATIBLE_BASE_URL;
    const model = compatibleModel(opts.model, env);
    if (!baseURL) throw new Error("openai-compatible needs the API address: --base-url or OPENAI_COMPATIBLE_BASE_URL, e.g. https://api.deepseek.com");
    if (!model) throw new Error("openai-compatible needs a model id: --model or OPENAI_COMPATIBLE_MODEL (\"cheap\" has no meaning here, since the API's models are unknown).");
    // Local servers such as Ollama need no key, but the SDK wants a non-empty one.
    const apiKey = env.OPENAI_COMPATIBLE_API_KEY || "not-needed";
    const client = opts.client ?? new (await import("openai")).default({ baseURL, apiKey });
    return openaiProvider(client, model, { compatible: true, label: new URL(baseURL).host });
  }
  if (name === "vercel") {
    const client = opts.client ?? new (await import("openai")).default({ baseURL: VERCEL_GATEWAY, apiKey: env.AI_GATEWAY_API_KEY });
    return { ...openaiProvider(client, pickModel("vercel", opts.model), { compatible: true }), name: "vercel" };
  }
  if (name === "cloudflare") {
    const account = env.CLOUDFLARE_ACCOUNT_ID;
    if (!opts.client && !(account && env.CLOUDFLARE_API_TOKEN)) throw new Error("Cloudflare Workers AI needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.");
    const client = opts.client ?? new (await import("openai")).default({ baseURL: `${CLOUDFLARE_API}/${account}/ai/v1`, apiKey: env.CLOUDFLARE_API_TOKEN });
    return { ...openaiProvider(client, pickModel("cloudflare", opts.model), { compatible: true }), name: "cloudflare" };
  }
  const model = pickModel(name, opts.model);
  const gateway = gatewayOptions(name, env);
  const provider = await builtInProvider(name, model, gateway, opts.client, env);
  // Shown in the "Using ..." line so a run says whether its calls went through the gateway.
  if (gateway.baseURL && !opts.client) provider.via = "Cloudflare AI Gateway";
  return provider;
}

async function builtInProvider(name, model, gateway, client, env) {
  if (name === "anthropic") return anthropicProvider(client ?? new (await import("@anthropic-ai/sdk")).default(gateway), model);
  if (name === "openai") return openaiProvider(client ?? new (await import("openai")).default(gateway), model);
  const { GoogleGenAI } = await import("@google/genai");
  const apiKey = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
  const httpOptions = gateway.baseURL ? { httpOptions: { baseUrl: gateway.baseURL, headers: gateway.defaultHeaders } } : {};
  return geminiProvider(client ?? new GoogleGenAI({ ...(apiKey ? { apiKey } : {}), ...httpOptions }), model);
}

const VERCEL_GATEWAY = "https://ai-gateway.vercel.sh/v1";
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4/accounts";

/** An openai-compatible API has no known cheap model, so `cheap` falls back to OPENAI_COMPATIBLE_MODEL. */
function compatibleModel(model, env) {
  return (model === "cheap" ? undefined : model) ?? env.OPENAI_COMPATIBLE_MODEL;
}

/** The model to use: an explicit id, `cheap` for the provider's small CI model, else the default. */
export function pickModel(name, model) {
  if (model === "cheap") return PROVIDERS[name]?.cheapModel ?? PROVIDERS[name]?.defaultModel ?? model;
  return model ?? PROVIDERS[name].defaultModel;
}

const KEY_PROVIDERS = [
  ["vercel", (env) => env.AI_GATEWAY_API_KEY],
  ["cloudflare", (env) => env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID],
  ["anthropic", (env) => env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN],
  ["openai", (env) => env.OPENAI_API_KEY],
  ["gemini", (env) => env.GEMINI_API_KEY || env.GOOGLE_API_KEY],
  ["openai-compatible", (env) => env.OPENAI_COMPATIBLE_BASE_URL],
];

/**
 * One line saying which AI aitd would use and why, e.g.
 * "AI: anthropic (claude-opus-5-5) via Cloudflare AI Gateway · also set: gemini (pick with --provider)".
 */
export function aiStatus(opts = {}, env = process.env) {
  if (!opts.name && !KEY_PROVIDERS.some(([, has]) => has(env))) return "AI: no key set (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, AI_GATEWAY_API_KEY or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID)";
  const name = resolveProviderName(opts.name, env);
  const model = (name === "openai-compatible" ? compatibleModel(opts.model, env) : pickModel(name, opts.model)) ?? "no model set";
  const via = name !== "vercel" && gatewayOptions(name, env).baseURL ? " via Cloudflare AI Gateway" : "";
  return `AI: ${name} (${model})${via}${alsoSet(name, env)}`;
}

/** " · also set: gemini (pick with --provider)" when keys for other providers are set too. */
export function alsoSet(name, env = process.env) {
  const others = KEY_PROVIDERS.filter(([n, has]) => n !== name && has(env)).map(([n]) => n);
  return others.length ? ` · also set: ${others.join(", ")} (pick with --provider)` : "";
}

// Cloudflare AI Gateway path for each provider, appended to AI_GATEWAY_URL.
const GATEWAY_PATHS = { anthropic: "anthropic", openai: "openai", gemini: "google-ai-studio" };

/**
 * SDK client options that send a provider's calls through Cloudflare AI Gateway, for logs,
 * cost tracking and optional caching. AI_GATEWAY_URL is https://gateway.ai.cloudflare.com/v1/<account>/<gateway>;
 * AI_GATEWAY_TOKEN is only needed when the gateway has authentication on. Empty when unset.
 */
export function gatewayOptions(name, env = process.env) {
  const base = env.AI_GATEWAY_URL?.trim().replace(/\/+$/, "");
  if (!base || !GATEWAY_PATHS[name]) return {};
  const options = { baseURL: `${base}/${GATEWAY_PATHS[name]}` };
  if (env.AI_GATEWAY_TOKEN) options.defaultHeaders = { "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}` };
  return options;
}

// --- Anthropic ---------------------------------------------------------------

function anthropicProvider(client, model) {
  const common = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
  return {
    name: "anthropic",
    model,
    conversation({ system, tools, firstMessage }) {
      const messages = [{ role: "user", content: firstMessage }];
      const toolDefs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }));
      return {
        async next() {
          const response = await client.beta.messages.create({
            model,
            max_tokens: 16000,
            system,
            tools: toolDefs,
            messages,
            // Navigation is simple step-by-step work; low effort keeps runs fast and cheap.
            output_config: { effort: "low" },
            cache_control: { type: "ephemeral" },
            ...common,
          });
          if (response.stop_reason === "refusal") return { toolCalls: [], stop: "refusal" };
          messages.push({ role: "assistant", content: response.content });
          const toolCalls = response.content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, input: b.input }));
          return { toolCalls, stop: toolCalls.length ? "tool_use" : response.stop_reason === "max_tokens" ? "max_tokens" : "end" };
        },
        addToolResults(results) {
          messages.push({
            role: "user",
            content: results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.content, ...(r.isError ? { is_error: true } : {}) })),
          });
        },
        addUserText(text) {
          messages.push({ role: "user", content: text });
        },
      };
    },
    async json({ system, texts, schema }) {
      const stream = client.beta.messages.stream({
        model,
        max_tokens: 64000,
        system,
        messages: [{ role: "user", content: texts.map((text) => ({ type: "text", text })) }],
        output_config: { effort: "high", format: { type: "json_schema", schema } },
        ...common,
      });
      const message = await stream.finalMessage();
      if (message.stop_reason === "refusal" || message.stop_reason === "max_tokens") return { error: message.stop_reason };
      return { value: JSON.parse(message.content.filter((b) => b.type === "text").map((b) => b.text).join("")) };
    },
  };
}

// --- OpenAI ------------------------------------------------------------------

// Also serves OpenAI-compatible APIs. Those often lack reasoning_effort and strict JSON
// schemas, so for them the first is left out and JSON falls back to plain JSON mode.
function openaiProvider(client, model, { compatible = false, label } = {}) {
  const effort = (level) => (compatible ? {} : { reasoning_effort: level });
  return {
    name: compatible ? `openai-compatible (${label})` : "openai",
    model,
    conversation({ system, tools, firstMessage }) {
      const messages = [
        { role: "system", content: system },
        { role: "user", content: firstMessage },
      ];
      const toolDefs = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.schema } }));
      return {
        async next() {
          const response = await client.chat.completions.create({ model, messages, tools: toolDefs, ...effort("low") });
          const choice = response.choices[0];
          const message = choice.message;
          if (message.refusal) return { toolCalls: [], stop: "refusal" };
          messages.push(message);
          const toolCalls = (message.tool_calls ?? [])
            .filter((c) => c.type === "function")
            .map((c) => ({ id: c.id, name: c.function.name, input: safeParse(c.function.arguments) }));
          return { toolCalls, stop: toolCalls.length ? "tool_use" : choice.finish_reason === "length" ? "max_tokens" : "end" };
        },
        addToolResults(results) {
          for (const r of results) messages.push({ role: "tool", tool_call_id: r.id, content: r.isError ? `Error: ${r.content}` : r.content });
        },
        addUserText(text) {
          messages.push({ role: "user", content: text });
        },
      };
    },
    async json({ system, texts, schema }) {
      const messages = [
        { role: "system", content: system },
        { role: "user", content: texts.join("\n\n") },
      ];
      let response;
      try {
        response = await client.chat.completions.create({
          model,
          ...effort("high"),
          messages,
          response_format: { type: "json_schema", json_schema: { name: "result", schema, strict: true } },
        });
      } catch (err) {
        if (!compatible) throw err;
        // No structured outputs here: ask for plain JSON and describe the shape instead.
        response = await client.chat.completions.create({
          model,
          messages: [{ role: "system", content: `${system}\n\nReply with only a JSON object that matches this JSON Schema:\n${JSON.stringify(schema)}` }, messages[1]],
          response_format: { type: "json_object" },
        });
      }
      const message = response.choices[0].message;
      if (message.refusal) return { error: "refusal" };
      if (response.choices[0].finish_reason === "length") return { error: "max_tokens" };
      return { value: parseJsonReply(message.content) };
    },
  };
}

// --- Google Gemini -----------------------------------------------------------

function geminiProvider(ai, model) {
  return {
    name: "gemini",
    model,
    conversation({ system, tools, firstMessage }) {
      const contents = [{ role: "user", parts: [{ text: firstMessage }] }];
      const config = {
        systemInstruction: system,
        tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.schema })) }],
      };
      let pendingNames = new Map();
      return {
        async next() {
          const response = await ai.models.generateContent({ model, contents, config });
          const candidate = response.candidates?.[0];
          if (!candidate?.content) return { toolCalls: [], stop: candidate?.finishReason === "MAX_TOKENS" ? "max_tokens" : "refusal" };
          contents.push(candidate.content);
          const calls = (candidate.content.parts ?? []).filter((p) => p.functionCall).map((p) => p.functionCall);
          pendingNames = new Map();
          const toolCalls = calls.map((c, i) => {
            const id = c.id ?? `call_${contents.length}_${i}`;
            pendingNames.set(id, { name: c.name, id: c.id });
            return { id, name: c.name, input: c.args ?? {} };
          });
          return { toolCalls, stop: toolCalls.length ? "tool_use" : candidate.finishReason === "MAX_TOKENS" ? "max_tokens" : "end" };
        },
        addToolResults(results) {
          contents.push({
            role: "user",
            parts: results.map((r) => {
              const call = pendingNames.get(r.id) ?? { name: "unknown" };
              return {
                functionResponse: {
                  ...(call.id ? { id: call.id } : {}),
                  name: call.name,
                  response: r.isError ? { error: r.content } : { output: r.content },
                },
              };
            }),
          });
        },
        addUserText(text) {
          contents.push({ role: "user", parts: [{ text }] });
        },
      };
    },
    async json({ system, texts, schema }) {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: texts.map((text) => ({ text })) }],
        config: { systemInstruction: system, responseMimeType: "application/json", responseJsonSchema: schema },
      });
      if (!response.text) return { error: response.candidates?.[0]?.finishReason ?? "empty response" };
      return { value: JSON.parse(response.text) };
    },
  };
}

/** Parses a JSON reply, also when a model wraps it in a Markdown code fence. */
function parseJsonReply(text) {
  const trimmed = String(text ?? "").trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

function safeParse(text) {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return null;
  }
}
