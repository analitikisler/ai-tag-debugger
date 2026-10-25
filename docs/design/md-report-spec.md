# report.md specification

Most readers never open `report.html`: the Markdown goes into a pull request comment (GitHub renders it, 65,536 characters max), a Slack message (the first ~40 lines show in the preview, 4,000 characters per message), or a mail. The file must therefore be a verdict first, evidence second, and never a dump. The current sample is 20.7 KB and 200+ lines, 150 of them a per-hit timeline that the CSV already carries.

## Budgets

| Limit | Value | Reason |
|---|---|---|
| Total | ≤ 120 lines, ≤ 8 KB | Fits one GitHub comment with room for the CI header; a Slack message can carry the first half. |
| First 40 lines | Self-sufficient | Slack and mail previews stop there; they must contain the verdict, the counts, and the priorities. |
| Full finding blocks | ≤ 5, each ≤ 10 lines | More than five actionable findings is a list, not a story; items 6+ become one line each. |
| Line length | ≤ 160 characters | Mail clients wrap; tables are the exception. |
| Raw JSON | ≤ 1 line per finding, ≤ 200 characters, clipped with "…" | The HTML and the CSV hold the rest. |
| Timeline | Not in the file | `timeline.csv` is the timeline. One journey summary table replaces it. |

## Section order, headings and per-section budget

| # | Heading (H-level) | Lines | Content |
|---|---|---|---|
| 1 | `# {Site}: {verdict sentence}` (H1) | 1 | The deterministic verdict from `ux-spec.md` §3, with the site, so the title alone tells the story in a notification. |
| 2 | meta line | 2 | "Generated {date} · {j} journeys · {p} platforms · ai-tag-debugger {version} · [HTML report](report.html)". Counts line in bold: "**2 broken · 1 risk · 1 warning · 4 passed**". |
| 3 | `## Changed since last run` (H2) | ≤ 6 | Only when a previous run exists: one bold line, then fixed / new / still open as `- ` items with finding titles. "First run" is one line. |
| 4 | `## Priorities` (H2) | ≤ 12 | One `### {Owner}` (H3) per owner with findings, numbered items: `1. **Broken** purchase without value, currency · checkout · mobile · step 11`. Owners with nothing get one line: "Marketing: nothing to do". |
| 5 | `## Findings` (H2) | ≤ 50 | Up to 5 `### {Severity}: {title}` (H3) blocks, each with the fixed field list below. Findings 6+ as one line each under `### Also` (H3). |
| 6 | `## Consent` (H2) | ≤ 12 | The timing sentence per journey (one line each, or one line when identical), then the scenario table with glyphs and reasons. |
| 7 | `## What passed` (H2) | ≤ 10 | One line per check group: what was checked, where, what was seen. |
| 8 | `## Journeys` (H2) | ≤ 8 | One table row per run: journey, viewport, completed, steps, hits, findings. |
| 9 | `## Not checked` (H2) | ≤ 5 | Plan, GTM container, consent choices not supported, platforms skipped, each with the config key that enables it. |
| 10 | `## Inventory` (H2) | ≤ 8 | The vendor table as today (vendor, party, pages, cookies), capped at 10 rows plus "+n more in the HTML report". |
| 11 | footer | 2 | `---` and the credit line. |

Sections 3, 9 and 10 are omitted when empty; the others always render (an empty Findings section is the "What passed" list promoted one level).

### Finding block fields (fixed order, one line each; omit only "GTM tags" when no container was given)

```
### Broken: purchase was sent without value and currency
- Where: checkout · mobile · step 11 "Place the order" · /thanks.html · +6.7s
- Impact: GA4 reports 0 revenue for mobile orders; Google Ads gets no value to bid on.
- Evidence: `{"transaction_id":"T1792391968794","items":"idTEE-01~nmBasic Tee~pr19.9~qt1"}` (no `value`, no `currency`)
- Also fine on: checkout · desktop (value 19.9 EUR)
- Owner: Developer
- Fix: 1. add `ecommerce.value` and `ecommerce.currency` to the purchase push on the mobile thanks page; 2. re-run `--journeys checkout`
- Verify: [GA4 DebugView](https://support.google.com/analytics/answer/7201382)
- Link: report.html#f-ga4-purchase-missing_params
```

