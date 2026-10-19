# Reference UX: how practitioners' tools present tracking QA

Research notes for the report redesign. Scope: the tools the three readers of our
HTML report already use (a marketer who owns the ad budget, a developer who fixes
the dataLayer, a GTM admin), and the single-file reports people hold up as good.
Each tool gets its layout model, what its first screen shows, how deep the "why"
sits, and what it does badly. The synthesis maps every pattern onto our data:
verdict, findings by owner, journeys with steps and hits, consent scenarios,
coverage, inventory and trend. Direct page loads were blocked from the research
environment, so quotes come from indexed excerpts of the cited pages and from
reviews and blog posts that describe screenshots; labels marked "(secondary)" were
not confirmed against the vendor's own page.

Today (`src/report.js`): tabs Overview (severity counters, model summary, journey
table, run card), Findings (owner groups as open accordions), Journeys (consent
scenarios, one tab per journey, steps with a Timeline / Events / dataLayer / Network
control) and Scope (coverage, inventory, providers), all CSS-only via `:target`.

## 1. Google Tag Assistant (tagassistant.google.com, Tag Assistant Companion)

- Layout model: left rail timeline, right detail. The left column lists events
  "numbered in firing order" per page load (Consent Initialization, Container
  Loaded, DOM Ready, custom events); the right pane switches with tabs Summary,
  Tags, Variables, Data Layer, Consent, Errors. Source: Google, "Find your way
  around Tag Assistant" and "Preview and debug containers",
  https://support.google.com/tagmanager/answer/15212503,
  https://support.google.com/tagmanager/answer/6107056.
- First screen: "Summary" for the whole page load. "Tags Fired" and "Tags Not
  Fired" are two sections, so the absent tag is a first-class row, not a gap.
  Source: https://support.google.com/tagassistant/answer/10039345.
