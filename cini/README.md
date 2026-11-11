# Çini · Mercan: the design kit for the Analitik İşler tools

The website's design system (analitikisler.com, the owner's pick of 11 Nov 2026: "Pano + Mercan") packaged for
the tools: ai tag debugger, ai tagging server, ai visibility, ai analyst, seo tracker, banner-resizer, ai listening,
rakip-reklam and tv-etki.

Everything here is built from the website by `cini-kit/build.ts`, so the kit and the site never drift apart.
Don't edit the files in a tool. Rebuild the kit and copy it again. `VERSION` names the site commit it came from.

Names, the family, the logos and their spacing are in `13-ai-brand/BRAND.md`. This kit covers colour, type, pattern
and controls.

## What is in it

| File | What it is |
|---|---|
| `tokens.css` | Every role as a CSS variable (`--color-*`, `--font-*`, `--text-*`, `--space-*`, `--radius-*`, `--motion-*`, `--shadow-*`), light and dark. Unlayered. |
| `tokens.json` | The same values as JSON, for code that draws (charts, canvas, PDFs, emails). |
| `fonts.css` + `fonts/` | Gabarito (wght 400–900) and Azeret Mono (400–600), self-hosted, with metric-matched fallbacks. Both under the SIL OFL. |
| `cini.css` | Base and controls for plain HTML: button, field, switch, card, status, tag, callout, table, metric, missing-data hatch, tool header and footer. The class names are the site's. |
| `tailwind.css` | Tailwind v4 and shadcn/ui bridge: shadcn's variables point at the Çini roles, and the Çini roles become utilities. |
| `pano.js` / `pano.global.js` / `pano.d.ts` | The Pano pattern (field, band, panel) and the missing-data hatch, as an ES module or a classic script (`window.Pano`). |
| `logos/` | Master logo, the ai mark, the five lockups (light, dark, mono, stacked, endorsed), app icons and favicons. |
| `demo.html` | Everything on one page, light and dark. Opens from disk. |

## Install

Copy `dist/` into the tool as `cini/` (for example `web/src/cini/` or `public/cini/`). Then do one of the following.

**Plain HTML** (ai tag debugger reports, seo tracker, banner-resizer, tv-etki, ai tagging server pages):

```html
<link rel="stylesheet" href="cini/tokens.css">
<link rel="stylesheet" href="cini/fonts.css">
<link rel="stylesheet" href="cini/cini.css">
<script src="cini/pano.global.js"></script>
```

**React + Tailwind v4 + shadcn** (ai analyst, ai visibility, ai listening), in the main CSS file:

```css
@import "tailwindcss";
@import "./cini/tokens.css";
@import "./cini/fonts.css";
@import "./cini/tailwind.css";
```

Delete the tool's own colour variables and its `.dark { … }` block. shadcn components then follow Çini without
any edits. `import { field } from './cini/pano.js'` works with the types in `pano.d.ts`.

**React without Tailwind** (rakip-reklam): import `tokens.css`, `fonts.css` and `cini.css` in the entry file.

**Class names to watch.** The kit's classes are short (`.status`, `.tag`, `.card`, `.table`, `.field`, `.button`).
If a tool already uses one of these names for something else, rename the tool's class rather than the kit's.
In Tailwind, `bg-muted` is shadcn's ground colour. For muted text, use `text-muted-foreground` or `text-subtle`.

**Theme.** Dark follows the OS. To let people choose, set `data-theme="light"` or `data-theme="dark"` on `<html>`.
shadcn's `.dark` class also works.

## The rules

**Colour: one job each.**

| Role | Light | Dark | Use for | Never for |
|---|---|---|---|---|
| `--color-accent` (red) | #C12D30 | #FA6B6D | links, the logo's point, the one red pen mark | buttons, errors, big fields of colour behind text |
| `--color-action` (ink) | #17140F | #F1ECE2 | primary buttons (ink, with a light label) | |
| `--color-point` (coral) | #C45E3D | #F0926D | the Pano route's end, one highlighted figure | text, status |
| `--color-focus` | #B84A2C | #F0926D | the focus ring | |
| `--color-ok` / `--color-data-measured` (teal) | #087671 | #3B9E98 | measured, sent, passes | |
| `--color-bad` / `--color-data-broken` (wine) | #72051A | #FEC6D6 | errors, broken, fails | the brand |
| `--color-risk` | #965000 | #F0A04B | risk: the severity between broken and warning (glyph ◆) | brand use. Kit-only, outside the site palette |
| `--color-warn` | #6C5904 | #A18C0B | warnings | |
| `--color-info` | #3B5876 | #729CC8 | the one quiet blue: notes | |
| `--color-bg`, `--color-surface`, `--color-surface-2`, `--color-well` | glaze white family | warm near-black family | grounds, from the page to the nested box | |
| `--color-data-cat-1…6`, `-seq-1…9`, `-div-1…9` | | | charts, in order (Tailwind: `cat-1…6`) | more than 6 series: group the rest as "other" |

- A status always has a glyph and a word. Colour is never the only signal. For "waiting" or "none", use the
  neutral tone (`data-tone="neutral"`, a muted –).
- The brand red is not the error colour. Errors are wine.
- Buttons are ink, not red.
- Blue appears only as `info` and as one chart series. Avoid orange that looks like Google Analytics or HubSpot.

**Type.** Gabarito for everything people read and press: headings at weight 700, text at 400, buttons and labels at
600. Azeret Mono for code, event names, IDs, figures in tables and status words. No third face. Sizes come from
`--text-step--2` to `--text-step-6`.

**Pano.** The pattern is the brand's surface. It goes:
- on a band above the footer;
- on the edge of a closing call to action;
- on a share image;
- on an empty state.

Its route runs from the left edge to one coral point, from first click to conversion. Seed it with something stable,
such as a page path or a report ID, so the same page always draws the same field. Never use it behind text, and
never use more than one field per screen.

```js
el.innerHTML = Pano.field({ cols: 40, rows: 3, seed: location.pathname, startRow: 1, endRow: 1, align: 'xMaxYMid' });
```

**Missing data.** Mark it with the Pano ring hatch, never with a grey bar or a red one: use `class="is-missing"` on
a box, `mask: var(--pattern-missing)` in CSS, or `Pano.hatchPattern()` in SVG.

**Logos.** Next to a tool, the master logo is always the original: the wordmark, the three bars and the red point.
Don't draw new marks. For the rest, see `13-ai-brand/BRAND.md`.

**Voice.**
- Write "Analitik İşler", never "we".
- Never give durations, prices or invented facts.
- Write English first.

## Updating

When the site's tokens change, run the build in `analitikisler-design/cini-kit/`, then copy `dist/` into each tool
again:

```bash
bun build.ts
```
