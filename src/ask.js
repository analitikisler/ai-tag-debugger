// Turns a plain sentence like "check my GA tags" into an aitd command.
// The AI provider fills a fixed intent schema, so it can never invent options;
// without an AI key a small keyword matcher handles the common phrases.
import { PROVIDERS as PLATFORMS } from "./parsers.js";

const PLATFORM_KEYS = Object.keys(PLATFORMS);
// The same values as plan --topic (TOPICS in discover.js, kept in step by a test).
export const TOPIC_KEYS = ["custom-events", "ecommerce", "forms", "consent"];

export const INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action", "site", "against", "platforms", "goal", "journey", "topic", "question"],
  properties: {
    action: { type: "string", enum: ["plan", "run", "report", "unclear"], description: "plan drafts what a site should track; run audits what the site sends; report re-reads an existing report; unclear when you cannot tell plan from run." },
    site: { type: ["string", "null"], description: "The site's domain or URL if the sentence names one." },
    against: { type: ["string", "null"], enum: ["plan", "latest", null], description: "run only: compare with the saved plan, or with the latest run (\"what changed\", \"since the last run\", \"after the deploy\")." },
    platforms: { type: "array", items: { type: "string", enum: PLATFORM_KEYS }, description: "Only the tracking platforms the sentence names; empty for all." },
    goal: { type: ["string", "null"], description: "run only: a short user journey to try, in plain words, e.g. \"submit the contact form\"." },
    journey: { type: ["string", "null"], enum: ["purchase", null], description: "run only: purchase when the sentence is about the purchase event or revenue." },
    topic: { type: ["string", "null"], enum: [...TOPIC_KEYS, null], description: "plan only: limit the plan to one kind of event when the sentence asks about it." },
    question: { type: ["string", "null"], description: "One short question to ask back when the sentence is ambiguous; otherwise null." },
  },
};

const SYSTEM = `You translate a request about website tracking (analytics, ads, consent tags) into options for the aitd command line tool. Fill the schema with only what the sentence says; leave the rest null or empty. Use action "unclear" and a short question when you cannot tell whether the user wants a tracking plan or an audit of the live site.`;

const has = (s, re) => re.test(s);

/** The intent for a sentence from keywords alone, for when no AI key is set. */
export function matchKeywords(sentence) {
  const s = ` ${sentence.toLowerCase()} `;
  const intent = { action: null, site: null, against: null, platforms: [], goal: null, journey: null, topic: null, question: null };
  const site = sentence.match(/\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/\S*)?/i);
  if (site) intent.site = site[1].toLowerCase();

  if (has(s, /google analytics|\bga4?\b/)) intent.platforms.push("ga4");
  if (has(s, /google ads|adwords/)) intent.platforms.push("google_ads");
  if (has(s, /\bmeta\b|facebook/)) intent.platforms.push("meta");
  if (has(s, /tiktok/)) intent.platforms.push("tiktok");

  if (has(s, /only the (errors|failures)|from the (last|latest) report/)) intent.action = "report";
  else if (has(s, /tracking plan|make a plan|should .* track|does my site need|events .* need/)) intent.action = "plan";
  else {
    if (has(s, /since (the )?last run|what changed|\bbreak|\bbroke|deploy/)) intent.against = "latest";
    else if (has(s, /(against|in) the plan/)) intent.against = "plan";
    if (has(s, /revenue|purchase event/)) intent.journey = "purchase";
    else if (has(s, /newsletter/)) intent.goal = "sign up for the newsletter";
    else if (has(s, /accept(ing)? (the )?cookies|consent/)) intent.goal = "browse without accepting cookies";
    else if (has(s, /contact form/)) intent.goal = "submit the contact form";
    else if (has(s, /checkout/)) intent.goal = "reach checkout";
    if (intent.platforms.length || intent.against || intent.goal || intent.journey || has(s, /\b(check|test|audit|firing|fire|working)\b/)) intent.action = "run";
  }
  if (intent.action === "plan") {
    if (has(s, /custom events?/)) intent.topic = "custom-events";
    else if (has(s, /ecommerce|e-commerce|online shop|\bshop\b|\bstore\b/)) intent.topic = "ecommerce";
    else if (has(s, /\bforms?\b/)) intent.topic = "forms";
    else if (has(s, /consent|cookies?/)) intent.topic = "consent";
  }
  if (!intent.action) {
    intent.action = "unclear";
    intent.question = "Do you want a tracking plan or a check of what the site sends? (plan/run)";
  }
  return intent;
}

/** Asks the provider for the intent of a sentence; falls back to keywords without one. */
export async function translate(sentence, { provider } = {}) {
  if (!provider) return { intent: matchKeywords(sentence), by: "keywords" };
  const result = await provider.json({ system: SYSTEM, texts: [sentence], schema: INTENT_SCHEMA });
  if (result.error) return { intent: matchKeywords(sentence), by: "keywords" };
  return { intent: normalize(result.value), by: "ai" };
}

/** Keeps only schema values, so an odd reply can never become an option. */
export function normalize(v = {}) {
  const str = (x) => (typeof x === "string" && x.trim() ? x.trim() : null);
  return {
    action: ["plan", "run", "report", "unclear"].includes(v.action) ? v.action : "unclear",
    site: str(v.site),
    against: ["plan", "latest"].includes(v.against) ? v.against : null,
    platforms: [...new Set((Array.isArray(v.platforms) ? v.platforms : []).filter((p) => PLATFORM_KEYS.includes(p)))],
    goal: str(v.goal),
    journey: v.journey === "purchase" ? "purchase" : null,
    topic: TOPIC_KEYS.includes(v.topic) ? v.topic : null,
    question: str(v.question),
  };
}

const siteUrl = (site) => (/^https?:\/\//i.test(site) ? site : `https://${site}`);

/** The aitd arguments for an intent, or { question } when one more answer is needed. */
export function intentToArgs(intent) {
  if (intent.action === "unclear") return { question: intent.question ?? "Do you want a tracking plan or a check of what the site sends? (plan/run)" };
  if (intent.action === "report") return { unsupported: "Filtering an existing report is not available yet. Open the latest report in aitd/<domain>/runs/." };
  const args = [intent.action];
  if (intent.site) args.push("--site", siteUrl(intent.site));
  if (intent.action === "plan" && intent.topic) args.push("--topic", intent.topic);
  if (intent.action === "run") {
    // --against takes a saved plan. Every run already reports what changed since the previous
    // run, so "since the last run" needs no option of its own.
    if (intent.against === "plan") args.push("--against", "latest");
    if (intent.platforms.length) args.push("--platforms", intent.platforms.join(","));
    if (intent.journey) args.push("--journey", intent.journey);
    if (intent.goal) args.push("--goal", intent.goal);
  }
  return { args };
}

/** True when a run has nothing to test yet: no plan to check against, no journey, no goal. */
export function needsWhatToTest(args) {
  return args[0] === "run" && !["--against", "--journey", "--goal"].some((o) => args.includes(o));
}

/** The command as the user would type it. */
export function commandText(args) {
  return ["aitd", ...args.map((a) => (/^[\w.,:/@=-]+$/.test(a) ? a : `"${a.replace(/(["\\$`])/g, "\\$1")}"`))].join(" ");
}

/** True when the arguments are one sentence rather than a command. */
export function isSentence(positionals) {
  return positionals.length === 1 && /\s/.test(positionals[0].trim());
}
