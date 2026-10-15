// Explores the demo shop with a fake provider, to test plan --site end to end without an API key.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { discoverPlan, pageTypeCoverage, pagesSeen, toPlan } from "../src/discover.js";

const PORT = 4411;
let server;
before(async () => {
  server = spawn(process.execPath, ["examples/serve.js"], { env: { ...process.env, PORT: String(PORT) }, stdio: "pipe" });
  await new Promise((resolve) => server.stdout.once("data", resolve));
});
after(() => server.kill());

const answer = {
  pages: [{ type: "home", url: `http://localhost:${PORT}/` }],
  events: [
    { name: "view_item", custom: false, description: "Visitor views a product", trigger_page: "product", trigger_element: "page load", parameters: [{ name: "currency", custom: false, required: true, description: "ISO currency", example: "USD" }, { name: "item_color", custom: true, required: false, description: "Chosen colour", example: "red" }] },
    { name: "size_guide_open", custom: true, description: "Opens the size guide", trigger_page: "product", trigger_element: 'button "Size guide"', parameters: [] },
  ],
  user_properties: [{ name: "customer_type", description: "new or returning", example: "returning" }],
};

function fakeProvider(steps) {
  const seen = { firstMessage: null, texts: null };
  let i = 0;
  return {
    seen,
    conversation({ firstMessage }) {
      seen.firstMessage = firstMessage;
      return {
        next: async () => ({ toolCalls: [{ id: `c${i}`, ...steps[i++] }], stop: "tool_use" }),
        addToolResults() {},
        addUserText() {},
      };
    },
    async json({ texts }) {
      seen.texts = texts;
      return { value: answer };
    },
  };
}

test("plan --site explores pages, then turns the model's answer into a plan the audit can read", async () => {
  const provider = fakeProvider([
    { name: "browser_action", input: { action: "goto", url: `http://localhost:${PORT}/product.html`, reason: "Open a product" } },
    { name: "finish", input: { success: true, note: "Seen every page type." } },
  ]);
  const { plan, outcome } = await discoverPlan({ site: `http://localhost:${PORT}/`, provider, maxSteps: 5 });
  assert.equal(outcome.completed, true);
  assert.match(provider.seen.firstMessage, /ONE example of each kind of page/);
  const pages = JSON.parse(provider.seen.texts[1].replace(/^Pages visited:\n/, ""));
  assert.ok(pages.some((p) => p.url.endsWith("/product.html")), "the product page is sent to the model");
  assert.match(provider.seen.texts[2], /ga4:page_view/, "the demo shop's own hits are listed");
  assert.deepEqual(plan.events[0], {
    platform: "ga4", name: "view_item", description: "Visitor views a product", trigger: { page: "product", element: "page load" }, required_params: ["currency"],
    parameters: { currency: { description: "ISO currency", example: "USD" }, item_color: { custom: true, description: "Chosen colour", example: "red" } }, seen: true,
  });
  assert.equal(plan.events[1].custom, true);
  assert.deepEqual(plan.user_properties, answer.user_properties);
});

test("toPlan marks events the site already sends", () => {
  const plan = toPlan("https://x.test", { pages: [], events: [{ ...answer.events[0], parameters: [] }], user_properties: [] }, [{ platform: "ga4", name: "view_item" }]);
  assert.equal(plan.events[0].seen, true);
  assert.equal(plan.events[0].required_params, undefined);
});

test("pagesSeen keeps one entry per address, without fragments", () => {
  const pages = pagesSeen([{ url: "https://x.test/a#top", title: "A1" }, { url: "about:blank" }, { url: "https://x.test/a", title: "A2" }]);
  assert.deepEqual(pages.map((p) => [p.url, p.title]), [["https://x.test/a", "A2"]]);
});

test("pageTypeCoverage lists found and absent page types, so a two-page site is not a failure", () => {
  const { found, absent } = pageTypeCoverage([{ type: "Home page", url: "/" }, { type: "product", url: "/r" }]);
  assert.deepEqual(found, ["home", "detail"]);
  assert.ok(absent.includes("cart") && absent.includes("checkout") && !absent.includes("home"));
});
