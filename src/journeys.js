// Ready-made journeys: a goal for the AI in plain language, plus the events
// (GA4 recommended events and Meta standard events) a correct setup sends on the way.
// They let you audit a site without writing a config or a measurement plan.

const ecommerce = ["currency", "value", "items"];

export const JOURNEY_PRESETS = {
  purchase: {
    goal: "Accept cookies, open any product, add it to the cart, go to checkout and place the order with the test or demo payment option until a confirmation page shows. Never enter real payment details.",
    events: [
      { platform: "ga4", name: "view_item", required_params: ecommerce },
      { platform: "ga4", name: "add_to_cart", required_params: ecommerce },
      { platform: "ga4", name: "begin_checkout", required_params: ecommerce },
      { platform: "ga4", name: "purchase", required_params: ["transaction_id", ...ecommerce] },
      { platform: "meta", name: "AddToCart" },
      { platform: "meta", name: "InitiateCheckout" },
      { platform: "meta", name: "Purchase", required_params: ["value", "currency"] },
    ],
  },
  add_to_cart: {
    goal: "Accept cookies, open any product and add it to the cart. Stop once the cart shows the product.",
    events: [
      { platform: "ga4", name: "view_item", required_params: ecommerce },
      { platform: "ga4", name: "add_to_cart", required_params: ecommerce },
      { platform: "meta", name: "AddToCart" },
    ],
  },
  sign_up: {
    goal: "Accept cookies, find the sign-up or registration form, and create an account with the test data. Stop when the site confirms the account or asks to verify the email.",
    events: [
      { platform: "ga4", name: "sign_up" },
      { platform: "meta", name: "CompleteRegistration" },
    ],
  },
  lead: {
    goal: "Accept cookies, find a contact, quote or demo request form, fill it in with the test data and submit it. Stop when the site confirms the submission.",
    events: [
      { platform: "ga4", name: "generate_lead" },
      { platform: "meta", name: "Lead" },
    ],
  },
  search: {
    goal: "Accept cookies, use the site search to search for a common product or topic, and open the first result.",
    events: [
      { platform: "ga4", name: "search", required_params: ["search_term"] },
      { platform: "meta", name: "Search" },
    ],
  },
  decline_cookies: {
    goal: "Reject all cookies on the cookie banner (the reject-all or decline button, never accept) and set rejects_consent to true on that click. Then browse the site like a visitor who said no: scroll the home page, open a product or article page, and open a second page. Stop there.",
    events: [],
  },
};

const ALIASES = { checkout: "purchase", order: "purchase", cart: "add_to_cart", signup: "sign_up", decline: "decline_cookies", reject: "decline_cookies", reject_cookies: "decline_cookies", consent: "decline_cookies", register: "sign_up", registration: "sign_up", contact: "lead", form: "lead" };

/** The preset for a name like "purchase" or "signup", or null. */
export function presetFor(name) {
  const id = ALIASES[name?.toLowerCase()] ?? name?.toLowerCase();
  return JOURNEY_PRESETS[id] ? { id, ...JOURNEY_PRESETS[id] } : null;
}

/**
 * Adds a journey's preset events to a plan (a copy): events the plan already
 * has are expected on this journey too; missing ones are added for this journey.
 */
export function withPresetEvents(plan, journeyId, preset, { addMissing = true } = {}) {
  const events = plan.events.map((e) => ({ ...e }));
  for (const pe of preset.events) {
    const existing = events.find((e) => String(e.platform).toLowerCase() === pe.platform && e.name === pe.name);
    if (!existing) {
      if (addMissing) events.push({ ...pe, journeys: [journeyId] });
    }
    else if (existing.journeys && !existing.journeys.includes(journeyId)) existing.journeys = [...existing.journeys, journeyId];
  }
  return { ...plan, events };
}

/**
 * Builds the journeys and plan for a run from the config plus command-line picks.
 * @param {{ config?: any, plan?: any, picks?: string[], goals?: string[], events?: string[] }} opts
 *   picks: journey ids from the config or preset names. goals: journeys described in plain language.
 *   events: only check these event names.
 */
export function planRun({ config = {}, plan, picks = [], goals = [], events = [], against = false }) {
  const configJourneys = config.journeys ?? [];
  // --against alone: the plan says what to walk.
  if (against && !picks.length && !goals.length && !configJourneys.length) {
    const derived = journeysFromPlan(plan);
    return { journeys: derived.journeys, plan: onlyEvents(derived.plan, events) };
  }
  // --against with --journey or --goal: only plan events expected on those flows are checked;
  // the rest are expected nowhere, so they are not checked rather than reported missing.
  const scoped = against && (picks.length || goals.length);
  let runPlan = {
    ...(plan ?? { events: [] }),
    events: (plan?.events ?? []).map((e) => (scoped ? { ...e, journeys: (e.journeys ?? []).filter((j) => picks.includes(j)) } : { ...e })),
  };
  const journeys = [];

  for (const pick of picks) {
    const fromConfig = configJourneys.find((j) => j.id === pick);
    if (fromConfig) {
      journeys.push(fromConfig);
      continue;
    }
    const preset = presetFor(pick);
    if (!preset) {
      const known = [...configJourneys.map((j) => j.id), ...Object.keys(JOURNEY_PRESETS)];
      throw new Error(`Unknown journey "${pick}". Use one of: ${[...new Set(known)].join(", ")}, or describe it with --goal.`);
    }
    if (journeys.some((j) => j.id === preset.id)) continue;
    journeys.push({ id: preset.id, goal: preset.goal });
    runPlan = withPresetEvents(runPlan, preset.id, preset, { addMissing: !scoped });
  }

  goals.forEach((goal, i) => {
    const id = goals.length > 1 ? `custom-${i + 1}` : "custom";
    journeys.push({ id, goal });
    runPlan = expectEvents(runPlan, id, scoped ? [...events, ...eventsNamedIn(goal, runPlan)] : events);
  });

  if (!picks.length && !goals.length) journeys.push(...configJourneys);

  return { journeys, plan: onlyEvents(runPlan, events) };
}

