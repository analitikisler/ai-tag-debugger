// Alerts after a saved run: the "since last run" diff, sent to Slack and/or by email.
// Set in the config:
//   "notify": { "slack": "https://hooks.slack.com/services/…", "email": "team@example.com" }
// "slack": true reads the webhook from SLACK_WEBHOOK_URL. Email goes through the SMTP server in
// SMTP_URL (smtps://user:pass@host:465 or smtp://host:25), from SMTP_FROM (default: the "to" address).
// Nothing is sent when there is no earlier run or nothing changed.
import { connect as tlsConnect } from "node:tls";
import { connect as netConnect } from "node:net";
import { changesText, hasChanges } from "./changes.js";
import { messages } from "./i18n.js";

const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/** The alert's subject and plain-text body. */
export function alertMessage({ site, changes, lang = "en", reportPath = null }) {
  const subject = `${site}: ${messages(lang).ui.changesLine(changes)}`;
  const body = [`${site}`, changesText(changes, lang), ...(reportPath ? ["", reportPath] : [])].join("\n");
  return { subject, body };
}

/**
 * Sends the diff to every channel in `notify`. Never throws: returns { sent: [...], errors: [...] }.
 * @param {{ notify: any, site: string, changes: any, lang?: string, reportPath?: string,
 *   env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, smtp?: (url: string, mail: any) => Promise<void> }} opts
 */
export async function sendAlerts({ notify, site, changes, lang = "en", reportPath = null, env = process.env, fetchImpl = fetch, smtp = sendSmtp }) {
  const sent = [];
  const errors = [];
  if (!notify || !hasChanges(changes)) return { sent, errors };
  const { subject, body } = alertMessage({ site, changes, lang, reportPath });
  const slack = notify.slack === true ? env.SLACK_WEBHOOK_URL : notify.slack;
  if (slack) {
    try {
      const res = await fetchImpl(slack, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: body }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      sent.push("slack");
    } catch (err) {
      errors.push(`Slack: ${err.message}`);
    }
  } else if (notify.slack === true) errors.push("Slack: SLACK_WEBHOOK_URL is not set");
  const to = list(notify.email);
  if (to.length) {
    try {
      if (!env.SMTP_URL) throw new Error("SMTP_URL is not set");
      await smtp(env.SMTP_URL, { from: env.SMTP_FROM || to[0], to, subject, text: body });
      sent.push("email");
    } catch (err) {
      errors.push(`Email: ${err.message}`);
    }
  }
  return { sent, errors };
}

/** A minimal SMTP client: smtps:// (TLS from the start) or smtp:// (plain), AUTH LOGIN when the URL has a user. */
export function sendSmtp(url, { from, to, subject, text }) {
  const u = new URL(url);
  const secure = u.protocol === "smtps:";
  const port = Number(u.port || (secure ? 465 : 25));
  const socket = secure ? tlsConnect({ host: u.hostname, port, servername: u.hostname }) : netConnect({ host: u.hostname, port });
  const b64 = (s) => Buffer.from(s).toString("base64");
  const clean = (s) => String(s).replace(/[\r\n]+/g, " ");
  const data = [
    `From: ${clean(from)}`,
    `To: ${to.map(clean).join(", ")}`,
    `Subject: =?UTF-8?B?${b64(clean(subject))}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(text).replace(/.{76}/g, "$&\r\n"),
    ".",
  ].join("\r\n");
  const steps = [
    null, // greeting
    `EHLO ${clean(u.hostname)}`,
    ...(u.username ? ["AUTH LOGIN", b64(decodeURIComponent(u.username)), b64(decodeURIComponent(u.password))] : []),
    `MAIL FROM:<${clean(from)}>`,
    ...to.map((t) => `RCPT TO:<${clean(t)}>`),
    "DATA",
    data,
    "QUIT",
  ];
  return new Promise((resolve, reject) => {
    let buf = "";
    let i = 0;
    socket.setTimeout(20000, () => socket.destroy(new Error("SMTP timed out")));
    socket.on("error", reject);
    socket.on("data", (chunk) => {
      buf += chunk;
      // A reply is complete at a line "NNN text" (a dash after the code means more lines follow).
      const lines = buf.split("\r\n");
      const last = lines.findLastIndex((l) => /^\d{3} /.test(l));
      if (last < 0) return;
      const reply = lines[last];
      buf = lines.slice(last + 1).join("\r\n");
      if (!/^[23]/.test(reply)) return socket.destroy(new Error(`SMTP said: ${reply}`));
      i += 1;
      if (i < steps.length) socket.write(`${steps[i]}\r\n`);
      else {
        socket.end();
        resolve();
      }
    });
  });
}
