# Report visual system

The HTML report is one self-contained file: inline CSS, inline SVG, images and fonts only as data URIs (the MCP server serves it with `default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:`). It is read on screen by marketers and developers, forwarded to clients as a PDF, and often printed in black and white. Every rule below follows from that. The working example is `docs/design/directions/d-inspector/mockup.html`, which `src/html/` implements; its layout still holds, its colours and faces are now Çini's.

## 1. Tokens

The look is **Çini · Mercan**, the Analitik İşler design system, taken from the kit in `cini/` (see `brand/README.md`). The page carries the kit's `tokens.css`, `fonts.css` and `cini.css` first (`KIT_CSS` in `src/cini.js`, written by `node scripts/cini.js`), then the report's own sheet (`CSS` in `src/html/css.js`). The report keeps its own token names, but every one is a `var()` of a kit role: the report's sheet writes no colour value (`test/cini.test.js` checks it). Colour has one job each, as the kit's README sets out: red for links and the selected rule, ink for text, teal for measured and passing, olive for warnings, wine for errors, the quiet blue for notes.

Dark mode is the kit's: its roles switch under `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`, and under `:root[data-theme="dark"]`, so a theme toggle (`<html data-theme="light|dark">`) wins over the OS and the absence of the attribute means "follow the OS". The report's names follow without a dark block of their own. `brandCss()` in `src/whitelabel.js` still emits its dark set under the same two selectors (see §9).

### Surfaces and text

| Token | Kit role | Use |
|---|---|---|
| `--page` | `--color-bg` (glaze white, warm near-black in dark) | page background |
| `--card` | `--color-surface` | cards, tables, header, footer |
| `--card-2` | `--color-surface-2` | hover and selected rows, hovered controls |
| `--well` | `--color-well` | sunken: code, counts, icon plates, tracks |
| `--fg` / `--fg-strong` / `--muted` | `--color-text` / `--color-text-strong` / `--color-muted` | text, headings and key figures, metadata |
| `--border` / `--border-strong` | `--color-border` / `--color-border-strong` | hairlines, control edges |
| `--accent`, `--accent-fg` | `--color-accent` (the brand red) | links, the selected tab and rail rule, pressed filter edges |
| `--accent-bg` | `--color-accent-soft` | selected rail item and step, pressed filter, tab count |
| `--selection` | `--color-selection` | text selection |
| focus ring | `--color-focus` | every `:focus-visible` |
| `--shadow-overlay` | the kit's own | tooltips only; nothing else casts a shadow |

Selected things keep their text in `--fg-strong`; only the rule beside them is red. The three `--accent*` names are the white-label entry point (§9).

The logos' point is `--brand-point`, the kit's `--color-brand-point`. The brand red is not the error colour: errors are wine.

### Severity

Five severities, three tokens each: `--sev-<name>` (solid: left rule, dot, ring, bar), `--sev-<name>-fg` (text, icon) and `--sev-<name>-bg` (tint). A status is one colour for text and marks, and always shows its glyph and its word (§4).

| Severity | Kit role | Tint |
|---|---|---|
| broken | `--color-bad` (wine) | `--color-bad-soft` |
| risk | `--color-bad` (wine), told apart by the diamond and the word | `--color-bad-soft` |
| warning | `--color-warn` (olive) | `--color-warn-soft` |
| info | `--color-info` (the one quiet blue) | the blue laid 12% on the surface |
| ok | `--color-ok` (teal) | `--color-ok-soft` |

Severity colours never move with the brand. Run states, finding groups and score bands are aliases of these (`--run-completed` is ok, `--score-mid` is warning, and so on). Consent: denied is wine, granted teal, none the kit's neutral muted tone.

### Categories and charts

Owners are the only category with colours of their own, the kit's chart colours 2, 4 and 6, their text mixed a quarter toward `--color-text-strong` so it reads in both themes. Platforms and viewports are plain chips: their logo or icon says which. The timing bars are a chart and take chart colours 1 and 2 in order; a chart with more than six series groups the rest as "other" rather than adding a colour.

### Missing data

Missing data takes the kit's Pano ring hatch (`--pattern-missing` in `--color-data-missing`), never a grey or a red bar: the planned events that were not sent in the coverage bar, and the score ring when there is no score. The coverage bar's other segments are the kit's `--color-data-measured` and `--color-data-broken`.

### Spacing, radii, shadows, motion

