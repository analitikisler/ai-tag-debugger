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
  assert.match(body, /- Fixed: GA4 page_view \(Sent before consent\)\n- New: Meta Purchase \(No value\)/);
  assert.match(body, /\/r\/report\.html$/);
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
  assert.match(calls[0].body.text, /New: Meta Purchase/);
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
