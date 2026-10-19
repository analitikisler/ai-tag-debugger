# Direction C: the inspector

_Not chosen. The mockup this describes was removed from the repository once Direction D was implemented; see `../README.md`._

`mockup.html` beside this file is a working, single-file mockup of the 0.17.0 demo report (localhost, 4 runs, 2 broken · 1 risk · 1 warning · 4 ok) rebuilt from the real `capture.json`. It loads nothing from the network, keeps the visual-system tokens, logos and sprite, works with JavaScript off (sections stacked, rail as a table of contents), has light and dark mode through the two-selector pattern, prints, and holds a second, clearly marked state built from the failed-run capture. Screenshots live outside the repository under the review scratchpad (`c-inspector-{overview,findings,journeys}-{1280,390}.png` and `c-inspector-journeys-1280-dark.png`).

## Thesis

The three readers already spend their days in Tag Assistant, Analytics Debugger and Lighthouse. Those tools share one shape: a short list on the left that never grows past what fits, a detail pane on the right that shows one thing at a time, and the "why" one click deep. The 0.17.0 report is a document: four long tabs under a 490 px verdict header, each tab stacking every card it owns. Direction C turns the report into an inspector: a left rail of seven sections, a content area that is never taller than the thing being inspected, and the journey as a page-and-step timeline with the selected step's hits beside it. The measured result at 1280 px: Summary 1,028 px (was 1,722), Findings 1,594 px with three cards open (was 2,006), Journeys 1,274 px (was 4,178). The file is 368 KB against 514 KB, with 237 `<details>` against 370, because each hit is rendered once in its step pane rather than inside a details row of a table.

## What was borrowed, from which tool

