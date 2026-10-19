# Report visual system

The HTML report is one self-contained file: inline CSS, inline SVG, images only as data URIs (the MCP server serves it with `default-src 'none'; style-src 'unsafe-inline'; img-src data:`). It is read on screen by marketers and developers, forwarded to clients as a PDF, and often printed in black and white. Every rule below follows from that. The working example is `docs/design/prototype/report.html`; `docs/design/prototype/NOTES.md` maps it to `src/report.js`.

## 1. Tokens

All tokens live on `:root`. Dark mode redefines the same names, twice: once under `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`, and once under `:root[data-theme="dark"]`, so a theme toggle (`<html data-theme="light|dark">`) wins over the OS and the absence of the attribute means "follow the OS". `brandCss()` in `src/whitelabel.js` must emit its dark set under the same two selectors, or a forced light theme on a dark OS gets the dark accent (see §9).

### Surfaces and text

| Token | Light | Dark | Use |
|---|---|---|---|
| `--page` | `#F6F7F9` | `#0B0F19` | page background |
| `--card` | `#FFFFFF` | `#141927` | cards, tables, header, footer |
| `--well` | `#EEF1F6` | `#1B2235` | code chips, inset blocks, table heads |
| `--fg` | `#111827` | `#EEF2FF` | text (17.7:1 / 15.7:1 on card) |
| `--muted` | `#4B5567` | `#9AA4BD` | secondary text (7.5:1 / 7.0:1 on card, 7.0:1 / 7.7:1 on page) |
| `--border` | `#D9DEE8` | `#263050` | hairlines, 1px only |
| `--accent` | `#2E6CDB` | `#4F8EF7` | active tab rule, focus ring, step index (4.9:1 / 5.5:1 as a mark) |
| `--accent-fg` | `#2459C0` | `#8CBBFF` | links, link-like text (6.4:1 / 8.9:1 on card) |
| `--accent-bg` | `#EBF1FE` | `#1A2F5C` | selected row, step number plate |

The three `--accent*` names are the white-label entry point and keep the names `brandCss()` already writes. Nothing else may be derived from a brand color (§9).

### Severity

Five severities, three tokens each: `--sev-<name>-fg` (text, icon), `--sev-<name>-bg` (tint), `--sev-<name>` (solid: left rule, dot, bar segment). Contrast is measured with WCAG 2.1 relative luminance; "card" is `--card`, "tint" is the severity's own `-bg`. Text needs 4.5:1, solid marks 3:1.

| Severity | Light fg / bg / solid | fg on card · page · tint; solid on card | Dark fg / bg / solid | fg on card · page · tint; solid on card |
|---|---|---|---|---|
| broken | `#B42318` / `#FEE4E2` / `#D92D20` | 6.6 · 6.1 · 5.5; 4.8 | `#FDA29B` / `#3D1D1D` / `#F04438` | 9.0 · 9.9 · 7.8; 4.7 |
| risk | `#86338A` / `#F7E8F7` / `#9B3B9A` | 7.4 · 6.9 · 6.3; 6.0 | `#E3A6E0` / `#34203A` / `#D78AD6` | 9.0 · 9.9 · 7.6; 7.1 |
| warning | `#7A5A00` / `#FBF0D0` / `#B7791F` | 6.4 · 6.0 · 5.6; 3.6 | `#F5C451` / `#352B10` / `#E8B44A` | 10.8 · 11.8 · 8.6; 9.2 |
| info | `#3F4D6B` / `#E9EDF5` / `#5B6B8C` | 8.5 · 7.9 · 7.2; 5.4 | `#B4C0DC` / `#1E2536` / `#8191B8` | 9.6 · 10.5 · 8.4; 5.6 |
| ok | `#167A55` / `#E1F3EA` / `#17805A` | 5.3 · 5.0 · 4.6; 4.9 | `#5BD39A` / `#113128` / `#3FB98A` | 9.4 · 10.2 · 7.5; 7.1 |