Cause and fix text come from the AI when it ran and from the per-check template otherwise; the block never says "run without --no-ai".

## Filled example from the sample capture

Built from `capture.json` of the demo-shop run (4 journeys, GA4 + Meta, consent scenarios, no plan, no AI, no previous run). 99 lines, 5.5 KB. The impact, fix and "Also fine on" lines are the per-check templates this spec asks for; today's checks emit only the campaign-parameter line under "What passed", the other three lines there are facts read from the capture (desktop purchase value, GA4/Meta agreement, no plain-text personal data in any hit) that the proposed "what passed" rule would report.

```markdown
# localhost: purchase tracking is broken on mobile

Generated 2026-10-19 06:39 UTC · 4 journeys · 2 platforms seen (GA4, Meta) · ai-tag-debugger 0.16.0 · [HTML report](report.html)
**2 broken · 1 risk · 1 warning · 4 passed** · first run, nothing to compare with yet

## Priorities

### Developer
1. **Broken** `purchase` without `value`, `currency` · checkout · mobile · step 11
2. **Broken** Meta `Purchase` without `value`, `currency` · checkout · mobile · step 11

### Tag Manager
1. **Risk** Meta `PageView` fires before consent · all 4 journeys · step 1
2. **Warning** `add_to_cart` sent twice by one click · all 4 journeys · step 4

Marketing: nothing to do.

## Findings

### Broken: `purchase` was sent without `value` and `currency`
- Where: checkout · mobile · step 11 "Place the order" · /thanks.html · +6.7s
- Impact: GA4 reports 0 revenue for mobile orders; Google Ads gets no value to bid on.
- Evidence: `{"transaction_id":"T1792391968794","items":"idTEE-01~nmBasic Tee~pr19.9~qt1"}` (no `value`, no `currency`)
- Also fine on: checkout · desktop (value 19.9 EUR, T1792391957987)
- Owner: Developer
- Fix: 1. add `ecommerce.value` and `ecommerce.currency` to the `purchase` push on the mobile thanks page; 2. re-run `--journeys checkout`
- Verify: [GA4 DebugView](https://support.google.com/analytics/answer/7201382), [Tag Assistant](https://tagassistant.google.com/)
- Link: report.html#f-ga4-purchase-missing_params

### Broken: Meta `Purchase` was sent without `value` and `currency`
- Where: checkout · mobile · step 11 "Place the order" · /thanks.html · +6.7s
- Impact: Meta cannot attribute revenue or optimise for value on mobile purchases.
- Evidence: `{}` (the pixel call carried no custom data)
- Also fine on: checkout · desktop (value 19.9 EUR)
- Owner: Developer
- Fix: 1. same push as above; the Meta tag reads `ecommerce.value` and `ecommerce.currency`; 2. re-run `--journeys checkout`
- Verify: [Meta Test Events](https://www.facebook.com/business/help/2040882565969969)
- Link: report.html#f-meta-purchase-missing_params

### Risk: Meta `PageView` fired before the visitor accepted cookies
- Where: browse · desktop, browse · mobile, checkout · desktop, checkout · mobile · step 1 "Open /" · +0.2s
- Impact: a pixel hit without consent; under GDPR this is the kind of call a regulator or a consent audit flags first.
- Evidence: `POST facebook.com/tr` at +0.2s, Consent Mode default was all denied at +0.2s; no dataLayer push matches, so the pixel fires from a page-view trigger or is hardcoded.
- Owner: Tag Manager
- Fix: 1. give the Meta Pixel tag a consent check (`ad_storage`) or an Additional Consent requirement; 2. add a GTM container export to the config to name the tag; 3. re-run
- Verify: [Meta Test Events](https://www.facebook.com/business/help/2040882565969969), [Consent Mode](https://developers.google.com/tag-platform/security/guides/consent)
- Link: report.html#f-meta-pageview-before_consent

### Warning: `add_to_cart` was sent 2 times by one action
- Where: all 4 journeys · step 4 "Add to cart" · /product.html?id=TEE-01 · +2.6s
- Impact: add-to-cart counts and any conversion built on them are doubled.
- Evidence: two identical `add_to_cart` pushes at +2.7s, each followed by a GA4 hit; Meta `AddToCart` fired once.
- Owner: Tag Manager
- Fix: 1. the site pushes twice (two click handlers on the add-to-cart button); ask the developer to remove one, or add a once-per-event guard on the GA4 tag as the Meta tag has; 2. re-run `--journeys browse`
- Verify: [Tag Assistant](https://tagassistant.google.com/)
- Link: report.html#f-ga4-add_to_cart-duplicate

## Consent

Consent Mode default (all denied) at +0.2s on every journey, before the first tag request; updated to all granted after "Accept cookies" at +1.1s.

| Tag | Before any choice | Accept all | Reject all | Analytics only |
|---|---|---|---|---|
| GA4 `page_view` | 1 · cookieless ✓ | 1 ✓ | 1 · cookieless ✓ | not run |
| GA4 `view_item_list` | 1 · cookieless ✓ | 1 ✓ | 1 · cookieless ✓ | not run |
| Meta `PageView` | 1 ✗ before consent | 1 ✓ | 1 ✗ should not send | not run |

✓ allowed · ✗ should not have been sent · "cookieless" = Consent Mode ping with storage denied · "Analytics only" not run: the banner has no such choice.

## What passed
- Campaign parameters: `gclid`, `fbclid`, `utm_*` survived the landing redirect and reached the hits on all 4 journeys.
- Purchase value and currency: checkout · desktop (19.9 EUR, 1 item, transaction id present).
- Purchase cross-platform match: GA4 and Meta agree on checkout · desktop.
- Personal data: no plain-text email or phone in any hit.

## Journeys

| Journey | Viewport | Completed | Steps | Hits | Findings |
|---|---|---|---|---|---|
| browse | desktop | yes | 4 | 9 | 2 |
| browse | mobile | yes | 4 | 9 | 2 |
| checkout | desktop | yes | 11 | 20 | 2 |
| checkout | mobile | yes | 11 | 20 | 4 |

## Not checked
- Planned events: no measurement plan given (`plan` in the config).
- GTM tag names: no container export given (`gtm_container` in the config).
- Analytics-only consent: the banner has no such choice.
- Google Ads and TikTok were in scope but the site sent nothing to them.

## Inventory

| Vendor | Party | Pages | Cookies |
|---|---|---|---|
| Google Analytics | Third party | 5 | – |
| Meta | Third party | 5 | – |

---
_Generated by ai tag debugger · [analitikisler.com](https://analitikisler.com)_
```

## Rendering rules

- Every value from the audited page goes through the existing `mdText` / `mdCode` escaping; nothing from the site becomes Markdown syntax.
- Titles use the finding's `detail` with quoted names turned into code spans, as the HTML does.
- "Also fine on" is computed from the same check passing on another run; omitted when there is none.
- When the AI ran, its `impact`, `likely_cause` (as a "Cause:" line between Impact and Evidence) and `fix_steps` replace the templates; the AI headline is appended to the meta line as "AI summary: …".
- With more than 5 actionable findings, the five most severe (by severity, then spread) get blocks; the rest are listed under `### Also` as `- **Risk** title · where`.
- Turkish output follows the same structure with the `i18n` strings; budgets are the same.
