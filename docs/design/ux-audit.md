# UX audit of the current report

> Screenshot names below refer to captures of the 0.16.0 demo report taken during the review. They are not kept in the repository: run `npm run demo:serve` and `npm run demo`, then open the report to see the same screens.

Artifact under review: the report generated from the demo shop (`report.html`, 665 KB, 13,845 DOM nodes, 482 `<details>`, 209 tables, 406 "?" tips; `report.md`, 20.7 KB; `timeline.csv`, 189 rows). Browser: Chromium via Playwright, 1280×800 desktop, 640×400 as the 200 % zoom proxy, 390×844 mobile, dark scheme and print media. Screenshots are in `docs/design/ux-audit/`.

The sample run has no AI explanations (`explained: null`), no measurement plan check and no GTM container, which is the common case for a first run and the worst case for the report: every "Likely cause" slot says "Run without --no-ai for an explanation", and the finding card has to carry the reader on evidence alone.

## How to read the task tables

Each task lists the clicks and scrolls a reader needs today, measured on the sample, then where the path breaks. "Click" counts a mouse click or a keyboard activation; "scroll" counts a full-viewport scroll. A task "fails" when the report cannot answer it, "stalls" when it can but the reader has to infer the answer from raw data.

## Reader 1: the marketer

Owns ad spend and the GA4 property. Reads on a laptop, often from a link in a chat message, and will forward the report rather than act on it.

### M1. "Is purchase revenue correct on mobile?"

| Step | What happens today | Screenshot |
|---|---|---|
| Land on Overview | Four metric tiles (2 Broken, 1 Risk, 1 Warning, 4 OK). The tiles are not links. The Summary card says "Run without --no-ai for an AI summary". The Journeys table shows checkout · mobile has 4 problems, the others 2, which is the first hint that mobile is worse, but "problems" are not named. | `01-overview-desktop.png` |
| Click "See all findings" (1 click) | Findings tab, first card open: "purchase was sent without currency, value" with GA4, "1 journey · 1 step", a Where chip "11 checkout · mobile · Place the order", and Evidence (page_location, page_title, transaction_id, items). The second card (Meta Purchase without value, currency) is closed. | `02-findings-desktop.png`, `03-marketer-purchase-findings.png` |
| Decide | The answer "no, on mobile GA4 and Meta purchase carry no value or currency" is on the page but the reader has to assemble it: the card title does not say "mobile", the viewport lives in a chip at the bottom-right of the open card, and the Meta twin is a separate card. | |
| "And is desktop correct?" | Nothing in Findings says the desktop purchase carried 19.9 EUR. To see it: Journeys (1 click) → checkout · desktop (1) → step 11 (1) → expand GA4 purchase (1) → read `value 19.9` in the parameter table. 4 clicks, 2 scrolls. | `04-developer-step11-mobile-timeline.png` |

Result: stalls. 1 click to the negative answer, 5 clicks to the positive one, and the positive one is never stated. The report has an OK list (campaign parameters survived) but no "purchase on checkout · desktop carried value 19.9 EUR, currency EUR, 1 item, transaction_id T…" line, so a passing check is invisible.

### M2. "What will this cost me?"

| Step | What happens today | Screenshot |
|---|---|---|
| Open the purchase finding | No Impact box (it only renders when the AI ran). "Likely cause: Run without --no-ai for an explanation." | `03-marketer-purchase-findings.png` |
| Look for a summary | Overview Summary card: same dead end. | `01-overview-desktop.png` |

Result: fails. Without the AI there is no impact statement at all, although the impact of each deterministic check is fixed and known (a purchase without `value` reports 0 revenue in GA4 and gives Google Ads nothing to bid on; a Meta purchase without value breaks value optimisation; a duplicate `add_to_cart` inflates the add-to-cart rate by 100 %). The report should carry a templated impact per check and let the AI refine it, not replace it.

### M3. "What do I send to the developer?"

