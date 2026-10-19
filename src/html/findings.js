// The Findings section: the filter bar and the Failed, Unverified and Passed rows. A stub until it is ported: the 0.17
// findings panel inside the new section.
import { n, sectionBlock } from "./lib.js";
import { findingsPanel } from "./legacy.js";

/** @param {import("./shell.js").Ctx} ctx */
export function render(ctx) {
  const { m, runs, plan, rows, ids, counts } = ctx;
  return sectionBlock("findings", `${m.html.shell.sections.findings} ${n(ctx.tally.failed)}`, findingsPanel(m, runs, plan, rows, ids, counts));
}
