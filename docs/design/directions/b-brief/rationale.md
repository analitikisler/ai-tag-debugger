# Direction B: "the brief"

_Not chosen. The mockup this describes was removed from the repository once Direction D was implemented; see `../README.md`._

Working mockup: `mockup.html` (the 0.17.0 demo run, `current-0.17/capture.json`) and `mockup-failed-run.html` (the run whose start page refused the connection). Both are generated from the real `capture.json` by one script; only the verdict, the three "do first" lines and the three cards' sentences are written by hand, because the renderer does not yet merge findings by cause or carry an action sentence per check.

## Thesis

Four readers out of five read the first screen and nothing else: the marketer, the account manager, the client, the person who forwards it. The first screen is therefore the whole report for them: one verdict sentence, what it means for money or law, the three things to do first with who does them, what works, the score with its factors and the trend. It fits 1280×800 with no scroll (measured: `scrollHeight` 800). Everything a developer or a tag admin needs sits behind one row of four "Details" tabs, closed by default, and opens at the right place from any link in the brief. Inside, a finding discloses in three layers: a line, then four sentences (what, so, why, fix), then evidence, the reproduction and a text to forward, each on request.

The report-brief's narrative order (verdict → impact → what to fix, by whom → what works → evidence) is the page's layout, not a convention: the evidence cannot appear above a sentence that interprets it, because it is on another tab.

## Information architecture

```
Brief (the first screen, always visible, printed first)
├─ Eyebrow: audit · date · 4 journeys · desktop and mobile
├─ Verdict: state word + one headline sentence (report-brief §2 rule, no model)
├─ Sub-line: "3 problems: 1 for the developer, 2 for Tag Manager" (owner counts are links) · plan coverage
├─ Do first: 3 action lines, each severity glyph + word, owner chip, place, link to its card
├─ What works: 5 verified lines + 1 "Not checked" line (counted, links to Scope)
└─ Side: score /100 with its 3 factors and points (each a link) · trend sparkline · "since last run"
Details (one tab row, nothing open until asked; stacked in order with JS off)
├─ Findings: owner groups → one card per cause
│    card: line → what / so / why / fix → facts (page, event, parameters, step, viewport)
│          → Evidence (push with the missing lines marked, hit tables, desktop comparison, links to the exact hit)
│          → Reproduce (the steps with their selectors from capture.json)
│          → Copy for the developer / for Tag Manager (plain text + Copy button) → How to verify
├─ Journeys: table of runs → journey (details) → step (details) → hits and pushes (details)
├─ Consent: one verdict sentence → scenarios table (glyph + word in the cells) → timing per journey → the raw commands
└─ Scope: run facts · plan coverage · conversion integrity · providers · inventory · timing (collapsed) · not checked
```

## What is on the first screen, and what was cut

On it: the verdict with the state word, the headline that names the event, the place and the contrast ("Desktop sent both"), the owner split, the coverage fraction, three actions with owner and place, five positive facts, one "not checked" line, the score with three named factors, the trend. Nothing else.

Cut from 0.17.0's first 490 px and the Overview tab, and why:

- The five count tiles. They were the first thing on the page and read as a score; "4 OK" counted journeys. The counts survive as the sub-line ("3 problems: 1 for the developer, 2 for Tag Manager") and are links to the owner groups (reference pattern 2).
- The run facts row (journeys, platforms, plan, consent, campaign check, AI). Scope facts, not verdict facts; they open the Scope tab now.
- The "What to fix first" card listing all four findings in full. The three "do first" lines say what to do, not what was found; the finding titles live on the Findings tab.
- The Journeys table and the score's deduction list. The table opens the Journeys tab; the deductions are three factor lines on the side (reference pattern 8: a score is shown only with its factors and points).
- "Marketing · Nothing for Marketing in this run." as a section. It is one muted line under the Findings owner groups.

## What moved where versus 0.17.0

| 0.17.0 | Direction B |
|---|---|
| Verdict header (490 px, repeated on every tab) | The brief; the tab row is sticky, the brief is not repeated |
| Overview tab | Gone; its content is the brief or a Details tab |
| Findings tab, first card per owner open | Findings tab, every card closed; a link from the brief opens one |
| Journeys: consent scenarios card at the top of the tab | Consent tab, with the per-journey timing and the raw commands |
| Journeys: Consent Mode card per journey (default + update per page load) | One line per journey under Consent ("default at 30 ms, before the first Google hit, granted at step 2, re-sent on 4 more page loads") |
| Journeys: journey sub-tabs, then the steps table with a 4-tab strip per step | Journey `details` → step `details` → one time-ordered list of hits and pushes, each a `details`; `{ecommerce: null}` resets folded into one muted count |
| Journeys: expected-vs-observed and platform parity tables | Scope (plan coverage per journey; parity is in the conversion integrity table) |
| Scope: "This run" card | Scope facts list at the top of the tab |
| Where chips on a card (one per journey) | One place phrase on the line ("all 4 journeys", "checkout · mobile only") and links to the exact hit rows in the evidence (pattern 7) |
| Network requests list per step | The request line under each hit; non-tracking vendor calls stay in `timeline.csv` |

