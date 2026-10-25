# Report visual system

The HTML report is one self-contained file: inline CSS, inline SVG, images only as data URIs (the MCP server serves it with `default-src 'none'; style-src 'unsafe-inline'; img-src data:`). It is read on screen by marketers and developers, forwarded to clients as a PDF, and often printed in black and white. Every rule below follows from that. The working example is `docs/design/directions/d-inspector/mockup.html`, which `src/html/` implements; its tokens are the `TOKENS` constant in `src/html/css.js`.

## 1. Tokens

The values are those of Tally, the Analitik İşler design system that analitikisler.com uses, so the report, `plan.html` and the site read as one family: navy grounds, one action blue, the Google Sans family, sharp corners, 1px rules and no decoration. The report keeps its own token names; the comment at the top of `TOKENS` says which Tally token each one follows. The AI Tag Debugger orange (`#D9531E` light, `#FF6D33` dark) stays in the logo and the emblem only.

All tokens live on `:root`. Dark mode redefines the same names, twice: once under `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`, and once under `:root[data-theme="dark"]`, so a theme toggle (`<html data-theme="light|dark">`) wins over the OS and the absence of the attribute means "follow the OS". `brandCss()` in `src/whitelabel.js` must emit its dark set under the same two selectors, or a forced light theme on a dark OS gets the dark accent (see §9).

Contrast is measured with WCAG 2.1 relative luminance. Text needs 4.5:1, control edges, focus rings and meaningful marks 3:1. Every pair below was computed from the `TOKENS` constant in both themes: 174 pairs per theme, all pass. Lowest text pair: `--plat-ga4-fg` on `--well` 4.61 (light), `--consent-denied-fg` on its own tint 4.60 (dark). Lowest non-text pair: a category solid on `--well` 3.00 (light), `--border-strong` on `--card-2` 3.28 (dark).

### Surfaces and text

| Token | Tally | Light | Dark | Use |
|---|---|---|---|---|
| `--page` | `bg` | `#f4f6fa` | `#071529` | page background |
| `--card` | `surface` | `#ffffff` | `#0e1e34` | cards, tables, header, footer |
| `--card-2` | `surface-2` | `#ecf1f8` | `#15263f` | hover and selected rows, hovered controls |
| `--well` | `well` | `#e9eef5` | `#040e1f` | sunken: code, counts, icon plates, tracks |
| `--fg` | `text` | `#142338` | `#e1e8f3` | text (15.82 / 13.59 on card) |
| `--fg-strong` | `text-strong` | `#071529` | `#f9fbff` | headings, the score, key figures |
| `--muted` | `muted` | `#566479` | `#a2b1c6` | metadata (6.01 / 7.69 on card, 5.15 / 8.86 on well) |
| `--border` | `border` | `#d5dde8` | `#22354e` | hairlines, 1px only |
| `--border-strong` | `border-strong` | `#78869a` | `#607695` | control edges, the rule under a table head (3.26 / 3.28 at the lowest, on card-2) |
| `--accent` | `accent` | `#1161bb` | `#69b1ff` | active tab and rail rule, focus ring, pressed filters (6.08 / 7.44 on card) |
| `--accent-fg` | `accent` | `#1161bb` | `#69b1ff` | links, link-like text (6.08 / 7.44 on card, 5.12 / 5.75 on `--accent-bg`) |
| `--accent-bg` | `accent-soft` | `#deedff` | `#0c325b` | selected rail item and step, pressed filter, tab count |
| `--selection` | `selection` | `#c6defc` | `#123f6f` | text selection (`--fg` 11.49 / 8.67 on it) |
| `--shadow-overlay` | overlay shadow | `0 16px 48px rgb(7 21 41 / 14%)` | `0 16px 48px rgb(2 8 18 / 55%)` | tooltips only; nothing else casts a shadow |

The three `--accent*` names are the white-label entry point and keep the names `brandCss()` already writes. Nothing else may be derived from a brand color (§9). Blue means measured or actionable: links, focus, selected tabs and filters, never decoration.

