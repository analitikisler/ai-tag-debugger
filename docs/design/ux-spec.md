# Report information architecture and interaction spec

_Superseded by `directions/d-inspector/` (the report since 0.17.0). Kept as the record of the four-tab report's design._

This is the next report's structure, decided against the tasks in `ux-audit.md`. Where a choice trades something away, the trade is named. Assumptions that the Creative Director's brief (`report-brief.md`, written in parallel) may contradict are marked **CD assumption**.

## 1. Principles

1. The verdict is the product. A reader who sees only the first screen (or the first 40 lines of Markdown) must know whether the site passes, what is wrong, who fixes it, and what it costs. Everything else is evidence.
2. Every claim links to its evidence, and every piece of evidence links back to the claim. A finding is a pointer into the timeline, not a copy of it.
3. Positive results are results. A passing check is listed with what was seen, not implied by silence.
4. No JavaScript is required. The current report runs on `:target`, `:has()` and `<details>` and works from `file://`, in mail attachments and in locked-down viewers. The spec keeps that as the baseline and allows a small inline enhancement layer (text filter, copy buttons, URL-state for filters) that degrades to the CSS behaviour. **CD assumption**: the brief may ask for richer interaction; anything that only works with JS must have a static fallback.
5. One owner per finding, one fix per finding, one place to verify it.

## 2. Page skeleton

The page is one long document with a sticky in-page navigation, not a set of tabs. Trade-off: tabs keep the page short and feel like an app; sections keep Ctrl+F, print, screen-reader heading navigation and "scroll until you find it" working, and they stop the current problem where the consent table hides in a tab the reader never opens. The deep data (journeys, network) stays heavy, so those two sections use internal tabs where the alternatives are parallel and same-shaped (journey A / journey B, step 3 / step 4), and disclosures everywhere else.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ logo        SITE example.com   2026-10-19 · 4 journeys · 4 platforms  v0.16 │
│ Verdict · Priorities · Findings 4 · Journeys 4 · Consent · Inventory · Net… │ ← sticky nav
├──────────────────────────────────────────────────────────────────────────────┤
│ 1 VERDICT     ┌───────────────────────────────────────────────────────────┐  │
│               │ ● Purchase tracking is broken on mobile                   │  │
│               │ 2 broken · 1 risk · 1 warning   ·   4 checks passed       │  │
│               │ Changed since 2026-10-12: 1 fixed · 1 new · 2 still open  │  │
│               └───────────────────────────────────────────────────────────┘  │
│ 2 PRIORITIES  Developer (2) ──────── Tag Manager (2) ──────── Marketing (0)  │
│               1. purchase without      1. Meta PageView before   nothing     │
│                  value on mobile          consent (4 journeys)               │
│               2. Meta Purchase …       2. add_to_cart ×2 …                   │
│               [copy for developer]     [copy for tag manager]                │
│ 3 FINDINGS    filter: severity ▾ owner ▾ platform ▾ journey ▾   expand all   │
│               ┌ finding card ┐ ┌ finding card ┐ …   ▸ What passed (4)       │
│ 4 JOURNEYS    [browse·desktop][browse·mobile][checkout·desktop][checkout·m] │
│               step list │ step view (timeline ⇄ network)                     │
│ 5 CONSENT     Consent Mode timing · scenario table · cookies after reject    │
│ 6 INVENTORY   vendors · pages · cookies · plan coverage                      │
│ 7 NETWORK     one table, grouped by journey › step, filter box               │
│ 8 RUN FACTS   platforms, plan, AI, viewports, version, skipped requests      │
└──────────────────────────────────────────────────────────────────────────────┘
```

Order is by reader cost: the marketer stops after 2, the tag admin reads 3 and 5, the developer reads 3, 4 and 7. Run facts go last because they only matter when someone doubts the result.

### What is a section, a tab, a disclosure

| Pattern | Used for | Rule |
|---|---|---|
| Section (`<section>` with `h2`, in the sticky nav) | Verdict, Priorities, Findings, Journeys, Consent, Inventory, Network, Run facts | Always rendered, always printed, always findable with Ctrl+F. |
| Tab (radio + label, `:checked` CSS; `aria` roles added by the enhancement layer) | Journey switcher; the step's Timeline ⇄ Network toggle | Only for parallel, same-shaped alternatives of which exactly one is wanted at a time. Never for content the reader must not miss. |
| Disclosure (`<details>`) | Finding body, push/hit row, raw request, context parameters, item lists past 3, "What passed", consent updates past the first | Closed content must be summarised in its `summary` line so the reader can decide without opening. |
| Link + hash target | Step view (`#j2-s11`), hit row (`#j2-s11-h3`), network row (`#n-j2-41`) | Every hash is stable across runs of the same config so links survive re-runs. |