/** Keeps only the picked events in a plan (all of them when none are picked). Names match any platform, ignoring case. */
export function onlyEvents(plan, events = []) {
  if (!events.length) return plan;
  const wanted = new Set(events.map((e) => e.toLowerCase()));
  return { ...plan, events: plan.events.filter((e) => wanted.has(e.name.toLowerCase())) };
}

/**
 * A journey you describe yourself has no known events, so the events you pick are
 * expected on it: as GA4 events, unless the plan already lists them.
 */
export function expectEvents(plan, journeyId, names) {
  const events = plan.events.map((e) => ({ ...e }));
  for (const name of names) {
    const existing = events.filter((e) => e.name.toLowerCase() === name.toLowerCase());
    if (!existing.length) events.push({ platform: "ga4", name, journeys: [journeyId] });
    for (const e of existing) if (e.journeys && !e.journeys.includes(journeyId)) e.journeys = [...e.journeys, journeyId];
  }
  return { ...plan, events };
}

/** With an events filter, keeps findings about those events plus the journey-wide ones (consent setup, incomplete journey). */
export function filterFindings(findings, events = []) {
  if (!events.length) return findings;
  const wanted = new Set(events.map((e) => e.toLowerCase()));
  return findings.filter((f) => (f.event ? wanted.has(f.event.toLowerCase()) : f.check !== "unplanned_events"));
}

const words = (text) => String(text ?? "").toLowerCase().replace(/[_-]+/g, " ");

/** Plan events a plain-language goal mentions, by event name ("add to cart" finds add_to_cart) or "<trigger page> page". */
export function eventsNamedIn(goal, plan) {
  const text = words(goal);
  return plan.events
    .filter((e) => text.includes(words(e.name)) || (e.trigger?.page && text.includes(`${words(e.trigger.page)} page`)))
    .map((e) => e.name);
}

/** Which ready-made journey covers a group of plan events, from the standard GA4 shop and lead events in it. */
const PRESET_BY_EVENT = [
  ["purchase", ["purchase", "add_payment_info", "add_shipping_info", "begin_checkout"]],
  ["add_to_cart", ["add_to_cart", "view_cart"]],
  ["sign_up", ["sign_up"]],
  ["lead", ["generate_lead"]],
  ["search", ["search", "view_search_results"]],
];

export const MAX_PLAN_JOURNEYS = 6;

const slug = (text) => words(text).trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "page";

function goalFor(page, events) {
  const actions = [...new Set(events.map((e) => e.trigger?.element).filter(Boolean))];
  const where = page ? `go to a ${page} page` : "browse the site";
  const doing = actions.length ? ` and use ${actions.map((a) => `"${a}"`).join(", ")}` : "";
  return `Accept cookies, ${where}${doing}. Never enter real payment details.`;
}

/**
 * Journeys for `run --against` used alone: the plan's events grouped by the page they are triggered on
 * (trigger.page), at most six, each with one goal built from the plan's trigger text (standard shop events
 * reuse the ready-made journeys) and the group's events expected on it. Returns the journeys and the plan
 * with each event's "journeys" set.
 */
export function journeysFromPlan(plan, max = MAX_PLAN_JOURNEYS) {
  const groups = new Map();
  for (const e of plan?.events ?? []) {
    const page = e.trigger?.page ? String(e.trigger.page).trim() : "";
    if (!groups.has(page)) groups.set(page, []);
    groups.get(page).push(e);
  }
  // The biggest groups get their own journey; the rest share the last one.
  let list = [...groups].map(([page, evs]) => ({ page, events: evs })).sort((a, b) => b.events.length - a.events.length);
  if (list.length > max) {
    const rest = list.slice(max - 1);
    list = [...list.slice(0, max - 1), { page: rest.map((g) => g.page).filter(Boolean).join(", "), events: rest.flatMap((g) => g.events), merged: rest }];
  }
  const journeys = [];
  const ids = new Map();
  for (const group of list) {
    const names = new Set(group.events.map((e) => e.name));
    const presetId = PRESET_BY_EVENT.find(([, evs]) => evs.some((n) => names.has(n)))?.[0];
    const base = presetId && !journeys.some((j) => j.id === presetId) ? presetId : slug(group.page);
    let id = base;
    for (let n = 2; journeys.some((j) => j.id === id); n++) id = `${base}_${n}`;
    const goal = presetId === id ? JOURNEY_PRESETS[presetId].goal : group.merged ? group.merged.map((g) => goalFor(g.page, g.events)).join(" Then ") : goalFor(group.page, group.events);
    journeys.push({ id, goal, planEvents: group.events.map((e) => e.name) });
    for (const e of group.events) ids.set(e, id);
  }
  return {
    journeys,
    plan: { ...plan, events: (plan?.events ?? []).map((e) => ({ ...e, journeys: [ids.get(e)] })) },
  };
}
