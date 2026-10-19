# Report metrics

`src/metrics.js` turns a capture (`{ plan, runs, findings, consentScenarios }`, as `writeReports` in
`src/audit.js` writes it to `capture.json`) into numbers the report can show. Every function is pure:
no I/O, no AI, no HTML, deterministic for the same capture. `computeMetrics(capture)` runs them all.

The examples below are computed from the demo shop run in `test/fixtures/demo-capture.json`: two
journeys (`browse`, `checkout`) in two viewports, a plan of 11 events with Consent Mode, and consent
scenarios on the start page. In that run every planned event fires, but the mobile checkout sends both
purchases without `value` and `currency`, GA4 `add_to_cart` fires twice per click, and Meta's `PageView`
fires before consent and again after "reject all".

## Verdict

`verdict({ findings, runs })` → `{ status, headline, counts, journeys, problems }`

**Rule, in order.** Nothing to judge (no runs and no findings) → `attention`. Any broken finding →
`fail`. Any journey that did not complete → `fail`. Any risk → `attention`. Any warning → `attention`.
Runs that captured no hit at all → `attention`. Otherwise `pass`. Info and ok findings never change it.

`counts` are over distinct problems (`groupFindings`: the same finding on desktop and mobile is one),
which is how the report's overview already counts them. `headline` is a key for the renderer's texts:
`fail_broken`, `fail_incomplete`, `attention_risk`, `attention_warning`, `attention_no_hits`,
`attention_nothing_tested`, `pass`.

**Demo.** `fail` / `fail_broken`; counts broken 2, risk 1, warning 1, ok 4; 4 of 4 journeys
completed; 4 problems.

**How to read it.** A `fail` means at least one number a marketer relies on is wrong or missing, or
the tool could not get to the end of a journey (so it cannot vouch for what comes after). `attention`
means the data arrives but the setup carries a legal or quality risk.

## Data quality score

`qualityScore({ findings, runs })` → `{ score, lost, deductions }`

**Formula, one sentence.** Start at 100, take off 15 points for every distinct broken problem, 10 for
every risk and 5 for every warning, doubled when the problem is on a conversion event, never below 0.

The weights are the `SCORE_WEIGHTS` table at the top of the file: severity `{ broken: 15, risk: 10,
warning: 5 }`, `check: { journey_incomplete: 15 }` (an unfinished journey hides every event after the
point it stopped, so it costs as much as a broken event), `conversion: 2`. Conversion events are the
canonical names in `CONVERSION_EVENTS` (purchase, generate_lead, Lead, sign_up, CompleteRegistration,
subscribe). Distinct problems are `groupFindings` groups, so walking more viewports never lowers the
score by itself. `deductions` lists every problem with its points and owner, sorted by points, so the
score is never a number without a reason; `lost` is their sum.

**Demo.** 25. Deductions: GA4 `purchase` missing params 30 (broken, conversion, developer), Meta
`Purchase` missing params 30 (same), Meta `PageView` before consent 10 (risk, gtm), GA4 `add_to_cart`
duplicate 5 (warning, gtm). Lost 75.

**What moves it.** Fixing the mobile purchase parameters alone takes it to 85. The score is `null`,
not 100, when nothing was tested.

**Limitations.** The weights are a judgement, not a measurement; the table exists to argue about them.
A site with twenty small warnings scores like one with a broken purchase (both 0 to 25), which is
intended: the score is a headline, the deductions are the explanation. Findings the `--event` filter
removed are not scored.

## Plan coverage

`planCoverage({ plan, runs, findings })` → `{ planned, checkable, counts, percent, platforms, events }`
or `null` without a plan.

**Formula.** Reuses `planCheck` from `src/checks.js` to sort each planned event into one bucket
(`implemented`, `missing`, `missing_params`, `wrong_values`, `not_checked`) plus one `unplanned`
entry per event that fired without being in the plan. `planned` = planned events; `checkable` =
planned minus `not_checked` (events no walked journey expects); `percent[bucket]` = bucket count /
checkable, for the four checkable buckets. `not_checked` and `unplanned` are counts only, since a
share of "events we did not look at" says nothing. The same per platform.

**Demo.** 11 planned, 11 checkable: implemented 9 (82%), missing_params 2 (18%), missing 0,
wrong_values 0, unplanned 0, not_checked 0. GA4: 6 of 7 implemented (86%). Meta: 3 of 4 (75%).