The logos' point is `--brand-point`, the brand's one red (`brand/ai/BRAND.md` §4). It is Tally's bad, the same value as `--sev-broken` (`#c12d30` light, `#fa6b6d` dark), so a page never shows two reds.

### Severity

Five severities, three tokens each: `--sev-<name>` (solid: left rule, dot, ring, bar), `--sev-<name>-fg` (text, icon) and `--sev-<name>-bg` (tint). As in Tally, a status is one colour for text and marks, so `-fg` equals the solid; the tint is the colour mixed into `--card`, 10% in light and 16% in dark.

| Severity | Tally | Light | fg on card · page · card-2 · well · tint | Dark | fg on card · page · card-2 · well · tint |
|---|---|---|---|---|---|
| broken | `bad` | `#c12d30` / tint `#f9eaea` | 5.70 · 5.27 · 5.02 · 4.89 · 4.88 | `#fa6b6d` / `#342a3d` | 5.89 · 6.43 · 5.35 · 6.79 · 4.78 |
| risk | own hue | `#964799` / `#f5edf5` | 5.74 · 5.31 · 5.06 · 4.92 · 5.01 | `#dc86de` / `#2f2f4f` | 6.78 · 7.41 · 6.16 · 7.82 · 5.19 |
| warning | `warn` | `#8b6200` / `#f3efe6` | 5.46 · 5.05 · 4.81 · 4.68 · 4.76 | `#f4cf5a` / `#333a3a` | 11.10 · 12.12 · 10.08 · 12.80 · 7.70 |
| info | `accent` | `#1161bb` / `#e7eff8` | 6.08 · 5.62 · 5.36 · 5.22 · 5.24 | `#69b1ff` / `#1d3654` | 7.44 · 8.13 · 6.76 · 8.58 · 5.46 |
| ok | `ok` | `#197746` / `#e8f1ed` | 5.57 · 5.15 · 4.91 · 4.78 · 4.84 | `#5ad093` / `#1a3a43` | 8.68 · 9.47 · 7.88 · 10.00 · 6.29 |

**Risk keeps a hue of its own.** Tally makes risk red, told apart from broken by its diamond glyph and its word, and lets a product keep a separate risk hue when its screens put the two side by side. The report does: the score lines, the filter dots, the rail and the 3px card rules show broken and risk next to each other, and a dot or a rule has no room for a glyph. The plum passes the same contrast as the statuses and stays apart from broken under deuteranopia and protanopia simulated with Machado et al. (2009) at full severity (OKLab ΔE 16.9 and 16.7 light, 15.6 and 16.5 dark). Risk still carries its diamond and its word wherever it has room.

**Info is the accent's value, not the accent.** `--sev-info` is written as Tally's accent hex rather than `var(--accent)`, so a white label with a red accent never turns info findings red next to broken ones. Severity colours never move with the brand. No status is orange: orange is GA4's category colour and Tally's mark.

### Categories

Owners, platforms, viewports and consent states each keep their own hue, retuned to sit on the navy grounds. `-fg` is the text colour, the solid colours dots, icons and bars, the tint is mixed into `--card` like the severity tints. Every `-fg` passes 4.5:1 on card, page, card-2, well and its own tint; every solid 3:1 on card, page and well.

