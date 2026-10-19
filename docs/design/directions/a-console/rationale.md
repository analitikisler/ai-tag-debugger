# Direction A: the console

`mockup.html` next to this file is a working mockup built from the real 0.17.0 demo run (`capture.json`, `summary.json`: 2 journeys × 2 viewports, 2 broken, 1 risk, 1 warning, 4 ok, 3 consent scenarios, 4 platforms checked, 2 seen). A "Mockup state" button in the top bar swaps in the failed-run capture (every journey stopped at step 1) to show how repetitive findings collapse. Open it at 1280 px and at 390 px, with JavaScript on and off, in light and dark, and print it.

## Thesis

The report is an app-like triage console: the reader never scrolls more than one screen to reach an answer. Three rules do the work.

1. **The header is one line, not a page.** Verdict word, headline sentence, score and the counts as chips in 117 px including the tab bar (0.17.0: 490 px on every tab). Every chip is a filter: "2 Broken" and "2 Developer" open the Findings list pre-filtered.
2. **Every list is master-detail.** Findings: list left, one finding's detail right. Journeys: a strip of steps, one step's detail below. Scope: compact tables with "Show all". The list stays short and the detail is the thing that scrolls, inside a sticky pane, so the page itself does not grow.
3. **Tabs hold sub-tabs.** A finding's detail is Evidence · Fix & verify · Where; a run is Steps · Expected vs observed · Platform parity · Consent commands; a step is Hits · dataLayer · Network; Scope is Plan coverage · Conversions · Vendors · Timing · This run. Nothing that belongs to one object is stacked under it.

Keyboard: arrow keys move through the Findings list and the step strip, and the detail follows; the top tabs are hash links so Back works and any state is a URL (`#f-ga4-purchase-missing_params`, `#j3-s11-h0`).

## Information architecture

```
Header (sticky, 117 px at 1280)
├─ bar: logos · "TRACKING AUDIT · date" · theme · print
├─ verdict strip: [×] Fail: headline sentence · site | Score 25/100 · 2 Broken · 1 Risk · 1 Warning · 4 OK | 2 Developer · 2 Tag Manager (+ "n of m runs completed" only when a run stopped)
└─ tabs: Overview · Findings 4 · Journeys 4 · Scope
Overview (one screen: 1,037 px at 1280 incl. header)
├─ Fix first (3/5 width): owner groups, one row per problem (glyph, sentence, platform+event, spread, "also fine on", points), "Copy as text" per owner
├─ Verified: n of m planned events, a bar per platform, the passed checks as links, → Plan coverage
├─ Consent: default timing and v2 in one sentence; what still fires after Reject all; → Scenarios
└─ Runs and platforms: 4-row table (steps, hits, problems → run) + platform chips (seen / never seen)
Findings (975 px)
├─ filter chips: Owner · Severity · Platform · Journey/Viewport · Clear · "n of m"
├─ master list: Developer › rows · Tag Manager › rows · Marketing · Passed (ok rows, folded)
└─ detail pane (sticky): title, badges (severity, owner, category, platform+event, spread), "Also fine on …", Impact strip, "Open the hit" link
   ├─ Evidence: page/event/params table with "missing" rows · the causing dataLayer push with "already lacks value and currency" · request · consent on the hit
   ├─ Fix & verify: fix text · verify links · owner
   └─ Where: one chip per place (links to the exact hit row) · reproduce recipe (steps 1..n with action and selector)
Journeys (958 px)
├─ run sub-tabs: browse·desktop 2 · browse·mobile 2 · checkout·desktop 2 · checkout·mobile 4 · Consent scenarios 1
└─ run: status line (completed, steps, hits, problems, consent default at +53 ms) and sub-tabs
   ├─ Steps: strip of step tiles (number, label, page, hit icons with severity glyph) → one step's detail
   │   └─ step: page, action/selector, time, counts; sub-tabs Hits (rows with AD/AN consent chips, flagged open) · dataLayer · Network
   ├─ Expected vs observed · Platform parity · Consent commands (first default + first update, repeats summarised)
   └─ Consent scenarios: the table with the reason in every cell
Scope (800 px)
└─ sub-tabs: Plan coverage (flagged rows first, "Show all 11") · Conversions · Vendors · Timing · This run
```