**How to read it.** `implemented` is the coverage number; the other three shares say why it is not
100. `not_checked` above 0 means the run did not walk every journey the plan covers; coverage is then
only about what was walked.

**Limitations.** A planned event counts as implemented when it fired once with its required
parameters in any walked run; it does not have to fire in every viewport. Without a plan there is
nothing to cover, so the metric is `null` rather than a meaningless 100%.

## Journey funnel (expected vs observed)

`journeyFunnel({ plan, runs })` → one entry per run: `{ journey, viewport, completed, source,
expected, observed, ok, percent, firstMissing, events }`.

**Formula.** The expected events are the plan's events this journey expects (`journeys` empty or
containing the journey id, and the platform among the run's checked providers), in plan order. When
the plan names none for the journey, the ready-made journey's events from `JOURNEY_PRESETS` are used
(`source: "preset"`), so `aitd run --journey purchase` without a plan still gets a funnel. For each
expected event: `observed`, `count`, the `step`, `stepLabel` and `page` where it first fired (first by
step, then by time), `required` and `missingParams` (the union over every send), `paramsOk`, and a
`status` of `ok`, `missing_params` or `missing`. `firstMissing` is the first expected event that
never fired, which is where the funnel breaks. Hits match by `hitMatchesEvent`, so aliases and the
common variants (AddToCart, dl_add_to_cart) count.

**Demo, checkout on mobile.** 11 expected, 11 observed (100%), 9 ok, nothing missing. `page_view`
first at step 1 "Open http://localhost:4321/" (5 sends), `view_item` at step 3 "Open the first
product", `add_to_cart` at step 4 "Add to cart" (2 sends), `purchase` at step 11 "Place the order" on
`/thanks.html`, status `missing_params` (currency, value); Meta `Purchase` the same. On desktop all 11
are ok.

**How to read it.** Read the rows top to bottom as the journey: the first `missing` row is where
tracking stops following the visitor. `count` above 1 on a step that happens once is the duplicate the
findings report.

**Limitations.** Plan order is the order the plan author wrote, which is usually, not always, the
funnel order. A custom `--goal` journey with no plan events and no preset has `source: "none"` and an
empty funnel; the data has no way to know what was expected there.

## Platform parity

`platformParity({ runs })` → one entry per run: `{ journey, viewport, shared, onlyOn, mismatches }`.

**Formula.** Hits are grouped by `canonicalEvent` (purchase and Purchase, add_to_cart and AddToCart,
view_item and ViewContent are one). An event seen on two or more platforms is `shared`, with per
platform the names used, the `count`, and the `value` and `currency` of the first hit that carries
them. `mismatch` lists what differs: `count`, `value` (more than 0.005 apart), `currency`, or
`value_missing` when one platform sent a value and another did not. An event on one platform only is
in `onlyOn`. Conversion events sort first.

**Demo, checkout on desktop.** Shared: purchase GA4 1 × 19.9 EUR vs Meta 1 × 19.9 EUR, no mismatch;
addtocart GA4 2 vs Meta 1, mismatch `count`; begincheckout and pageview agree. Only on GA4:
`view_cart`, `view_item`, `view_item_list`. 1 mismatch. On mobile the purchase has no value on either
side, so parity is silent there and conversion integrity speaks.

**How to read it.** `mismatch` on a conversion is the "GA4 and Meta report different revenue" problem.
`onlyOn` is a to-do list for the platform that lacks the event: `view_item` only on GA4 means Meta gets
no `ViewContent`, which its catalogue ads need.

