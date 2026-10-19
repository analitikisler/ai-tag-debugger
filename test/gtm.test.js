import { test } from "node:test";
import assert from "node:assert/strict";
import { annotateFindings, containerTags, evaluateTrigger, explainTags, tagsForEvent } from "../src/gtm.js";
import { groupFindings } from "../src/checks.js";
import { renderHtml, renderMarkdown } from "../src/report.js";

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

// A purchase tag whose trigger needs a positive ecommerce value, with a paused, a blocked, a consent-gated and a click-driven tag beside it.
const tmpl = (key, value) => ({ type: "TEMPLATE", key, value });
const cond = (type, arg0, arg1, extra = []) => ({ type, parameter: [tmpl("arg0", arg0), tmpl("arg1", arg1), ...extra] });
const purchaseTrigger = { triggerId: "20", name: "CE - purchase", type: "CUSTOM_EVENT", customEventFilter: [cond("_eq", "{{_event}}", "purchase")], filter: [cond("GREATER", "{{DL - ecommerce value}}", "0")] };
const evalContainer = {
  containerVersion: {
    tag: [
      { tagId: "1", name: "GA4 - purchase", type: "gaawe", parameter: [tmpl("eventName", "purchase")], firingTriggerId: ["20"] },
      { tagId: "2", name: "Meta Purchase", type: "html", paused: true, parameter: [tmpl("html", "<script>fbq('track', 'Purchase');</script>")], firingTriggerId: ["20"] },
      { tagId: "3", name: "TikTok purchase", type: "html", parameter: [tmpl("html", "<script>ttq.track('CompletePayment');</script>")], firingTriggerId: ["20"], blockingTriggerId: ["21"] },
      { tagId: "4", name: "Ads - purchase", type: "awct", parameter: [tmpl("eventName", "purchase")], firingTriggerId: ["20"], consentSettings: { consentStatus: "NEEDED", consentType: { type: "LIST", list: [tmpl("", "ad_storage")] } } },
      { tagId: "5", name: "GA4 - add_to_cart", type: "gaawe", parameter: [tmpl("eventName", "add_to_cart")], firingTriggerId: ["22"] },
      { tagId: "6", name: "GA4 - checkout", type: "gaawe", parameter: [tmpl("eventName", "begin_checkout")], firingTriggerId: ["23"] },
    ],
    trigger: [
      purchaseTrigger,
      { triggerId: "21", name: "Test orders", type: "CUSTOM_EVENT", customEventFilter: [cond("_eq", "{{_event}}", "purchase")], filter: [cond("CONTAINS", "{{DL - transaction id}}", "TEST")] },
      { triggerId: "22", name: "Click - add to cart", type: "CLICK", filter: [cond("CSS_SELECTOR", "{{Click Element}}", ".add")] },
      { triggerId: "23", name: "CE - checkout on /checkout", type: "CUSTOM_EVENT", customEventFilter: [cond("_eq", "{{_event}}", "begin_checkout")], filter: [cond("STARTS_WITH", "{{Page Path}}", "/checkout")] },
    ],
    variable: [
      { variableId: "1", name: "DL - ecommerce value", type: "v", parameter: [{ type: "INTEGER", key: "dataLayerVersion", value: "2" }, tmpl("name", "ecommerce.value")] },
      { variableId: "2", name: "DL - transaction id", type: "v", parameter: [{ type: "INTEGER", key: "dataLayerVersion", value: "2" }, tmpl("name", "ecommerce.transaction_id")] },
    ],
  },
};
const variables = evalContainer.containerVersion.variable;
const push = (value, url = "https://shop.example/checkout/done") => ({ value, url, step: 1, t: 1 });

