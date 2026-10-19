// The new report's Consent section (src/html/consent.js): a status line per platform, the Consent Mode card and the
// scenarios card, from the demo run (GA4 honours the choice, Meta does not) and from a run that never loaded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { context } from "../src/html/shell.js";
import { render } from "../src/html/consent.js";
import { CSS } from "../src/html/css.js";
import { failedInput, reportInput } from "./helpers/demo-capture.js";

const html = (input) => render(context(input));
const cards = (h) => [...h.matchAll(/<details class="card"([^>]*)>/g)];

test("one status line per platform with severity, counts per choice and a link to the worst finding", () => {
  const h = html(reportInput());
  assert.match(h, /^<section class="sec" id="consent" aria-labelledby="consent-h"><h2 id="consent-h">Consent<\/h2>/);
  const ga4 = h.slice(h.indexOf('id="consent-ga4"'), h.indexOf('id="consent-meta"'));
  assert.match(ga4, /^id="consent-ga4"/);
  assert.match(h, /<li class="card sev-ok cs-row" id="consent-ga4">/);
  assert.match(ga4, /<span class="chip chip-sev ok">.*OK<\/span>/);
  assert.match(ga4, /<span class="chip chip-consent denied">2 · denied<\/span>/);
  assert.match(ga4, /<span class="chip chip-consent granted">2 · granted<\/span>/);
  assert.doesNotMatch(ga4, /Finding/);
  const meta = h.slice(h.indexOf('id="consent-meta"'), h.indexOf('<details class="card" id="consent-mode"'));
  assert.match(h, /<li class="card sev-risk cs-row" id="consent-meta">/);
  assert.match(meta, /<span class="chip chip-sev risk">.*Risk<\/span>/);
  assert.match(meta, /<span class="chip chip-consent none">1 · no signal<\/span>/);
  assert.match(meta, /<a class="cs-go" href="#f-meta-pageview-before_consent">Finding →<\/a>/);
  for (const w of ["No choice", "Accept", "Reject"]) assert.match(ga4, new RegExp(`<span class="cs-k">${w}</span>`));
});

test("every card is collapsed, ids are unique and no heading sits under the h2", () => {
  const h = html(reportInput());
  assert.deepEqual(cards(h).map((c) => c[1]), [' id="consent-mode"', ' id="consent-scenarios"']);
  assert.doesNotMatch(h, /<h[3-6]/);
  assert.doesNotMatch(h, /data:image/);
  assert.equal([...h.matchAll(/ id="([^"]+)"/g)].map((x) => x[1]).length, new Set([...h.matchAll(/ id="([^"]+)"/g)].map((x) => x[1])).size);
});

test("the Consent Mode card: default first, timing per run, the first default and update as consent chips", () => {
  const h = html(reportInput());
  const mode = h.slice(h.indexOf('<details class="card" id="consent-mode"'), h.indexOf('<details class="card" id="consent-scenarios"'));
  assert.match(mode, /<span class="t">Consent Mode<\/span>/);
  assert.match(mode, /<span class="chip chip-sev ok">.*Default first<\/span>/);
  assert.match(mode, /<span class="chip plain mono">.*<b>27–53 ms<\/b><\/span>/);
  assert.match(mode, /<span class="chip chip-sev ok">.*v2<\/span>/);
  assert.match(mode, /<span class="end muted xs">4 runs<\/span>/);
  assert.match(mode, /Default set 53 ms into the first page, before the first Google hit · v2 signals present\./);
  assert.match(mode, /Default set 27 ms into the first page/);
  assert.match(mode, /<b class="cm-l">Default<\/b><span class="cm-w">step 1 · Open Home · \+0\.2 s<\/span>/);
  assert.match(mode, /<b class="cm-l">Update<\/b><span class="cm-w">step 2 · Accept cookies · \+1\.2 s<\/span>/);
  assert.match(mode, /<span class="chip chip-consent denied"><span class="k">ad_storage<\/span>denied<\/span>/);
  assert.match(mode, /<span class="chip chip-consent granted"><span class="k">ad_personalization<\/span>granted<\/span>/);
  // Four runs that sent the same commands share one pair of rows.
  assert.equal((mode.match(/<ol class="cm-list">/g) ?? []).length, 1);
  assert.match(mode, /Sent again on 8 more page loads/);
});

test("runs that sent different commands get their own rows with their run chips", () => {
  const input = reportInput();
  input.runs = structuredClone(input.runs);
  const cmd = input.runs[1].dataLayerLog.find((e) => Array.isArray(e.value) && e.value[1] === "default");
  cmd.value[2].analytics_storage = "granted";
  const mode = html(input);
  assert.equal((mode.match(/<ol class="cm-list">/g) ?? []).length, 2);
  assert.match(mode, /<div class="chips cm-runs">/);
});

