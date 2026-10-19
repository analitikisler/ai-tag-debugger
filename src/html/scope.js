// The Coverage, Inventory and Run sections (three sections, one module). A stub until it is ported: the 0.17 Scope
// cards split over the three sections. Their cards' own ids (coverage, inventory, run) would repeat the sections' ids,
// so they get a -card suffix here.
import { sectionBlock } from "./lib.js";
import { conversionsCard, coverageCard, inventoryCard, planVsSiteCard, providersCard, runCard, timingCard } from "./legacy.js";

const card = (html, id) => html.replace(`id="${id}"`, `id="${id}-card"`);

/** @param {import("./shell.js").Ctx} ctx */
export function render(ctx) {
  const { m, runs, plan, metrics, planCheck, ai, lang, against, planChanges } = ctx;
  const s = m.html.shell.sections;
  return [
    sectionBlock("coverage", s.coverage, `${planCheck ? planVsSiteCard(m, planCheck) : ""}${card(coverageCard(m, plan, runs, metrics), "coverage")}${conversionsCard(m, metrics)}`),
    sectionBlock("inventory", s.inventory, `${card(inventoryCard(m, runs), "inventory")}${providersCard(m, runs)}`),
    sectionBlock("run", s.run, `${timingCard(m, metrics)}${card(runCard(m, runs, { ai, plan, lang, against, planChanges }), "run")}`),
  ].join("\n");
}