test("evaluates a custom event trigger against the pushes: missing event, failed condition, fired", () => {
  const none = evaluateTrigger(purchaseTrigger, [push({ event: "add_to_cart" })], variables);
  assert.deepEqual([none.fired, none.reason], [false, 'no dataLayer push with event "purchase" in this journey']);
  const zero = evaluateTrigger(purchaseTrigger, [push({ event: "purchase", ecommerce: { value: 0 } })], variables);
  assert.deepEqual([zero.fired, zero.reason], [false, 'trigger "CE - purchase" needs ecommerce.value greater than 0, the push had 0']);
  const ok = evaluateTrigger(purchaseTrigger, [push({ event: "view_item" }), push({ event: "purchase", ecommerce: { value: 50 } })], variables);
  assert.deepEqual([ok.fired, ok.matched], [true, 1]);
  assert.match(ok.reason, /fired on the "purchase" push/);
  const missing = evaluateTrigger(purchaseTrigger, [push({ event: "purchase" })], variables);
  assert.match(missing.reason, /the push had no value/);
});

test("the data layer is cumulative: a value from an earlier push counts, and null clears it", () => {
  const later = evaluateTrigger(purchaseTrigger, [push({ ecommerce: { value: 50, currency: "EUR" } }), push({ event: "purchase" })], variables);
  assert.equal(later.fired, true);
  const cleared = evaluateTrigger(purchaseTrigger, [push({ ecommerce: { value: 50 } }), push({ ecommerce: null }), push({ event: "purchase" })], variables);
  assert.deepEqual([cleared.fired, cleared.reason], [false, 'trigger "CE - purchase" needs ecommerce.value greater than 0, the push had no value']);
  const gtag = evaluateTrigger({ name: "t", type: "CUSTOM_EVENT", customEventFilter: [cond("EQUALS", "{{_event}}", "purchase")], filter: [cond("GREATER", "{{DL - value}}", "0")] }, [push(["event", "purchase", { value: 9 }])], [{ name: "DL - value", type: "v", parameter: [tmpl("name", "eventModel.value")] }]);
  assert.equal(gtag.fired, true, "a gtag() call is an event with its parameters in eventModel");
});

test("page triggers fire on GTM's own events, click triggers are unknown, and page variables come from the push address", () => {
  const pages = evaluateTrigger({ name: "All Pages", type: "PAGEVIEW" }, [push({ event: "gtm.js" })], variables);
  assert.equal(pages.fired, true);
  const noGtm = evaluateTrigger({ name: "All Pages", type: "PAGEVIEW" }, [push({ event: "purchase" })], variables);
  assert.deepEqual([noGtm.fired, /gtm\.js/.test(noGtm.reason)], [false, true]);
  const click = evaluateTrigger(evalContainer.containerVersion.trigger[2], [push({ event: "purchase" })], variables);
  assert.deepEqual([click.fired, click.reason], ["unknown", 'click triggers such as "Click - add to cart" are evaluated by GTM in the page, not from the dataLayer']);
  const clicked = evaluateTrigger(evalContainer.containerVersion.trigger[2], [push({ event: "gtm.click" })], variables);
  assert.deepEqual([clicked.fired, clicked.reason], ["unknown", 'trigger "Click - add to cart" has a CSS_SELECTOR condition, which can\'t be evaluated from the dataLayer']);
  const clickText = evaluateTrigger({ name: "c", type: "CLICK", filter: [cond("EQUALS", "{{Click Text}}", "Buy")] }, [push({ event: "gtm.click" })], variables);
  assert.equal(clickText.reason, 'trigger "c" checks "Click Text", which can\'t be read from the dataLayer');
  const path = evaluateTrigger(evalContainer.containerVersion.trigger[3], [push({ event: "begin_checkout" }, "https://shop.example/cart")], variables);
  assert.deepEqual([path.fired, path.reason], [false, 'trigger "CE - checkout on /checkout" needs Page Path starting with "/checkout", the push had "/cart"']);
  assert.equal(evaluateTrigger(evalContainer.containerVersion.trigger[3], [push({ event: "begin_checkout" })], variables).fired, true);
  const negated = evaluateTrigger({ name: "n", type: "CUSTOM_EVENT", customEventFilter: [cond("_eq", "{{_event}}", "purchase")], filter: [cond("EQUALS", "{{Page Hostname}}", "SHOP.example", [{ type: "BOOLEAN", key: "negate", value: "true" }, { type: "BOOLEAN", key: "ignore_case", value: "true" }])] }, [push({ event: "purchase" })], variables);
  assert.match(negated.reason, /needs Page Hostname not equal to "SHOP.example", the push had "shop.example"/);
  assert.equal(evaluateTrigger({ name: "g", type: "TRIGGER_GROUP" }, [], variables).fired, "unknown");
});