| Step | What happens today | Screenshot |
|---|---|---|
| Findings tab | Findings are grouped by owner: "Developer 2 · Site code and dataLayer", "Tag Manager 2". This is the right grouping. | `02-findings-desktop.png` |
| Try to link to the group | Finding cards have no `id`; owner groups have no `id`; the severity filter is not in the URL. The closest shareable link is `#findings`, which lands on all findings for all owners. | |
| Try to copy | No "copy as text" or "copy link" on a card. The marketer either forwards the 665 KB HTML file, or pastes `report.md`, which is 200+ lines and lists findings by severity with the owner as a bare line ("- Developer"), not grouped. | |

Result: stalls. The information architecture (owner groups) is right; the hand-off mechanics (per-finding permalink, per-owner permalink, copy as text, a short Markdown block per owner) are missing.

## Reader 2: the developer

Fixes site code and the dataLayer. Reads on a wide screen with DevTools open, wants the exact push, the page and a way to reproduce.

### D1. "Which push is wrong and on which page?"

| Step | What happens today | Screenshot |
|---|---|---|
| Findings → purchase card (open by default) | Evidence table shows `page_location http://localhost:4321/thanks.html` (good) and the hit's parameters with `value` and `currency` absent. The absence is implied by the title, not shown as rows. | `03-marketer-purchase-findings.png` |
| Click the Where chip (1 click) | Lands on Journeys → checkout · mobile → step 11, Timeline tab. The push list in time order: `consent default`, `consent update`, `{"ecommerce":null}`, `purchase` → GTM event `purchase` → GA4 purchase (Broken, open) and Meta Purchase. | `04-developer-step11-mobile-timeline.png` |
| Expand the `purchase` push (1 click) | Raw JSON shows `ecommerce: {transaction_id, items}` with no `value`/`currency`. This is the answer. | `05-developer-purchase-push-expanded.png` |

Result: works, 3 clicks. Two gaps: the step header ("11 · Place the order · +6.7s · 4 events · 4 dataLayer") never shows the page URL, although `steps[].pagePath` is in the capture; and the push card does not say "missing: value, currency" next to the raw JSON, so the developer diffs by eye.

### D2. "Reproduce the duplicate add_to_cart"

| Step | What happens today | Screenshot |
|---|---|---|
| Findings → add_to_cart card (closed; 1 click to open) | "sent 2 times by one action", 4 journeys · 4 steps, four Where chips. No evidence table (the duplicate check has no `evidence`). | `02-findings-desktop-full.png` |
| Click a chip (1 click) | Step 4 "Add to cart" timeline: two `add_to_cart` pushes at +2.7s, each followed by a GA4 `add_to_cart` hit; Meta AddToCart appears once. The timeline makes the cause visible: the site pushes twice, GTM fires once per push. | `06-developer-duplicate-add-to-cart.png` |
| Reproduce | The step says "Add to cart" and nothing else. The capture holds `replay: {action: "click", selector: "a.card"}` per step and the page path, neither is rendered. The developer must guess which button on which page. | |

Result: stalls. The evidence is excellent; the reproduction recipe (page URL, action, selector, the sequence of previous steps) exists in `capture.json` and is left out of the report. The asymmetry (GA4 twice, Meta once) is also not called out, although it is the strongest clue that the GTM Meta tag has a once-per-page guard and the GA4 tag does not.

### D3. "Which parameters are missing on view_item?"

| Step | What happens today | Screenshot |
|---|---|---|
| Findings | Nothing about `view_item`: without a measurement plan there is no expectation to compare against. | |
| Journeys → checkout · desktop → step 3 → Events tab → expand `view_item` (5 clicks) | Parameter table: page_location, page_title, currency, value, items. Items card shows item_id, item_name, price. | `07-developer-view-item-params.png` |
| Decide | "Missing relative to what?" The report has no notion of GA4's recommended parameters for an ecommerce event, so `quantity` absent from the item and no `item_category` are not flagged. The Scope tab's plan coverage card only says "No plan". | `12-scope-tab.png` |

Result: fails without a plan, 5 clicks to the raw data with a plan. The plan coverage card in Scope says "No plan", which is correct and useless to the developer. The checks already know the GA4 ecommerce event list (`ECOMMERCE_EVENTS` in report.js); a default expectation per recommended event would turn this into a finding.

## Reader 3: the tag admin

Runs GTM and the consent platform. Wants tag names, trigger names and consent state per hit.

### T1. "Which tag fires Meta PageView before consent?"