Two deliberate changes from 0.16.0: **risk is plum, not orange.** Red, orange and amber are one ramp; under deuteranopia the old broken/risk pair measured ΔE 0.8 and even full-colour readers got 6.3 (the dataviz validator's floor is 15). Red / plum / amber / slate / green pass as four adjacent pairs in both modes. **Info is slate, not the accent.** A white-label customer with a red accent must not get red info findings next to red broken ones. Severity colours never move with the brand.

### Spacing, radii, shadows, motion

`--s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px; --s7: 48px`. Card padding `--s4` (`--s5` on ≥768px). Dense tables: `6px 10px` cells. Grid gaps `--s3`/`--s4`.
`--r-sm: 4px` (badges, chips, code, step index), `--r-md: 8px` (cards, tables, details). No pill shapes; the only circles are severity icons and the timeline dots.
`--shadow-sm: 0 1px 2px rgb(16 24 40 / 6%)` on cards in light mode, `none` in dark (borders carry the edge). Sticky bars get `0 1px 0 var(--border)`.
Transitions ≤ 150ms, only on `details` chevrons and tab underlines; all off under `prefers-reduced-motion`.

## 2. Typography

System fonts only; the file must look the same on the machine that generated it and the one it is opened on, offline. Drop `'Google Sans'`/`'Google Sans Code'` from the stacks: they only apply on machines that have them installed, so the same report looked different on the author's and the client's machines.

```
--font-sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
--font-mono: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
```

| Role | Size / line | Weight | Notes |
|---|---|---|---|
| Verdict headline | 20 / 1.3 | 600 | one sentence, `letter-spacing: -.01em` |
| Site (h1) | 24 / 1.2 | 700 | `overflow-wrap: anywhere` |
| Section (h2) | 17 / 1.3 | 600 | one per tab; `break-before: page` in print |
| Card / group (h3) | 14 / 1.4 | 600 | |
| Body | 14 / 1.55 | 400 | base; 15 on ≥1024px is not used: density matters more than comfort here |
| Small | 12.5 / 1.45 | 400 | meta lines, table heads, chips |
| Count numerals | 24 / 1 | 600, mono | `font-variant-numeric: tabular-nums` |
| Mono | 12.5 / 1.5 | 400 | event names, parameter names and values, URLs, times. Event names always in `<code>`; parameter keys in `<th>` of a `.ptable` |

Numbers in tables use `tabular-nums` everywhere. Uppercase is used once: the "SITE"/"TRACKING AUDIT" eyebrow, mono 11px, `letter-spacing: .06em`.

## 3. Platform icons

Today `src/report.js` embeds each platform icon as a base64 SVG in the `CSS` constant and paints it as a `background` on `.ptag::before` / `.dot`. That has two costs: browsers drop background images when "print background graphics" is off (the default in Chrome's print dialog), and a CSS background cannot take `currentColor`. The system keeps the same artwork and moves it into an inline `<svg hidden>` sprite of `<symbol id="p-ga4">` elements referenced with `<use href="#p-ga4">`. Sizes: **14px** inline in text and chips, **16px** in table rows and event lists, **20px** in finding-card headers and the run-facts row. Always `aria-hidden="true"` with the platform name as visible text beside it (or `<title>` when the name is not shown, as in step-row hit chips, where the event name is shown and the platform is in the `title` tooltip and `aria-label`).

Fallback for a platform with no artwork (new providers, white-label vendors): a 16px rounded square (`--r-sm`) filled `--well` with the platform's first letter in mono 10px `--muted`, e.g. **K** for Klaviyo, **PW** for Piwik PRO when two words. Never a coloured square: colour would read as a severity.

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

Badge: `display:inline-flex; gap:4px; padding:2px 8px 2px 6px; border-radius: var(--r-sm); font: 500 12px/16px var(--font-sans); background: var(--sev-*-bg); color: var(--sev-*-fg)`; icon 14px, stroke 1.75. In print the tint is dropped and the badge gets a 1px `currentColor` border (§8). The same symbols are used at 18px as the finding-card marker and at 12px as the flag beside a hit in a step row. Severity order is fixed everywhere: broken, risk, warning, info, ok.

## 5. Tables

Two table kinds, both real `<table>`s with `<thead>`/`<th scope="col">`:

- **`.dt` data tables** (journeys, consent scenarios, inventory, plan coverage): 13px, cells `8px 10px`, head row in `--well` with 12px `--muted` labels, hairline rows, no zebra. Numbers right-aligned and tabular. A problem cell is `--sev-broken-fg` **and** carries the broken glyph before the number (`1 ×`), so the consent table reads in greyscale. "Not run" cells are `–` in `--muted`.
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

A customer can set `report.color` (one hex) and `report.logo`/`report.name`. `brandCss(color)` writes `--accent`, `--accent-fg`, `--accent-bg`. The system draws from those three tokens only the things that say "this document belongs to the brand": the active tab rule, focus rings, link colour, the step index plate, and the fix-step numerals. Severity, platform icons, text and surfaces never change. `brandCss` should also emit its dark set under both dark selectors of §1 and should refuse (or auto-darken) an accent whose `--accent-fg` falls under 4.5:1 on `--card`, computing the ratio instead of the fixed 20% mix; today a yellow accent gives unreadable links.

Logo slots: the top-left product slot (26px high; brand logo or `brand-name` text), the "by Analitik İşler" byline (18px) which a white-label run drops, and the footer (56px stacked logo or the customer's). The AI Tag Debugger emblem stays in the credit line at 16px in every case. All logos remain `<picture>` with light/dark sources (`logo()` in `src/report.js`); a customer logo has one source and sits on `--card`, so the topbar and footer backgrounds must stay `--card` in dark mode rather than `--page`.

## 10. Dark mode

Dark mode is a second palette, not an inversion: surfaces are navy-black (`--page #0B0F19`, `--card #141927`), tints are deep versions of their hue, text on tints is the light `-fg`. Order of precedence: `data-theme="dark"` > `data-theme="light"` > `prefers-color-scheme`. The toggle is a `<button aria-pressed>` cycling auto → light → dark, stored in `localStorage` inside `try/catch` (file:// and the MCP viewer may deny it); without JS the attribute is absent and the OS decides. `color-scheme: light dark` is set on `:root` so form controls and scrollbars follow. Logos switch through `<picture>` sources, which follow `prefers-color-scheme` only; a forced theme must therefore also toggle a `.theme-dark` class the CSS uses to swap the two `<img>`s (the prototype does this).