## What moved where versus 0.17.0, and why

| 0.17.0 | Console | Why |
|---|---|---|
| Verdict block, five count tiles, six run facts (490 px) | One verdict line and chips (110 px); run facts to Scope › This run; "runs completed" is a chip | The marketer reads the sentence; the facts were repeated on every tab |
| Overview: What to fix first, What is working, Journeys table, Score card (1,722 px) | A board that fits one screen; the score's deductions become the points on each Fix-first row | The score card listed the same four problems a second time |
| Findings: accordion cards, first open (2,006 px) | List + sticky detail pane, sub-tabs inside the detail | The reader sees the list and one answer at once; nothing below the fold |
| "Also fine on checkout · desktop." at the card's bottom | On the list row and the Overview row: "checkout · desktop sent value 19.9 EUR" | M1's positive answer at zero clicks |
| Where chips → step anchor | Where chips and "Open the hit" → the hit row, opened and highlighted | Pattern 7: evidence links to the exact hit |
| Journeys: scenarios table, Consent Mode card, full steps table with flagged rows open, expected-vs-observed, parity (4,178 px) | Run sub-tabs; one step at a time; the rest as sub-tabs of the run; scenarios as a run-level sub-tab and a line on the Overview | A step view is one screen; the context tables are one click, not 3,000 px, away |
| Consent card: default + update on every page load | One sentence (default at +53 ms, before the first Google hit, v2 present, granted at step 2) plus the first pair; repeats counted | The only interesting pair is the first |
| Scope: five stacked cards (2,854 px) | Five sub-tabs; coverage folds clean rows behind "Show all" | Scope is reference material |
| Step rows without page or action | Page, action and selector on the step; a reproduce recipe on the finding | D2 needed `capture.json` |

Patterns taken from `docs/design/reference-ux.md`: 1 (verdict above the fold), 2 (counters are filters: severity and owner chips in the strip, filter chips on the list), 3 (one row per cause, places inside), 5 (consent state as AD/AN chips on every hit row, "no consent signal" for Meta), 6 (passed folded into counted rows, clean coverage rows folded), 7 (highlight: finding → hit row), 8 (the score names its factors: hover text and the points per row). Pattern 4 ("not fired" as a row with the reason) is used in the failed-run state and in Expected vs observed. Not taken: the vendor-per-tab axis, drill-in on phones (accordion keeps every view a URL).

## Scroll and click budget

Measured with Playwright at 1280 × 800 (`measure.mjs` in the design scratchpad): "clicks" are mouse clicks or keyboard activations, "px" the vertical scroll needed to bring the answer fully into view after the clicks, summed over the task's steps. Tasks are the nine of `docs/design/ux-audit.md`.

| Task | 0.17.0 clicks | 0.17.0 px | Console clicks | Console px | Where the answer sits in the console |
|---|---|---|---|---|---|
| M1 Is purchase revenue correct on mobile, and fine on desktop? | 1 | 201 | 0 | 0 | Overview, first Fix-first row: "checkout · mobile only" + "checkout · desktop sent value 19.9 EUR" |
| M2 What will this cost me? | 1 | 0 | 1 | 0 | Points on the Overview row; Impact strip at the top of the Findings pane |
| M3 What do I send to the developer? | 1 | 0 | 1 | 0 | Overview, "Copy as text" on the Developer group (0.17.0 has no copy affordance) |
| D1 Which push is wrong and on which page? | 4 | 370 | 1 | 0 | Findings pane, Evidence: page row, missing rows, the causing push, "already lacks value and currency" |
| D2 Reproduce the duplicate add_to_cart | 3 | 445 | 3 | 0 | Where sub-tab: places and the 4-step replay recipe (0.17.0 stalls: no selector, no prior steps) |
| D3 Which parameters are missing on view_item? | 3 | 1,400 | 3 | 0 | Step 3 pane: "plan requires currency, value, items" and "required present" on the row |
| T1 Which tag fires Meta PageView before consent? | 2 | 948 | 2 | 0 | Evidence: no push, so hard-coded or trigger; "add gtm_container to name the tag"; consent on the hit: none |
| T2 Is Consent Mode default set early enough? | 1 | 251 | 0 | 0 | Overview Consent panel: default 27–53 ms into the first page, before the first Google hit, all 4 runs |
| T3 What fires after reject? | 1 | 15 | 1 | 0 | Overview Consent line names Meta PageView; the Scenarios sub-tab has the reason per cell |