The kit's 4px steps under the builders' names: `--s1` to `--s7` are 4, 8, 12, 16, 24, 32 and 48px (`--space-1` … `--space-9`). Card padding `--s4` (`--s5` on ≥768px). Dense tables: `7px 10px` cells. Grid gaps `--s3`/`--s4`.
`--r-cell: 1px` (bar segments, timing bars), `--r-sm: 2px` (chips, badges, code, counts, icon plates, step numbers), `--r-ctl: 4px` (buttons, the search field, the filters fold, rail items, tooltips), `--r-md: 6px` (cards, tables, the filter bar, the scorecard), the kit's `--radius-*`. No pill shapes: the only round marks are the status dots and the score ring.
No shadows on cards, panels or bars: depth comes from the grounds (`--well` < `--page` < `--card` < `--card-2`) and 1px borders. `--shadow-overlay` is for the rail and parameter tooltips.
Transitions are the kit's `--motion-fast` and `--motion-base` on `--motion-ease-out`, only on chevrons, tab rules and the rail; the 1.5s flash that marks a revealed element is kept because it is how a jump shows where it landed. All motion is off under `prefers-reduced-motion`.

### The Pano band

An Analitik İşler report and `plan.html` draw one Pano band above the footer (`field()` from `cini/pano.js`, seeded with the site so a site always draws the same band). A white-labelled report or `branding: false` leaves it out, and print hides it.

## 2. Typography

Gabarito for everything people read and press, Azeret Mono for code, event names, IDs and figures, and nothing else. Both are the kit's, carried in the page as data URIs (the kit's `fonts.css`), with the kit's metric-matched fallbacks behind them. The report names them through the kit's roles: `--font-sans` is `--font-body`, `--font-display` and `--font-mono` are the kit's own.

| Role | Size / line | Weight | Notes |
|---|---|---|---|
| Score figure | 44 / 1 (48 in the Summary) | display (700) | `--fg-strong`, tabular |
| Verdict word | 30 / 1.1 | display (700) | in the band's colour |
| Page title (h1) | 24 / 1.2 | display (700) | `--fg-strong`, `overflow-wrap: anywhere`; screen-reader only in the report, visible on `plan.html` |
| Section (h2) | 17 / 1.3 | display (700) | `--fg-strong`; one per tab; `break-before: page` in print |
| Card / group (h3) | 14 / 1.4 | 600 | `--fg-strong` |
| Body | 14 / 1.5 | 400 | base; density matters more than comfort here |
| Labels | 12 / 1.4 | 500 | filter group names, run facts, panel headings (Parameters, Items, Source), the no-JS tab labels; `--muted`, sentence case |
| Eyebrow | the kit's `.eyebrow` | 500 | mono, small capitals, `--muted` |
| Small | 12.5 / 1.45 | 400 | meta lines, table heads, chips |
| Mono | 12.5 / 1.5 | 400 | event names, parameter names and values, URLs, times. Event names always in `<code>` |

Numbers in tables use `tabular-nums` everywhere. Labels are set as written, in sentence case, except the kit's eyebrow. The journey tabs keep `text-transform: capitalize` on the journey's id (`browse` shows as "Browse").

Two rules keep the geometry the same whatever face draws the page (the kit's, its fallback, or another when a reader's settings override it); `test/report-html.test.js` renders all three:

- The score and "/100" are trimmed to their cap height and baseline (`text-box: trim-both cap alphabetic`) and stacked as one group in the middle of the ring. Untrimmed, a font's own ascent and descent moved the same digits by up to 4px. Browsers without `text-box` keep tuned margins.
- In the Summary's score lines the points sit on the text's first baseline and the chips at the top of the row, so a line that wraps keeps them beside its first line instead of halfway down.

## 3. Platform icons

