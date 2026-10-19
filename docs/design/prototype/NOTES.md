# Prototype notes

`report.html` is a hand-built, single-file prototype of the next report, filled with the demo shop's real capture (`aitd run` on http://localhost:4321, 2 journeys × 2 viewports, 2 broken · 1 risk · 1 warning · 4 ok, three consent scenarios). The step tables and hit parameters were generated from `capture.json` so they are exact; everything else is written by hand. It loads nothing from the network (inline CSS, inline SVG sprite, logos as data URIs from `src/brand.js`), carries the same CSP as the MCP server plus `script-src 'unsafe-inline'`, and is fully readable with JavaScript off (every section stacked, every `details` open in print). `before/` holds the 0.16.0 report at the same sizes for comparison.

One honest caveat: the demo run had AI off, so the first finding card shows an **illustrative** impact / likely cause / fix block, marked as such on the card, so the full anatomy is visible. The other three cards show the real no-AI state.

## Map to `src/report.js`

| Prototype | Today | What changes |
|---|---|---|
| `<svg hidden style="display:none">` sprite of `sev-*`, `ui-*`, `p-*` symbols at the top of `<body>` | `ICON`, `ic()`, `sevIcon()` (inline per use) and the base64 `.ptag.p-*::before` / `.dot.p-*` backgrounds inside `CSS` | One sprite emitted by a `sprite(platformsSeen)` helper; `ic()` becomes `use(id, size)`. Platform artwork stays the same strings, decoded once from the existing data URIs. Note `hidden` alone does not hide an inline `<svg>` in Chromium; keep the inline `display:none`. |
| `:root` tokens, two dark blocks (`@media … :root:not([data-theme="light"])` and `:root[data-theme="dark"]`) | first 10 lines of `CSS` | Replace the token block with `docs/design/visual-system.md` §1. Keep `--accent`, `--accent-fg`, `--accent-bg` names: `brandCss()` writes them. `brandCss()` needs the same two dark selectors. |
| `.topbar` (product logo, byline, theme button) | the `topbar` string in `renderHtml` and `logo()` | `logo()` emits two `<img>` (`.l-light`/`.l-dark`) instead of `<picture>`, so a forced theme can swap them with CSS. The theme button is new; it needs the script at the end of the body (see below). |
| `.verdict` (eyebrow, h1 site, verdict line, five count tiles, run facts `<dl class="facts">`) | `header.title` + `.metrics` + `runCard()` in `overviewTab()` | Merge: the metrics and "This run" card move above the tabs and become the verdict block. The verdict sentence is deterministic: worst severity → "Not ready / Usable with a risk / Usable with warnings / All checks passed", followed by the counts phrased by owner (`m.ui.verdict[sev](counts, ownerCounts)`); when `explained.summary.headline` exists it replaces the sentence. New i18n keys in `src/i18n.js`. |
| `.tabbar` with `[role=tablist]` buttons and `.panel[role=tabpanel]` sections | `nav.toptabs` anchors + `:target`/`:has()` rules in `CSS` and `navCss()` | Buttons + `aria-selected` + the 60-line script; `navCss()` goes away. Deep links (`#f1`, `#j3-s11`) still work: the script opens the panel, journey and `details` that contain the hash target. Without JS all panels show with their `h2` (today's `:target` scheme shows only the overview without a hash). |
| "What to fix first" (`.fixlist` grouped by `OWNERS`) + "What is working" (`.oklist`) + journeys table | `summaryCard()` (AI summary) and the journeys table in `overviewTab()` | `fixFirst(m, rows)` lists problem findings per owner (`ownerOf`), severity order, each line a link to its card. OK findings are summarised in a second card instead of hidden. The AI summary, when present, becomes the verdict sentence and the "Impact" strips, not a separate card. |
| `.finding` card: `.fmark`, `h4.ftitle`, `.fmeta` (platform, event, owner chip, spread), `badge()`, body with `.impact`, `.fcols` | `findingCard()`, `badge()`, `evidenceHtml()`, `gtmHtml()`, `verifyHtml()` | Same structure; add the owner chip and `<code>` event to `.fmeta`, make the title an `h4`, sections `h5`. Evidence for `missing_params` lists the missing keys as rows with the `missing` chip (today only `missing_event` gets one). |
| `.steps` table (step row + `.drow` details row) | `journeyPanel()` step nav + `stepDetail()` with four radio tabs (Timeline / Events / dataLayer / Network) | One table replaces the sticky step list + detail pane: every step is a row, hits are chips with the severity glyph, the details row holds the hit list (`eventRow()` content), then the dataLayer pushes. Timeline and Network panels can come back as further `h5` blocks inside the details row; they are not in the prototype. Flagged rows are `open`. |
| `.consent-card` | `consentCard()` | Same tiles (`.sigs`), plus a one-line note on how many steps re-sent the commands. |
| Consent scenarios `.dt` table | `scenariosCard()` | Same table; problem cells carry the risk glyph and the word "cookieless" explains the allowed GA4 pings. The table moves above the journey tabs. |
| Scope: `.cov` coverage, inventory, platforms | `coverageCard()`, `inventoryCard()`, `providersCard()` | Same; coverage cells say `params` with the broken glyph when the event was sent without required parameters, so the plan table agrees with the findings. The platforms table shows the `.plat-fb` letter fallback. |
| `.footer` | the `footer` strings in `renderHtml` | Unchanged apart from tokens; `f-meta` now repeats the site. |
| `@media print` block | the one-line print rule at the end of `CSS` | Replace with the prototype's block (visual-system.md §8). `writePdf()` can add `displayHeaderFooter` with site · date · page numbers. |
| `<script>` at the end of the body | none | ~60 lines: tablists, hash reveal, theme toggle. The MCP server's CSP header in `src/mcp.js` needs `script-src 'sha256-<hash of the script>'` (or `'unsafe-inline'`); the file still works without it, stacked. |

## Non-negotiable vs taste

Non-negotiable (the system breaks without them):

1. Severity is never colour alone: glyph + word in every badge, glyph on flagged hit chips and problem table cells, and the five severity tokens are fixed, never derived from the brand accent. Risk is plum, info is slate.
2. Nothing meaningful lives in a CSS background: platform icons are inline SVG via `<use>`, so print without background graphics and PDF keep them. Print drops tints and outlines badges instead.
3. System font stacks only, no `'Google Sans'` entries. Tabular numerals in every table.
4. Tabs are `<button role="tab">` with `aria-selected`/`aria-controls`; panels are `role="tabpanel"` sections with a real `h2`; without JS everything is visible and in heading order (h1 site → h2 section → h3 group/card → h4 finding → h5 section). Deep links to steps and findings keep working in both modes.
5. Dark mode has the two selectors (`prefers-color-scheme` guarded by `:root:not([data-theme="light"])`, and `:root[data-theme="dark"]`), `brandCss()` writes under both, and all tables sit in `.tscroll` so the page never scrolls sideways at 390px.

Taste (change freely if the engineer or lead prefers otherwise):

- The verdict sentence wording and whether the five count tiles link to the findings tab.
- The 3fr/2fr overview split and the 3fr/2fr evidence/request split inside a hit.
- Step rows open by default only when flagged; a PDF could keep unflagged hit parameters collapsed to save pages (the current print opens all, 25 A4 pages for this demo).
- Card shadows in light mode (`--shadow-sm`), radii of 8px, the 1120px max width.
- Whether the Timeline and Network panels return as extra blocks in the details row or as `details` of their own.