test("explains each tag: paused, blocked, consent denied, trigger failed, or fired with the tag itself to blame", () => {
  const base = { journey: "buy", viewport: "desktop", severity: "broken", check: "missing_event" };
  const finding = (platform, event) => ({ ...base, platform, event, detail: "x" });
  const run = (dataLayerLog) => ({ journeyId: "buy", viewport: "desktop", dataLayerLog });
  const why = (f, r) => Object.fromEntries(explainTags(annotateFindings([f], evalContainer)[0], r, evalContainer).gtm.map((t) => [t.name, t.evaluation]));
  const denied = push(["consent", "default", { ad_storage: "denied", analytics_storage: "granted" }]);
  const purchase = push({ event: "purchase", ecommerce: { value: 50, transaction_id: "TEST-1" } });
  const runs = [run([denied, purchase])];
  const findings = annotateFindings([finding("ga4", "purchase"), finding("meta", "Purchase"), finding("tiktok", "CompletePayment"), finding("google_ads", "purchase"), finding("ga4", "add_to_cart")], evalContainer, runs);
  const by = Object.fromEntries(findings.flatMap((f) => f.gtm.map((t) => [t.name, t.evaluation])));
  assert.deepEqual(by["GA4 - purchase"], { fired: true, why: "the trigger fired and consent was granted; the tag itself or its configuration (measurement id, event name) may be wrong" });
  assert.deepEqual(by["Meta Purchase"], { fired: false, why: "the tag is paused" });
  assert.deepEqual(by["TikTok purchase"], { fired: false, why: 'blocked by exception trigger "Test orders"' });
  assert.deepEqual(by["Ads - purchase"], { fired: false, why: "needs ad_storage, which was denied when the event fired" });
  assert.equal(by["GA4 - add_to_cart"].fired, "unknown");
  // Consent granted later than the push does not help; granted before it does.
  const granted = push(["consent", "update", { ad_storage: "granted" }]);
  assert.equal(why(finding("google_ads", "purchase"), run([denied, purchase, granted]))["Ads - purchase"].fired, false);
  assert.equal(why(finding("google_ads", "purchase"), run([denied, granted, purchase]))["Ads - purchase"].fired, true);
  assert.equal(why(finding("ga4", "purchase"), run([push({ event: "purchase", ecommerce: { value: 0 } })]))["GA4 - purchase"].why, 'trigger "CE - purchase" needs ecommerce.value greater than 0, the push had 0');
  assert.equal(why(finding("ga4", "purchase"), run([]))["GA4 - purchase"].why, 'no dataLayer push with event "purchase" in this journey');
  // The old two-argument call and a finding from another run stay without an evaluation.
  assert.equal(annotateFindings([finding("ga4", "purchase")], evalContainer)[0].gtm[0].evaluation, undefined);
  assert.equal(annotateFindings([{ ...finding("ga4", "purchase"), viewport: "mobile" }], evalContainer, runs)[0].gtm[0].evaluation, undefined);
  // The reasons follow the report language.
  const tr = annotateFindings([finding("meta", "Purchase")], evalContainer, runs, { lang: "tr" });
  assert.equal(tr[0].gtm[0].evaluation.why, "etiket duraklatılmış");
  const md = renderMarkdown({ title: "t", generatedAt: "now", findings, explained: null, runs: [] });
  assert.match(md, /- Tag "GA4 - purchase": should have fired — the trigger fired and consent was granted/);
  assert.match(md, /- Tag "Meta Purchase": did not fire — the tag is paused/);
  const html = renderHtml({ title: "t", generatedAt: "now", findings, explained: null, runs: [] });
  assert.match(html, /class="xs gtm-why">Tag &quot;TikTok purchase&quot;: did not fire — blocked by exception trigger &quot;Test orders&quot;/);
});
