import { test } from "node:test";
import assert from "node:assert/strict";
import { annotateFindings, containerTags, tagsForEvent } from "../src/gtm.js";
import { groupFindings } from "../src/checks.js";
import { renderMarkdown } from "../src/report.js";

const container = {
  containerVersion: {
    tag: [
      { tagId: "1", name: "GA4 - add_to_cart", type: "gaawe", parameter: [{ type: "TEMPLATE", key: "eventName", value: "add_to_cart" }], firingTriggerId: ["10"], blockingTriggerId: ["11"], consentSettings: { consentStatus: "NEEDED", consentType: { type: "LIST", list: [{ type: "TEMPLATE", value: "analytics_storage" }] } } },
      { tagId: "2", name: "GA4 - ecommerce", type: "gaawe", parameter: [{ type: "TEMPLATE", key: "eventName", value: "{{Event}}" }], firingTriggerId: ["12"] },
      { tagId: "3", name: "Meta Purchase", type: "html", paused: true, parameter: [{ type: "TEMPLATE", key: "html", value: "<script>fbq('track', 'Purchase', {value: 1});</script>" }], firingTriggerId: ["12"] },
      { tagId: "4", name: "GA4 config", type: "googtag", parameter: [{ type: "TEMPLATE", key: "tagId", value: "G-X" }], firingTriggerId: ["2147479553"] },
    ],
    trigger: [
      { triggerId: "10", name: "CE - add_to_cart", type: "CUSTOM_EVENT", customEventFilter: [{ type: "EQUALS", parameter: [{ type: "TEMPLATE", key: "arg0", value: "{{_event}}" }, { type: "TEMPLATE", key: "arg1", value: "add_to_cart" }] }] },
      { triggerId: "11", name: "Internal traffic", type: "PAGEVIEW" },
      { triggerId: "12", name: "CE - purchase", type: "CUSTOM_EVENT", customEventFilter: [{ type: "EQUALS", parameter: [{ type: "TEMPLATE", key: "arg0", value: "{{_event}}" }, { type: "TEMPLATE", key: "arg1", value: "purchase" }] }] },
    ],
  },
};

test("reads tags, their platform, events, triggers and consent", () => {
  const tags = containerTags(container);
  const [a, b, c, d] = tags;
  assert.deepEqual([a.platform, a.events, a.consent], ["ga4", ["add_to_cart"], ["analytics_storage"]]);
  assert.deepEqual(a.triggers, [{ id: "10", name: "CE - add_to_cart", type: "CUSTOM_EVENT", event: "add_to_cart" }]);
  assert.equal(a.blocking[0].name, "Internal traffic");
  assert.deepEqual(b.events, ["purchase"], "an {{Event}} name follows the trigger");
  assert.deepEqual([c.platform, c.events, c.paused], ["meta", ["Purchase"], true]);
  assert.deepEqual([d.events, d.triggers[0].name], [["page_view"], "All Pages"]);
  assert.deepEqual(tagsForEvent(tags, "ga4", "purchase").map((t) => t.name), ["GA4 - ecommerce"]);
  assert.deepEqual(tagsForEvent(tags, "meta", "Purchase").map((t) => t.name), ["Meta Purchase"]);
});

test("names the tag behind a broken hit, or says no tag sends it", () => {
  const base = { journey: "j", viewport: "desktop" };
  const findings = annotateFindings([
    { ...base, severity: "broken", check: "missing_params", platform: "ga4", event: "add_to_cart", detail: "x" },
    { ...base, severity: "broken", check: "missing_event", platform: "ga4", event: "begin_checkout", detail: "y" },
    { ...base, severity: "risk", check: "consent_default_missing", detail: "z" },
  ], container);
  assert.equal(findings[0].gtm[0].name, "GA4 - add_to_cart");
  assert.deepEqual(findings[1].gtm, []);
  assert.equal(findings[2].gtm, undefined);
  const grouped = groupFindings(findings);
  assert.ok(grouped.find((f) => f.event === "add_to_cart").gtm);
  const md = renderMarkdown({ title: "t", generatedAt: "now", findings, explained: null, runs: [] });
  assert.match(md, /In your GTM container: GA4 - add_to_cart, Fires on CE - add_to_cart/);
  assert.match(md, /No tag in the container export sends this event/);
});

test("leaves findings alone without a container", () => {
  const f = [{ severity: "broken", platform: "ga4", event: "x" }];
  assert.equal(annotateFindings(f, null)[0].gtm, undefined);
});
