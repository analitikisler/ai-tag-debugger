// The Consent section: one status line per platform, the Consent Mode card and the scenarios card. A stub until it is
// ported: the 0.17 scenarios table and each run's Consent Mode card inside the new section.
import { esc, sectionBlock } from "./lib.js";
import { consentCard, scenariosCard } from "./legacy.js";

/** @param {import("./shell.js").Ctx} ctx */
export function render(ctx) {
  const { m, runs, rows, ids, metrics, consentScenarios } = ctx;
  const perRun = runs.map((run, ri) => `<h3>${esc(`${run.journeyId} · ${run.viewport}`)}</h3>${consentCard(m, run, metrics.consent.consentMode.runs[ri])}`).join("\n");
  return sectionBlock("consent", m.html.shell.sections.consent, `${scenariosCard(m, consentScenarios, rows, ids)}\n${perRun}`);
}