| Token | Light solid / fg | Dark solid / fg | Lowest fg ratio light · dark | Solid on well light · dark |
|---|---|---|---|---|
| `--owner-developer` | `#7b7ee4` / `#5b5bbd` | `#7679de` / `#a5abff` | 4.90 · 6.38 | 3.03 · 5.11 |
| `--owner-gtm` | `#2194b9` / `#086f8d` | `#148eb2` / `#54bde3` | 4.91 · 6.35 | 3.00 · 5.09 |
| `--owner-marketing` | `#d85f92` / `#af3a6f` | `#d1598d` / `#ff88b7` | 4.92 · 6.39 | 3.02 · 5.08 |
| `--plat-ga4` | `#d46700` / `#b14c00` (Tally `mark` / `mark-ink`) | `#fa8c31` / `#fa8c31` | 4.61 · 5.47 | 3.14 · 8.15 |
| `--plat-meta` | `#4b85f6` / `#2960ce` | `#457fef` / `#88b1fe` | 4.92 · 6.30 | 3.01 · 5.09 |
| `--plat-google_ads` | `#379b55` / `#027634` | `#2f954f` / `#63c47b` | 4.94 · 6.37 | 3.01 · 5.09 |
| `--plat-tiktok` | `var(--fg)` | `var(--fg)` | 13.57 · 12.34 | 13.57 · 15.66 |
| `--vp-desktop` | `#1e9895` / `#08726f` | `#0f928f` / `#53c1bd` | 4.94 · 6.32 | 3.01 · 5.08 |
| `--vp-mobile` | `#7a922c` / `#596e01` | `#748d25` / `#9fba56` | 4.93 · 6.32 | 3.01 · 5.13 |
| `--consent-granted` | `var(--sev-ok)` | `var(--sev-ok)` | 4.78 · 6.29 | 4.78 · 10.00 |
| `--consent-denied` | `#a8162c` | `#ff5c69` | 6.27 · 4.60 | 6.40 · 6.42 |
| `--consent-none` | `var(--border-strong)` / `var(--muted)` | same | 5.15 · 6.98 | 3.17 · 4.16 |

Denied shares broken's red on purpose and is told apart by weight: a deeper red in light, a full-colour outline, a 600 value in the mono key/value form, never the octagon. The run, group and score families are aliases of the severities (`--run-completed` is ok, `--score-mid` is warning, and so on), so dark mode follows them.

### Spacing, radii, shadows, motion

`--s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px; --s7: 48px`, Tally's 4px base. Card padding `--s4` (`--s5` on ≥768px). Dense tables: `7px 10px` cells. Grid gaps `--s3`/`--s4`.
`--r-cell: 1px` (bar segments, timing bars), `--r-sm: 2px` (chips, badges, code, counts, icon plates, step numbers), `--r-ctl: 4px` (buttons, the search field, the filters fold, rail items, tooltips), `--r-md: 6px` (cards, tables, the filter bar, the scorecard). No pill shapes: the only round marks are the status dots and the score ring.
No shadows on cards, panels or bars: depth comes from the grounds (`--well` < `--page` < `--card` < `--card-2`) and 1px borders. `--shadow-overlay` is for the rail and parameter tooltips.
Transitions are 160ms (`--t-fast`) or 220ms (`--t-base`) on `cubic-bezier(.2,0,0,1)` (`--ease`), only on chevrons, tab rules and the rail; the 1.5s flash that marks a revealed element is kept because it is how a jump shows where it landed. All motion is off under `prefers-reduced-motion`.

## 2. Typography

Tally's families, named first, with the system behind them. The report is one file and ships no font files (no `@font-face`, no `url(`), so a machine without the Google Sans family shows the system face; one that has them installed shows the design system's.

```
--font-sans: "Google Sans", "Segoe UI Variable Text", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
--font-display: "Google Sans Flex", "Google Sans", "Segoe UI Variable Display", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
--font-mono: "Google Sans Code", ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace;
```

| Role | Size / line | Weight | Notes |
|---|---|---|---|
| Score figure | 44 / 1 (48 in the Summary) | 570, display | `--fg-strong`, tabular |
| Verdict word | 30 / 1.1 | 570, display | in the band's colour |
| Page title (h1) | 24 / 1.2 | 570, display | `--fg-strong`, `letter-spacing: -.012em`, `overflow-wrap: anywhere`; screen-reader only in the report, visible on `plan.html` |
| Section (h2) | 17 / 1.3 | 600 | `--fg-strong`; one per tab; `break-before: page` in print |
| Card / group (h3) | 14 / 1.4 | 600 | `--fg-strong` |
| Body | 14 / 1.5 | 400 | base; density matters more than comfort here |
| Labels | 12 / 1.4 | 500 | filter group names, run facts, panel headings (Parameters, Items, Source), the no-JS tab labels, the eyebrow; `--muted`, sentence case |
| Small | 12.5 / 1.45 | 400 | meta lines, table heads, chips |
| Mono | 12.5 / 1.5 | 400 | event names, parameter names and values, URLs, times. Event names always in `<code>` |