The current "Events" and "dataLayer" per-step tabs are removed: the Timeline already shows pushes and hits in order; a platform filter row on the timeline replaces the Events tab, and the push rows replace the dataLayer tab. Trade-off: a reader who wants only pushes clicks "dataLayer" in the filter row instead of a tab.

## 3. Verdict

One sentence, one colour, one number set. Deterministic text, chosen by rule:

- Broken > 0: "{Worst finding title} · {n} broken, {m} risk" (e.g. "Purchase tracking is broken on mobile").
- No broken, risk > 0: "Tracking works, but {n} consent or data risks need fixing".
- Only warnings: "Tracking works; {n} things to tidy".
- Nothing: "All {k} checks passed on {j} journeys".

Below it: counts as text, not tiles (tiles cost 25 % of the first screen for four numbers); the "changed since last run" line when a previous run exists; the AI headline when present, labelled "AI summary" and visibly secondary to the deterministic sentence. Trade-off: the AI headline is often the best sentence on the page, but it is absent on `--no-ai` runs and must not be the only verdict.

## 4. Priorities by owner

Three columns (one per `OWNERS` entry), each a numbered list of the owner's findings sorted by severity then by spread (journeys × steps), max 5, each item one line: severity dot, title, where in short form ("checkout · mobile · step 11"). Each column has "Copy for {owner}" which copies a Markdown block (title, where, evidence line, fix steps, verify link, permalink) for that owner. Empty column: "Nothing for {owner}" so the owner who opens the report sees they are done.

## 5. Finding card anatomy

```
┌─[id f-ga4-purchase-missing_params]──────────────────────────────────────────┐
│ ⊗ BROKEN  purchase was sent without value and currency          Developer   │
│    GA4 · checkout · mobile · step 11 "Place the order" · thanks.html        │
│    Impact: GA4 reports 0 revenue for mobile orders; Google Ads gets no       │
│    value to bid on.                                           [▾ details]  │
├────────────────────────────────────────────────────────────────────────────┤
│ WHERE                     │ EVIDENCE  (hit at +6.9s → timeline row ↗)       │
│  11 checkout · mobile     │  page_location  http://…/thanks.html             │
│     Place the order       │  transaction_id T1792391968794                   │
│     thanks.html           │  items          1 (Basic Tee 19.9 × 1)           │
│  Also fine on:            │  value          — missing                        │
│  11 checkout · desktop ✓  │  currency       — missing                        │
│                           │  dataLayer push ↗  network row ↗  copy          │
│ CAUSE                     │ FIX                                              │
│  The purchase push on the │  1. In the thanks-page push add ecommerce.value  │
│  mobile template has no   │     (order total) and ecommerce.currency.        │
│  value/currency keys.     │  2. Re-run: aitd --journeys checkout             │
│  (AI, or template text)   │  HOW TO VERIFY  Tag Assistant · GA4 DebugView    │
│ GTM TAGS (when container) │  "GA4 – purchase" fires on Custom Event purchase │
└────────────────────────────────────────────────────────────────────────────┘
```

Required fields, in this order, every one present (with "—" when unknown, never omitted silently):

| Field | Source | Rule |
|---|---|---|
| Severity + title | `finding.detail` | Title in plain words; event and parameter names in `<code>`. Viewport in the title when the finding is viewport-specific ("…on mobile"). |
| Owner | `ownerOf(finding)` | Badge on the card and group heading. |
| Where | `finding.where[]` + `steps[].pagePath` | Journey, viewport, step number and label, page path. One chip per place, each a link to the step. When the same check passed elsewhere, list it under "Also fine on" so the reader sees the contrast (M1). |
| Impact | template per `check`, overridden by AI `impact` | Deterministic sentence for every check (missing_params, duplicate, before_consent, …). Never "run without --no-ai". |
| Evidence | `finding.evidence` or the matched hit/push | Key-value table of the hit; expected-but-missing keys appear as rows marked "missing". Links: timeline row of the hit, the push behind it, the network row. |
| Cause | AI `likely_cause` or template | Template when no AI, flagged "typical cause" so it is not mistaken for a diagnosis. |
| Fix steps | AI `fix_steps` or template | Numbered; last step is always how to re-run only this journey. |
| GTM tags | `finding.gtm` | When a container was given; otherwise one line "Add a GTM container export to name the tag" (T1). |
| How to verify | `verifyLinks(finding)` | Tool links; external links say "opens in a new tab". |
| Permalink + copy | card `id` | `id` is `f-{platform}-{event}-{check}` (deduplicated with a counter), stable across runs. Copy produces the Markdown block of §4. |

