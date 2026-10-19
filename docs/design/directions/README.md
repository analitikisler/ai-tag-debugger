# Report redesign: three directions and a recommendation

The 0.17.0 report is better than 0.16.0 but still scrolls too much. Measured on the demo
shop at 1280 px: the verdict header takes the first 490 px of every tab, and the tabs run to
1,722 px (Overview), 2,006 px (Findings), 4,178 px (Journeys) and 2,854 px (Scope). A failed run
shows eleven near-identical info cards.

Three designers each built one direction as a working single-file mockup from the real demo
data, after a research pass on the tools practitioners use (`../reference-ux.md`). Each mockup
has light and dark modes, a 390 px layout, print rules and a no-JavaScript fallback, and each
rationale measures the nine reader tasks from `../ux-audit.md` against 0.17.0.

| | A: the console | B: the brief | C: the inspector |
|---|---|---|---|
| Thesis | Never scroll more than a screen: compact header, master-detail lists, filters, keyboard | The first screen is the report; details behind four tabs, nothing open until clicked | The mental model of Tag Assistant and Lighthouse: a left rail, step timeline, pass/fail groups |
| Header | 117 px strip: verdict line + count chips that filter | Full brief, no scroll at 1280×800 | 48 px bar with a "Fail · 25/100" chip |
| Tab heights at 1280 px | 1,037 / 975 / 958 / 800 | brief 800; Findings 2,533; Journeys 2,624; Scope 2,203 | Summary 1,028; Findings 1,594; Journeys 1,274; Coverage 1,084 |
| Nine tasks, clicks / px (0.17.0 ≈ 18 / 14,000) | 12 / 0 | 13 / 6,138 | 11 / 3,408 |
| Strongest screen | Findings: list, detail pane with Evidence / Fix / Where sub-tabs, filters, "the push already lacks value and currency" | Overview: verdict, impact, three actions by owner, what works, score factors, trend. Finding prose: So / Why / Fix, what each platform received, the same step on desktop | Journeys: page-grouped step list, one step's hits with a consent chip per hit, Tags fired / not fired |
| Weakest point | Overview is a dense board; needs an inline script (CSP hash) for everything that makes it a console | Findings and Journeys are long again once opened; Journeys still 2,624 px | Looks like DevTools to a marketer; rail layout on print and at 390 px needs a second layout |
| Repetitive findings | One row per cause, bundle of ≥3 info rows with the same reason | One card per cause; GA4 + Meta purchase merged; failed run's eleven become one line | Failed / Unverified / Passed groups, the last two folded with a count |
| Implementation cost | ~1,000 lines of `src/report.js`, CSP change in `src/mcp.js` | Mostly the overview and the finding card; tabs stay | The journey section is the big change; the rest is layout |

Each direction's rationale has the full task table, the information architecture and the
decisions it asks for.

## Direction D: the inspector, simplified

After reviewing A, B and C the owner asked for C's rail made collapsible, a calmer Summary (a big
scorecard, a short reason, status chips, cards about the run), A's filter on C's findings, the
journey pane's Hits / Data Layer / Requests as tabs with page titles instead of URLs, denied in red,
every card collapsed except Summary, less text and more distinct colours. `d-inspector/mockup.html`
is that report, built by a second team (UX spec, visual system, shell, five section builders, a
reviewer) from the same demo data. Measured at 1280 px with the rail open: Summary 684 px, Findings
426 px with rows closed, Journeys 658 px with one step selected; the nine reader tasks take 10 clicks
and no manual scrolling. `d-inspector/rationale.md` maps the eight points to the mockup and lists
what the implementation needs.

## Recommendation: one report, three screens

Take the screen each direction does best and keep the current four tabs, so the renderer
changes section by section rather than all at once:

1. **Overview = B's brief.** The verdict sentence, the owner-attributed "do first" actions, what
   works, the score with its named factors and the trend fit one screen. Nothing renders under
   the tab row until a tab is clicked.
2. **On every other tab the header collapses to A's strip.** One line: verdict word, headline,
   score, count chips that act as filters. That alone removes 370 px from the top of every tab.
3. **Findings = A's master-detail**, with B's card prose inside the detail pane (So / Why / Fix,
   what each platform received, the same step on the other viewport, copy-for-owner). On phones
   the list becomes an accordion.
4. **Journeys = C's inspector.** Step list grouped by page on the left, the selected step's hits on
   the right, a consent chip on every hit, Tags fired / not fired under the hits. One step at a
   time cuts the tab from 4,178 px to about 1,300.
5. **Scope = C's folded groups.** Consent scenarios, coverage, conversions, inventory and run facts
   as Lighthouse-style rows, passed and not-applicable folded with a count.

Three product decisions come first, because the counts shown on every surface depend on them:

- **One card per cause.** B and A both merge the GA4 and Meta purchase findings into one card.
  The demo then reads "3 problems" rather than 4 in the HTML, Markdown, CLI, alerts and
  history. This is a `groupFindings` decision in `src/checks.js`, not a layout one.
- **Actions, not findings, on the first screen.** B's "do first" lines are written as the action
  ("Add value and currency to the purchase push on /thanks.html in the mobile layout"). That needs
  an action string per check in both languages next to the existing consequence and fix.
- **An inline script in the report.** Master-detail, filters, keyboard and the step inspector all
  need it. The report already ships a hashed script for tabs; the no-JavaScript fallback stays
  the stacked document.

Open question for the owner: keep the 0–100 score as a chip with named factors (A, B) or as a
Lighthouse gauge (C)? The research cautions that a gauge reads as more precise than the weights
are; the chip with factors is the safer default.