| Step | What happens today | Screenshot |
|---|---|---|
| Findings → Tag Manager group → Risk card (1 click to open) | "meta PageView fired before the visitor accepted cookies", 4 journeys · 4 steps. No GTM tags section, because no container was given, and the card does not say that a container would name the tag. | `02-findings-desktop.png` |
| Click a chip → step 1 timeline (1 click, 2 scrolls) | Meta PageView sits under "Hits without a dataLayer push" with the note "No dataLayer push with this event name in this step. The tag may fire from a page view, a click trigger or a hardcoded pixel." Source: request `POST facebook.com/tr 200`. | `09-tagadmin-step1-meta-pageview-before-consent.png` |

Result: stalls. The report cannot name the tag (no container) and does not say how to make it able to (`gtm_container` in the config). The consent state of the Meta hit is not shown either: GA4 hits carry a Consent chip block (`ad_storage: denied`), Meta hits have none, so the reader cannot see "sent with no consent signal at all".

### T2. "Is Consent Mode default set early enough?"

| Step | What happens today | Screenshot |
|---|---|---|
| Journeys → checkout · desktop (1 click) | Consent card lists Default (step 1), Update (step 2), then Default + Update again for every page load (10 entries for an 11-step journey). No timestamps. | `10-tagadmin-consent-card-checkout.png` |
| Step 1 timeline (1 click) | Nodes in time order: `consent default` (+0.2s), `{"ecommerce":null}`, `view_item_list` push → GA4 hits. Order implies the default came first. | `09-tagadmin-step1-meta-pageview-before-consent.png` |
| Confirm | `gcs=G100` on the GA4 request proves the default was applied, but it is in the Network tab's collapsed "Context parameters" (1 more click, 1 scroll). | `11-network-tab-step1.png` |

Result: stalls. The only positive signal is the absence of a "consent default missing or late" finding. The report never states "Consent Mode default at +0.20s, 10 ms before the first tag request", which is the one sentence the tag admin needs. The consent card repeats the same default/update pair on every page load, which buries the first (only interesting) one.

### T3. "What fires after reject?"

| Step | What happens today | Screenshot |
|---|---|---|
| Journeys tab (1 click) | Consent scenarios card at the top: columns No choice yet / Accept all / Reject all / Analytics only. Reject all: GA4 page_view 1, GA4 view_item_list 1, Meta PageView **1** in red. | `08-tagadmin-journeys-top.png` |
| Understand | Why are the two GA4 "1"s fine and the Meta "1" not? The data knows (`cookieless: 1, adDenied: 1` on the GA4 cells, `0` on Meta) but the cell shows only a count. The red is the only cue and it is colour + bold, no text or glyph (the Markdown version adds ⚠). | |
| Go deeper | There is no decline journey in this run, so there is no step view for the reject path and no cookie list after reject. | |

Result: works for the headline, stalls on the reason. The table is also in the wrong place for this reader: it is a finding ("Meta PageView still fires after reject all") and lives in Journeys, not in Findings, and nothing in Findings points at it.

## Accessibility pass

### Keyboard-only navigation

Tab walk from the Overview (`results.tabWalkOverview`): byline link → Overview → Findings → Journeys → Scope and plan → "See all findings" → four journey links → four footer links → end. 14 stops, all with a visible 2 px accent outline. No skip link; the sticky tab bar must be tabbed through on every page.

Findings (`#findings`): the severity radio group (one stop, arrows switch), then each finding `summary`. An open card adds its Where chips and verify links to the sequence. Works. The radios are visually hidden (`opacity:0`) but the label gets a 2 px outline through `:focus-visible + label`, which is correct.

Journey step (`#j3-s11`): focus starts after the hash target, so the step list and journey switcher are behind the reader (Shift+Tab). The per-step tab strip is one stop (radio group), then every push and hit `summary`. Works, with one trap-like problem: in the Network tab each request row exposes a "?" per parameter (`tabindex="0" role="note"`); an open GA4 request adds 12 stops, the three requests of step 1 add 22, the report holds 406. A keyboard user who opens a request has to tab through every tip to reach the next row.

Tabs are hash links, so every tab switch is a history entry; Back walks through tabs the reader visited, which surprises people expecting to leave the report.