test("the scenarios card: tags by choice, a not-supported choice, and the problem cells with the finding link", () => {
  const h = html(reportInput());
  const card = h.slice(h.indexOf('<details class="card" id="consent-scenarios"'));
  assert.match(card, /<span class="t">Scenarios<\/span>/);
  assert.match(card, /<span class="chip chip-consent none">Analytics only · not supported<\/span>/);
  assert.match(card, /<span class="end"><span class="chip chip-sev risk">.*2 problems<\/span><\/span>/);
  assert.match(card, /<div class="tscroll"><table class="tbl cs-tbl"><caption class="sr">Consent scenarios<\/caption>/);
  assert.deepEqual([...card.matchAll(/<th scope="col">([^<]+)<\/th>/g)].map((x) => x[1]), ["Tag", "No choice", "Accept", "Reject"]);
  assert.equal((card.match(/<th(?=[ >])(?![^>]*scope=)/g) ?? []).length, 0);
  // Meta's PageView is sent before the choice and after Reject: both cells are problems and link to the finding.
  const meta = card.slice(card.indexOf("<code>PageView</code>"));
  assert.equal((meta.match(/<td class="cs-bad">/g) ?? []).length, 2);
  assert.match(meta, /<span class="badge sev-risk">.*Sent<\/span><span class="sr"> problem: should not have been sent<\/span><a href="#f-meta-pageview-before_consent">Finding →<\/a>/);
  // GA4 on a cookieless ping: counted, denied, and the reason stays in the cell for screen readers and as a tip.
  assert.match(card, /<b class="num">1<\/b><span title="cookieless"><span class="chip chip-consent denied">denied<\/span><\/span><span class="sr"> cookieless<\/span>/);
  assert.match(card, /<span class="chip chip-consent granted">granted<\/span>/);
});

test("a baseline-accepted finding no longer colours the Meta line or its cell", () => {
  const input = reportInput();
  input.findings = input.findings.map((f) => (f.check === "before_consent" ? { ...f, accepted: true } : f));
  const h = html(input);
  assert.match(h, /<li class="card sev-ok cs-row" id="consent-meta">/);
  assert.doesNotMatch(h.slice(h.indexOf('id="consent-meta"'), h.indexOf('<details class="card" id="consent-mode"')), /Finding/);
});

test("with no finding row for Meta, the metric's after-reject verdict still marks its line Risk, without a link", () => {
  const input = reportInput();
  input.findings = input.findings.filter((f) => !(f.platform === "meta" && f.check === "before_consent"));
  const h = html(input);
  const meta = h.slice(h.indexOf('id="consent-meta"'), h.indexOf('<details class="card" id="consent-mode"'));
  assert.match(h, /<li class="card sev-risk cs-row" id="consent-meta">/);
  assert.doesNotMatch(meta, /Finding/);
  assert.match(h, /<li class="card sev-ok cs-row" id="consent-ga4">/);
});

test("a run that never loaded: no platform lines, no default, scenarios not run, the finding linked", () => {
  const h = html(failedInput());
  assert.doesNotMatch(h, /cs-list/);
  const mode = h.slice(h.indexOf('<details class="card" id="consent-mode"'));
  assert.match(mode, /<span class="chip chip-sev risk">.*No default<\/span>/);
  assert.match(mode, /<span class="end muted xs">0 of 4 runs<\/span>/);
  assert.match(mode, /No Consent Mode default command was seen on any journey\./);
  assert.match(mode, /<a href="#f-site-consent_default_missing">Finding →<\/a>/);
  assert.match(h, /<p class="muted xs cs-none" id="consent-scenarios">Consent scenarios: not run/);
});

test("a report with no runs says consent was not checked", () => {
  const h = html({ ...reportInput(), runs: [], findings: [], consentScenarios: null, metrics: undefined });
  assert.match(h, /Consent was not checked in this run\./);
  assert.match(h, /<span class="chip chip-consent none">not checked<\/span>/);
  assert.match(h, /id="consent-scenarios"/);
});

test("the Turkish section reads as Turkish", () => {
  const h = html(reportInput({ lang: "tr" }));
  assert.match(h, /<h2 id="consent-h">Onay<\/h2>/);
  assert.match(h, /<span class="chip chip-consent denied">2 · reddedildi<\/span>/);
  assert.match(h, /<span class="chip chip-consent granted">2 · verildi<\/span>/);
  assert.match(h, /<span class="chip chip-consent none">1 · sinyal yok<\/span>/);
  assert.match(h, /<span class="cs-k">Seçim yok<\/span>/);
  assert.match(h, /<span class="chip chip-consent none">Yalnızca analitik · desteklenmiyor<\/span>/);
  assert.match(h, /<span class="chip chip-sev risk">.*2 sorun<\/span>/);
  assert.match(h, /<a class="cs-go" href="#f-meta-pageview-before_consent">Bulgu →<\/a>/);
  assert.match(h, /<span class="end muted xs">4 çalıştırma<\/span>/);
  assert.match(h, /gönderilmemeliydi/);
  assert.match(html(failedInput({ lang: "tr" })), /<span class="end muted xs">4 çalıştırmadan 0 tanesi<\/span>/);
});

test("the section's CSS colours only through tokens", () => {
  const css = CSS.slice(CSS.indexOf("/* Consent: platform status lines"), CSS.indexOf("/* Scope (Coverage"));
  assert.ok(css.length > 500);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(css, /rgba?\(/);
});