**Limitations.** Parity is per run, so an order is compared with itself on the other platform, never
across runs. Platforms the run did not check are absent, not "missing". `onlyOn` includes events that
have no equivalent on the other platform (GA4's `view_item_list` has no Meta standard event), so it is
a list to review, not a list of bugs.

## Consent compliance

`consentCompliance({ plan, runs, findings, consentScenarios })` → `{ status, consentMode, platforms,
scenarios, findings }`.

**Formula.**
- `consentMode`: per run, the first `consent default` push in the dataLayer log: its step, how many
  ms into that step it came, whether it came before the first Google hit (`sentBefore`, as checks.js
  decides it), and whether it declared both v2 signals (`ad_user_data`, `ad_personalization`).
  Summarised as `defaultPresent`, `defaultOnTime` and `v2Signals` over all runs; `expected` is the
  plan's `consent_mode` flag.
- `platforms`: one row per platform seen in any hit or scenario: `beforeConsent` (distinct events with
  a `before_consent` finding), `afterReject` (distinct `after_reject` findings plus the consent
  scenario's "reject" cells that are problems), `afterAnalyticsOnly` (ad platforms only: problem cells
  in the "analytics only" scenario, `null` when that scenario did not run), the hit counts per scenario
  state, and a `status`: `fail` when anything fired after reject, `attention` when something fired
  before consent or after analytics-only, `pass` otherwise.
- `scenarios`: which states ran, the CMP used, and every problem cell from `consentTable` in
  `src/consent.js`.
- `status` overall: `fail` on any platform fail or any of `after_reject`, `cookies_after_reject`,
  `reject_ignored`, `reject_button_failed`; `attention` on any platform attention or any of
  `before_consent`, `cookies_before_consent`, `consent_default_missing`, `consent_default_late`,
  `consent_v2_missing`, `consent_v2_update`; `unknown` with no runs and no scenarios; else `pass`.

**Demo.** Status `fail`. Consent Mode: expected, default present in all 4 runs at step 1 (31 to 57
ms into the page open), before the first Google hit, v2 signals present. GA4: 0 before consent, 0 after
reject, scenarios before 2 / accept 2 / reject 2 (both cookieless pings), `pass`. Meta: 1 event before
consent (PageView), 1 after reject (PageView in the reject scenario), scenarios before 1 / accept 1 /
reject 1, `fail`. The "analytics only" scenario did not run (the demo banner has no such choice), so
`afterAnalyticsOnly` is `null`.

**How to read it.** The platform table is the one to show: a `fail` row is a tag that ignores the
visitor's "no". `consentMode.defaultOnTime: false` means Google tags fired before they knew consent
was denied, which Consent Mode cannot repair afterwards.

**Limitations.** Consent scenarios only look at the start page, and are `null` on a replay or when
no banner was found; the findings then carry the whole judgement and `afterReject` only counts what a
`decline_cookies` journey saw. A CMP the tool cannot drive leaves `analytics` at `null`, which is "not
tested", not "fine". Consent Mode only governs Google tags; the Meta and TikTok rows come from whether
they sent at all.

## Conversion integrity

`conversionIntegrity({ runs })` → `{ rows, total, passed, percent }`, one row per purchase-like hit
(`canonicalEvent === "purchase"`) in any run.

**Formula.** Each row has `checks`, each `pass`, `fail` or `null` (not applicable):
- `value`: present, numeric and above 0 (so a 0 purchase fails);
- `currency`: present and a three-letter ISO code;
- `transactionId`: present (`transaction_id` or the `order_id` aliases); `null` when absent on Meta
  or TikTok, which have no standard order id;
- `items`: a non-empty list (GA4 `items`/`pr1..`, Meta `contents`/`content_ids`); absent on GA4
  fails (every product report is lost), absent elsewhere is `null`;
- `duplicate`: the same order (same transaction id, or same step without one) sent again on the same
  platform with a different or no event id;
- `parity`: the same value and currency as the other platform's purchase for the same order (paired by
  transaction id, else the only other purchase in the run), `null` without a counterpart or with
  nothing to compare;
- `eventId`: present; `fail` only when a server container is in play (any hit with `delivery:
  "server"`), since that is when Meta needs it to deduplicate, else `null`.
`failed` lists the failing checks, `pass` is true when none fail. Rows carry the order id, value,
currency, item count, step, page and counterpart platform.

**Demo.** 4 purchases, 2 pass (50%). Desktop GA4 `purchase` T1792391957987, 19.9 EUR, 1 item,
counterpart Meta: all pass. Desktop Meta `Purchase` 19.9 EUR: pass (transaction id and items not
applicable). Mobile GA4 and Meta: `value` and `currency` fail, everything else passes or does not apply.

**How to read it.** This is the one table a marketer needs about revenue: a row that fails `value`
or `currency` is an order the platform counts wrong, `duplicate` is an order counted twice, `parity`
is GA4 and Meta disagreeing.

**Limitations.** Only purchases: leads and sign-ups have no value to check. The tool sees one order
per run, so "duplicate" is about one visit, not about repeat page loads of the thank-you page over
days. Server-side copies of Meta and TikTok events never pass through the browser, so `eventId`
checks the browser half only.

## Timing

`timing({ runs, slowest = 5 })` → one entry per run: `{ journey, viewport, durationMs,
medianFirstHitMs, steps, slowest }`.