Severity badge text is always visible, never colour only, and the card's left border carries the severity colour for scanning.

## 6. Filters and sorting

- Default sort: severity (broken → risk → warning → info), then owner (developer, gtm, marketing), then spread descending. Within an owner group on the page the order is severity then spread.
- Filters: severity, owner, platform, journey (each a chip row; multiple selection). Platform and journey chips appear only when the report has more than one of them.
- Default state: all problems shown; OK findings are under a closed "What passed (n)" disclosure at the end of the section, listed one line each with where and what was seen.
- CSS fallback: severity and owner filters stay as radio groups (as today); platform and journey filters need the enhancement layer and are hidden without it.
- Filter state is written to the URL hash (`#findings?sev=broken&owner=developer`) by the enhancement layer so a filtered view can be shared; the static page ignores the query and shows everything, which is the safe fallback.

## 7. Progressive disclosure rules

| Collapsed by default | Why |
|---|---|
| Finding body, except the first card of the highest-severity owner group | The summary line already carries severity, title, where and impact; opening is for the fixer. |
| Push row body, hit row body (except hits with a finding, which open) | Same as today; the open flagged row is the thing the chip link points at. |
| Context parameters of a request | They are session/device noise for every task in the audit. |
| Raw request / raw push JSON | Only the developer wants it, and only after the decoded table did not answer. |
| Items beyond the first 3 | Lists of 20 items from `view_item_list` push the next hit off-screen. |
| Consent updates after the first default+update pair of a journey | The repeated pair on every page load is expected; the first pair and any pair that differs are what matter. Different pairs are opened and flagged. |
| "What passed" | Positive results are listed but out of the way. |
| Steps with no hits and no pushes ("Fill in name") | Shown as a thin row in the step list, no detail panel. |

Never collapsed: the verdict, the priorities, the consent timing sentence, the scenario table, the step list.

## 8. Cross-links

```
finding card ──where chip──▶ step view (#j3-s11)
     │                          │
     │ evidence "hit ↗"         ├──▶ hit row (#j3-s11-h2)  ──"network ↗"──▶ network row (#n-j3-77)
     │                          │        ▲ "finding ↗" ◀──────────────────────────┘ "hit ↗"
     └──"push ↗"──────────────▶ push row (#j3-s11-p4)
step view header: "2 findings in this step ↗" ──▶ findings filtered to that step
network row: "step 11 ↗" ──▶ step view
```

Every id is derived from stable keys (journey id, viewport, step index, ordinal within the step), never from timestamps.

## 9. Empty and all-good states

A passing report must still read as a result:

```
┌ VERDICT ────────────────────────────────────────────────────────────────┐
│ ✓ All 9 checks passed on 4 journeys                                     │
│ 38 events seen across GA4 and Meta · consent default before first hit   │
│ on every journey · nothing fired after reject all                       │
├ WHAT WAS CHECKED ───────────────────────────────────────────────────────┤
│ ✓ Purchase value and currency     checkout · desktop, mobile            │
│ ✓ Duplicates                      38 hits, none repeated                │
│ ✓ Consent before first tag        4 journeys                            │
│ …                                                                       │
├ NOT CHECKED ────────────────────────────────────────────────────────────┤
│ – Planned events (no measurement plan given)         how to add one ↗   │
│ – Analytics-only consent (banner has no such choice)                    │
│ – GTM tag names (no container export given)          how to add one ↗   │
└─────────────────────────────────────────────────────────────────────────┘
```

Empty sections never render an empty card: no findings → the Findings section is the "What was checked" list; no previous run → the change line says "First run; later runs will show what changed"; no network rows for a platform → that platform is absent from the filter.

## 10. "Changed since last run"