## Scroll and click budget

Measured with Playwright at 1280×800 (`b-brief-measure.mjs` in the scratchpad), on the 0.17.0 `report.html` and on `mockup.html`. A click is a mouse click; px is every vertical scroll needed: the page's own scroll on a hash jump plus the scroll to bring the next thing to click, or the answer, into view. The tasks are the nine of `ux-audit.md`.

| Task | Reader's question | 0.17.0 clicks | 0.17.0 px | Brief clicks | Brief px | Note |
|---|---|---|---|---|---|---|
| M1 | Is purchase revenue correct on mobile, and on desktop? | 1 | 909 | 0 | 0 | the headline says "Desktop sent both" |
| M2 | What will this cost me? | 1 | 0 | 0 | 0 | "send no revenue" in the headline; the "So:" sentence is 1 click |
| M3 | What do I send to the developer? | 1 | 0 | 3 | 1499 | 0.17.0 has no copy affordance (forward the file); B copies a ticket-ready text |
| D1 | Which push is wrong and on which page? | 3 | 4777 | 2 | 1169 | B shows the push with the expected lines marked |
| D2 | Reproduce the duplicate add_to_cart | 3 | 3058 | 2 | 903 | 0.17.0 shows no action or selector (stalls); B lists the clicks |
| D3 | Which parameters does view_item carry on checkout · desktop? | 4 | 2152 | 4 | 1267 | same depth; no plan expectation in either |
| T1 | Which tag fires Meta PageView before consent? | 3 | 1560 | 1 | 824 | neither names the tag (no container); B says "no push precedes it" in the card |
| T2 | Is the Consent Mode default set early enough? | 1 | 913 | 0 | 0 | a "What works" line |
| T3 | What fires after Reject all? | 1 | 581 | 1 | 476 | the "do first" line already says it at 0 clicks; the table is 1 |
| Total | | 18 | 13,950 | 13 | 6,138 | |

The marketer's three tasks and the tag admin's T2 go to zero. The developer's tasks lose one click each and three quarters of the scrolling because the evidence is inside the card, not three tabs away. M3 is the one task that costs more clicks than today, and today it cannot be done at all. Tab heights for the page as a whole: brief 800 px; Findings 2,533 px with the purchase card and its evidence open (0.17.0: 2,006 with one card open and no evidence); Journeys 2,624 px with checkout · mobile and step 11 open (0.17.0: 4,178); Consent 1,276; Scope 2,203 (0.17.0: 2,854).

## How repetitive findings collapse

One card per cause, occurrences inside (reference pattern 3). The demo's 18 raw findings become 3 cards, not 4: the GA4 and Meta `missing_params` on the same push are one card titled "`purchase` reached GA4 and Meta without `value` and `currency`", and the red "Reject all" cell of the scenarios table folds into the Meta `PageView` card as "and again after Reject all". The place is a phrase on the line ("all 4 journeys", "checkout · mobile only"), the four Where chips are gone, and the evidence links to the exact hit row of one journey.

The failed run (`mockup-failed-run.html`) is the test: 0.17.0 shows eleven near-identical info cards. Here the verdict is "Not verified" with the reason, "Do first" is one action for the developer plus one re-check for Tag Manager, "What works" is "Nothing could be verified · Not checked: 11 planned events on 4 platforms, consent scenarios, campaign parameters", and the eleven findings are one info card, "11 planned events could not be checked", whose evidence lists them. The consent-default finding is kept as a risk card but says in its first sentence that it is unverified rather than missing, which the data cannot say today.

## Mobile

At 390 px the brief stacks: verdict, sub-line, the three actions, what works, then the score and trend as a block. `scrollWidth` is 375 on every tab (no horizontal scroll); the tab row scrolls sideways under a fade. The brief is 1,495 px tall, under two screens. The Journeys tab at 390 px with a step open is 4,305 px, which is the real cost of a step list on a phone, but it is a tab a phone reader does not open; a link from a card lands on the hit row directly.

## Print

