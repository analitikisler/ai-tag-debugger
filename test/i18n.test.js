// Every report string exists in every language, in the same shape. Strings interpolate through
// functions (`title: (host) => ...`), so a function's parameter count is its placeholder list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGUAGES, messages } from "../src/i18n.js";

/** Flattens a message tree into "ui.title" -> value. */
function leaves(tree, prefix = "", out = new Map()) {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") leaves(v, key, out);
    else out.set(key, v);
  }
  return out;
}

const en = leaves(messages("en"));
const others = Object.keys(LANGUAGES).filter((l) => l !== "en");

test("at least one other language exists and messages() refuses unknown ones", () => {
  assert.ok(others.length >= 1);
  assert.throws(() => messages("xx"), /Unsupported language "xx"/);
});

for (const lang of others) {
  const tree = leaves(messages(lang));

  test(`${lang} has every key en has, and nothing more`, () => {
    const missing = [...en.keys()].filter((k) => !tree.has(k));
    const extra = [...tree.keys()].filter((k) => !en.has(k));
    assert.deepEqual(missing, [], `missing in ${lang}`);
    assert.deepEqual(extra, [], `only in ${lang}`);
  });

  test(`${lang} strings are not empty and take the same placeholders as en`, () => {
    for (const [key, value] of en) {
      const translated = tree.get(key);
      assert.equal(typeof translated, typeof value, `${key} is a ${typeof value} in en`);
      if (typeof value === "string") {
        assert.ok(value.trim(), `en ${key} is empty`);
        assert.ok(translated.trim(), `${lang} ${key} is empty`);
      } else {
        assert.equal(typeof value, "function", `${key} is a string or a function`);
        assert.equal(translated.length, value.length, `${key} takes ${value.length} placeholders in en`);
      }
    }
  });
}
