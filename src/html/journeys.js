// The Journeys section: the journey picker, the step list and the step pane with Hits, Data Layer and Requests tabs.
// A stub until it is ported: the 0.17 journey panels inside the new section (the consent scenarios move to Consent).
import { sectionBlock } from "./lib.js";
import { journeysPanel } from "./legacy.js";

/** @param {import("./shell.js").Ctx} ctx */
export function render(ctx) {
  const { m, lang, findings, rows, runs, ids, metrics } = ctx;
  // shell.js drives a tablist only inside [data-tabs]; the 0.17 journey tabs get that wrapper here.
  return sectionBlock("journeys", m.html.shell.sections.journeys, `<div class="tabs" data-tabs>${journeysPanel(m, lang, findings, rows, runs, ids, metrics, null)}</div>`);
}
