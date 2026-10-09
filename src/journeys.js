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
};

const ALIASES = { checkout: "purchase", order: "purchase", cart: "add_to_cart", signup: "sign_up", register: "sign_up", registration: "sign_up", contact: "lead", form: "lead" };

/** The preset for a name like "purchase" or "signup", or null. */
export function presetFor(name) {
  const id = ALIASES[name?.toLowerCase()] ?? name?.toLowerCase();
  return JOURNEY_PRESETS[id] ? { id, ...JOURNEY_PRESETS[id] } : null;
}

/**
 * Adds a journey's preset events to a plan (a copy): events the plan already
 * has are expected on this journey too; missing ones are added for this journey.
 */
export function withPresetEvents(plan, journeyId, preset) {
  const events = plan.events.map((e) => ({ ...e }));
  for (const pe of preset.events) {
    const existing = events.find((e) => e.platform === pe.platform && e.name === pe.name);
    if (!existing) events.push({ ...pe, journeys: [journeyId] });
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
export function planRun({ config = {}, plan, picks = [], goals = [], events = [] }) {
  // Copied, because the loops below add journeys to events.
  let runPlan = { ...(plan ?? { events: [] }), events: (plan?.events ?? []).map((e) => ({ ...e })) };
  const configJourneys = config.journeys ?? [];
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
    runPlan = withPresetEvents(runPlan, preset.id, preset);
  }

  goals.forEach((goal, i) => {
    const id = goals.length > 1 ? `custom-${i + 1}` : "custom";
    journeys.push({ id, goal });
    runPlan = expectEvents(runPlan, id, events);
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