### Heading order

Visible headings on the Overview: one (`h1` "Site localhost"). The card titles ("Summary", "Journeys", "This run", "Consent scenarios", "Consent", "Measurement plan coverage", "Tag inventory", "Providers") are `div.card-t`, invisible to heading navigation. In Findings the owner groups are `h3` under no `h2`. In Journeys: `h2` journey → `h3` step → `h5` "Parameters"/"Source"/"Items" (skips `h4`). Counts: 1 `h1`, 4 `h2`, 32 `h3`, 0 `h4`, 472 `h5`. A screen-reader user pressing H hears "Parameters, Parameters, Parameters…".

### Tables

209 tables, 0 captions, 0 `aria-label`, 0 `scope` attributes. The 5 data tables (`table.dt`) have a proper `thead`. The 203 key-value tables (`.ptable`) use `th` in `tbody` as row headers without `scope="row"`, acceptable for two-column tables but each needs a name (the parameter table of which hit?). The coverage table uses ✓ / ✗ / – glyphs, which screen readers announce as "check mark", "ballot x", "en dash"; "en dash" says nothing.

### Contrast of the severity badges (computed, WCAG 2.x formula)

| Element | Fg | Bg | Ratio | Needs | Result |
|---|---|---|---|---|---|
| Badge Broken, light | #C8323A | #FCE9EA | 4.53:1 | 4.5 | pass (by 0.03) |
| Badge Risk, light | #B8441A | #FFF0E8 | 4.87:1 | 4.5 | pass |
| Badge Warning, light | #8C6106 | #FBF1DC | 4.89:1 | 4.5 | pass |
| Badge OK, light | #17805A | #E3F3EC | 4.28:1 | 4.5 | FAIL |
| Badge Info, light | #2459C0 | #EBF1FE | 5.68:1 | 4.5 | pass |
| Badge Broken, dark | #F2545B | #3A1F22 | 4.43:1 | 4.5 | FAIL |
| Badge Risk, dark | #FF6D33 | #2A1A0F | 5.97:1 | 4.5 | pass |
| Badge Warning, dark | #E8B44A | #33290F | 7.55:1 | 4.5 | pass |
| Badge OK, dark | #3FB98A | #12302A | 5.75:1 | 4.5 | pass |
| Badge Info, dark | #8CBBFF | #1A2F5C | 6.65:1 | 4.5 | pass |
| Consent "granted" chip, light | #17805A | #E3F3EC | 4.28:1 | 4.5 | FAIL |
| Muted text 12 px on white | #5A6480 | #FFFFFF | 5.88:1 | 4.5 | pass |
| Warning dot on the event row | #C99A2E | #FFFFFF | 2.58:1 | 3.0 (non-text) | FAIL |
| Severity bar, Risk next to Broken | #B8441A | #C8323A | 1.02:1 | 3.0 (adjacent) | FAIL (legend saves it) |
| Severity bar, Warning next to Broken | #C99A2E | #C8323A | 2.05:1 | 3.0 | FAIL |
| "?" tip border, rest → focus | #848EA6 | #2E6CDB | 1.49:1 | 3.0 (state change) | FAIL |
| Focus outline on white / muted bg | #2E6CDB | #FFFFFF, #EEF2F8 | 4.90, 4.36 | 3.0 | pass |

Badges are 12 px at weight 500, so the 4.5:1 threshold applies, not the 3:1 large-text one. OK in light mode and Broken in dark mode fail; Broken in light mode passes by a hair and will fail the moment the background is tinted by the open-card gradient (`.finding>details[open]>summary` paints `--sev-bg` behind the badge area, which is the same colour, so it holds; any brand colour override will not).

### Focus visibility

Every focusable element in the walk had a visible outline (`13-focus-ring-findings.png`) except the "?" tips, whose focus style is `outline:none` plus a border colour change of 1.49:1 (`14-tooltip-keyboard.png`). The sticky top bar (56 px) can obscure a focused element at the top of the viewport; `scroll-padding-top:64px` prevents it for hash targets but not for Tab focus, so Shift+Tab backwards into a card can leave the focused row under the bar (WCAG 2.4.11).

### Screen-reader labels on icons

