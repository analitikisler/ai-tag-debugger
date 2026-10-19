import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { alertMessage, sendAlerts, sendSmtp } from "../src/notify.js";

const changes = {
  run: "2026-10-16T10-00-00",
  previous: "2026-10-15T10-00-00",
  mode: "findings",
  fixed: [{ check: "consent", platform: "ga4", event: "page_view", severity: "broken", detail: "Sent before consent" }],
  new: [{ check: "params", platform: "meta", event: "Purchase", severity: "broken", detail: "No value" }],
};

test("alertMessage puts the site and headline in the subject", () => {
  const { subject, body } = alertMessage({ site: "shop.example", changes, reportPath: "/r/report.html" });
  assert.equal(subject, "shop.example: 1 problem fixed, 1 new problem");
  assert.match(body, /^shop\.example\n1 problem fixed, 1 new problem\./);
  // A fixed item says what it was; a new one carries its severity and owner.
  assert.match(body, /- Fixed: GA4 page_view \(was: Sent before consent\)\n- New: Meta Purchase · Broken · No value · Tag Manager/);
  assert.match(body, /\/r\/report\.html$/);
  assert.doesNotMatch(body, /Verdict:|Trend over/);
});

const verdict = { status: "fail", statusText: "Fail", headline: "purchase tracking is broken on mobile", score: 25 };
const point = (id, broken, complete = true) => ({ id, date: null, broken, risk: 1, warning: 0, score: broken * 3 + 2, complete });
const trend = {
  runs: 5, first: "2026-10-01_0900", last: "2026-10-05_0900", direction: "worsening",
  series: [point("2026-10-01_0900", 0), point("2026-10-02_0900", 0), point("2026-10-03_0900", 0, false), point("2026-10-04_0900", 1), point("2026-10-05_0900", 2)],
  openLongest: [{ check: "before_consent", severity: "risk", platform: "meta", event: "PageView", openSince: "2026-10-01_0900", runsOpen: 5, places: [{ journey: "browse", viewport: "desktop" }, { journey: "checkout", viewport: "mobile" }] }],
  fixedRecently: [], newRecently: [],
  flapping: [{ check: "duplicate", severity: "warning", platform: "ga4", event: "add_to_cart", seenIn: 3, runsOpen: 1, places: [{ journey: "browse", viewport: "desktop" }] }],
};

test("the alert carries the verdict in the subject and body, then the trend with its sparkline, flapping and round-number lines", () => {
  const { subject, body } = alertMessage({ site: "shop.example", changes, reportPath: "/r/report.html", verdict, trend });
  assert.equal(subject, "shop.example: Fail · 1 problem fixed, 1 new problem · purchase tracking is broken on mobile");
  const lines = body.split("\n");
  assert.equal(lines[0], "shop.example");
  assert.equal(lines[1], "Verdict: Fail · purchase tracking is broken on mobile · score 25/100");
  assert.match(lines[2], /^1 problem fixed, 1 new problem\./);
  assert.equal(lines[5], "Trend over 5 runs (2026-10-01 → 2026-10-05): worsening. Now 2 broken · 1 risk · 0 warning; 3 runs ago 0 broken · 1 risk · 0 warning. `▃▃·▅█`");
  assert.equal(lines[6], "Flapping (seen, gone, back again): GA4 add_to_cart duplicate in 3 of 5 runs.");
  assert.equal(lines[7], "Still open after 5 runs: Meta PageView before_consent in 2 places.");
  assert.equal(lines.at(-1), "/r/report.html");
  // The open-longest line is not in every alert: only at 5, 10, 20 runs and every ten after that.
  const six = alertMessage({ site: "s", changes, verdict, trend: { ...trend, runs: 6, openLongest: [{ ...trend.openLongest[0], runsOpen: 6 }] } }).body;
  assert.doesNotMatch(six, /Still open/);
  assert.match(alertMessage({ site: "s", changes, verdict, trend: { ...trend, runs: 30, openLongest: [{ ...trend.openLongest[0], runsOpen: 30 }] } }).body, /Still open after 30 runs/);
  // One saved run has no trend yet, and the Turkish alert follows the report language.
  assert.doesNotMatch(alertMessage({ site: "s", changes, verdict, trend: { ...trend, runs: 1, series: trend.series.slice(0, 1) } }).body, /Trend|█/);
  const tr = alertMessage({ site: "s", changes, lang: "tr", verdict: { ...verdict, statusText: "Başarısız" }, trend });
  assert.match(tr.subject, /^s: Başarısız · 1 sorun düzeldi, 1 yeni sorun · purchase tracking/);
  assert.match(tr.body, /Sonuç: Başarısız · [^\n]* · puan 25\/100\n/);
  assert.match(tr.body, /5 çalıştırmada eğilim[^\n]*`▃▃·▅█`\nGelip giden/);
});