- The "why" is one click deep: a tag's detail shows "Firing Triggers" and
  "Blocking Triggers", with a failed condition marked with a cross; a consent-
  blocked tag shows a "Required Additional Consent" section (secondary:
  https://www.analyticsmania.com/post/google-tag-manager-debug-mode/,
  https://www.lovesdata.com/blog/troubleshooting-consent-mode/).
- "What was sent" and "why" are separated by tab: the Output section "will show
  where hits were sent, updates to the data layer, and any errors"; the Consent tab
  shows the state per type (ad_storage, analytics_storage) at each timeline point,
  so "fired before update" is visible as "default denied" on that event. Source:
  https://developers.google.com/tag-platform/security/guides/consent-debugging.
- Does badly: only Google tags; state lives in a browser session, nothing to hand
  to a colleague; the timeline grows to dozens of rows per page and offers no
  filter; a tag's reason needs three clicks (event, Tags, tag). Guides warn that
  Tag Assistant says "a tag fired" while DebugView shows what GA4 received
  (https://piotrlitwa.com/articles/en/ga4-debug-mode.html).

## 2. Analytics Debugger (David Vallejo, analytics-debugger.com)

- Layout model: a DevTools panel with one tab per vendor ("20+ vendors supported",
  GA4, UA, Adobe, GTM, gtag, Tealium, Launch); inside a vendor tab, a request list
  with a decoded detail per request. Source:
  https://analytics-debugger.com/tools/analytics-debugger-extension/.
- First screen: the vendor tab you enabled, a chronological list of hits with the
  event name and the decoded parameters below; the settings screen is where you
  "pick which vendors to display" (secondary:
  https://measureschool.com/google-tag-manager-extensions/).
- Parameters are flattened into one key/value table with human names; GA4 items
  get a dedicated "GA4 items report" and reports carry a "PII alert icon".
  Source: https://github.com/analytics-debugger/analytics-debugger-browser-extension.
- The "why" is absent by design: it shows exactly what left the browser and nothing
  about intent. Its value is the per-vendor table, not an opinion.
- Does badly: one vendor at a time, so a journey that mixes GA4 and Meta needs tab
  hopping; the repository has not changed in about three years (same source);
  everything is live and lost on reload.

## 3. Pixel helpers, Omnibug, dataslayer, GA Debugger

- Meta Pixel Helper: a popup listing pixels, then events per pixel, with inline
  yellow warnings and red errors ("Pixel Activated Multiple Times", "Invalid Pixel
  ID"); each error has a sentence of cause and a fix. Source:
  https://developers.facebook.com/docs/meta-pixel/support/pixel-helper. Badly: it
  sees browser-side firing only, and vendors document false warnings
  (https://www.pixelyoursite.com/contact); nothing about consent.
- TikTok Pixel Helper: diagnostics "at all levels including pixel, event, and
  parameter", and a troubleshooting table organised by that level. Source:
  https://ads.tiktok.com/help/article/tiktok-pixel-helper-2.0. Badly: a Shopify
  thread shows it reporting no issues while Ads Manager flagged a missing `value`
  (https://community.shopify.com/t/how-to-fix-missing-value-parameter-issue-in-tiktok-pixel/269316).
- Omnibug: a DevTools panel where requests are "grouped by the marketing platform"
  with a status indicator, and clicking one "decodes the long, messy URL into a
  clean, readable list of parameters"; filters by provider and account; CSV/JSON
  export. Sources: https://addons.mozilla.org/firefox/addon/omnibug/,
  https://www.trackingplan.com/blog/omnibug-chrome-extension. Badly: no
  warnings at all, no dataLayer, no ordering against consent.
- dataslayer: "a page group and URL for each pageload", each dataLayer push nested
  beneath it, the TMS container ID as a dropdown when several exist. Source:
  https://github.com/ofhope/dataslayer. Badly: a store review reports "false
  results"; GTM tags are not linked to the push that triggered them.
- Google Analytics Debugger prints "a detailed breakdown of each tracking beacon"
  to the console, a list with no detail pane at all
  (https://chrome.google.com/webstore/detail/google-analytics-debugger/jnkmfdileelhofjcijamephohjechhna).
- Shared pattern across the group: compact list, one row per hit or event, status
  colour on the row, detail on expand, warning text inline next to the event it
  concerns. None of them persists a run or compares two runs.

## 4. Governance tools: ObservePoint, Trackingplan, Tag Inspector

- ObservePoint Audit Summary: one "Audit Score" out of 100 built from named factors
  with points each ("Tag Presence (30 points)", "Rules (30 points)", tag
  performance, page performance, cookies); the top band shows pages scanned,
  primary tags present, rules applied; "trend sparklines" for tag counts, broken
  tags and broken pages, and clicking a sparkline opens earlier runs. Sources:
  https://help.observepoint.com/en/articles/9084064-audit-summary-report,
  https://help.observepoint.com/en/articles/9101703-audit-score.
- ObservePoint rules: the Rule Summary counts failed, passed and "not applied"
  rules and pages, filterable by page and status, so the same violations can be
  read by rule or by page. Source:
  https://api-docs.observepoint.com/openapi/reporting-api.openapi/rule-summary-report.
  Badly: the score formula is opaque to a marketer ("failing pages divided by pages
  scanned, scaled to 30") and the summary is a dashboard, not a verdict.
- Trackingplan: warnings carry a type (traffic, anomaly, KPI, specification,
  consent, destination), a status (ongoing, muted, resolved) and, in the Data
  Explorer, "a clear warning status (yellow or green), the percentage of hits
  affected, and a quick tooltip summary". Its Debug Warning View ranks the
  suspected fields High/Medium/Low by how often they co-occur with the warning, and
  a "Warning Analysis" tab gives plain-language cause and recommendation with
  copy-to-clipboard for tickets. Sources:
  https://docs.trackingplan.com/warning-management,
  https://www.trackingplan.com/changelog/data-quality-warnings-now-in-data-explorer,
  https://www.trackingplan.com/changelog/trackingplans-ai-debugger. Badly: cause
  and evidence are on different screens; the daily digest is the only overview.
- Tag Inspector (InfoTrust): the Scan Overview gives pages scanned, tags found,
  times and options; the "tag hierarchy" draws which tags load from source and
  which piggyback; Tag Details lists each tag with how many pages it appeared on
  and a load-path snippet; reports share as a view-only link or CSV. Source:
  https://infotrust.com/faq/what-information-is-in-the-scan-report-from-tag-inspector/.
  Badly: the hierarchy hides tags under 1% presence, and there is no verdict.

## 5. Single-file HTML reports people like

- Lighthouse: category score gauges on top (0-44 red, 45-74 orange, 75-100 green),
  then per category Metrics, Insights/Opportunities, Diagnostics, "Passed audits"
  collapsed with a count, "Not applicable" and manual checks; each audit is an
  accordion with a one-line title, a short description and "Learn more". Sources:
  https://github.com/GoogleChrome/lighthouse/blob/main/docs/understanding-results.md,
  https://www.debugbear.com/blog/lighthouse-accessibility. Badly: a forum user
  describes clicking the gauge, then scrolling, repeatedly, and no way back to
  "all" after a filter without reloading
  (https://community.mainwp.com/t/lighthouse-extension-beta-release/4094).
- Playwright HTML report: test list grouped by file, filter chips Passed / Failed /
  Flaky / Skipped with counts plus search, "Click a test to inspect errors,
  attachments and steps", the trace one click away. Source:
  https://playwright.dev/docs/running-tests and
  https://playwright.dev/docs/test-reporters. Badly: no aggregation across runs
  without a third-party service (https://currents.dev/posts/playwright-html-reporter-why-it-breaks-down-at-scale).
- Allure: Overview widgets (statistics, history trend, categories, environment),
  then trees by Suites, Behaviors or Packages with a detail panel; Categories group
  failures by defect type; a test page has Retries and History tabs; a
  `--single-file` option exists. Sources: https://allurereport.org/docs/v3/navigation/,
  https://allurereport.org/docs/history-and-retries/,
  https://allurereport.org/docs/v3/view-report/. Badly: five trees of the same
  data; the first screen is charts, not the broken thing.
- Cypress Cloud: a header with counts for flaky, skipped, pending, passed, failed,
  and "clicking any of these takes you to the Test Results tab with results
  filtered by the clicked status"; an Errors tab that "shows the error message
  once, then lists every test attempt where that error occurred", on the argument
  that "forty failing tests with the same error message means one problem to fix".
  Sources: https://docs.cypress.io/cloud/features/recorded-runs,
  https://www.cypress.io/blog/how-the-cypress-cloud-errors-tab-helps-you-triage-faster.
- axe DevTools: a left summary with counts by impact (critical, serious, moderate,
  minor) and a separate "needs review" bucket for what the tool cannot decide;
  issues grouped by rule; the detail has a "Highlight" button that marks the
  element on the page and a code snippet with an inspect shortcut. Sources:
  https://accessibility.umich.edu/training/axe-devtools-testing,
  https://www.deque.com/blog/upgrade-accessibility-testing-axe-extension-3-0/.
- PageSpeed Insights: the Core Web Vitals assessment ("Passed" / "Failed") sits
  above the fold with the field metrics; lab data and "Diagnose performance
  issues" sit below, separated from real-user data. Badly: mobile and desktop are
  two reports with no diff. Sources: https://developers.google.com/speed/docs/insights/v5/about,
  https://web.dev/whats-new-pagespeed-insights.

## Patterns worth borrowing

1. Verdict above the fold, evidence below (PageSpeed Insights). Solves: the
   marketer wants one sentence. Mapping: the summary headline plus the
   broken/risk/warning counters become a single verdict strip ("Not ready: 2
   broken, 1 risk") with the ad-spend impact line; everything else is below or on
   another tab.
2. Counters are filters (Cypress Cloud header, Playwright chips). Solves: counters
   that only inform waste the click. Mapping: each severity counter and each owner
   name links to the Findings tab pre-filtered (`#findings-broken`,
   `#findings-developer`), which our `:target` CSS can already do.
3. Group by error, not by occurrence (Cypress Errors tab, Allure Categories).
   Solves: ten steps missing `value` is one fix. Mapping: `groupFindings` already
   folds occurrences into one finding with `where[]`; show the count of steps
   and journeys on the summary line, occurrences inside.
4. "Fired" and "not fired" are both rows, with the reason one click away (Tag
   Assistant Tags Fired / Tags Not Fired, Firing and Blocking Triggers). Mapping:
   the coverage matrix row for a missing event links straight to the step where it
   was expected, and the finding card names the trigger or consent type that
   blocked it, in the GTM admin's vocabulary.
5. Consent state as a column on the timeline (Tag Assistant Consent tab). Solves:
   "fired before consent" needs no prose when every hit row shows
   ad_storage/analytics_storage at that instant. Mapping: `c.consent` is already
   captured per hit; render it as a two-letter chip on the Timeline row and make the
   scenario table cells link to the hit list filtered to that scenario.
6. Passed and not-applicable collapsed with a count (Lighthouse "Passed audits",
   ObservePoint "not applied", axe "needs review"). Solves: OK rows push problems
   off screen. Mapping: `ok` findings and `not_checked` coverage rows fold into
   one line each ("14 checks passed", "3 events not checked: Meta not in scope").
7. Highlight affordance (axe "Highlight", Cypress Test Replay from the error row).
   Solves: the developer needs the exact push, not a description. Mapping: each
   finding's evidence table links to the step anchor and opens that hit's
   accordion; the step list marks flagged steps with the severity colour.
8. Score factors named with their points (ObservePoint Audit Score). Solves: a
   bare score is argued with; named factors are acted on. Mapping: if we ever add
   a score, show "Plan coverage 11/14, Consent 2/3, Hygiene 4/4" and link each to
   its tab; otherwise keep the verdict words and skip the number.
9. Decoded parameter table with glossary tooltips and a separate items table
   (Analytics Debugger, Omnibug). Mapping: we have `paramRows` with tips and
   `itemsBlock`; keep them, but default-collapse the session/device/page context
   block so the event parameters are the first thing in an opened hit.
10. Trend as a sparkline that opens earlier runs (ObservePoint, Allure history).
    Mapping: `changes` (fixed / new since the previous run) belongs in the verdict
    strip as "2 fixed, 1 new since 2026-10-16", linking to the changes card;
    `history.json` can feed a tiny per-journey pass/fail strip later.

## Patterns to avoid

- Vendor-per-tab as the primary axis (Analytics Debugger). A journey step mixes
  GA4, Ads and Meta; splitting by vendor hides the ordering between them. Keep
  vendor as a filter chip on the step timeline, not a tab.
- Gauges and pie charts before the problem (Allure Overview, Lighthouse gauges on a
  one-category report). A 0-100 score invites debate about the formula; our checks
  are deterministic pass/fail, so counts and words are more honest.
- Several trees over the same results (Allure Suites / Behaviors / Packages).
  Readers lose track of which view they are in. We have one grouping per tab:
  owner on Findings, journey on Journeys, event on Scope.
- Unbounded timeline with no filter (Tag Assistant left rail, dataslayer page
  groups). A ten-step journey yields hundreds of rows; the step list must stay a
  list of steps, with hits only inside the chosen step.
- Cause and evidence on different screens (Trackingplan Warning Analysis vs
  Debug Warning View). Our finding card keeps `evidence`, `likely_cause` and
  `fix_steps` together; do not split them into tabs.
- Live-only state (every extension). Our report is a file; every view must be a
  URL so it can be pasted in a ticket, which the hash-driven tabs already allow.
- Filter without a way back (Lighthouse chips per the forum complaint). Every
  filter needs an "All" chip and the unfiltered state must be the plain tab URL.
- Treating "fired" as success (Pixel helpers). A hit that fired before consent or
  with an empty `value` is a failure row, with the same colour as a missing hit.

## Proposal: a layout that minimises scrolling

Model: verdict strip, then three tabs that each fit one screen before scrolling,
each tab a list-to-detail pair where the list is short and the detail is the thing
that scrolls. Tabs: Fix it (findings by owner), Journeys (steps and hits), Plan
(coverage, consent scenarios, inventory). Overview disappears; its content becomes
the strip.

```
+------------------------------------------------------------------------------+
| example.com  run 2026-10-19_0912  [EN|TR]                      prev run 10-16 |
| NOT READY FOR SPEND   2 broken  1 risk  3 warning  14 ok   | 2 fixed  1 new  |
| "purchase reaches GA4 but Google Ads sees no value; Meta fires before consent"|
| Developer 2  Tag Manager 1  Marketing 0        (each count is a filter link)  |
+------------------------------------------------------------------------------+
| [Fix it 3]      [Journeys 2]      [Plan 14/17]                                |
+----------------------------+-------------------------------------------------+
| Fix it (owner groups)      | Finding detail                                  |
| Developer                  | BROKEN  purchase: value missing  (2 steps, 1 j) |
|  > purchase value missing  | Where: checkout/thank-you +70.4s  [open hit]    |
|    dataLayer `ecommerce`   | Evidence: table of captured params              |
| Tag Manager                | Likely cause / Fix steps / Verify in GTM (link) |
|  > Meta fires on denied    | Consent at that hit: ad_storage=denied          |
| Marketing (none)           |                                                 |
| 14 passed (collapsed)      |                                                 |
+----------------------------+-------------------------------------------------+
| Journeys: [checkout·mobile 2] [browse·desktop 0]   chips: GA4 Ads Meta  All  |
| Steps (left)               | Step 4: Click "Pay"  3 hits  2 pushes           |
|  1 Home             ok     | Timeline | Events | dataLayer | Network         |
|  2 Product          ok     |  +69.9s dataLayer purchase        [AD gr AN gr] |
|  3 Cart             warn   |  +70.4s GA4 purchase  value=–   BROKEN  [AD gr] |
|  4 Pay              broken |  +70.5s Meta Purchase          RISK   [AD de]   |
+----------------------------+-------------------------------------------------+
| Plan: coverage matrix (event x journey, ✓ ✗ –, ✗ links to the step)          |
|       consent scenarios (cells link to filtered hits) · inventory · providers|
+------------------------------------------------------------------------------+
```

Reading paths per reader:

- Marketer: strip only: verdict words, headline, ad-spend line, "fixed / new".
- Developer: strip, "Developer 2" link, Fix it tab with the Developer group open and
  the others collapsed, "open hit" to the exact push in Journeys.
- GTM admin: strip, "Tag Manager 1", finding with the trigger or consent type named,
  the "Verify in GTM" link from `src/verify.js`, the consent chips on the timeline.

All of this stays CSS-only: anchors per owner and severity, `:target` for the
detail pane on wide screens, stacked on phones; the "passed" fold is one `<details>`.

## Open questions for the designers

1. On a phone, does list-to-detail collapse to accordions (current behaviour) or to
   a drill-in with a back link? Accordions keep every view a URL; drill-in reads
   better but needs a visible way back.
2. Should the verdict be a word ("Not ready for spend" / "Ready with warnings" /
   "Ready") or a 0-100 number? The research says words plus named factors beat a
   score, but a number is what ObservePoint-trained teams trend over time.
3. Where does the plan-versus-site coverage live when a run has no plan: hidden,
   or replaced by "unplanned events seen" as a prompt to make one?