One line in the verdict ("Since 2026-10-12: 1 fixed · 1 new · 2 still open"), a `Changes` disclosure under it with three short lists (fixed, new, still open; each item is a finding title linking to its card), and a chip on each finding card: "new", "since {date}" (still open) or, in What passed, "fixed". Route changes ("checkout · mobile now ends on /thanks-v2") go in the same disclosure. Trade-off: no full diff view; the lists plus per-card chips cover the "what changed" question without a second report layout.

## 11. Consent section

Three parts, in this order, because the tag admin's questions come in this order (T2, T1, T3):

1. **Timing sentence per journey**: "Consent Mode default (all denied) at +0.20s, 10 ms before the first tag request (GA4 page_view, gcs=G100). Updated to all granted at +1.1s after 'Accept cookies'." Computed from the first consent push and the first hit of the journey. When the default is missing or late, this sentence is the finding's evidence and links to it.
2. **Scenario table**, redesigned:

```
Tag               Before any choice   Accept all    Reject all              Analytics only
GA4 page_view     1 · cookieless ✓    1 ✓           1 · cookieless ✓        not run (banner has
GA4 view_item_lst 1 · cookieless ✓    1 ✓           1 · cookieless ✓        no such choice)
Meta PageView     1 ✗ before consent  1 ✓           1 ✗ should not send
                                                    → finding f-meta-… ↗
legend: ✓ allowed · ✗ should not have been sent · "cookieless" = Consent Mode ping with storage denied
```

Each cell carries count, a glyph, and the reason (cookieless / ad storage denied / sent with cookies), so the GA4 "1" and the Meta "1" stop looking alike. Bad cells link to the finding; the finding links back. Columns that were not run say why. On mobile the first column is sticky.

3. **After reject**: cookies and requests seen after the reject journey (when one ran), as a short list; otherwise one line pointing at the `decline_cookies` journey.

## 12. Journeys and the step view

```
┌ JOURNEYS ─ [browse · desktop 2] [browse · mobile 2] [checkout · desktop 2] [checkout · mobile 4] ┐
│ checkout · mobile  ✓ completed · 11 steps · 20 hits · 2 findings   consent: default +0.2s ✓     │
│ ┌ steps ───────────┐ ┌ 11  Place the order ─────────────────────────────── +6.7s ───────────┐   │
│ │ 1 Open /     ●   │ │ page http://localhost:4321/thanks.html   click #place-order              │   │
│ │ 2 Accept cookies │ │ 2 findings in this step ↗     [timeline] [network 4]   filter: GA4 Meta  │   │
│ │ 3 Open product   │ │ ○ +6.8s  consent default → update                                  ▸   │   │
│ │ 4 Add to cart ●  │ │ ○ +6.9s  push purchase  1 item · transaction T1792…    missing: value,   │   │
│ │ 5 Open the cart  │ │          ├ GA4 purchase  BROKEN  value — currency —  → finding ↗  ▾      │   │
│ │ 6 Go to checkout │ │          │   page_location  http://…/thanks.html                         │   │
│ │ 7–10 form (no    │ │          │   transaction_id T1792391968794                                │   │
│ │      events)     │ │          │   value          — missing                                     │   │
│ │ 11 Place order ● │ │          │   request POST region1.google-analytics.com/g/collect 204 ↗    │   │
│ └──────────────────┘ │          └ Meta Purchase  BROKEN  value — currency —  → finding ↗  ▸      │   │
│                      │ ○ +6.9s  GA4 page_view · Meta PageView (no push)                      ▸   │   │
│                      └──────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Step header: number, label, time, page path, replay action (`click #place-order`, `goto /…`), hits and pushes count, "n findings in this step" link. The page path and the replay action are the two fields D1 and D2 needed.
- Step list: steps with nothing to show are merged into one thin row ("7–10 form, no events"). Flagged steps show a severity dot and the word, not a dot alone.
- Timeline: pushes with their hits nested, time-ordered; hits without a push under "no push". A hit row's summary shows platform, event, severity text, and the headline values (value, currency, items); expected-but-missing parameters appear in the summary as "value —".
- Network toggle shows the same step's requests (see §13) in place, same filter row.
- The journey's consent card shrinks to one line in the journey header; the full list lives in Consent.

## 13. Network: the long-table strategy