test("the plan-mode diff lines name the bucket instead of a severity and keep the owner out", () => {
  const plan = { run: "r2", previous: "r1", mode: "plan", fixed: [{ platform: "ga4", event: "purchase", bucket: "implemented", was: "missing" }], new: [{ platform: "meta", event: "Lead", bucket: "missing_params", was: null }] };
  const { body } = alertMessage({ site: "s", changes: plan });
  assert.match(body, /- Fixed: GA4 purchase \(was: Missing\)\n- New: Meta Lead · Missing params$/m);
});

test("sendAlerts posts to Slack only when something changed", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => (calls.push({ url, body: JSON.parse(init.body) }), { ok: true });
  const none = await sendAlerts({ notify: { slack: "https://hooks.example/x" }, site: "s", changes: { ...changes, fixed: [], new: [] }, fetchImpl });
  assert.deepEqual(none.sent, []);
  const first = await sendAlerts({ notify: { slack: "https://hooks.example/x" }, site: "s", changes: { previous: null }, fetchImpl });
  assert.deepEqual(first.sent, []);
  const res = await sendAlerts({ notify: { slack: true }, site: "s", changes, fetchImpl, env: { SLACK_WEBHOOK_URL: "https://hooks.example/env" } });
  assert.deepEqual(res, { sent: ["slack"], errors: [] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://hooks.example/env");
  assert.match(calls[0].body.text, /New: Meta Purchase · Broken/);
  // The verdict and the trend go through to the channel when the run has them.
  await sendAlerts({ notify: { slack: "https://hooks.example/x" }, site: "s", changes, verdict, trend, fetchImpl });
  assert.match(calls[1].body.text, /^s\nVerdict: Fail · purchase tracking is broken on mobile · score 25\/100\n[\s\S]*`▃▃·▅█`/);
});

test("sendAlerts reports failures instead of throwing", async () => {
  const res = await sendAlerts({
    notify: { slack: "https://hooks.example/x", email: "a@example.com" },
    site: "s",
    changes,
    env: {},
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
  assert.deepEqual(res.sent, []);
  assert.deepEqual(res.errors, ["Slack: HTTP 404", "Email: SMTP_URL is not set"]);
});

test("sendSmtp speaks SMTP with AUTH LOGIN", async () => {
  const got = [];
  const server = createServer((sock) => {
    let inData = false;
    let buf = "";
    sock.write("220 hi\r\n");
    sock.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        got.push(line);
        if (inData) {
          if (line === ".") (inData = false), sock.write("250 queued\r\n");
          continue;
        }
        if (line.startsWith("EHLO")) sock.write("250-hi\r\n250 AUTH LOGIN\r\n");
        else if (line === "AUTH LOGIN") sock.write("334 VXNlcm5hbWU6\r\n");
        else if (line === "DATA") (inData = true), sock.write("354 go\r\n");
        else if (line === "QUIT") sock.end("221 bye\r\n");
        else if (got.at(-2) === "AUTH LOGIN") sock.write("334 UGFzc3dvcmQ6\r\n");
        else sock.write(line.startsWith("MAIL") || line.startsWith("RCPT") ? "250 ok\r\n" : "235 ok\r\n");
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  await sendSmtp(`smtp://u%40x:p@127.0.0.1:${port}`, { from: "f@x", to: ["a@x"], subject: "Hi", text: "Body" });
  server.close();
  assert.ok(got.includes(Buffer.from("u@x").toString("base64")));
  assert.ok(got.includes("RCPT TO:<a@x>"));
  assert.ok(got.includes(Buffer.from("Body").toString("base64")));
});
