# Copy guide

Rules for every string the report, the Markdown, the CSV flags and the alerts show. Applies to `src/i18n.js` in both languages and to the consequence and fix strings proposed in `report-brief.md`.

## Voice and tone

- Plain statements of what happened, to whom it matters, and what to do. No adjectives of degree ("critical", "severe", "simply"), no reassurance ("don't worry"), no marketing ("powerful", "AI-driven").
- Write for the person who will act: the marketer in the headline and consequence, the developer or tag admin in the detail and the fix.
- One idea per sentence. Symptom, then consequence, then fix, as three sentences, not one.
- Never address the operator inside the report. Anything that starts with "Run …" or mentions a CLI flag belongs in the terminal, not in `report.html`.
- Say what the tool saw, not what the site "does". "Meta received no `Purchase`" is a measurement; "the site is broken" is a guess.
- Name the unknown. "Page: unknown" beats a blank cell.

## Severity vocabulary

Three levels plus ok. Each has a verb set; a string on one level must not borrow another's verbs.

| Level | Means | Verbs used | Not used |
|---|---|---|---|
| **Broken** | Data is wrong or missing now; a report or a bidding algorithm is already acting on it, or a visitor's refusal is already being ignored. | is missing, was not sent, is lost, is counted twice, continues after, was sent in plain text | may, might, could, at risk |
| **Warning** | Data arrives but is distorted or incomplete; the effect is measurable and bounded. | is inflated, differs, has no items, stayed denied | is lost, is broken |
| **Info** | A fact about scope or coverage; nothing to fix in the tags. | was not checked, is not visible here, is not in the plan | fired, failed, wrong |
| **OK** | Verified correct on this run. | fired with, survived, matched | no problem found (a double negative) |

`Risk` is retired as a level and becomes the **legal** category label, next to **money** and **hygiene**. A card shows one level and one category.

Until the levels change in `checks.js`, "Risk" strings keep the broken verbs where the effect is present tense (an email was sent, cookies were set) and the warning verbs where it is conditional.

## Naming

- **Platforms**: the label from `PROVIDERS` in `src/parsers.js` (GA4, Google Ads, Meta, TikTok), never the key (`ga4`, `meta`). Same in Turkish.
- **Events**: exactly as the site sent them, in code font, never translated, never re-cased: `purchase`, `Purchase`, `PageView`. When one bug covers two platforms, name both: "GA4 `purchase` and Meta `Purchase`".
- **Parameters**: code font, the name the platform uses (`value`, `currency`, `transaction_id`), listed in a fixed order: `value`, `currency`, `transaction_id`, `items`, then alphabetical. Not the plan's order.
- **GTM tags and triggers**: the container's own names in quotes, with the kind: tag "GA4 - Purchase", trigger "CE - purchase". Variables as `{{Order Value}}`.
- **Journeys and viewports**: `checkout · mobile`, the id and viewport the config uses, joined by a middle dot. "Journey" is the word in both chrome and prose; never "flow" or "scenario" (scenario is reserved for the consent scenarios).
- **Steps**: "step 11 · Place the order", number first, label as the config wrote it.
- **Pages**: the path (`/thanks.html`) in prose, the full URL in evidence.
- **Consent signals**: code font, as Google names them: `ad_storage`, `ad_user_data`. States: "granted", "denied", never "on/off".
- **The tool**: "ai tag debugger" in chrome, "this audit" or "this run" in prose. Always lowercase, also at the start of a sentence, and never translated (Turkish adds its suffix with an apostrophe: ai tag debugger’ı); the maker is "Analitik İşler". The brand guide is `brand/ai/BRAND.md`.

## Numbers

- Counts as digits, even below ten: "sent 2 times", "4 journeys".
- Money as sent, with the ISO code after it, no symbol: `19.9 EUR`. Prose may say "19.90 EUR"; evidence tables never reformat.
- Times relative to the journey start with one decimal: `+6.9s`.
- Dates ISO, UTC, both languages: `2026-10-19 06:39 UTC`.
- Percentages as integers: "Coverage 7 of 9 (78%)".
- Never "2x", "~", "approx." or ranges in a finding.

## Ten rewrites

Keys and current English from `src/i18n.js`.

1. `ui.noExplanation` — now: "Run without --no-ai for an explanation."
   After: "No model explanation in this run. The consequence, owner and fix below do not need one."

2. `ui.noSummary` — now: "Run without --no-ai for an AI summary of the findings."
   After: the deterministic headline, for the sample: "Mobile purchases send no revenue: `purchase` reached GA4 and Meta without `value` and `currency` on checkout · mobile. Desktop sent both."

3. `detail.missingParams` — now: `"purchase" was sent without "currency", "value".`
   After: "GA4 `purchase` was sent without `value` and `currency`. The order is counted; its revenue is not."

4. `detail.duplicate` — now: `"add_to_cart" was sent 2 times by one action, which inflates counts and conversions.`
   After: "One click sent GA4 `add_to_cart` 2 times. GA4 counts 2 adds to cart for every real one."

5. `detail.beforeConsent` — now: `meta "PageView" fired before the visitor accepted cookies.`
   After: "Meta `PageView` was sent before the visitor made a consent choice. Meta receives page views from visitors who have not agreed."

6. `detail.missingEvent` — now: `Expected ga4 event "purchase" was never sent during this journey.`
   After: "GA4 `purchase` was not sent on the checkout journey, although the order was placed. GA4 and Google Ads see no conversion."

7. `detail.purchaseMismatch` — now: `GA4 and Meta reported order "T123" differently: value "120" in GA4 and "115" in Meta. One of the tags reads the wrong data.`
   After: "Order `T123` was reported as 120 EUR to GA4 and 115 EUR to Meta. One tag reads the wrong number, so Google and Meta bid on different revenue."

8. `ui.scenariosLead` — now: "The start page opened once per consent choice (answered through the banner's buttons). Hits per tag after the choice; red ones should not have been sent."
   After: "The home page was opened once per consent choice, answered through the banner's buttons. Each cell is how many hits the tag sent after that choice. A red number is data the visitor had refused."

9. `ui.blockedNote` — now: "answered locally, not sent"
   After: "blocked by the audit: answered locally, never reached Meta" (vendor name filled in).

10. `ui.changeFixed` as used by `changesLines` — now: "Fixed: GA4 purchase (Missing params)"
    After: "Fixed: GA4 `purchase` (was: missing parameters)"

Two more that are right today and set the bar: `ui.allGood` "All planned events fired correctly on every journey tested." and `detail.campaignOk` "gclid, fbclid, utm_source, utm_medium, utm_campaign survived the landing page's redirects and reached the hits."

## Turkish

- The rules above apply unchanged: labels not keys, events untouched, ISO dates, digits.
- "Tamam" only as a tile label; in sentences use "Sorunsuz".
- Loanwords the audience uses stay (dataLayer, container, pixel, trigger as "tetikleyici" is fine, "tag" as "etiket" is fine); do not invent Turkish for `ad_storage` or `event_id`.
- Verify links that open English pages are marked "(İngilizce)".
