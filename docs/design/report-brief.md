# Report brief

> Screenshot names below refer to captures of the 0.16.0 demo report taken during the review. They are not kept in the repository: run `npm run demo:serve` and `npm run demo`, then open the report to see the same screens.

What the ai-tag-debugger report is for, who reads it, what it must say first, and what the next release should build. The Art Director, UX Designer and front-end engineer build against this document. The copy rules are in `copy-guide.md`.

The artifact under review is the demo-shop run (`report.html`, `report.md`, `capture.json`, `timeline.csv`, version 0.16.0, no AI model). Screenshots of it are in `current/`:

| File | What it shows |
|---|---|
| `current/01-overview-1280.png` | Overview tab, desktop, full page |
| `current/02-finding-1280.png` | Findings tab with the first finding open |
| `current/03-journeys-1280.png` | Journeys tab: consent scenarios, consent commands, first step's timeline |
| `current/04-network-1280.png` | Step 11 "Place the order" on checkout · mobile, Network requests tab, the broken `purchase` request open |
| `current/05-consent-1280.png` | Consent scenarios table and the Consent card of checkout · mobile |
| `current/06-mobile-overview-390.png` | Overview at 390px |
| `current/07-mobile-finding-390.png` | Findings at 390px |

Facts about the sample that the rest of this document leans on:

- 4 runs (browse and checkout, each on desktop and mobile), 11 planned events, 4 platforms chosen (GA4, Google Ads, Meta, TikTok), 2 seen (GA4, Meta).
- 18 raw findings, grouped into 4 problem cards: 2 broken (`purchase` without `value` and `currency` on GA4 and on Meta, checkout · mobile only), 1 risk (Meta `PageView` before consent, all 4 runs), 1 warning (`add_to_cart` sent twice, all 4 runs). Plus 8 "ok" findings shown as 4.
- The same purchase on checkout · desktop was correct. No finding says so.
- The consent scenarios table shows Meta `PageView` sent after "Reject all" (red cell). No finding is made from it, so it is not in the count of 4.
- The print version of this report is 55 A4 pages (print CSS opens every tab, journey and step).
- The HTML has no `<script>`; styling is inline CSS; images are data URIs. The MCP server sends it with `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:` (`src/mcp.js`), so the page must keep working with no JavaScript and no external resource. Navigation is `:target` and `:has()` CSS only.

## 1. Who reads it, and the first ten seconds

### The marketer or analytics lead (owns the ad budget)

Needs in ten seconds: is my conversion data trustworthy, and what is it costing me. Then: who do I send this to.

What the report gives them now: four count tiles (`2 Broken · 1 Risk · 1 Warning · 4 OK`), a journeys table with a "Problems" column, and a card that says "Run without --no-ai for an AI summary of the findings." (`01-overview-1280.png`). The site passes or fails nowhere. The word "purchase" is not on the overview. "4 OK" is the number of journeys with an ok line, not four things that work; "Problems 2, 2, 2, 4" sums to 10 while the tab says "Findings 4", because one counts raw findings per run and the other counts grouped cards.