- All 500 inline SVGs are `aria-hidden="true"`; severity icons sit next to a text badge, chevrons are decorative. Good.
- Logos have `alt`; the footer logo link has `aria-label`. Good.
- Step list: the "has problems" dot is a `span` with only `title="Has problems"`; 9 of them, not announced by most screen readers. The platform dots in the step counts (36) have no text, so "2 1" is read without GA4/Meta.
- Timeline rows: the severity `span.tag` is `display:none`, so a closed flagged row is announced with no severity at all; the only cue is a 6 px coloured dot (2.58:1 for Warning).
- Scenario table: the bad cell is "1" in red and bold, no text, no `aria-label`.
- "?" tips: `role="note"` with `aria-label` holding the tip. The role is wrong for an interactive element and the `aria-label` replaces the visible "?" name; 406 of them.
- The top tab bar has no `aria-current`; the selected tab is only a colour and a border.
- 8 links open in a new tab (`target="_blank"`) without saying so.

### Zoom to 200 %

At 640 CSS px (1280 px window at 200 %) nothing overflows (`scrollWidth` 625 ≤ 640) in Findings or in a journey step. The two-column finding body and the step grid both collapse to one column. Pass (`15-zoom200-findings.png`, `16-zoom200-journey-step.png`).

### 390 px layout

- Overview and Findings: no horizontal overflow; the tab strip scrolls horizontally without a visible cue (`17-mobile-390-overview.png`, `18-mobile-390-findings.png`).
- Journeys: the page scrolls horizontally to 535 px. The step list (`.stepnav a` with `white-space:nowrap` counts) is 535 px wide and the per-step tab strip ("Timeline / Events / dataLayer / Network requests") is 518 px wide; the fourth tab is cut off at the viewport edge. Playwright could not click the Network tab at 390 px because the overflowing labels overlap each other (`19-mobile-390-journey-step11.png`).
- Order on mobile: scenarios card → journey switcher → consent card (10 entries) → full step list (434 px) → the step. Step 11's content starts 3,342 px down the page. A reader arriving from a finding chip lands on it via the hash, but anyone browsing scrolls through four screens of consent tiles.
- Key-value tables wrap long values (`overflow-wrap:anywhere`), the raw request `pre` wraps (`20-mobile-390-network-row.png`). Good.
- The consent scenario table at 390 px keeps its five columns inside a scrolling card; the tag column scrolls away with the rest, so the red "1" loses its row label (`21-mobile-390-scenarios.png`).
- Dark scheme renders correctly with no missing tokens (`22-dark-findings.png`); only the Broken badge contrast fails there.

### Print / PDF

`@media print` expands all 482 `<details>` and shows all tabs, journeys and steps: 90 A4 pages, 1.0 MB, for a four-journey demo. Nothing is omitted or summarised, external links lose their URLs, and the sticky nav is hidden so there is no table of contents.

### Other

- `lang="en"`, a descriptive `<title>`, `prefers-reduced-motion` honoured, landmarks `header / nav / main / footer` present.
- Finding cards, owner groups and hits have no `id`, so nothing below the step level can be linked to.
- No JavaScript at all: the report works from `file://` and in locked-down viewers. This is a real strength and the spec keeps it as the baseline.

## Summary of failures, ordered by reader impact

1. No impact or verdict without the AI; a first run reads as "4 numbers and a dead end" (M2, M1).
2. Positive results are invisible: nothing says what passed and where (M1, T2).
3. Steps hide their page URL and replay action; reproduction needs `capture.json` (D1, D2).
4. Consent scenarios show counts without reasons and live outside Findings (T3, T1).
5. Mobile Journeys overflow horizontally and bury the step under 3,000 px of context (390 px).
6. Keyboard: 406 "?" tab stops, no skip link, tooltip not dismissible, focus style on tips invisible.
7. Screen readers: card titles are not headings, h4 skipped, severity hidden on closed timeline rows, dots with `title` only, no `aria-current` on tabs, no table captions.
8. Contrast: OK badge (light) and Broken badge (dark) under 4.5:1; warning dot 2.58:1.
9. No permalinks or copy affordances for findings (M3).
10. Print produces 90 pages with every disclosure forced open.
