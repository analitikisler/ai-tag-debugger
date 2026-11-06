// The full report for one recording, rendered by the same renderHtml the CLI writes report.html with. Extension
// pages may not run inline scripts, and the report has one, so it is shown in a sandboxed frame (sandbox.html) that
// gets the finished page and nothing else: no extension APIs, no access to the recordings.
import { messages } from "../core/i18n.js";
import { buildRun, labelsFor } from "../lib/run.js";
import { reportHtml } from "../lib/analyze.js";
import { getEvents, getRecording } from "../lib/store.js";

const params = new URLSearchParams(location.search);
const lang = ["en", "tr"].includes(params.get("lang")) ? params.get("lang") : "en";
const m = messages(lang).extension;
const status = document.getElementById("status");
const frame = document.getElementById("frame");
document.documentElement.lang = lang;
status.textContent = m.reportLoading;

const recording = await getRecording(params.get("rec") ?? "");
if (!recording) {
  status.textContent = m.reportMissing;
} else {
  const run = buildRun(await getEvents(recording.id), { site: recording.site, startedAt: recording.startedAt, labels: labelsFor(lang) });
  const html = reportHtml(run, { plan: recording.plan?.plan ?? null, lang, site: recording.site, generatedAt: new Date(recording.stoppedAt ?? Date.now()) });
  document.title = `${recording.host} · AITD Recorder`;
  const show = () => {
    frame.contentWindow.postMessage({ type: "aitd-report", html }, "*");
    status.hidden = true;
    frame.hidden = false;
  };
  frame.addEventListener("load", show, { once: true });
  frame.src = "sandbox.html";
}