What they hunt for: that the purchase lost its revenue on mobile and was fine on desktop (two cards in the Findings tab, each saying "1 journey · 1 step", neither mentioning desktop); that Google Ads and TikTok sent nothing at all although they were "checked" (only visible by comparing "Platforms" on the overview with the Scope tab's inventory); that a Meta tag fires after Reject all (a red "1" in a table on the Journeys tab, `05-consent-1280.png`, not counted anywhere).

### The developer (fixes the dataLayer)

Needs: the exact event, page, parameter and step, and how to reproduce it.

What the report gives them now: the finding card has the captured parameters, the step chip "11 · checkout · mobile · Place the order", and a link to the step (`02-finding-1280.png`). The step's Timeline tab pairs the dataLayer push with the hit, and the Network tab decodes the request (`04-network-1280.png`). This is the strongest part of the report. Keep it.

What they hunt for: the page URL on the finding (it is inside the evidence table as `page_location`, and absent for the Meta card, whose evidence is `{}`); the dataLayer push that caused the bad hit, which in the sample shows `transaction_id` and `items` but no `value` or `currency`, i.e. the bug is in the push, not in the tag. The report has this one click away but never states it. The viewport (mobile) is the key clue and is only in the chip.

### The GTM or tag admin

Needs: tag and trigger names, consent configuration, and which events the container sends.

What the report gives them now: an owner group "Tag Manager · Tags, triggers and consent setup" with two cards; with a container export, tag and trigger names per finding (`gtmHtml` in `src/report.js`, not exercised in the sample). The Consent card lists every `default` and `update` command in order (`05-consent-1280.png`).

What they hunt for: one sentence on whether the consent setup is right. The Consent card for checkout · mobile shows five identical default/update pairs, one per page load; the only facts that matter (default set before the first hit, v2 signals present, update after accept) are left for the reader to infer. The "Likely cause" box says "Run without --no-ai for an explanation.", a CLI instruction in a document sent to a client.

### The agency account manager (forwards it)

Needs: a page that stands on its own, in the client's language, that can be attached to an email.

What the report gives them now: a clean header, white-label branding (`src/whitelabel.js`), Turkish and English, a Markdown file.

What they hunt for: a sentence to paste in the email. `report.md` opens with "2 broken · 1 risk · 1 warning · 0 info · 4 ok", then a tag inventory, then the consent table, then findings. The PDF of this four-journey sample is 55 pages, most of it the timeline. The Slack alert reads "Fixed: GA4 purchase (Missing params)", which says the opposite of what it means (the bracket is the old state).

## 2. The narrative order

The report says, in this order:

1. **Verdict.** One line, one of five states, with the site name and the date. Deterministic.
2. **Impact.** The one to three findings that change money or expose the site legally, each as a consequence sentence with where it happened and where it did not.
3. **What to fix, by whom.** The full problem list grouped by owner (developer, Tag Manager, marketing), each card with page, event, parameter, step, evidence and a fix.
4. **What works.** Plan coverage per journey, so the reader knows what was verified and not only what failed.
5. **Evidence.** Journeys, steps, dataLayer, requests, consent commands, inventory. Everything else.

Why this order: the marketer stops after 1 and 2; the agency manager pastes 1 and 2; the developer and tag admin start at 3 and go to 5. Today's order is counts → (empty) summary → journeys table → run settings, and in Markdown counts → inventory → consent table → findings → timeline.

### The verdict, defined

The verdict is computed from the grouped findings and the plan check, with no model. States, in order of precedence:

| State | Rule | Headline template |
|---|---|---|
| **Broken** | any `broken` finding on a completed journey, or any `reject_ignored`, `after_reject`, `cookies_after_reject`, or a red cell in the "Reject all" column of the consent scenarios | "{Consequence of the lead finding}. {Where}." |
| **At risk** | no broken, at least one `risk` | same template |
| **Needs attention** | only `warning` findings | same template |
| **Not verified** | a journey did not complete and a planned conversion event was not checked, with nothing worse found | "The {journey} journey stopped at step {n} ({note}), so {event} could not be checked." |
| **Pass** | no broken, risk or warning; every planned event in scope fired on every journey it was expected on | "All {n} planned events fired correctly on {m} journeys. {k} were checked on desktop and mobile." |

The lead finding is the highest-severity card; ties go to the money category, then to the event latest in the funnel (`purchase` before `begin_checkout` before `add_to_cart`), then to the card with more places. The headline is that card's consequence sentence (section 3) with the event and place filled in, plus a scope clause. For the sample: "Mobile purchases send no revenue: `purchase` reached GA4 and Meta without `value` and `currency` on checkout · mobile. Desktop sent both." A second line gives the work split: "4 problems: 2 for the developer, 2 for Tag Manager."

Three consequences of this definition:

- The consent scenarios table must become findings (`scenario_after_reject`, `scenario_after_analytics_only`), or the table disappears from the verdict.
- "Checked but never seen" must become a finding (`platform_not_seen`: a chosen platform with zero requests on every journey), at `info` when the plan has no events for it and `broken` when it does.
- The "Desktop sent both" clause needs a cross-run comparison that `groupFindings` does not do today: the same event on the same journey, flagged on one viewport and clean on the other. This is the most useful sentence the report can produce and it costs one loop.

## 3. Meaning: checks as consequences

One sentence per check that a non-engineer understands, written to drop into `i18n.js` as a `consequence` block next to `detail`. Category: **M** money (ad spend, revenue, attribution), **L** legal (consent, personal data), **H** data hygiene. Severity and owner are the current values from `src/checks.js` and `src/verify.js`; the last column notes where they disagree with the consequence.

| Check | Now | Cat. | Consequence | Note |
|---|---|---|---|---|
| `missing_event` | broken / Tag Manager | M | {Platform} never received `{event}`, so this step of the funnel is invisible, and if it is a conversion the ad platform cannot count or bid on it. | Becomes `info` when the journey stopped early; that is a different thing and should be "not verified". |
| `missing_params` | broken / developer | M | `{event}` arrived without `{params}`, so {Platform} records the event with no value, currency or items: the order counts, its revenue does not. | |
| `duplicate` | warning / Tag Manager | M | One click sent `{event}` {n} times, so counts and conversion totals are inflated by {n} and ad platforms bid on sales that did not happen. | Inflated conversions is money; should be `broken` for conversion events, `warning` otherwise. |
| `purchase_value_invalid` | broken / developer | M | The purchase value is "{value}", so revenue is recorded as nothing: return-on-ad-spend reports and value-based bidding are wrong. | |
| `purchase_currency_invalid` | broken / developer | M | The currency is "{currency}", which platforms do not recognise, so the revenue is dropped or converted at the wrong rate. | |
| `purchase_items_empty` | warning / developer | M | The purchase has no products, so product reports, catalogue feeds and dynamic remarketing see no sales. | |
| `purchase_mismatch` | warning / developer | M | Google and Meta received different revenue for the same order, so one of them is reporting and bidding on the wrong number. | Money; should be `broken`. |
| `campaign_lost_redirect` | broken / Tag Manager | M | A redirect strips the campaign parameters from the landing address, so paid clicks arrive as direct traffic and campaigns get no credit for what they sell. | Redirects are server or site code: owner should be developer. |
| `campaign_missing_in_hits` | broken / Tag Manager | M | The landing page kept the campaign parameters but the {Platform} hit did not report them, so the visit is credited to direct traffic. | |
| `campaign_params` | ok | M | Campaign parameters survived the landing redirect and reached the hits. | |
| `event_id_reused` | warning / Tag Manager | M | Two different events share one event ID, so {Platform} keeps the first and silently drops the other: a real event is lost. | Lost conversions is money; `broken` when a conversion is among them. |
| `event_id_mismatch` | warning / Tag Manager | M | The browser and server copies of `{event}` carry different IDs, so Meta cannot pair them and counts the conversion twice. | |
| `event_id_not_forwarded` | info / Tag Manager | M | The GA4 hit that feeds the server container has no `event_id`, so a server copy of `{event}` cannot be paired with the pixel and is counted twice. | Same effect as the line above; `warning`. |
| `dedup_id_missing` | info / Tag Manager | M | `{event}` left the browser with no event ID while the site uses a server container; if the server also sends it, {Platform} counts it twice. | |
| `server_side` | info / developer | H | Some {Platform} events go through the site's own server; this report sees what the browser sent, not what the server forwarded to Meta or TikTok. | Not a problem: belongs in scope, not in findings. |
| `server_endpoint` | info / Tag Manager | H | A server container answers on {hosts}; events it forwards to ad platforms are not visible here. | Same. |
| `consent_default_missing` | risk / Tag Manager | L | Google tags run with no consent default, so they behave as if every visitor had consented before being asked. | |
| `consent_default_late` | risk / Tag Manager | L | The first Google hit went out before the consent default was set, so that hit ignored the visitor's choice. | |
| `consent_v2_missing` | risk / Tag Manager | L, M | The consent default lacks `ad_user_data` and `ad_personalization`; for EEA and UK traffic Google can stop ad personalisation and conversion measurement for this account. | |
| `consent_v2_update` | warning / Tag Manager | M | After the visitor accepted, `{signals}` stayed denied, so Google Ads conversions and remarketing audiences stay off even for consenting visitors. | Money; `risk` at least. |
| `before_consent` | risk / Tag Manager | L | {Platform} `{event}` was sent before the visitor made a choice, so {Platform} receives data from visitors who have not agreed. | Owner depends on where the tag lives; the sample's Meta pixel has no dataLayer push, so it is likely hard-coded (developer). |
| `after_reject` | broken / Tag Manager | L | {Platform} `{event}` was still sent after the visitor clicked Reject, so tracking continues against an explicit refusal. | |
| `reject_ignored` | broken / Tag Manager | L | After Reject, a consent update granted everything anyway: the reject button is cosmetic. | |
| `reject_button_failed` | broken / Tag Manager | L | The reject button did nothing: the banner stayed open. | |
| `cookies_before_consent` | risk / Tag Manager | L | Tracking cookies ({names}) were written before the visitor chose, so cookies are set without consent. | |
| `cookies_after_reject` | broken / Tag Manager | L | Tracking cookies ({names}) were written after the visitor refused them. | |
| `pii` (email) | risk / Tag Manager | L | A visitor's email address was sent to {Platform} in plain text: personal data left the site unprotected. | Should be `broken`: this is a data breach, not a risk of one. |
| `pii` (unhashed user data) | risk / Tag Manager | L | User data for ad matching ({fields}) was sent to {Platform} unhashed; the platform expects SHA-256 and the raw data is now in its logs. | Same. |
| `pii_datalayer` | warning / developer | L | The dataLayer holds unhashed user data ({fields}); every script on the page can read it, not only the tag that needs it. | |
| `journey_incomplete` | warning / developer | H | The browser could not finish this journey ({note}), so every event after that point, including any conversion, is unverified. | Not a tracking problem: feeds the "Not verified" verdict, not the problem list. |
| `unplanned_events` | info / marketing | H | Events fire that are not in the plan ({list}): either the plan is out of date or tags send things nobody asked for. | |
| `planned_out_of_scope` | info / marketing | H | {n} planned events are on platforms this run did not check, so their status is unknown. | |
| `matches_plan` | ok | H | These planned events fired with everything the plan requires. | Today the detail is lost: `groupFindings` keys ok findings by journey, so `campaign_params` swallows `matches_plan` and the "N planned events matched" text appears nowhere in the HTML or Markdown. |

Proposed new checks, named here so the table stays complete: `scenario_after_reject` (broken, L), `scenario_after_analytics_only` (risk, L), `platform_not_seen` (see section 2), `viewport_differs` (info, H: the same event is correct on one viewport and wrong on the other; attaches to the existing card rather than making a new one).

## 4. Critique of the current report

### What works, keep it

- The finding card's structure: title, platform, spread, owner group, evidence table, "Where" chip that links to the step, "How to verify" links (`02-finding-1280.png`).
- The step view: a dataLayer push, the GTM event it raised, the hits it caused, in time order; the request decoded into event and context parameters with glossary tips; items decoded from `pr1` strings (`04-network-1280.png`). Nothing else in the market shows the push next to the hit this plainly.
- Owner grouping (Developer, Tag Manager, Marketing) with a one-line hint of what each owns.
- The run card: platforms, plan size, journeys, viewports, language, version. It is the right content, in the wrong place (top right of the first screen).
- No JavaScript, one file, works at 390px with no horizontal scroll (`06-mobile-overview-390.png`, `07-mobile-finding-390.png`), dark mode, print styles exist, white-label works.
- Consent scenarios table: the right idea, three columns a lawyer understands.

### What is noise

- The per-journey Consent card: five identical default/update pairs for checkout · mobile (`05-consent-1280.png`). One line would do: "Default set before the first hit · v2 signals present · granted at step 2".
- `{"ecommerce":null}` pushes rendered as timeline nodes labelled "No GTM event (data only)" with "No platform hit followed this push." under them (`03-journeys-1280.png`). Three of six nodes on the first step say nothing.
- Four runs repeating the same three steps in the Markdown timeline: 15 of the 20 KB of `report.md`.
- The 55-page PDF.
- The "OK" tile. It counts journeys, reads as a score, and hides what actually passed.
- "4 providers" in the header, when two of them sent nothing.

### What is missing

- A verdict. Without a model the first screen has no sentence about the site.
- Consequence. The detail sentences describe the symptom ("was sent without") and leave the reader to work out what it costs.
- The desktop/mobile contrast, the most actionable fact in the sample.
- The consent scenarios result in the findings and in the count.
- "Checked but never seen" for Google Ads and TikTok.
- The page URL and the causing dataLayer push on the finding card itself (both exist one click away).
- A fix when there is no model. Owner and verify links exist; a one-line fix per check does not, and most checks have a fixed one.
- Plan coverage on the first screen. It is on the fourth tab ("Scope and plan"), and the Plan vs. site card only exists with `--against`.

### Where the copy is vague

- "Run without --no-ai for an explanation." and "Run without --no-ai for an AI summary of the findings." are instructions to the operator printed in the client's document.
- `meta "PageView" fired before the visitor accepted cookies.`: the platform key, not its label, lower case, next to a title case "Meta" in the same card. Same with `ga4` in `missingEvent`.
- Two cards for one bug: `"purchase" was sent without "currency", "value".` and `"Purchase" was sent without "value", "currency".` The parameter order follows the plan's order, so the two sentences look like different problems.
- "Captured: `{}`" in the Markdown for the Meta purchase.
- "answered locally, not sent": means the audit blocked the hit from reaching the vendor (`block_hits`). Nobody outside the project knows that.
- "Hits per tag after the choice; red ones should not have been sent." The one sentence that explains the table is the last clause of a card description.
- "1 journey · 1 step" as the spread of a problem that hit 1 of 4 runs: say "checkout · mobile only".

### Where severity semantics are inconsistent

- `risk` is a category (legal exposure) used as a level between broken and warning. A plain-text email (`pii`) is `risk` while a cookie after reject is `broken`; both are the same kind of thing, and the email is the worse one.
- Money problems are spread over three levels: `missing_params` broken, `purchase_mismatch` warning, `duplicate` warning, `dedup_id_missing` info, although all of them put wrong numbers in front of a bidding algorithm.
- `missing_event` switches from `broken` to `info` when the journey stopped early; the information "not verified" is not a severity.
- `server_side` and `server_endpoint` are facts about scope, listed as findings and counted in `info`.
- The `risk` icon is the warning triangle (`sevIcon` maps everything but broken and info to it), so risk and warning look alike at a glance; only the colour differs.
- The overview tiles omit `info`; the Markdown counts line includes it; the Findings filter includes it.

### The Markdown report

Read by anyone who gets the file in a pull request, a ticket or an email client that strips HTML. It opens with a counts line, then the tag inventory, then consent, then findings, then a timeline that is three quarters of the file. There is no verdict line, no owner grouping (owner is a bare bullet "- Developer"), and the "ok" lines show only `campaign_params`. It should be the HTML's sections 1 to 4 in the same order, with the timeline reduced to steps that carry a problem and a pointer to `timeline.csv` for the rest.

### The Slack and email alert (`src/notify.js`, `changesLines` in `src/changes.js`)

Subject: `{site}: 2 new problems`. Body: `2 new problems. Compared with run {id}, by health findings ({id}).` then one line per change: `- New: GA4 purchase ("purchase" was sent without "currency", "value".)` or, in plan mode, `- Fixed: GA4 purchase (Missing params)`. Problems:

- "Fixed: … (Missing params)" reads as the current state; it is the previous bucket.
- No severity, no owner, no consequence in the line; the reader cannot tell a lost purchase from an unplanned event.
- The report link is a local file path, or nothing.
- The subject never carries the verdict. "localhost: Broken, 2 new problems, mobile purchases send no revenue" is what should wake someone up.

### The Turkish and English duality

- Event, parameter, tag and trigger names must never be translated or re-cased; the Turkish strings get this right. Keep it a rule.
- Platform names: the Turkish detail strings also print the raw key (`meta "PageView", ziyaretçi…`). Use the label in both languages.
- "Tamam" for OK is fine in a tile; in a sentence ("Tamam, browse (desktop): …" in Markdown) it reads as "Alright,". Use "Sorunsuz" in sentences.
- The verify links go to English pages in both languages; say so with "(İngilizce)" or drop them from the Turkish Markdown.
- Date and number formats: `2026-10-19 06:39 UTC` and `19.9` in both languages. Keep ISO dates; show money as sent, with the currency code, never a locale-formatted number that differs from the evidence.
- The consequence sentences in section 3 need a Turkish version written by a person, not a pass through the existing detail strings; the detail strings are symptom descriptions and the consequence is a different sentence.

## 5. Principles

Each one is a test the reviewer can run on a rendered report.

1. **The first screen states the verdict without a model.** Open `report.html` with AI off at 1280px: the first 600px contain one of the five verdict states and a headline sentence that names an event and a place. Same for the first three lines of `report.md` and the first line of the alert.
2. **Every problem card says page, event, parameter, step and viewport, or says which one is unknown.** Pick any card: page URL, event name, the parameter(s) at fault, the step number and label, and the viewport are all visible without opening anything. A missing one reads "page: unknown", never blank.
3. **Every check has a consequence sentence and a default fix.** For every `check:` in `src/checks.js` there is a `consequence` string and a `fix` string in `i18n.js`, in both languages; the card shows them when the model is off; no string tells the reader to rerun the tool.
4. **Severity is a level; category is a label.** Exactly three levels (broken, warning, info) plus ok, and a separate category chip (money, legal, hygiene). Two problems with the same effect on data have the same level. `risk` does not appear as a level.
5. **One bug, one card.** The same cause on several platforms, journeys or viewports is one card with a place list and a contrast clause ("desktop sent both"). Test: the sample renders 3 problem cards, not 4.
6. **Everything counted is countable in one place.** The number next to "Findings", the tiles, the journeys table and the alert subject agree, because they count the same grouped cards. The consent scenarios table produces findings.
7. **Evidence is one click from every claim and never on the first screen.** Each card links to the step; the Journeys tab is unchanged in depth but nothing from it is shown before the problem list. Scope facts (server-side, platforms checked, skipped requests) live on the Scope tab, not in the findings count.
8. **The print and Markdown versions stand alone and fit.** The PDF of a run with up to 6 journeys is under 12 pages: verdict, impact, cards, coverage, flagged steps only; the full timeline is `timeline.csv`. `report.md` has the same sections in the same order. No JavaScript, no external request, one file, readable at 390px with no horizontal scroll.

## 6. Scope for the next release

### Build first

1. **Deterministic verdict and headline** (section 2). Data already exists; one function over grouped findings and `planCheck`. Shown as the first block of the overview, the first line of `report.md`, the subject of the alert. Reason: it is the one thing every reader needs and the only thing the model currently supplies.
2. **Consequence and fix strings for every check** (section 3) in `i18n.js`, English and Turkish, replacing the "Run without --no-ai" lines. Reason: makes the report usable without a model, which is how CI, MCP and most CLI runs produce it.
3. **Cross-viewport contrast and "one bug, one card"**: merge the GA4 and Meta `missing_params` cards when the cause is the same push, add "desktop sent both" when the other viewport was clean. Reason: the sample's most actionable sentence.
4. **Consent scenarios and "platform not seen" as findings.** Reason: a red cell that is not counted is a verdict error.
5. **Overview reorder and tile change**: verdict → impact → owner split → coverage summary; the run card moves to the Scope tab; the OK tile becomes "n of m planned events verified". The journeys table's Problems column counts grouped cards. Reason: principles 1 and 6.
6. **Markdown and PDF reduced to sections 1 to 4 plus flagged steps**; the Slack line gains verdict, severity and owner, and "was: …" for fixed items. Reason: these are the versions most people see.

### Defer

- Visual redesign of the Journeys tab and the step view. It works; it is not where readers get lost.
- A category chip and a severity rework across all checks in one go. Do the string work first; change levels check by check with a changelog line each, because saved runs and the "since last run" diff key on `check`, not on severity.
- Locale number formatting. Evidence must match what was sent; prose can add a formatted copy later.
- Charts or scores. A percentage next to "Coverage" already exists in `planCheck`; a single number for "trust" would be invented, and this document has no basis to define one.
- Interactive filtering beyond what `:has()` gives. The CSP and the no-script rule stay.

### Constraints the engineer keeps

One file; inline CSS; data-URI images; no `<script>`; `:target`-driven navigation; print styles must produce the reduced PDF, which means the step panels get a print-only-if-flagged rule instead of `display:block!important`; both languages ship together; saved runs from earlier versions (`capture.json` without new fields) still render.