Today `src/report.js` embeds each platform icon as a base64 SVG in the `CSS` constant and paints it as a `background` on `.ptag::before` / `.dot`. That has two costs: browsers drop background images when "print background graphics" is off (the default in Chrome's print dialog), and a CSS background cannot take `currentColor`. The system keeps the same artwork and moves it into an inline `<svg hidden>` sprite of `<symbol id="p-ga4">` elements referenced with `<use href="#p-ga4">`. Sizes: **14px** inline in text and chips, **16px** in table rows and event lists, **20px** in finding-card headers and the run-facts row. Always `aria-hidden="true"` with the platform name as visible text beside it (or `<title>` when the name is not shown, as in step-row hit chips, where the event name is shown and the platform is in the `title` tooltip and `aria-label`).

Fallback for a platform with no artwork (new providers, white-label vendors): a 16px square with 2px corners (`--r-sm`) filled `--well` with the platform's first letter in mono 10px `--muted`, e.g. **K** for Klaviyo, **PW** for Piwik PRO when two words. Never a coloured square: colour would read as a severity.

Dark mode: the TikTok glyph uses `#111` and the X glyph `#000`; both get a `.plate` 2px white backing in dark mode (`<rect>` in the symbol with `fill: var(--card)` and a 1px `--border`), so no icon disappears. In print all icons render because they are inline SVG.

## 4. Severity badges

A badge is **icon + word**, never colour alone, so the five severities survive colour-blindness, greyscale print and a photocopy:

| Severity | Shape | Glyph |
|---|---|---|
| broken | octagon | × |
| risk | diamond | ! |
| warning | triangle | ! |
| info | circle | i |
| ok | circle | ✓ |

Badge: `display:inline-flex; gap:4px; padding:2px 8px 2px 6px; border-radius: var(--r-sm); font: 500 12px/16px var(--font-sans); background: var(--card); color: var(--sev-*-fg)` with a 1px border mixed from the severity colour and `--border`: an outline tag, never a filled pill; icon 14px, stroke 1.75. In print the badge gets a 1px `currentColor` border (§8). The same symbols are used at 18px as the finding-card marker and at 12px as the flag beside a hit in a step row. Severity order is fixed everywhere: broken, risk, warning, info, ok.

## 5. Tables

Two table kinds, both real `<table>`s with `<thead>`/`<th scope="col">`:

- **`.dt` data tables** (journeys, consent scenarios, inventory, plan coverage): 13px, cells `7px 10px`, head row on the card with 12px weight 500 `--muted` labels in sentence case over a 1px `--border-strong` rule, hairline rows, hovered rows in `--card-2`, no zebra. Numbers right-aligned and tabular. A problem cell is `--sev-broken-fg` **and** carries the broken glyph before the number (`1 ×`), so the consent table reads in greyscale. "Not run" cells are `–` in `--muted`.
- **`.steps` tables** (hits per step): one row per step: `#` plate · step label · `+t` · hits (a wrapped row of `event` chips, each icon + mono name, flagged ones with the severity glyph and a tinted border) · dataLayer count. Rows with a problem get a 3px left rule in the worst severity's solid. Under 640px the row becomes a two-line block (number, label and time on line one; hits on line two) via `display:grid`, with `<th>`s kept but visually hidden.

Every table sits in a `.tscroll` (`overflow-x:auto`) so a long URL never widens the page at 390px. Cell text uses `overflow-wrap:anywhere`.

## 6. Finding card anatomy

```
<li class="finding sev-broken">                   3px left rule in --sev-broken
  <details open>
    <summary>  [octagon 18px]  Title (detail text; "quoted" names → <code>)
               meta row: [platform 20px + name] · <code>event</code> · owner chip · "1 journey · 1 step"
                                                              [Broken badge] [chevron]
    <div class="fbody">
      Impact strip  (tint --sev-*-bg, icon trending-down, one sentence)
      ┌ left column ────────────────┐ ┌ right column ───────────────────┐
      │ Likely cause  (paragraph)   │ │ Fix  (numbered steps, 1. 2. 3.) │
      │ Evidence  (.ptable key/val, │ │ Where  (chips: step plate +      │
      │   missing params as rows    │ │   journey · viewport · step,     │
      │   marked "missing")         │ │   each a link to #jN-sM)         │
      │ GTM tags (when a container) │ │ How to verify (tool links)       │
      └─────────────────────────────┘ └──────────────────────────────────┘
```

Owner chip: outline chip, 12px, text "Developer" / "Tag Manager" / "Marketing", no colour. The card body is two columns from 768px, one below. Impact, cause and fix are AI text; without AI the card shows cause/fix as one muted line ("Run with an AI provider for a likely cause and fix steps") and keeps Evidence, Where and How to verify, which are deterministic. Cards never nest tabs. The first card of each owner group is open by default; in print all are open.

## 7. Code and parameters

`<code>` inline: mono 12.5px on `--well`, `1px 5px`, `--r-sm`, `overflow-wrap:anywhere`, no colour (colour is reserved for severity and links). Parameter tables (`.ptable`): mono 12.5px, key column `<th scope="row">` in `--muted` with `width:1%; min-width:120px; white-space:nowrap`, values wrap. A missing required parameter is a row whose value cell is the badge-styled word **missing** in `--sev-broken-fg` on `--sev-broken-bg`. Raw payloads (`<pre>`) wrap (`white-space:pre-wrap`), never scroll horizontally. URLs are shown as host + path, query folded into the parameter table.

## 8. Print and PDF

`writePdf()` prints A4 with `printBackground: true`, JavaScript off and `colorScheme: "light"`, so print styles are the no-JS layout: all tabs stacked, all `details` open. The rules:

- `.topbar .actions`, `[role=tablist]`, the journey sub-tabs, filters and the theme toggle are `display:none`.
- `h2` sections get `break-before: page`; `.finding`, `.card`, `.steps tr`, `.ptable` get `break-inside: avoid`; `h2, h3` get `break-after: avoid`.
- Tints are dropped (`background: none`) on badges, impact strips and table heads; badges and chips get a `1px solid currentColor` border; severity left rules stay (borders print). The page is white, cards keep hairlines. Nothing meaningful is carried only by a background: icons are inline SVG, severities carry a glyph and a word, problem cells carry `×`.
- Links keep their text only; no `::after { content: attr(href) }` (the verify links are tool names, URLs would clutter).
- Sticky positioning is removed; `body { font-size: 12.5px }`; the verdict block prints on page one with the counts and run facts.
- Recommended for `writePdf`: `displayHeaderFooter: true` with a 9px footer template `site · date · page N of M`, since a forwarded PDF loses the file name. Margins stay 14mm/10mm.

## 9. White label

A customer can set `report.color` (one hex) and `report.logo`/`report.name`. `brandCss(color)` writes `--accent`, `--accent-fg`, `--accent-bg`. The system draws from those three tokens only the things that say "this document belongs to the brand": the active tab rule, focus rings, link colour, the step index plate, and the fix-step numerals. Severity, platform icons, text and surfaces never change. `brandCss` emits its dark set under both dark selectors of §1.

`brandTokens(color)` in `src/whitelabel.js` derives the three tokens per theme, and both themes follow the same rule:

- `--accent-bg`, the tint, is the brand colour laid on the card: 10% on white in light, 25% on the kit's dark surface in dark.
- `--accent-fg`, the link colour, starts at the brand colour mixed 20% toward black (light) or 50% toward white (dark) and is mixed further in 10% steps until it reads at 4.5:1 on every ground a link sits on (the kit's surface, bg, surface-2 and well, from `KIT_COLORS` in `src/cini.js`) and on that tint.
- `--accent`, the colour of marks (the tab and rail rules, focus rings, pressed filter edges), starts at the brand colour itself (light) or mixed 20% toward white (dark) and is moved the same way until it reaches 3:1 on the same grounds and the tint.

Mixing toward black or white keeps the brand's hue: a pale yellow becomes a darker gold, never another colour. A colour that already passes is left as it is.

For example, `#0a7d5a` passes as it is in both themes (light `#0a7d5a` · `#086448` · `#e7f2ef`, dark `#3b977b` · `#85bead` · `#183227`); a pale yellow such as `#ffe066` gets a darker gold in light.

`test/whitelabel.test.js` checks awkward colours (pale, near-white, pure red, a dark navy, black) in both themes against every ground and the tint, reading the grounds from the kit roles `TOKENS` points at. A near-white brand in light and a navy or black brand in dark get a tint that is all but the card itself; the selected rail item, step and filter then show through the accent rule, the edge and the weight, which pass 3:1.

Logo slots: the top-left product slot (the ai tag debugger lockup at 22px, the ai mark alone at 24px on phones, or the customer's logo or `brand-name` text), the "by Analitik İşler" byline (the master logo at 16px) which a white-label run drops, and the footer (the master logo at 24px, or the customer's). The credit line shows the tool favicon at 16px beside the name in every case, since BRAND.md puts anything under 24px on the favicon files. Those sizes keep the lockup's x-height above the guide's 9px minimum. The files are the kit's, in `cini/logos/`, embedded by `scripts/brand.js`. The brand's logos are symbols in the page's inline sprite, drawn with `logo()` in `src/html/lib.js`: their ink is `currentColor`, set to `--fg-strong` (the kit's text-strong ink), and their point is `--brand-point`, as BRAND.md §4 asks of a product's UI. They follow light, dark and print without a second file. The favicon tiles carry their own ground, so they stay a light and a dark image. A customer logo has one source and sits on `--card`, so the topbar and footer backgrounds must stay `--card` in dark mode rather than `--page`.

## 10. Dark mode

Dark mode is the kit's second palette, not an inversion: warm near-black grounds (`--well` below `--page`, `--card` and `--card-2` above), the kit's dark soft tints, and the lighter dark values of every role. Order of precedence: `data-theme="dark"` > `data-theme="light"` > `prefers-color-scheme`. The toggle is a `<button aria-pressed>` cycling auto → light → dark, stored in `localStorage` inside `try/catch` (file:// and the MCP viewer may deny it); without JS the attribute is absent and the OS decides. `color-scheme: light dark` is set on `:root` so form controls and scrollbars follow. Logos switch through `<picture>` sources, which follow `prefers-color-scheme` only; a forced theme must therefore also toggle a `.theme-dark` class the CSS uses to swap the two `<img>`s (the prototype does this).
