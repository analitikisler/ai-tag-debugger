import { test } from "node:test";
import assert from "node:assert/strict";
import { KEY_VARS, keysSet, minNodeMajor, nodeVersionOk } from "../scripts/setup.js";
import { PROVIDERS } from "../src/providers.js";

test("setup reads the Node major version from the engines range", () => {
  assert.equal(minNodeMajor(">=20"), 20);
  assert.equal(minNodeMajor(undefined), 0);
  assert.ok(nodeVersionOk("v22.22.0", ">=20"));
  assert.ok(nodeVersionOk("v20.0.0", ">=20"));
  assert.ok(!nodeVersionOk("v18.19.1", ">=20"));
});

test("setup reports which provider keys are set, by name only", () => {
  assert.deepEqual(keysSet({}), []);
  assert.deepEqual(keysSet({ OPENAI_API_KEY: "sk-x", GEMINI_API_KEY: "" }), ["OPENAI_API_KEY"]);
  // Every provider's own key variable is one setup looks for (the compatible API is found by its base URL).
  for (const [name, p] of Object.entries(PROVIDERS)) if (name !== "openai-compatible") assert.ok(KEY_VARS.includes(p.env), p.env);
});