One table for the whole report (section 7), rows grouped by journey then step; the step view's "network" toggle shows the same rows scoped to that step (the same DOM, moved by CSS, or duplicated when the enhancement layer is absent; the engineer chooses, the content must be identical).

- Sticky header row and sticky group header (journey › step › page path).
- Groups collapsed by default except steps with a finding; "expand all" per journey.
- Columns: time, platform, event, method, host + path (truncated at 48 chars with a full-width expand), status, flag. Fixed widths so the eye can scan one column.
- Filter box (enhancement layer): free text over platform, event, URL and status; plus chips for platform, method, status class and "flagged only". CSS fallback: the platform radio filter as today.
- Row body (disclosure): event parameters with "?" tips, then "Context parameters (n)" closed, then items, then "Raw request" closed. Values over 200 characters are clipped with an expand control.
- Cap: 500 rendered rows per report; beyond that, the oldest journeys are summarised ("checkout · desktop: 120 requests, 0 flagged; full list in timeline.csv") and a count is shown. Trade-off: the HTML stops growing without bound, the CSV stays complete.
- "?" tips become non-focusable; the tip text is also written into a visually hidden element inside the parameter cell so screen readers get it without a tab stop (fixes the 406-stop problem).

## 14. Mobile behaviour (≤ 600 px)

- Sticky nav becomes a single "Sections ▾" `<details>` menu at the top; the verdict stays above it.
- Priorities columns stack; "Copy for…" stays.
- Finding cards: Where chips wrap; the two-column body stacks (as today).
- Journeys: the step list becomes a horizontal, scrollable strip of numbered chips pinned under the nav; the selected step's label is shown next to it. The step view follows immediately, never 3,000 px down.
- Timeline ⇄ Network toggle wraps to two lines; nothing is `white-space:nowrap` except numbers.
- Tables wider than the viewport scroll inside their card with the first column sticky; the page never scrolls horizontally (acceptance test in `a11y-checklist.md`).
- Tap targets are at least 24 × 24 CSS px; chips and chevrons get padding to reach it.

## 15. Print and PDF

`@media print` produces a document, not a dump:

- Printed in full: verdict, priorities, every finding card expanded (impact, evidence, fix, where, verify with URLs after the link text), consent section, inventory, run facts.
- Printed as a summary: journeys as one table per run (step, page, hits with severity text, pushes count), no row bodies.
- Not printed: network section (one line "Requests: see timeline.csv"), raw JSON, context parameters, "?" tips, filters, copy buttons, nav.
- A page break before each `h2`; cards `break-inside: avoid`; a running header with site and date via `@page` margins where supported.
- Target: the sample prints in under 12 pages (today: 90).

## 16. Markdown report

`report.md` is the version most people see (PR comment, Slack message, mail). Its structure is in `md-report-spec.md`; the rules that matter here: verdict first; priorities by owner before findings; max 5 full finding blocks, the rest as one-line items; the consent table with glyphs; "what passed" as one line per check; no timeline dump (it moves to `timeline.csv`); a link to the HTML report; total under 120 lines and 8 KB, with the first 40 lines self-sufficient so a Slack preview tells the story.

## 17. Accessibility commitments

All items in `a11y-checklist.md` are acceptance criteria. The ones that change the design: card titles are real headings (`h2` sections, `h3` groups, `h4` cards, `h5` inside cards); severity is always text; the selected tab and the selected step carry `aria-current`; a skip link to the verdict; tips do not take focus; badges meet 4.5:1 in both schemes (OK light and Broken dark need new values); the Journeys section cannot scroll the page horizontally at 320 px.

## 18. Open points for the lead to reconcile with the brief

- **CD assumption 1**: the brief may keep the four top-level tabs. This spec replaces them with sections plus a sticky nav; if tabs stay, the Consent scenario table and the "What passed" list must move to Findings regardless.
- **CD assumption 2**: the brief may want the metric tiles. This spec demotes them to a text line under the verdict sentence.
- **CD assumption 3**: the brief may define the palette; the two failing badge contrasts and the warning dot need new values whichever palette wins.
- **CD assumption 4**: the enhancement JS layer. If the brief or the lead keeps zero-JS, the filter box, URL filter state and copy buttons are dropped and everything else in this spec still holds.
- Templated impact/cause/fix text per check needs copy from whoever owns `checks.js`; the spec assumes it exists for every check that can produce a broken or risk finding.