Direct page loads were blocked from this environment, so the URLs below come from `docs/design/reference-ux.md` (the researcher's notes, with their caveat on labels confirmed only through secondary sources) and from my own use of the tools.

- **Google Tag Assistant** (https://support.google.com/tagassistant/answer/10039345, https://support.google.com/tagmanager/answer/6107056): the left timeline grouped by page with numbered events and a detail pane on the right became the Journeys section: page groups (`/`, `/product.html`, `/cart.html`, `/checkout.html`, `/thanks.html`), numbered steps with their replay action, the selected step's pane. "Tags Fired" and "Tags Not Fired" as two first-class lists became the **Tags** block under each step's hits ("Fired here …", "Not fired on this journey …"), with the sentence that a `gtm_container` export is what names the tag and trigger. The Consent tab's per-event state became a consent chip on every hit row (`ad ✗ an ✗`, or `none` for a Meta hit that carries no signal).
- **Analytics Debugger** (https://analytics-debugger.com/tools/analytics-debugger-extension/, https://github.com/analytics-debugger/analytics-debugger-browser-extension): the compact hit row with the platform icon, the event name and the few parameters a practitioner scans first (`value 41.4 EUR`, `items 3`, `transaction_id`), expanding into a decoded parameter table, a separate items table and the raw request. What it does badly, one vendor per tab, is deliberately not borrowed: a step shows GA4 and Meta in firing order.
- **Lighthouse** (https://github.com/GoogleChrome/lighthouse/blob/main/docs/understanding-results.md): the score gauge with its 0–49 / 50–89 / 90–100 bands and the category rows under it became the Summary; the audit groups became **Failed**, **Unverified** and **Passed**, the last two collapsed to one counted line with a "Show" toggle; each finding is an accordion row with a one-line title, an icon and a chevron.
- From the researcher's list of eight patterns, taken: 1 (verdict above the fold), 3 (group by cause: `cards()` folds the 18 raw findings into 4 rows with every place inside), 4 (fired / not fired rows), 5 (consent state on the hit row), 6 (passed and unverified folded to one line), 7 (the "Where" chip opens the exact hit accordion in the step, axe's "Highlight"), 8 (the score factors are printed with their points beside the gauge). Not taken: 2 (counters as filters) beyond section links, because a filterable console is Direction B.

## Information architecture

```
Top bar      product · site · date · "Fail · 25/100" chip · byline · theme
Rail         Summary ⊗ · Findings 4 · Journeys 4 · Consent ◇ · Coverage 82% · Inventory 2 · Run
                                                              (mockup only: Failed-run state)
Summary      gauge + verdict sentence + run facts line
             category rows: Findings / Journeys / Consent / Coverage / Inventory / Run (each a link)
             What to fix first: owner → finding lines with points
             score legend with the deductions
Findings     Failed (4) accordion rows: impact · evidence · fix · where · verify
             Unverified (n) one line, show → event chips        (empty groups are omitted)
             Passed (5) one line, show → one row per positive result
Journeys     journey picker (4) → goal, badges, planned-events strip
             page/step list (left, sticky) │ selected step pane (right):
                                           │ Hits → Tags fired/not fired → Data Layer → Requests
Consent      status per platform · Consent Mode timing + first default/update · scenarios table
Coverage     plan matrix (event × run) · conversion integrity
Inventory    vendor · seen or not · requests · pages · cookies
Run          facts · timing · files
```

## What moved where versus 0.17.0

| 0.17.0 | Direction C |
|---|---|
| 490 px verdict header on every tab (headline, five count tiles, six run facts) | A 48 px top bar with a verdict chip; the headline, gauge and facts live on Summary only |
| Overview: fix-first card, "What is working", journeys table, score card | Summary: category rows replace the journeys table and the count tiles; the score card folds into the gauge and one legend line; "What is working" becomes the Passed group in Findings |
| Findings: owner groups of open cards, severity bar | One Failed group sorted by severity with an owner chip per row; the first row of each owner and every broken row open |
| Journeys: scenarios table, sub-tabs, Consent Mode card, steps table with open flagged rows, expected-vs-observed, parity | Journeys: picker, one-line planned-events strip (was expected-vs-observed), step list and one pane; parity becomes a note on the step ("Count differs: GA4 2× · Meta 1×"); consent scenarios and the Consent Mode card move to Consent |
| Scope: coverage, conversions, inventory, providers, timing, run card | Coverage (plan + conversions), Inventory (providers merged in), Run (facts + timing) |
| Positive results never stated (M1, T2) | Passed lines: "GA4 purchase carried 19.9 EUR … checkout · desktop", "Consent Mode default set 27–53 ms …"; the broken card also says "Fine on checkout · desktop: 19.9 EUR" |
| Replay action and selector only in `capture.json` (D2) | Step list shows `click #add-to-cart`; the pane header shows path, action and "after steps 1–3"; the duplicate finding's evidence carries the recipe |

## Scroll and click budget

Measured with Playwright at 1280×800 (`measure-c.mjs` in the review scratchpad) on the 0.17.0 demo report and on the mockup, from a fresh load. Clicks are mouse or keyboard activations; px is the sum of scroll distance over the task, whether the reader scrolled or a link scrolled for them. The 0.17.0 paths are the ones in `ux-audit.md`, re-walked.

| Task (ux-audit.md) | 0.17.0 clicks | 0.17.0 px | C clicks | C px | Where C answers it |
|---|---|---|---|---|---|
| M1 negative: is purchase broken on mobile? | 1 | 567 | 0 | 228 | Summary fix-first line "checkout · mobile" |
| M1 positive: did desktop carry 19.9 EUR? | 5 | 3,747 | 1 | 0 | "Fine on checkout · desktop: 19.9 EUR" under the evidence; also a Passed line |
| M2 what will this cost me? | 1 | 0 | 1 | 0 | Impact strip (same as 0.17.0) |
| M3 what do I send to the developer? | 1 | 539 | 0 | 228 | Developer lines on Summary, each a permalink `#f-…` |
| D1 which push is wrong, on which page? | 3 | 4,349 | 3 | 925 | Where chip opens the hit; push row says `value missing currency missing`; raw JSON one more click |
| D2 reproduce the duplicate add_to_cart | 3 | 2,156 | 2 | 794 | Evidence: `click #add-to-cart` on `/product.html?id=TEE-01` after steps 1–3, GA4 2× / Meta 1× |
| D3 which parameters are missing on view_item? | 1 | 554 | 1 | 0 | Coverage matrix row with its "needs" column |
| T1 which tag fires Meta PageView before consent? | 2 | 1,310 | 2 | 1,233 | Evidence says tag unknown and names `gtm_container`; hit row shows consent `none` |
| T2 is Consent Mode default early enough? | 1 | 905 | 0 | 0 | Summary Consent row: "default on time (27–53 ms)" |
| T3 what fires after reject? | 1 | 485 | 1 | 0 | Summary row names it; Consent table gives the reason and a finding link |

Totals: 19 clicks and 14,612 px in 0.17.0 against 11 clicks and 3,408 px in C. T1 is the one task that does not improve in clicks: the tag admin still needs the card and the step, because without a container export nobody can name the tag; what improves is that the report now says so.

## How repetitive findings collapse

`cards()` folds findings by check, platform, event and text, so the four `before_consent` and four `duplicate` rows of the demo become one card each with "all 4 runs" and four Where chips. In the failed-run state (rail: "Failed-run state"), the eleven `missing_event` info findings become one line, **Unverified 11 · planned events the journeys stopped before; not failures**, closed by default, opening into eleven event chips. The group sits between Failed and Passed, as Lighthouse puts "Not applicable" after the audits, and is omitted when it is empty. The two real problems of that run (no consent default, journey incomplete) stay as two Failed rows, each "all 4 runs".

## Mobile and print

At 390 px the rail becomes a sticky horizontal strip under the top bar, the summary keeps the gauge at 72 px beside the verdict, category rows drop to two lines, finding rows stack the badge under the title, and the journey's step list becomes a horizontal strip of numbered steps with the selected step's pane below it; hit rows wrap their key parameters onto a second line. Every section measures 375 px wide at a 390 px viewport (no horizontal scroll), checked per section with Playwright. The tallest mobile section is Findings at 3,153 px with three cards open.

Print follows the no-JS layout, as `writePdf()` prints with JavaScript off: the rail and top bar are hidden, every section prints under its `h2` with a page break before it, finding rows and flagged step panes are `open` in the markup, unflagged step panes print as a header line only, and the step list prints as a plain list. Tints are dropped and badges get a 1 px border. The demo prints on 19 A4 pages against 22 for the 0.17.0 report under the same Playwright call.

## Implementation cost in `src/report.js`

- `renderHtml`: the page skeleton changes most. The `verdictBlock` and `tabbar` go; a `topbar`, a `rail()` and seven `panel()` sections take their place. The `SCRIPT` constant gains the rail (about 25 lines) and the vertical step tablist; `scriptCspSource` keeps working because the script is still a fixed string.
- `overviewPanel` → `summaryPanel`: `gauge()` is new (one SVG, 8 lines); the category rows are a new 20-line function over `metrics`; `fixFirst` is reused as is; `scoreCard` shrinks to the legend line.
- `findingsPanel`: the owner groups become one list with an owner chip; `okLines` moves into a `<details class="group">`; a new `unverifiedGroup()` folds `info` rows of `missing_event` for incomplete runs. `findingCard` keeps its anatomy; `whereChips` targets the hit anchor (`j3-s11-h0`) when the hit is known.
- `journeysPanel` / `journeyPanel` / `stepRow`: the largest change. `stepRow` splits into `stepItem` (list entry with page grouping and replay action) and `stepPane` (hits via `eventRow`, a Tags block from `metrics.funnel`, the dataLayer list via `pushRow`, requests via `requestRows`). `funnelCard` becomes the planned-events strip and `parityCard` a note per step; `consentCard` and `scenariosCard` move to a `consentPanel`.
- `scopePanel` splits into `coveragePanel`, `inventoryPanel` (with `providersCard` merged in) and `runPanel`. `coverageCard`, `conversionsCard`, `inventoryCard`, `timingCard` and `runCard` are reused.
- `CSS`: the rail, shell, pane and hit-row rules are new (about 180 lines); the token block, badges, tables, `ptable` and dark-mode selectors are unchanged. `i18n.js` gains the section names, the group names (Failed, Unverified, Passed, Show), the Tags block sentences and the consent-chip words in both languages. `renderMarkdown` and `renderCsv` are untouched.

## Risks

- **A rail layout in a one-file report.** The rail needs JavaScript to switch sections; without it the file is a 22,640 px stacked document with the rail as a sticky table of contents, which is longer than today's no-JS page (20,669 px) because the failed-run state is in the same file. The MCP viewer's CSP already allows the hashed inline script, and the fallback is readable, but a reader who opens the file in a locked-down viewer gets the document, not the inspector.
- **Printing a rail layout.** Print has to discard the rail and the step panes' one-at-a-time behaviour; the mockup does this with `display:block!important` overrides, which is a second layout to maintain. Unflagged steps print as one line each, so a reader who wants every hit on paper has to open the HTML.
- **The marketer meets a developer tool.** The Summary is calm (one gauge, six rows, four fix lines), but Journeys looks like DevTools, and a marketer forwarded straight to `#j3-s11` lands in it. The mitigations are the verdict chip in the top bar on every section and the plain-sentence category rows; whether that is enough is a question for the product owner.
- **The gauge.** The researcher's caution stands: a number invites argument. It is kept because 0.17.0 already prints 25/100 and the brief asks for the Lighthouse model; the factors and points sit next to it and the verdict words are set larger than the number.
- **Open-by-default rows.** Three open cards make Findings 1,594 px; opening only the first would bring it near 900 px but costs the tag admin a click (T1 becomes 3).

## Three decisions for the product owner

1. **Score as a gauge with named factors, or verdict words only?** The mockup shows the gauge at 92 px with the deductions in the legend. Dropping it removes the Lighthouse resemblance and 40 px; keeping it gives teams a number to trend.
2. **Seven rail sections, or fold Consent, Coverage and Inventory into one "Checks" section?** Seven keeps each screen under 1,100 px and gives the tag admin a Consent entry on the rail; four would be closer to today's tabs and shorter on phones.
3. **One pane per step with the Tags fired / not fired block, or keep the 0.17.0 steps table?** The pane is the heart of the direction and what cuts Journeys from 4,178 to 1,274 px, but it is the largest change to `src/report.js` and the "not fired" list only becomes a real GTM trigger evaluation when a container export is given.