Weights are 400, 500 and 600, and 570 for the display face. Numbers in tables use `tabular-nums` everywhere. No uppercase and no letter-spaced caps anywhere: every label is set as it is written, in sentence case. The journey tabs keep `text-transform: capitalize` on the journey's id (`browse` shows as "Browse").

### Without Google Sans

Most readers have none of the three families, so the report is checked with them taken out of the stacks: Summary, Findings with a card open, Journeys and `plan.html`, light and dark, at 1280 and 390px, rendered in Chromium on macOS. What the stacks fall back to:

| System | Text and display | Mono | 500 | 570 (display) | 600 |
|---|---|---|---|---|---|
| macOS | SF Pro (`system-ui`), variable | Menlo in Chrome and Firefox (only Safari knows `ui-monospace`) | 500 | 570 | 600 |
| Windows 11 | Segoe UI Variable (Text for text, Display for display), variable | Cascadia Mono where installed, else Consolas | 500 | 570 | 600 |
| Windows 10 | Segoe UI: 300, 350, 400, 600, 700, 900 | Cascadia Mono where installed, else Consolas | 400 | 600 | 600 |
| Linux | the desktop's UI face: DejaVu Sans (400, 700), Ubuntu (300 to 700), Noto Sans, Cantarell (variable) | the `monospace` default, often DejaVu Sans Mono | 400 in DejaVu Sans | 700 in DejaVu Sans and Ubuntu, 600 in Noto Sans | 700 |
| Android | Roboto (100 to 900) | Roboto Mono or Droid Sans Mono | 500 | 700 | 700 |

Only the macOS row was rendered; the others follow from the faces each system ships and from how browsers pick a weight, and are expected rather than seen. No weight is ever faked: Chromium only draws a synthetic bold when the weight asked for is more than 200 above the face it found, and the heaviest the report asks for is 600, which every face above has. So 570 always lands on a real face, a step heavier than designed where the family has no semibold. Where the family is static, Chromium on macOS rounds 570 down instead (a static Google Sans without Flex gives Medium); SF is variable, so that never shows with the system face.

Two rules keep the geometry the same whatever face the system lends:

- The score and "/100" are trimmed to their cap height and baseline (`text-box: trim-both cap alphabetic`) and stacked as one group in the middle of the ring. Untrimmed, the font's own ascent and descent moved the same digits by up to 4px: Google Sans sat 2.4px below the middle, SF 4.1px. Browsers without `text-box` (Firefox today) keep the margins tuned for Google Sans.
- In the Summary's score lines the points sit on the text's first baseline and the chips at the top of the row, so a line that wraps (SF and Segoe UI are wider than Google Sans, DejaVu Sans wider still) keeps them beside its first line instead of halfway down.

