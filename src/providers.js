// AI providers. Bring your own API key: Anthropic (Claude), OpenAI, Google Gemini, or any
// OpenAI-compatible API (Kimi, GLM, DeepSeek, Mistral, Groq, OpenRouter, a local Ollama...).
//
// Every provider exposes the same two things:
//   conversation({ system, tools, firstMessage }) -> { next(), addToolResults(results), addUserText(text) }
//     next() returns { toolCalls: [{ id, name, input }], stop: "tool_use" | "end" | "refusal" | "max_tokens" }
//   json({ system, texts, schema }) -> { value } or { error }
// Tools use one neutral shape: { name, description, schema } where schema is JSON Schema.

export const PROVIDERS = {
  anthropic: { label: "Anthropic (Claude)", env: "ANTHROPIC_API_KEY", defaultModel: "claude-opus-5-5" },
  openai: { label: "OpenAI", env: "OPENAI_API_KEY", defaultModel: "gpt-5.5" },
  gemini: { label: "Google Gemini", env: "GEMINI_API_KEY", defaultModel: "gemini-pro-latest" },
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
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  if (env.OPENAI_API_KEY) return "openai";
  if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY) return "gemini";
  return "anthropic";
}

/**
 * @param {{ name?: string, model?: string, baseUrl?: string, client?: any }} opts
 *   baseUrl: for openai-compatible, e.g. https://api.deepseek.com or http://localhost:11434/v1.
 *   client: an already constructed SDK client (used by tests).
 */
export async function createProvider(opts = {}, env = process.env) {
  // A bare client (tests, embedding) is an Anthropic client unless named otherwise.
  const name = opts.client && !opts.name ? "anthropic" : opts.baseUrl && !opts.name ? "openai-compatible" : resolveProviderName(opts.name, env);
  if (name === "openai-compatible") {
    const baseURL = opts.baseUrl ?? env.OPENAI_COMPATIBLE_BASE_URL;
    const model = opts.model ?? env.OPENAI_COMPATIBLE_MODEL;
    if (!baseURL) throw new Error("openai-compatible needs the API address: --base-url or OPENAI_COMPATIBLE_BASE_URL, e.g. https://api.deepseek.com");
    if (!model) throw new Error("openai-compatible needs a model id: --model or OPENAI_COMPATIBLE_MODEL.");
    // Local servers such as Ollama need no key, but the SDK wants a non-empty one.
    const apiKey = env.OPENAI_COMPATIBLE_API_KEY || "not-needed";
    const client = opts.client ?? new (await import("openai")).default({ baseURL, apiKey });
    return openaiProvider(client, model, { compatible: true, label: new URL(baseURL).host });
  }
  const model = opts.model ?? PROVIDERS[name].defaultModel;
  if (name === "anthropic") return anthropicProvider(opts.client ?? new (await import("@anthropic-ai/sdk")).default(), model);
  if (name === "openai") return openaiProvider(opts.client ?? new (await import("openai")).default(), model);
  const { GoogleGenAI } = await import("@google/genai");
  const apiKey = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
  return geminiProvider(opts.client ?? new GoogleGenAI(apiKey ? { apiKey } : {}), model);
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
