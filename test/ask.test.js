import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { commandText, intentToArgs, isSentence, matchKeywords, normalize, translate } from "../src/ask.js";

// Sentence -> the command it should run. A bare "aitd run" then asks what to test (latest plan
// or a goal); every run already reports what changed since the previous one. Topic sentences ("custom events", "ecommerce") plan
// without a topic until plan --topic lands. "report" sentences are not runnable yet.
const EXAMPLES = [
  ["Check my google analytics tags", "aitd run --platforms ga4"],
  ["What changed on my site since the last run", "aitd run"],
  ["Compare my site against the plan", "aitd run --against latest"],
  ["What custom events does my site need", "aitd plan"],
  ["Is my Meta pixel firing on checkout?", 'aitd run --platforms meta --goal "reach checkout"'],
  ["Test signing up for the newsletter", 'aitd run --goal "sign up for the newsletter"'],
  ["Does my purchase event send the right revenue?", "aitd run --journey purchase"],
  ["Make a tracking plan for example.com", "aitd plan --site https://example.com"],
  ["Which tags fire before I accept cookies?", 'aitd run --goal "browse without accepting cookies"'],
  ["Did anything break after yesterday's deploy?", "aitd run"],
  ["Show me only the errors from the last report", null],
  ["What ecommerce events should an online shop track?", "aitd plan"],
  ["Check TikTok and Google Ads on the contact form", 'aitd run --platforms google_ads,tiktok --goal "submit the contact form"'],
  ["Is my site tracking everything in the plan?", "aitd run --against latest"],
];

const commandFor = (intent) => {
  const r = intentToArgs(intent);
  return r.args ? commandText(r.args) : null;
};

for (const [sentence, expected] of EXAMPLES) {
  test(`keywords: ${sentence}`, () => assert.equal(commandFor(matchKeywords(sentence)), expected));
}

// Intents as recorded from an AI reply for the same sentences; key order and platform order may vary.
const RECORDED = {
  "Check my google analytics tags": { action: "run", site: null, against: null, platforms: ["ga4"], goal: null, journey: null, question: null },
  "Is my Meta pixel firing on checkout?": { action: "run", site: null, against: null, platforms: ["meta"], goal: "reach checkout", journey: null, question: null },
  "Make a tracking plan for example.com": { action: "plan", site: "example.com", against: null, platforms: [], goal: null, journey: null, question: null },
  "Check TikTok and Google Ads on the contact form": { action: "run", site: null, against: null, platforms: ["google_ads", "tiktok", "made_up"], goal: "submit the contact form", journey: null, question: null },
  "Did anything break after yesterday's deploy?": { action: "run", site: null, against: "latest", platforms: [], goal: null, journey: null, question: null },
};

test("recorded AI replies map to the same commands, and unknown values are dropped", async () => {
  for (const [sentence, value] of Object.entries(RECORDED)) {
    const provider = { json: async ({ texts, schema }) => (assert.deepEqual(texts, [sentence]), assert.ok(schema.properties.action), { value }) };
    const { intent, by } = await translate(sentence, { provider });
    assert.equal(by, "ai");
    assert.equal(commandFor(intent), EXAMPLES.find(([s]) => s === sentence)[1], sentence);
  }
});

test("without a provider, or on a refusal, the keyword matcher answers", async () => {
  assert.equal((await translate("check my GA tags")).by, "keywords");
  assert.equal((await translate("check my GA tags", { provider: { json: async () => ({ error: "refusal" }) } })).by, "keywords");
});

test("an unclear sentence asks one question", () => {
  assert.match(intentToArgs(matchKeywords("hello there")).question, /plan or .*run/);
  assert.match(intentToArgs(normalize({ action: "nonsense" })).question, /plan/);
});

test("only a single sentence counts as a request", () => {
  assert.ok(isSentence(["check my GA tags"]));
  assert.ok(!isSentence(["run"]));
  assert.ok(!isSentence(["plan", "list"]));
});

test("the CLI shows the command and stops when the answer is no", () => {
  const env = { ...process.env, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "", GOOGLE_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "", OPENAI_COMPATIBLE_BASE_URL: "" };
  const out = execFileSync(process.execPath, ["src/cli.js", "make a tracking plan for example.com"], { encoding: "utf8", input: "n\n", env });
  assert.match(out, /aitd plan --site https:\/\/example\.com/);
  assert.match(out, /Run this\? \(Y\/n\)/);
});

test("a run with nothing to test asks for a goal when the site has no plan", () => {
  const env = { ...process.env, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "", GOOGLE_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "", OPENAI_COMPATIBLE_BASE_URL: "" };
  const dataDir = mkdtempSync(path.join(tmpdir(), "aitd-ask-"));
  const out = execFileSync(process.execPath, ["src/cli.js", "check my GA tags on example.com", "--data-dir", dataDir], { encoding: "utf8", input: "the contact form\nn\n", env });
  assert.match(out, /What should I check/);
  assert.match(out, /aitd run --site https:\/\/example\.com --platforms ga4 --goal "the contact form"/);
});