Known risks with the system faces: `system-ui` gives Windows the static Segoe UI, which has no 500, so the stacks name Segoe UI Variable first (Text for text, Display for display): on Windows 11 every weight is there. On Windows 10, which has only the static face, the labels, chips, tabs, filters, badges and table heads set at 500 show at 400 and their weight no longer sets them apart (size and colour still do). DejaVu Sans is the widest face likely: with Verdana standing in for it (both keep Bitstream Vera's proportions) nothing scrolls sideways at 390px, and long step labels in the Journeys list are cut with an ellipsis sooner.

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

- `--accent-bg`, the tint, is the brand colour laid on the card: 10% on white in light, 25% on Tally's navy `#0e1e34` in dark, as the default `--accent-bg` sits on it.
- `--accent-fg`, the link colour, starts at the brand colour mixed 20% toward black (light) or 50% toward white (dark) and is mixed further in 10% steps until it reads at 4.5:1 on every ground a link sits on (card, page, card-2 and well) and on that tint.
- `--accent`, the colour of marks (the tab and rail rules, focus rings, pressed filter edges), starts at the brand colour itself (light) or mixed 20% toward white (dark) and is moved the same way until it reaches 3:1 on the same grounds and the tint.

Mixing toward black or white keeps the brand's hue: a pale yellow becomes a darker gold, never another colour. A colour that already passes is left as it is.

| Brand | Light accent · link · tint | Lowest link · mark, light | Dark accent · link · tint | Lowest link · mark, dark |
|---|---|---|---|---|
| `#0a7d5a` (unchanged) | `#0a7d5a` · `#086448` · `#e7f2ef` | 6.15 · 4.40 | `#3b977b` · `#85bead` · `#0d363e` | 6.17 · 3.65 |
| `#ffe066` pale yellow | `#96853d` · `#796a31` · `#fffcf0` | 4.60 · 3.15 | `#ffe685` · `#fff0b3` · `#4a4f41` | 7.39 · 6.80 |
| `#a0f0ff` pale cyan | `#5f8e96` · `#4d7179` · `#f6feff` | 4.56 · 3.11 | `#b3f3ff` · `#d0f8ff` · `#335367` | 7.21 · 6.68 |
| `#fafafa` near-white | `#868686` · `#6a6a6a` · `#ffffff` | 4.64 · 3.12 | `#fbfbfb` · `#fdfdfd` · `#495566` | 7.44 · 7.31 |
| `#ff0000` red | `#ff0000` · `#cc0000` · `#ffe6e6` | 4.97 · 3.37 | `#ff3333` · `#ff8080` · `#4a1727` | 6.00 · 4.00 |
| `#0b1f3a` dark navy | `#0b1f3a` · `#09192e` · `#e7e9eb` | 14.50 · 13.57 | `#727d8c` · `#858f9d` · `#0d1e36` | 4.64 · 3.64 |

The lowest ratio is over card, page, card-2, well and the tint; `test/whitelabel.test.js` checks these colours and a few more in both themes, reading the grounds from `TOKENS`. A near-white brand in light and a navy or black brand in dark get a tint that is all but the card itself; the selected rail item, step and filter then show through the accent rule, the edge and the weight, which pass 3:1.

Logo slots: the top-left product slot (the ai tag debugger lockup at 22px, the ai mark alone at 24px on phones, or the customer's logo or `brand-name` text), the "by Analitik İşler" byline (the master logo at 16px) which a white-label run drops, and the footer (the master logo at 24px, or the customer's). The credit line shows the tool favicon at 16px beside the name in every case, since `brand/ai/BRAND.md` puts anything under 24px on the favicon files. Those sizes keep the lockup's x-height above the guide's 9px minimum. The files are in `brand/ai/assets/`, embedded by `scripts/brand.js`; the orange set they replace is under `brand/retired/`. The brand's logos are symbols in the page's inline sprite, drawn with `logo()` in `src/html/lib.js`: their ink is `currentColor`, set to `--fg-strong` (Tally's text-strong, the navy ink BRAND.md names for the site), and their point is `--brand-point`, as BRAND.md §4 asks of a product's UI. They follow light, dark and print without a second file. The favicon tiles carry their own ground, so they stay a light and a dark image. A customer logo has one source and sits on `--card`, so the topbar and footer backgrounds must stay `--card` in dark mode rather than `--page`.

## 10. Dark mode

Dark mode is a second palette, not an inversion: surfaces are Tally's navy (`--page #071529`, `--card #0e1e34`, `--well #040e1f` below them and `--card-2 #15263f` above), tints are the hue mixed 16% into the card, text on tints is the light `-fg`. Order of precedence: `data-theme="dark"` > `data-theme="light"` > `prefers-color-scheme`. The toggle is a `<button aria-pressed>` cycling auto → light → dark, stored in `localStorage` inside `try/catch` (file:// and the MCP viewer may deny it); without JS the attribute is absent and the OS decides. `color-scheme: light dark` is set on `:root` so form controls and scrollbars follow. Logos switch through `<picture>` sources, which follow `prefers-color-scheme` only; a forced theme must therefore also toggle a `.theme-dark` class the CSS uses to swap the two `<img>`s (the prototype does this).
