import { AuditSession } from "./browser.js";
import { runAgentJourney, StepTimeout } from "./agent.js";

/** The goal of the browsing part: one page of each type, nothing submitted. */
export const DISCOVER_GOAL = `Explore this site to draft its analytics measurement plan. You are not completing a purchase or any other task: visit ONE example of each kind of page that exists here and look at what a visitor can do on it, then call finish with success true.
Visit, where the site has them: the home page, one category or listing page, one product, item or article page, the cart (add one item first if there is an add-to-cart button), the first checkout step, the search results (search for something the site sells), and the sign-up, login, contact or newsletter forms.
Rules: never pay, never submit a form with personal details, never open more than one page of the same kind, and accept the cookie banner when it appears. Stop as soon as every kind of page above has been seen once.`;

const PLAN_SYSTEM = `You are a senior digital analytics consultant writing a GA4 measurement plan for a website that may have no tracking yet. You get the pages an explorer visited (their type, address, visible text and interactive elements) and any tracking hits the site already sent.

Propose the events this site should track:
- Recommended GA4 events where they fit (page_view, view_item_list, view_item, select_item, add_to_cart, view_cart, begin_checkout, purchase, search, sign_up, login, generate_lead, ...), with GA4's recommended parameters.
- Custom events for interactions specific to this site that a business would want to measure (for example a size guide, a store locator, a video, a configurator, a filter, a download). Name them in snake_case and mark them custom.
- For each event: what the visitor does, the page type and element that triggers it (quote the element's visible label), its parameters (standard and custom) with one realistic example value taken from the pages when possible, and which parameters are required.
- Suggested user properties (for example customer_type, logged_in, membership_level), with a description and example.
Only propose what the pages show is possible. Prefer fewer, useful events over many trivial ones.`;

const str = { type: "string" };
const PLAN_SCHEMA = {
  type: "object",
  properties: {
    pages: { type: "array", items: { type: "object", properties: { type: str, url: str }, required: ["type", "url"], additionalProperties: false } },
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: str,
          custom: { type: "boolean" },
          description: str,
          trigger_page: str,
          trigger_element: str,
          parameters: {
            type: "array",
            items: {
              type: "object",
              properties: { name: str, custom: { type: "boolean" }, required: { type: "boolean" }, description: str, example: str },
              required: ["name", "custom", "required", "description", "example"],
              additionalProperties: false,
            },
          },
        },
        required: ["name", "custom", "description", "trigger_page", "trigger_element", "parameters"],
        additionalProperties: false,
      },
    },
    user_properties: {
      type: "array",
      items: { type: "object", properties: { name: str, description: str, example: str }, required: ["name", "description", "example"], additionalProperties: false },
    },
  },
  required: ["pages", "events", "user_properties"],
  additionalProperties: false,
};

const MAX_PAGES = 15;
const cut = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s ?? "");

/** One entry per address the explorer saw, keeping the last (fullest) view of each. */
export function pagesSeen(snapshots) {
  const byUrl = new Map();
  for (const s of snapshots) {
    if (!s?.url || s.url === "about:blank") continue;
    const key = s.url.split("#")[0];
    byUrl.delete(key);
    byUrl.set(key, { url: key, title: s.title, elements: cut(s.elements, 4000), text: cut(s.text, 1500) });
  }
  return [...byUrl.values()].slice(-MAX_PAGES);
}

/** Turns the model's answer into the plan file: the audit's fields plus descriptions, triggers, parameters and user properties. */
export function toPlan(site, answer, hits = []) {
  const seen = new Set(hits.filter((h) => h.platform === "ga4").map((h) => h.name));
  return {
    site,
    consent_mode: true,
    pages: answer.pages ?? [],
    events: (answer.events ?? []).map((ev) => {
      const params = ev.parameters ?? [];
      const required = params.filter((p) => p.required).map((p) => p.name);
      return {
        platform: "ga4",
        name: ev.name,
        ...(ev.custom ? { custom: true } : {}),
        description: ev.description,
        trigger: { page: ev.trigger_page, element: ev.trigger_element },
        ...(required.length ? { required_params: required } : {}),
        parameters: Object.fromEntries(params.map((p) => [p.name, { ...(p.custom ? { custom: true } : {}), description: p.description, example: p.example }])),
        ...(seen.has(ev.name) ? { seen: true } : {}),
      };
    }),
    user_properties: answer.user_properties ?? [],
  };
}

/**
 * Lets the AI explore the site (one page per type), then asks it for a measurement plan.
 * @param {{ site: string, provider: any, maxSteps?: number, headed?: boolean, allowedHosts?: string[], viewport?: string, log?: (msg: string) => void }} opts
 */
export async function discoverPlan(opts) {
  const log = opts.log ?? (() => {});
  const session = new AuditSession({ viewport: opts.viewport ?? "desktop", site: opts.site, allowedHosts: opts.allowedHosts, headless: !opts.headed });
  const snapshots = [];
  let outcome;
  try {
    await session.start();
    const startError = await session.act({ action: "goto", url: opts.site, reason: `Open ${opts.site}` });
    if (startError) throw new Error(`Could not open ${opts.site}: ${startError}`);
    const snapshot = session.snapshot.bind(session);
    session.snapshot = async () => {
      const s = await snapshot();
      snapshots.push(s);
      return s;
    };
    outcome = await runAgentJourney(session, { id: "discover", goal: DISCOVER_GOAL }, { provider: opts.provider, maxSteps: opts.maxSteps ?? 25, log }).catch((err) => {
      if (err instanceof StepTimeout) return { completed: false, note: err.message };
      throw err;
    });
  } finally {
    await session.close();
  }
  const pages = pagesSeen(snapshots);
  if (!pages.length) throw new Error("The explorer saw no pages, so there is nothing to plan from.");
  log(`\nExplored ${pages.length} pages${outcome.completed ? "" : ` (${outcome.note})`}. Drafting the plan…`);
  const existing = [...new Set(session.hits.map((h) => `${h.platform}:${h.name}`))];
  const result = await opts.provider.json({
    system: PLAN_SYSTEM,
    texts: [`Site: ${opts.site}`, `Pages visited:\n${JSON.stringify(pages, null, 1)}`, `Tracking hits the site already sends: ${existing.length ? existing.join(", ") : "none"}`],
    schema: PLAN_SCHEMA,
  });
  if (result.error) throw new Error(`The model did not return a plan (${result.error}).`);
  return { plan: toPlan(opts.site, result.value, session.hits), outcome };
}