Page geometry at 1280 (document height with the tab active, 0.17.0 in brackets): header 117 px (490); Overview 1,037 (1,722); Findings 975 (2,006); Journeys 958 (4,178); Scope 800 (2,854). At 390: no horizontal scroll on any tab (`scrollWidth` 390), header 203 px, Overview 2,068, Findings 2,413, Journeys 3,842, Scope 858. The 0.17.0 D1 figure counts the "Raw JSON" toggle the push now hides behind.

## How repetitive findings collapse

Two rules, both deterministic and both already half-present in `groupFindings`:

1. **One cause, one row.** Findings with the same severity, check, platform and event are one row with a `where[]` of places. The row says the spread ("checkout · mobile only", "all 4 runs") and the detail's Where sub-tab lists every place. This is 0.17.0's grouping, kept.
2. **One reason, one bundle.** Info rows that share a check and a reason, three or more of them, fold into a single row that names the count and the reason, with the events as chips inside: the failed run's eleven "X was not seen, but the journey stopped early" cards become "11 planned events were not seen because every run stopped early", and the four `journey_incomplete` and four `consent_default_missing` findings are one row each by rule 1. The failed-run Findings list has 3 rows instead of 13 cards; its Overview is 850 px.

The GA4 and Meta purchase rows stay two rows because the data has two findings; merging them into one card ("purchase reached GA4 and Meta without value and currency") is the brief's principle 5 and a `checks.js` change, not a layout one. The console would show it as one row with two platform chips.

## Mobile and print

Below 900 px the master-detail pairs become accordions: the same `<details>` elements, one open at a time, the detail inline under its row; the step strip stacks vertically; filter chips wrap; the sticky pane is not rendered. The verdict strip keeps the severity chips and drops the owner chips (they are on the Findings filter row). Tables sit in `overflow-x: auto` wrappers and parameter values wrap, so nothing widens the page.

With JavaScript off the page is the accordion layout stacked: all four tabs with their `h2`, all sub-panels with a visible heading, every flagged finding and step open, clean ones closed (4,200 px at 1280, 29 `<details>` open). This is also the print layout: print CSS hides the tab bars, filters and buttons, opens the flagged items and keeps the rest collapsed, drops tints for `1px currentColor` borders, and starts each tab on a new page; a detail that sits in the pane when the reader prints from the browser is printed in place. Printed as `writePdf` does it (A4, JavaScript off), the demo is 8 pages (0.17.0: 21).

## Implementation cost in `src/report.js`

The data layer (`metrics`, `groupFindings`, `hitsByStep`, `pushesForHit`, `callsForHit`) is unchanged; the mockup is generated from the same `capture.json` fields. The HTML renderers change:

