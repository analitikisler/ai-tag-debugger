// The shape of the config file and the measurement plan, checked as soon as they are read. A typo
// such as "viewport" or a step action "clik" then fails at once with the field named, instead of
// deep in a run or by silently doing nothing. Unknown keys are allowed (they only get a warning),
// so an existing config with an extra harmless key still runs.
import { z } from "zod";
import { VIEWPORTS } from "./browser.js";
import { LANGUAGES } from "./i18n.js";
import { PROVIDERS as PLATFORMS } from "./parsers.js";
import { PROVIDERS as AI_PROVIDERS } from "./providers.js";

const text = z.string();
const flag = z.boolean();
const names = z.array(z.string());

export const STEP_ACTIONS = ["goto", "click", "fill", "select", "scroll", "wait"];

export const STEP_SCHEMA = z.looseObject({
  action: z.enum(STEP_ACTIONS),
  selector: text.optional(),
  ref: z.int().optional(),
  text: text.optional(),
  value: z.union([text, z.number()], { error: "must be a text or a number" }).optional(),
  url: text.optional(),
  reason: text.optional(),
  accepts_consent: flag.optional(),
  rejects_consent: flag.optional(),
  optional: flag.optional(),
});

export const JOURNEY_SCHEMA = z.looseObject({
  id: text.min(1),
  goal: text.optional(),
  start: text.optional(),
  steps: z.array(STEP_SCHEMA).optional(),
  incomplete: text.optional(),
});

export const PLAN_EVENT_SCHEMA = z.looseObject({
  platform: z.enum(Object.keys(PLATFORMS)),
  name: text.min(1),
  aliases: names.optional(),
  required_params: names.optional(),
  journeys: names.optional(),
  allow_multiple: flag.optional(),
  custom: flag.optional(),
  description: text.nullish(),
  trigger: z.looseObject({ page: text.nullish(), element: text.nullish() }).optional(),
  parameters: z.record(text, z.looseObject({ custom: flag.optional(), description: text.nullish(), example: z.unknown().optional() })).optional(),
  seen: flag.optional(),
});

export const PLAN_SCHEMA = z.looseObject({
  site: text.optional(),
  consent_mode: flag.optional(),
  learned: flag.optional(),
  pages: z.array(z.unknown()).optional(),
  events: z.array(PLAN_EVENT_SCHEMA),
  user_properties: z.array(z.union([text, z.looseObject({ name: text.min(1), description: text.nullish(), example: z.unknown().optional() })], { error: 'must be a name or { "name", "description", "example" }' })).optional(),
});

export const CONFIG_SCHEMA = z.looseObject({
  site: text.optional(),
  plan: z.union([text, z.looseObject({})], { error: "must be a file path or a plan object" }).optional(),
  gtm_container: text.optional(),
  viewports: z.array(z.enum(Object.keys(VIEWPORTS))).optional(),
  journeys: z.array(JOURNEY_SCHEMA).optional(),
  allowed_hosts: names.optional(),
  providers: z.union([names, text], { error: 'must be a list of platforms, e.g. ["ga4", "meta"]' }).optional(),
  detect_providers: flag.optional(),
  campaign_checks: flag.optional(),
  block_hits: flag.optional(),
  consent_scenarios: flag.optional(),
  keep_bodies: flag.optional(),
  branding: flag.optional(),
  // The range itself is checked by parseConcurrency, which gives the exact message for the CLI flag too.
  concurrency: z.union([z.number(), text], { error: "must be a whole number from 1 to 8" }).optional(),
  baseline: text.optional(),
  language: z.enum(Object.keys(LANGUAGES)).optional(),
  report: z.looseObject({ name: text.nullish(), logo: text.nullish(), color: text.nullish(), pdf: flag.optional() }).optional(),
  provider: z.enum(Object.keys(AI_PROVIDERS)).optional(),
  model: text.optional(),
  base_url: text.optional(),
  notify: z.looseObject({
    slack: z.union([flag, text], { error: "must be a webhook URL, or true to read SLACK_WEBHOOK_URL" }).optional(),
    email: z.union([text, names], { error: "must be an address or a list of addresses" }).optional(),
  }).optional(),
});

