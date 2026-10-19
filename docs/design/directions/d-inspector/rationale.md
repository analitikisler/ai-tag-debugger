# Direction D: the inspector, simplified

**Status: implemented.** This is the report `src/html/` renders since 0.17.0; the mockup stays as the design
reference. Differences from the mockup are product data the mockup did not have (GTM tags, plan checks,
changes, trend, the AI summary card, white label) and the square outlined chips the owner asked for.

`mockup.html` beside this file is a working single-file mockup of the 0.17.0 demo report built from the
real `capture.json`, following the owner's feedback on directions A, B and C. It loads nothing from the
network, works with JavaScript off (sections stacked, rail as a table of contents), has light and dark
mode through the two-selector pattern, prints, and carries a second state built from the failed-run
capture (the "Mockup: failed run" switch in the top bar). The demo prints on 16 A4 pages.

## The brief, point by point

The owner's eight points and where the mockup answers them:

| # | Feedback | What the mockup does |
|---|---|---|
| 1 | Keep C's left panel, make it collapsible | The rail is the only navigation. It collapses to a 48 px icon strip with tooltips, remembers the choice (`localStorage`), `[` toggles it, `1`–`7` jump to sections. Below 720 px it is C's horizontal strip. |
| 2 | A big scorecard, a short reason, status chips, option cards; none of A/B/C's overviews | Summary holds exactly three blocks: the scorecard (136 px ring coloured by verdict, the verdict word, one headline, up to three "what cost points" lines with their platform and run chips), the five status chips (each a pre-filtered link into Findings), and six equal cards: Vendors checked, Journeys (A's runs × platforms matrix), Events checked, Consent, AI, Run. A perfect score shows no explanation; 90–99 shows one line; below that up to three grouped lines. No priorities list, no "what works", no trend. 684 px at 1280. |
| 3 | C's findings with A's filter | A filter bar with Severity, Owner, Platform, Journey and Viewport chips (each with its count), a search box, "n of m", Clear, and an empty state. Filters are in the URL (`#findings?sev=broken&owner=developer`) so a chip on Summary or a link in an alert lands on the filtered list. Every row is collapsed; the open row has Evidence / Fix / Where / Verify tabs. |
| 4 | C's journeys; Hits, Data Layer, Requests as tabs; room on wide screens; titles, not URLs | The step list on the left (page groups by title, steps by title: "Open Home", "Add to cart"), the selected step's pane on the right with Hits · Data Layer · Requests tabs. No max-width: at 1680 the pane is 1,030 px with the rail open and 1,182 px collapsed. Switching desktop/mobile keeps the step and the tab. |
| 5 | Denied is red, not brown | `--consent-denied` is a crimson (#B1011B light, validated for contrast in both modes), rendered as an outlined chip with a bold mono value so it still reads apart from the Broken badge. |
| 6 | Coverage, Inventory and Run as C; no vendor name under the platform | Inventory is one line per platform: platform chip, seen / not seen, requests, pages, cookies; hosts, pages and cookies in tabs inside the card. Coverage and Run keep C's content as collapsed cards and a facts grid. |
| 7 | Every card starts collapsed except Summary | 201 `<details class="card">` in the document, none open on load. Summary has no `<details>`. "Expand all / Collapse all" per section. |
| 8 | Less text, more distinct colours, more tabs and filters | One hue family per categorical thing (severity 5, consent 3, owner 3, platform 4, viewport 2, run state 2, group 3), every pair validated for contrast in light and dark. Sentences became chips wherever a chip carries the meaning; the Summary is 101 words. Tabs in Findings, Journeys and Inventory; filters in Findings and Coverage. |

## Information architecture

```
Top bar   product · site · date · "Fail · 25" chip · byline · failed-run switch (mockup) · theme
Rail      Summary ⊗ · Findings 4 · Journeys 4/4 · Consent ◇ · Coverage 82% · Inventory 2/4 · Run
          (collapsible to icons; one section visible at a time; #hash routing)
Summary   scorecard (ring · verdict · headline · ≤3 cost lines) → status chips → six "about this run" cards
Findings  filter bar → Failed (collapsed rows: badge · title · owner · platform · where)
                      → Unverified (n) → Passed (n), each row opening into Evidence / Fix / Where / Verify
Journeys  journey tabs · desktop/mobile switch · status line
          step list (page groups, titles, hit chips, flags) │ step pane: Hits · Data Layer · Requests
Consent   one status line per platform → Consent Mode card → Scenarios card
Coverage  Plan coverage card (matrix, Needs column, platform filter) → Conversion integrity card
Inventory one line per platform → hosts / pages / cookies tabs inside
Run       facts grid → Timing card
```

The whole report is addressable: `#findings?sev=broken` is the filtered list, `#j3-s11-h0` reveals a
hit (opens the section, selects the journey, viewport, step, tab and card, then scrolls and flashes),
`#f-ga4-purchase-missing_params` opens a finding. Summary chips, finding Where chips and alert links
all use these.

## Measured

At 1280 × 800 with the rail open, every section fits one screen with its cards closed:

| Section | Height | C | 0.17.0 |
|---|---|---|---|
| Summary | 684 px | 1,028 | 1,722 |
| Findings (rows closed) | 426 px (798 with the first broken row open) | 1,594 | 2,006 |
| Journeys (one step selected) | 658 px (798 with one hit open) | 1,274 | 4,178 |
| Consent / Coverage / Inventory / Run | 254 / 122 / 238 / 372 px | — | 2,854 (Scope) |

The nine reader tasks from `../../ux-audit.md`, re-walked by the reviewer from a fresh load:
**10 clicks and 0 px of manual scrolling** (12 clicks counting the raw-JSON disclosure and the Where → hit
jump), against 11 / 3,408 for C and about 18 / 14,000 for 0.17.0. The one task that costs a click more
than in C is D3 (which parameters are missing on `view_item`): the Coverage card starts closed.

At 390 px: no horizontal scroll in any section; the rail is a strip, the step list a horizontal strip
of numbered steps, the Summary stacks the ring beside the verdict. The file is 509 KB (C: 368 KB; the
difference is the Data Layer and Requests tabs rendering every push and request once per step).

## What the implementation needs

- **Routing and reveal** in the report script (about 250 lines, hashed for the existing CSP): sections,
  tabs, filters, single-select, rail collapse, expand/collapse. The no-JavaScript fallback is the stacked
  document, which is also the print layout.
- **Shared counts.** The status chips count what Findings renders, so the demo's OK chip reads 5 (the
  five Passed rows) while `summary.counts.ok` says 4. The implementation should make `ok` mean the Passed
  rows, or render the Passed rows from the `ok` findings; both surfaces must agree.
- **Page titles** on steps: `page_title` from the GA4 hit at that step, falling back to the previous
  page's title, then the path. Steps without a page keep their action label.
- **Strings.** Every string the mockup introduced is listed in the builders' notes (verdict headlines,
  the cost-line templates per check, card labels, tab and filter labels); they become `ui.html.*` keys in
  `src/i18n.js` in both languages.
- **Tokens.** One hue family per categorical thing, with `-fg` and `-bg` pairs validated at 4.5:1 in
  both modes; denied and broken share the red family and differ by weight and outline, desktop teal and
  Tag Manager sky are close (ΔE 7.8), which is why every chip also carries a word and an icon.

## Known limits

- Filters exist in Findings and Coverage only. A hits filter in Journeys (by platform or consent state)
  would be the next addition for sites with long steps.
- The failed-run state renders Summary and Findings only, as C did; its card labels are plain text
  because the other sections are not rendered in that state.
- Print drops the Data Layer and Requests tabs and shows hits only; the rail and the tool buttons are hidden.