| Part | Lines today | Change | Rough size |
|---|---|---|---|
| `verdictBlock`, `runFacts` (1414–1450) | 37 | One strip; chips carry `data-filter`; run facts move to `runCard` | 60 |
| `overviewPanel`, `fixFirst`, `workingCard`, `journeysTable`, `scoreCard` (1452–1557) | 105 | The board: Fix first rows gain points, spread and "also fine on"; Verified with bars; Consent panel (new); Runs + platforms | 150 |
| `findingsPanel`, `findingCard`, `whereChips`, `evidenceHtml` (1260–1381) | 120 | Filter row, `data-*` attributes, sub-tabs in the detail, push + request in Evidence, reproduce recipe, hit-row anchors | 140 |
| `journeysPanel`, `journeyPanel`, `stepRow`, `eventRow` (713–737, 1623–1682) | 90 | Run sub-tabs, step tiles + pane, per-step sub-tabs, consent chips on hit rows, hit `id`s | 160 |
| `consentCard`, `scenariosCard` (1561–1603) | 42 | Sentence + first pair; scenarios as a sub-tab with reason cells | 40 |
| `scopePanel` and its cards (1715–1889) | 175 | Sub-tabs; coverage fold | 40 |
| `CSS` (847–1191) | 345 | Replace; the mockup's stylesheet is 21 KB / ~160 rules | 300 |
| inline script (in `renderHtml`) | ~60 | Master-detail, filters, copy, deep links, print restore; the mockup's is 8.8 KB | 140 |
| `i18n.js` | | ~25 new strings in `en` and `tr` (filter labels, "Copy as text", "Open the hit", bundle sentence, "required present", "no consent signal") | 50 ×2 |
| bundle rule | | `groupFindings` or a `bundleRows` step after it | 30 |
| tests | | `test/report.test.js` and the CI baseline: new ids, the strip, the bundle | 60 |

About 1,000 lines of `report.js` touched, most of it replacement rather than addition; `report.md` and `renderCsv` do not change. The hash ids `f-…` and `jN-sM` are kept so links in old tickets still resolve.

## Risks

- **The script becomes load-bearing.** Master-detail, filters, keyboard and the hit highlight need JavaScript; the MCP server sends `default-src 'none'; style-src 'unsafe-inline'; img-src data:` (`src/mcp.js`), which blocks inline scripts. Either the CSP gains `script-src 'sha256-…'` for the one inline script, or MCP viewers get the no-JS stacked layout, which is complete but 4,200 px long.
- **Moving DOM nodes.** The pane is filled by moving the selected item's `.detail` out of its `<details>`; `beforeprint` and the 900 px media change move it back. Screen readers announce the pane through `aria-live`; a reader that follows focus still finds the row's summary where it was.
- **Nested scrolling.** At 1280 the pane is sticky and scrolls inside itself when a detail is taller than the viewport (Where with 4 places plus a recipe just fits). Mouse-wheel over the list scrolls the page, over the pane scrolls the pane; some readers dislike that.
- **Bundle threshold.** "Three or more of the same check and reason" is a guess; a run with two unverified events shows two rows.
- **Chips are small targets.** The strip's chips are 24 px high; on touch devices the filter row is the real control and the strip chips are shortcuts.
- **"Copy as text" needs the clipboard API** (`file://` and some viewers deny it); the fallback is a prompt with the text.
- **Score.** The research says words beat a number; the console keeps the 0.17.0 score as one chip with its formula on hover and the points per row, so it can be dropped without a layout change.

## Three decisions for the product owner

1. **Accept a script in the report, and change the MCP CSP for it.** The console does not exist without master-detail; the no-JS layout is the fallback, not the product. The alternative is a `:target`-only version that loses filters and the keyboard, and keeps roughly 0.17.0's heights on Journeys.
2. **The Overview stays as a one-screen board, with "Copy as text" per owner.** The research proposes deleting it and folding everything into the strip; the console keeps it because the marketer's four answers (M1, M2, T2, T3) are read there at zero clicks. If it goes, those answers move one click into Findings.
3. **Collapsing rules change the counts.** One row per cause is 0.17.0 behaviour; the bundle rule makes the failed run read "3 problems" where 0.17.0 says "Findings 13", and merging the GA4 and Meta purchase into one row (brief principle 5) would make the demo read "3" instead of "4". The header, the Markdown, the CLI and the alert must agree, so this is a `checks.js`/`groupFindings` decision before it is a layout one.