/** Checks a config object. Returns { value, warnings }; throws when a field is wrong. */
export function validateConfig(config, { file } = {}) {
  return validate(CONFIG_SCHEMA, config, { what: "config", file });
}

/**
 * Checks a measurement plan. Returns { value, warnings }; throws when a field is wrong.
 * at: the path the plan sits at inside a bigger file, e.g. "plan" for a plan written inline in the config.
 */
export function validatePlan(plan, { file, at } = {}) {
  return validate(PLAN_SCHEMA, plan, { what: "plan", file, at });
}

function validate(schema, input, { what, file, at }) {
  const where = file ? ` in ${file}` : "";
  const result = schema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  ${pathOf(at, issue.path) || what}: ${describe(issue, input)}`);
    throw new Error(`Invalid ${what}${where}:\n${lines.join("\n")}`);
  }
  const unknown = [];
  unknownKeys(schema, input, [], unknown);
  const warnings = unknown.map(({ path, suggestion }) => `Unknown key ${quote(pathOf(at, path))}${where} is ignored.${suggestion ? ` Did you mean ${quote(suggestion)}?` : ""}`);
  return { value: result.data, warnings };
}

const quote = (s) => `"${s}"`;

/** "journeys[1].steps[0].action" for the path ["journeys", 1, "steps", 0, "action"]. */
const pathOf = (at, path) => path.reduce((s, key) => (typeof key === "number" ? `${s}[${key}]` : s ? `${s}.${key}` : key), at ?? "");

const valueAt = (input, path) => path.reduce((v, key) => v?.[key], input);

const MAX_SHOWN = 60;
const show = (value) => {
  const json = JSON.stringify(value) ?? String(value);
  return json.length > MAX_SHOWN ? `${json.slice(0, MAX_SHOWN)}…` : json;
};

const KINDS = { array: "a list", object: "an object", string: "a text", boolean: "true or false", number: "a number", int: "a whole number" };

function describe(issue, input) {
  const value = valueAt(input, issue.path);
  if (value === undefined) return "is required";
  const got = `(got ${show(value)})`;
  switch (issue.code) {
    case "invalid_value":
      return `must be one of ${issue.values.join(", ")} ${got}`;
    case "invalid_type":
      return `must be ${KINDS[issue.expected] ?? issue.expected} ${got}`;
    case "too_small":
      return issue.origin === "string" ? "must not be empty" : `${issue.message} ${got}`;
    default:
      // Unions and custom checks carry their own plain-language message.
      return `${issue.message} ${got}`;
  }
}

// Walks the value next to the schema and lists the keys no schema object knows about. Unions and
// records are not entered: their keys are free-form, or (an inline plan) checked on their own.
function unknownKeys(schema, value, path, out) {
  const s = unwrap(schema);
  if (s.def.type === "array" && Array.isArray(value)) value.forEach((item, i) => unknownKeys(s.def.element, item, [...path, i], out));
  if (s.def.type !== "object" || !value || typeof value !== "object" || Array.isArray(value)) return;
  const known = Object.keys(s.shape);
  for (const key of Object.keys(value)) {
    if (known.includes(key)) unknownKeys(s.shape[key], value[key], [...path, key], out);
    else out.push({ path: [...path, key], suggestion: closest(key, known) });
  }
}

function unwrap(schema) {
  let s = schema;
  while (["optional", "nullable"].includes(s.def.type)) s = s.def.innerType;
  return s;
}

const MAX_DISTANCE = 2;

/** The known key within two edits of the unknown one (a typo or a missing letter), or null. */
export function closest(key, known) {
  let best = null;
  for (const candidate of known) {
    const d = editDistance(key.toLowerCase(), candidate.toLowerCase());
    if (d <= MAX_DISTANCE && (best === null || d < best.d)) best = { d, candidate };
  }
  return best?.candidate ?? null;
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > MAX_DISTANCE) return MAX_DISTANCE + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}
