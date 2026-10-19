// The Summary section: the scorecard, the status chips and the "about this run" cards. A stub until it is ported: the
// 0.17 verdict block and overview inside the new section, so the page renders and the accepted line stays.
import { sectionBlock } from "./lib.js";
import { overviewPanel, verdictBlock } from "./legacy.js";

/** @param {import("./shell.js").Ctx} ctx */
export function render(ctx) {
  const { m, site, title, generatedAt, findings, runs, lang, metrics, explained, counts, accepted, changes, ai, plan, against, planChanges, consentScenarios, rows, ids, trend } = ctx;
  const runInfo = { ai, plan, lang, against, planChanges, consentScenarios };
  // The page's one h1 is the shell's; the 0.17 block's site heading becomes a paragraph here.
  const verdict = verdictBlock(m, { site, title, generatedAt, findings, runs, lang, metrics, explained, counts, accepted, runInfo, changes }).replace(/<h1 id="site">(.*?)<\/h1>/, '<p id="site"><strong>$1</strong></p>');
  return sectionBlock("summary", m.html.shell.sections.summary, `${verdict}\n${overviewPanel(m, runs, rows, ids, metrics, trend, changes)}`);
}
