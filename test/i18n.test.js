// Every report string exists in every language, in the same shape. Strings interpolate through
// functions (`title: (host) => ...`), so a function's parameter count is its placeholder list.
// The meaning layer (consequence, fix, category) covers every check checks.js can emit, in both
// languages, and no string tells the reader to rerun the tool.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

// Every check name checks.js emits, read from its source so a new check without strings fails here.
// Most findings are pushed as `check: "name"`; the purchase checks go through reportPurchase(hit, "name", ...).
const checksSource = readFileSync(new URL("../src/checks.js", import.meta.url), "utf8");
const CHECKS = [...new Set([
  ...[...checksSource.matchAll(/\bcheck: "([a-z0-9_]+)"/g)].map((m) => m[1]),
  ...[...checksSource.matchAll(/reportPurchase\(hit, "([a-z0-9_]+)"/g)].map((m) => m[1]),
])];
const CATEGORIES = ["money", "legal", "hygiene"];
const HEADLINES = ["fail_broken", "fail_incomplete", "attention_risk", "attention_warning", "attention_no_hits", "attention_nothing_tested", "pass"];
// The shape verdict() in metrics.js returns.
const sampleVerdict = { status: "fail", headline: "fail_broken", counts: { broken: 2, risk: 1, warning: 1, info: 0, ok: 4 }, journeys: { total: 4, completed: 3, incomplete: 1 }, problems: 4 };

test("at least one other language exists and messages() refuses unknown ones", () => {
  assert.ok(others.length >= 1);
  assert.throws(() => messages("xx"), /Unsupported language "xx"/);
});

test("the check list is read from checks.js and holds the checks the strings are written for", () => {
  assert.ok(CHECKS.length >= 27, `found ${CHECKS.length} checks`);
  for (const known of ["missing_event", "missing_params", "purchase_value_invalid", "journey_incomplete", "matches_plan"]) assert.ok(CHECKS.includes(known), known);
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

  test(`${lang} puts every check in the same category as en`, () => {
    assert.deepEqual(messages(lang).category, messages("en").category);
  });
}

for (const lang of Object.keys(LANGUAGES)) {
  const m = messages(lang);

  test(`${lang} has a consequence, a fix and a category for every check in checks.js`, () => {
    for (const check of CHECKS) {
      assert.equal(typeof m.consequence[check], "string", `${lang} consequence.${check}`);
      assert.ok(m.consequence[check].trim(), `${lang} consequence.${check} is empty`);
      assert.equal(typeof m.fix[check], "string", `${lang} fix.${check}`);
      assert.ok(m.fix[check].trim(), `${lang} fix.${check} is empty`);
      assert.ok(CATEGORIES.includes(m.category[check]), `${lang} category.${check} is ${m.category[check]}`);
    }
    // No strings for checks that no longer exist.
    for (const block of ["consequence", "fix", "category"]) {
      for (const key of Object.keys(m[block])) assert.ok(CHECKS.includes(key), `${lang} ${block}.${key} is not a check in checks.js`);
    }
    for (const c of CATEGORIES) assert.ok(m.categoryLabel[c]?.trim(), `${lang} categoryLabel.${c}`);
  });

  test(`${lang} consequences are one sentence under 160 characters`, () => {
    for (const [check, text] of Object.entries(m.consequence)) {
      assert.ok(text.length < 160, `${lang} consequence.${check} is ${text.length} characters`);
      assert.ok(text.endsWith("."), `${lang} consequence.${check} ends with a full stop`);
      assert.doesNotMatch(text, /[.!?]\s/, `${lang} consequence.${check} is more than one sentence`);
    }
  });

  test(`${lang} verdict strings cover every status and headline`, () => {
    for (const status of ["pass", "fail", "attention"]) assert.ok(m.verdict.status[status]?.trim(), `${lang} verdict.status.${status}`);
    assert.deepEqual(Object.keys(m.verdict.headline).sort(), [...HEADLINES].sort());
    for (const key of HEADLINES) {
      const text = m.verdict.headline[key](sampleVerdict);
      assert.equal(typeof text, "string", `${lang} verdict.headline.${key}`);
      assert.ok(text.trim(), `${lang} verdict.headline.${key} is empty`);
      assert.ok(text.split(/\s+/).length <= 25, `${lang} verdict.headline.${key} is over 25 words: ${text}`);
      // A bare counts object, without journeys, still gives a sentence.
      assert.ok(m.verdict.headline[key](sampleVerdict.counts).trim(), `${lang} verdict.headline.${key} with bare counts`);
    }
    assert.match(m.verdict.headline.fail_broken(sampleVerdict), /2/);
    assert.match(m.verdict.headline.fail_incomplete(sampleVerdict), /1/);
  });

  test(`${lang} never tells the reader to rerun the tool`, () => {
    // Function sources include their template literals, so the flag cannot hide in a placeholder branch.
    for (const [key, value] of leaves(m)) assert.doesNotMatch(String(value), /--no-ai/, `${lang} ${key}`);
  });
}
