// Events iframes post to the page with postMessage, and what the page does next: relays the same event, does
// something else right after (the same event under another name), or nothing, which is reported.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AuditSession } from "../src/browser.js";
import { collect } from "../src/agent.js";
import { checkRun } from "../src/checks.js";
import { isEventMessage, messageOutcomes } from "../src/frames.js";
import { messageLines, stepCapture, timelineOf } from "../src/mcp.js";
import { render as renderScope } from "../src/html/scope.js";
import { context } from "../src/html/shell.js";
import { renderMarkdown } from "../src/report.js";

let server;
let url;
let widget;
before(async () => {
  server = createServer((req, res) => {
    const port = server.address().port;
    const html = (body) => res.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html>${body}`);
    // The page relays the form's messages to its dataLayer: one under another name, one as it is. It has no
    // listener for the booking widget.
    if (req.url === "/") {
      return html(`<script>window.dataLayer = window.dataLayer || [];
addEventListener("message", function (e) {
  if (e.data && e.data.type === "form_submitted") dataLayer.push({ event: "generate_lead" });
  if (e.data && e.data.event === "sign_up") dataLayer.push({ event: "sign_up" });
});</script><iframe src="/form.html"></iframe><iframe src="http://localhost:${port}/widget.html"></iframe>`);
    }
    // A form on the site: what the visitor typed rides along, and a resize ping is housekeeping.
    if (req.url === "/form.html") {
      return html(`<script>
parent.postMessage({ type: "resize", height: 300 }, "*");
parent.postMessage({ type: "form_submitted", email: "visitor@example.com" }, "*");
parent.postMessage({ event: "sign_up" }, "*");
</script>`);
    }
    // A booking widget from another site tells the page, as a JSON string, twice.
    if (req.url === "/widget.html") {
      return html(`<script>
parent.postMessage(JSON.stringify({ event: "booking_complete", value: 120 }), "*");
parent.postMessage(JSON.stringify({ event: "booking_complete", value: 120 }), "*");
</script>`);
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}/`;
  widget = `http://localhost:${server.address().port}`;
});
after(() => server.close());

test("events iframes post to the page are matched with what the page did next", async () => {
  const session = new AuditSession({ viewport: "desktop", site: url, providers: ["ga4"], quietMs: 0 });
  await session.start();
  let run;
  let stepText;
  try {
    await session.act({ action: "goto", url });
    await session.act({ action: "wait", value: "4000" });
    run = { ...collect(session, { id: "browse" }, "desktop"), completed: true };
    stepText = stepCapture({ session }, run.frameMessages[0].step);
  } finally {
    await session.close();
  }
  const site = url.replace(/\/$/, "");
  // Only names and field names are kept, never values. The time and the address are left out of the search: a
  // timestamp or a port that happens to hold "120" is not the height the iframe posted.
  assert.doesNotMatch(JSON.stringify(run.frameMessages.map(({ t: _t, origin: _origin, ...kept }) => kept)), /visitor@example\.com|120/);
  assert.deepEqual(run.frameMessages.find((m) => m.name === "form_submitted").keys, ["type", "email"]);
  assert.deepEqual(run.frameMessages.map((m) => `${m.name} ${m.party}`).sort(), ["booking_complete third", "booking_complete third", "form_submitted site", "resize site", "sign_up site"]);

  const outcomes = messageOutcomes(run).map((x) => `${x.name} ${x.origin} ${x.outcome}${x.relay ? ` ${x.relay.kind} ${x.relay.name}` : ""}`);
  assert.deepEqual(outcomes.sort(), [
    `booking_complete ${widget} nothing`,
    `form_submitted ${site} followed push generate_lead`,
    `sign_up ${site} relayed push sign_up`,
  ]);

  const findings = checkRun({ events: [] }, run).filter((f) => f.check === "iframe_message_unhandled");
  assert.equal(findings.length, 1, "once per iframe and event");
  assert.equal(findings[0].detail, `An embedded widget from ${widget} posted "booking_complete" to the page, but the page pushed nothing to its dataLayer and sent no hit in the 3 seconds after, nor "booking_complete" later. If it is a conversion, the page isn't relaying it to its tags.`);

  const html = renderScope(context({ title: "t", generatedAt: "now", findings, explained: null, runs: [run] }));
  assert.match(html, /id="inv-messages"><summary><span class="t">Messages from iframes<\/span>/);
  assert.match(html, /<code>form_submitted<\/code>.*pushed generate_lead \d+ ms later \(another name\)/);
  const md = renderMarkdown({ title: "t", generatedAt: "now", findings, explained: null, runs: [run] });
  assert.match(md, /## Messages from iframes\n\n\| Message \| From \| What the page did \|/);
  assert.match(md, new RegExp(`\\| booking_complete \\| ${widget.replace(/[.:/]/g, "\\$&")} \\(Third party\\) \\| nothing: no dataLayer push or hit followed \\|`));
  assert.match(renderMarkdown({ title: "t", generatedAt: "now", findings, explained: null, runs: [run], lang: "tr" }), /## iframe'lerden gelen mesajlar/);
  assert.match(messageLines([run]).join("\n"), /sign_up from .* \(same site\), step \d+: pushed sign_up \d+ ms later/);
  assert.ok(timelineOf(run).some((s) => s.iframe_messages?.some((x) => x.name === "booking_complete" && x.outcome === "nothing")));
  assert.match(stepText, /Messages iframes posted to the page \(name and field names only\):\n {2}resize from .* \(same site\), fields type, height; housekeeping, not checked/);
});

test("what reads as an event, and what is housekeeping", () => {
  const is = (name, nameKey = "type") => isEventMessage({ name, nameKey });
  assert.equal(is("whatever", "event"), true, "dataLayer-shaped");
  for (const name of ["form_submitted", "bookingComplete", "purchase", "lead", "download_brochure", "add-to-cart"]) assert.equal(is(name), true, name);
  for (const name of ["resize", "iFrameResizer0:300", "ready", "heartbeat", "setHeight", "scroll", "load"]) assert.equal(is(name), false, name);
  assert.equal(is("theme_changed"), false, "a name that reads as nothing tracked");
});

test("each reaction of the page answers one message, whatever order the iframes load in", () => {
  const msg = (t, origin, name, nameKey = "type") => ({ t, origin, party: origin.includes("widget") ? "third" : "site", name, nameKey, keys: [nameKey], step: 1 });
  const push = (t, event) => ({ t, step: 1, value: { event } });
  const outcomes = (run) => messageOutcomes(run).map((x) => `${x.name} ${x.outcome}${x.relay ? ` ${x.relay.name}` : ""}`).sort();
  const form = [msg(200, "https://shop.example", "form_submitted"), push(201, "generate_lead"), msg(300, "https://shop.example", "sign_up", "event"), push(301, "sign_up")];
  const widget = msg(100, "https://widget.example", "booking_complete", "event");
  const expected = ["booking_complete nothing", "form_submitted followed generate_lead", "sign_up relayed sign_up"];
  // The order the CI runner saw: the widget's message first, then the form's messages and the page's relays of them.
  // The page relaying the form's sign_up within 3 seconds must not make the widget's booking look handled.
  const ciOrder = { frameMessages: [widget, form[0], form[2]], dataLayerLog: [form[1], form[3]] };
  assert.deepEqual(outcomes(ciOrder), expected);
  // And the other way round: the widget's message after everything the page did.
  const later = { ...widget, t: 400 };
  assert.deepEqual(outcomes({ frameMessages: [form[0], form[2], later], dataLayerLog: [form[1], form[3]] }), expected);
  // A message, the page's push answering it and the next message often share a millisecond: the recording order decides.
  const tie = (seq, x) => ({ ...x, t: 500, seq });
  const sameMs = { frameMessages: [tie(1, form[0]), tie(3, form[2])], dataLayerLog: [tie(2, form[1]), tie(4, form[3])] };
  assert.deepEqual(outcomes(sameMs), ["form_submitted followed generate_lead", "sign_up relayed sign_up"]);
  // A hit right after a relayed push is a second effect of the same message, not an answer to an earlier one.
  const hitAfter = { frameMessages: [widget, form[2]], dataLayerLog: [form[3]], hits: [{ platform: "ga4", name: "sign_up_hit", t: 350 }] };
  assert.deepEqual(outcomes(hitAfter), ["booking_complete nothing", "sign_up relayed sign_up"]);
});