**Formula.** Steps and hits both carry `t` (ms since epoch) and runs carry `startedAt`, so the data
supports this. Per step: `durationMs` to the next step, `firstHitMs` and `lastHitMs` from the step's
`t` to its first and last hit, and `hits`. A step's clock starts when its action begins, so a page
load is part of the delay. Per run: `durationMs` from `startedAt` (or the earliest timestamp) to the
latest timestamp, `medianFirstHitMs` over the steps that produced hits, and the `slowest` hits by
delay from their step.

**Demo, browse on desktop.** 2,677 ms in total; median first hit 74 ms. "Open http://localhost:4321/":
3 hits, first after 74 ms, last after 79 ms, step took 1,001 ms. "Accept cookies": no hits. Slowest hit:
Meta `PageView` at "Open the first product", 88 ms.

**How to read it.** A first hit far behind the step's action (seconds, not tens of ms) is a tag that
waits for something, and a visitor who leaves earlier is lost. A step with `firstHitMs: null` sent
nothing.

**Limitations.** Timings include the tool's own waiting (`settle`) and the demo site's localhost
speed, so they say more about the order and the gaps than about real-world latency. Older captures
without timestamps get `null`, not 0.

## Where things break

`findingsBy({ findings, runs })` → `{ byPage, byOwner, byPlatform, byJourney }`, each a list of
`{ key, counts, total, findings }` sorted worst-severity first, then by count.

**Formula.** Problem findings (broken, risk, warning) counted per occurrence, so a problem on two pages
or two viewports counts on each. The page is the `pagePath` of the run step whose label the finding
names; findings without a step (a missing event, an unfinished journey, a missing Consent Mode default)
go under the `null` page. Owner is `ownerOf` from `src/verify.js`.

**Demo.** By page: `/thanks.html` 2 (both broken), `/` 4 (risk), `/product.html` 4 (warning). By
owner: developer 2, gtm 8. By platform: GA4 1 broken + 4 warnings, Meta 1 broken + 4 risks. By
journey: checkout 6, browse 4.

`prioritiesByOwner(findings, { top = 3 })` → `[{ owner, total, counts, points, top }]`.

**Formula.** Distinct problems (`groupFindings`) per owner, each with the score points it costs, sorted
by points then severity; `top` is the first three; `points` is what fixing all of the owner's items
would give back to the score. Owners are ordered by points, so the group that moves the score most
comes first.

**Demo.** Developer: 2 problems, 60 points (GA4 purchase and Meta Purchase missing params, 30 each).
GTM: 2 problems, 15 points (Meta PageView before consent 10, GA4 add_to_cart duplicate 5). No marketing
items.

**How to read it.** `points` is the handle: "the developer's two fixes recover 60 of the 75 lost
points". The `top` three per owner is the overview's to-do list.

**Limitations.** Owner is a fixed table over check names, a best guess the AI explanation can refine
but these numbers do not. Page attribution needs the step label to be unique within the run; labels
are, in practice, but a journey that clicks the same button twice would attribute both to the first.

## Not implemented, and why

- **A per-event cross-run consistency score** (does the event fire the same way on desktop and
  mobile?) is visible by comparing funnel rows across viewports; a separate number would repeat the
  funnel.
- **Lead and sign-up integrity** beyond "fired with its params": the data carries no value to check.
- **Page load timing** as such: hits carry no navigation timing, only the capture time; the step
  clock is the nearest honest proxy.

## What the report should show first

Three numbers, in this order, above everything else:

1. **Verdict with the score and its top deductions.** One word (fail / attention / pass), the score,
   and the two or three deductions that made it. In the demo: "Fail, 25/100: purchases on mobile are
   sent without value and currency (GA4 and Meta)". That sentence is what the reader came for, and the
   deductions make the score defensible.
2. **Conversion integrity.** The purchase table, one row per order and platform with its pass/fail
   cells. Revenue is the number the business trusts the report for, and this table says in one glance
   whether that number is right (demo: 2 of 4 purchases pass).
3. **Priorities by owner.** The owner groups with points to recover and the top three items each.
   It turns the findings into who does what first (demo: developer 60 points in two fixes, GTM 15 in
   two), which is the next action the report exists to cause.

Plan coverage comes right after, as the "how much of the plan is live" line (82% implemented), and
the funnel matrix, parity and consent tables belong in the journey and consent tabs where the reader
drills down. Timing is a detail for the developer and sits last.