Print is the brief plus the Findings tab: closed cards print as their one line, open cards with their sentences and whatever evidence is open. Journeys, Consent and Scope do not print; `timeline.csv` is the long form. A4 with the purchase card and its evidence open: 3 pages (0.17.0: 55 to 90). Verify links print their URL after the name; badges and chips drop their tint and get a border.

## Implementation cost in `src/report.js`

- `verdictBlock` → `brief()`: the headline is `verdictHeadline` as today; the owner split becomes links to `#grp-<owner>`; "do first" takes `metrics.priorities[].top` and needs an **action** string per check in `i18n.js` (both languages) next to the consequence and fix strings; "what works" takes `okLines`, `metrics.consent.consentMode`, `metrics.conversions` and the pii check; "not checked" takes `checkedProviders` and the GTM container flag; the score factors take `metrics.score.deductions` merged by card; the trend keeps `sparklineSvg` at 160×36.
- `renderHtml`: the Overview panel and `overviewPanel` go; the tab row loses Overview and gains Consent; `SCRIPT` selects no tab at load, toggles a tab closed on a second click, and `reveal` opens the hit's `details` chain. The two-selector theme code and the CSP hash stay as they are.
- `findingCard`: one card per cause means `cardIds`/`rowKey` key on the push, not on `platform + event`; the card body becomes what / so / why / fix (consequence and fix strings exist; "why" is a per-check cause string for the deterministic cases, the model's `likely_cause` when there is one), a facts `<dl>` (page, event, parameters, step, viewport), and three nested `details` (evidence from `evidenceHtml` plus the push and the other viewport's hit, reproduce from `steps[].replay`, copy text from a new `copyText(f)` that the Markdown renderer can share).
- `journeysPanel`: drop `jtabs` and the per-step tab strip; `journeyPanel` renders a `details` per journey and `stepBlock` a `details` per step with hits and pushes interleaved by time (`eventRow` and `pushRow` survive, with an `id` per hit); the scenarios card and the Consent Mode card move to a new `consentPanel`.
- `scopePanel`: `runFacts` moves in; `timing` collapses into a `details`.
- Strings: the state word "Not verified", the consent lead sentence, the copy-block labels, the tab row hint, in `en` and `tr`.

Nothing in `checks.js`, `metrics.js` or `audit.js` changes. The Markdown and CSV renderers keep their order; `report.md` already follows this narrative.

## Risks

- A developer who opens the file sees no journey, no step and no hit until a tab is clicked, and the first finding is closed. The brief's links mitigate it (every "do first" line and every score factor lands on an open card), but someone who scrolls rather than clicks finds an empty band under the tab row with a one-line hint.
- Evidence one tab away means a developer with DevTools open flips between the card's evidence and the step list; today both are on the Journeys tab. The hit links go both ways (card → hit, hit → card).
- The single time-ordered list replaces the Timeline / Events / dataLayer / Network strip. Vendor calls that are not parsed as hits (there are none in the demo) no longer appear in the HTML; they are in `timeline.csv`.
- Print drops Journeys, Consent and Scope. A client who wants the consent table on paper opens that tab and prints it, which the stylesheet does not yet support.
- With JS off the page is 3,765 px of stacked panels, in the right order, with the cards closed. Readable, not short.
- Merging GA4 and Meta into one purchase card changes the count from 4 to 3 and the history keys (`problemKey`) in `history.json`; the "since last run" diff needs to key on the cause.
- The trend on the mockup uses two earlier demo runs from `demo/aitd/localhost/history.json` plus this run, all at score 25; the run's own `summary.json` has `trend: null`.

## Three decisions for the product owner

1. **Nothing under the tab row until a tab is clicked.** The page is one screen for anyone who does not ask for more. The alternative is Findings open by default, which brings the page back to 2,500 px and makes the brief a header again.
2. **One card per cause, counts change.** GA4 and Meta purchase are one card; the Reject-all cell is part of the Meta PageView card. The sub-line says "3 problems", the Markdown and the alert must say the same.
3. **"Do first" lines are actions, not findings.** "Add `value` and `currency` to the `purchase` push on `/thanks.html` in the mobile layout" needs a hand-written action string per check in both languages, and the owner on the line is the one who does that action, which for the duplicate push is arguably the developer, not Tag Manager as the data says today.

Reference patterns taken (from `reference-ux.md`): 1 (verdict above the fold, evidence below), 2 (owner counts and score factors are links), 3 (one card per cause), 5 (consent chips on every hit), 6 (passed and not-checked as counted lines), 7 (evidence links to the exact hit row), 8 (score factors named with points). Not taken: 4 (a "not fired" row per event; the failed run folds them into one card instead) and 9 (glossary tooltips: the 406 tab stops of 0.17.0 are gone and not replaced).
