# Accessibility checklist for the report (WCAG 2.2 AA, static HTML)

> Screenshot names below refer to captures of the 0.16.0 demo report taken during the review. They are not kept in the repository: run `npm run demo:serve` and `npm run demo`, then open the report to see the same screens.

Run before shipping a change to `src/report.js`. Each item has the exact test and, where a DOM query can decide it, a Playwright snippet. axe is not available offline, so the automated checks are plain `page.evaluate` queries; the manual ones take a minute each with the sample report.

Setup used by every snippet:

```js
import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("file:///path/to/report.html");
const fails = [];
const check = (name, ok, detail) => { if (!ok) fails.push(`${name}: ${detail ?? ""}`); };
```

Finish with `console.log(fails.join("\n")); process.exit(fails.length ? 1 : 0);`. "Current" notes what the sample report does today (see `ux-audit.md`).

## Structure and semantics

### 1. Page language and title (3.1.1, 2.4.2)
Test: `<html lang>` is the report language; `<title>` names the site.
```js
check("lang", await page.evaluate(() => /^(en|tr)$/.test(document.documentElement.lang)));
check("title", await page.evaluate(() => /report: .+/.test(document.title)));
```
Current: pass.

### 2. Landmarks and one `main` (1.3.1, 2.4.1)
Test: exactly one `main`, one `header` before it, one `nav` with an `aria-label`, one `footer`.
```js
check("landmarks", await page.evaluate(() => document.querySelectorAll("main").length === 1 && document.querySelectorAll("body > nav[aria-label], body > .toptabs[aria-label]").length === 1 && document.querySelectorAll("footer").length === 1));
```
Current: pass.

### 3. Skip link (2.4.1)
Test: the first focusable element is a link to the verdict/main content and becomes visible on focus.
```js
await page.keyboard.press("Tab");
check("skip link", await page.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); return a.tagName === "A" && /^#(main|verdict|overview)$/.test(a.getAttribute("href")) && r.width > 0 && r.height > 0; }));
```
Current: fail (first stop is the byline logo link).

### 4. Heading order (1.3.1, 2.4.6)
Test: one `h1`; no level skipped going down; every section in the nav starts with an `h2`; every card title is a heading. Hidden sections count (they become visible).
```js
check("headings", await page.evaluate(() => {
  const hs = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => +h.tagName[1]);
  let prev = 0; const skips = hs.filter((l) => { const skip = l > prev + 1; prev = l; return skip; }).length;
  return hs.filter((l) => l === 1).length === 1 && skips === 0 && document.querySelectorAll(".card-t:not(h2):not(h3):not(h4)").length === 0;
}));
```
Current: fail (h3 → h5 in steps, h3 owner groups with no h2, card titles are `div`).

### 5. Tables have names and header scope (1.3.1)
Test: every `table` has a `caption` or `aria-label`/`aria-labelledby`; header cells in a `thead` have `scope="col"`; row header `th` in a `tbody` have `scope="row"`; no empty `th`.
```js
check("tables", await page.evaluate(() => [...document.querySelectorAll("table")].every((t) =>
  (t.caption || t.hasAttribute("aria-label") || t.hasAttribute("aria-labelledby")) &&
  [...t.querySelectorAll("thead th")].every((th) => th.getAttribute("scope") === "col" && th.textContent.trim()) &&
  [...t.querySelectorAll("tbody th")].every((th) => th.getAttribute("scope") === "row"))));
```
Current: fail (209 tables, none named, no `scope`).

### 6. Lists are lists (1.3.1)
Test: step lists, finding lists, fix steps, where chips are `ol`/`ul`, and a `details` row list has one `li` per row.
```js
check("lists", await page.evaluate(() => document.querySelectorAll(".flist:not(ul), .stepnav ol, .fix-steps:not(ol)").length === 0 || document.querySelectorAll(".flist:not(ul), .fix-steps:not(ol)").length === 0));
```
Current: pass.

### 7. Disclosure summaries carry the decision (2.4.6)
Test: every closed `details > summary` has visible text of at least 3 characters and, for hit rows, contains the severity text when flagged.
```js
check("summaries", await page.evaluate(() => [...document.querySelectorAll("details > summary")].every((s) => s.textContent.trim().length >= 3) &&
  [...document.querySelectorAll(".event[class*=flag-] > summary")].every((s) => /broken|risk|warning|bozuk|risk|uyarı/i.test(s.innerText))));
```
Current: fail (flagged timeline rows hide the severity text with `display:none`).

## Keyboard

### 8. Everything reachable, nothing trapped (2.1.1, 2.1.2)
Test: Tab from the top reaches the sticky nav, the section content, and the footer; Tab from the last footer link wraps to the browser chrome; Escape never needed to leave a widget. Count stops per section and keep them under control: a closed finding card is 1 stop, an open one ≤ 6, a request row ≤ 3 (no focusable tips).
```js
const stops = [];
for (let i = 0; i < 300; i++) { await page.keyboard.press("Tab"); const t = await page.evaluate(() => { const e = document.activeElement; return e === document.body ? null : e.tagName + (e.className ? "." + String(e.className).split(" ")[0] : ""); }); if (!t) break; stops.push(t); }
check("no focusable tips", !stops.some((s) => s.startsWith("SPAN.q")), `${stops.filter((s) => s.startsWith("SPAN.q")).length} tip stops`);
```
Current: fail (406 "?" tips are tab stops).

### 9. Tabs and radios work with arrows, hidden inputs still focusable (2.1.1, 4.1.2)
Test: focus the severity filter, press ArrowRight, the next filter becomes checked and the list changes; same for the journey step tab strip.
```js
await page.goto(page.url().split("#")[0] + "#findings");
await page.locator("#fs-all").focus(); await page.keyboard.press("ArrowRight");
check("radio arrows", await page.evaluate(() => document.querySelector("input[name=fs]:checked").id !== "fs-all"));
```
Current: pass.

### 10. Focus visible on every stop (2.4.7, 2.4.13 as a target)
Test: for every Tab stop, the focused element or its label has an outline ≥ 2 px with ≥ 3:1 against the background, or an equivalent visible change. The "?" tips, chips and summary rows are the ones that break.
```js
await page.goto(page.url().split("#")[0]);
let bad = 0;
for (let i = 0; i < 120; i++) { await page.keyboard.press("Tab"); const r = await page.evaluate(() => { const e = document.activeElement; if (e === document.body) return "end"; const l = e.tagName === "INPUT" ? document.querySelector(`label[for="${e.id}"]`) : e; const cs = getComputedStyle(l); return cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2 ? "ok" : e.tagName + "." + e.className; }); if (r === "end") break; if (r !== "ok") bad++; }
check("focus ring", bad === 0, `${bad} stops without a 2px outline`);
```
Current: fail only on the "?" tips (outline removed, border change 1.49:1).

### 11. Focus not obscured by sticky bars (2.4.11)
Test: after each Tab, the focused element's top is below the sticky nav's bottom and its bottom above the viewport bottom.
```js
let hidden = 0;
for (let i = 0; i < 60; i++) { await page.keyboard.press("Tab"); hidden += await page.evaluate(() => { const e = document.activeElement; if (e === document.body) return 0; const r = e.getBoundingClientRect(); const bar = document.querySelector(".toptabs, nav[aria-label]")?.getBoundingClientRect(); return (bar && r.top < bar.bottom && r.bottom > bar.top && r.top >= 0) || r.top < 0 || r.bottom > innerHeight ? 1 : 0; }); }
check("focus not obscured", hidden === 0, `${hidden} stops under the sticky bar or off-screen`);
```
Current: partial (Shift+Tab into a card can land under the 56 px bar; `scroll-padding-top` only helps hash targets).

### 12. Hash navigation sets the focus start point and does not add surprise history (2.4.3)
Test: clicking a section link moves the sequential focus start to the section; clicking a tab twice does not add two history entries. Manual: click "Findings", press Tab, the focus is inside Findings. Press Back once, you are on the previous view, not on the same tab.
Current: pass for focus start; fail for history (every tab click is an entry). Accept if sections replace tabs (spec §2); otherwise use `history.replaceState` in the enhancement layer.

## Visual

### 13. Text contrast (1.4.3)
Test: every text colour/background pair ≥ 4.5:1 (≥ 3:1 only for ≥ 24 px regular or ≥ 18.7 px bold). Compute from the CSS tokens in both schemes; the table in `ux-audit.md` is the reference. Badges are 12 px / 500, so 4.5:1.
```js
const lum = (c) => { const [r, g, b] = c.match(/\d+/g).map(Number).map((v) => v / 255).map((v) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [h, l] = [lum(a), lum(b)].sort((x, y) => y - x); return (h + 0.05) / (l + 0.05); };
for (const scheme of ["light", "dark"]) {
  await page.emulateMedia({ colorScheme: scheme });
  const pairs = await page.evaluate(() => [...document.querySelectorAll(".badge, .consent, .n, .status, .method, .chip-step, td.bad, .flagnote, .muted")].filter((e) => e.getBoundingClientRect().width).map((e) => { let bg = "rgba(0, 0, 0, 0)", n = e; while (n && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) { bg = getComputedStyle(n).backgroundColor; n = n.parentElement; } return { sel: e.className, fg: getComputedStyle(e).color, bg }; }));
  for (const p of pairs) check(`contrast ${scheme} ${p.sel}`, ratio(p.fg, p.bg) >= 4.5, `${ratio(p.fg, p.bg).toFixed(2)}:1`);
}
```
Current: fail for `.badge.ok` light (4.28), `.consent.granted` light (4.28), `.badge.broken` dark (4.43).

### 14. Non-text contrast (1.4.11)
Test: UI boundaries and state indicators ≥ 3:1 against adjacent colours: focus outline, the filter chip border, the severity dot on timeline rows, the selected-tab underline, adjacent segments of the severity bar (or the bar has a text legend, which it does).
Current: fail for the warning dot (#C99A2E on white 2.58:1); the segments rely on the legend.

### 15. Colour is not the only cue (1.4.1)
Test: every severity, pass/fail and selected state has a text, glyph or shape in addition to colour. Query the known colour-only spots:
```js
check("colour only", await page.evaluate(() => document.querySelectorAll(".scenarios td.bad:not([aria-label]):not(:has(svg, abbr, .sr-only))").length === 0 && document.querySelectorAll(".dot-flag:not([aria-label]):not(:has(.sr-only))").length === 0 && getComputedStyle(document.querySelector(".event .tag") || document.body).display !== "none"));
```
Current: fail (scenario bad cell, step list dot, timeline severity tag hidden).

### 16. Reflow at 320 px, no horizontal scroll (1.4.10)
Test: at 320 px wide (and 390), `document.documentElement.scrollWidth <= clientWidth` on every section and every journey step; tables may scroll inside their own container.
```js
for (const w of [320, 390]) { await page.setViewportSize({ width: w, height: 800 }); for (const h of ["", "#findings", "#journeys", "#j3-s11", "#scope"]) { await page.goto(page.url().split("#")[0] + h); check(`reflow ${w} ${h}`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)); } }
```
Current: fail on Journeys (535 px at a 390 px viewport: step list and the per-step tab strip).

### 17. Zoom 200 % (1.4.4)
Test: at a 640 px viewport, no clipped text and no overlapping controls; same query as 16 plus a visual check of one finding card and one step.
Current: pass.

### 18. Text spacing (1.4.12)
Test: inject the WCAG text-spacing CSS and confirm nothing is clipped (`scrollWidth` of each `summary` and `.chip` ≤ its `clientWidth`).
```js
await page.addStyleTag({ content: "*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}" });
check("text spacing", await page.evaluate(() => [...document.querySelectorAll("summary, .chip, .badge, .toptabs a")].every((e) => e.scrollWidth <= e.clientWidth + 1)));
```
Current: not tested before; run it.

### 19. Content on hover or focus is dismissible, hoverable, persistent (1.4.13)
Test: a "?" tip (or whatever replaces it) can be dismissed with Escape without moving focus, the pointer can move onto it, and it stays until dismissed.
```js
await page.locator(".q").first().focus(); await page.keyboard.press("Escape");
check("tooltip escape", await page.evaluate(() => getComputedStyle(document.activeElement, "::after").content === "none"));
```
Current: fail (no Escape). The spec removes focusable tips; if tips stay interactive, add `[data-tip]:focus` handling in the enhancement layer.

### 20. Target size (2.5.8)
Test: every clickable/focusable target is ≥ 24 × 24 CSS px, or has 24 px spacing from its neighbours; inline links in running text are exempt.
```js
check("targets", await page.evaluate(() => [...document.querySelectorAll("a, summary, label[for], button, [tabindex='0']")].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.width < 24 || r.height < 24) && !e.closest("p, li.summary-list"); }).map((e) => e.className).length === 0));
```
Current: fail for `.q` (15 × 15), `.verify a` (16 px tall, inline list), `details.raw > summary` (19 px tall).

### 21. Reduced motion (2.3.3, AAA but cheap)
Test: with `prefers-reduced-motion: reduce` no transition runs.
```js
await page.emulateMedia({ reducedMotion: "reduce" });
check("reduced motion", await page.evaluate(() => getComputedStyle(document.querySelector(".chev")).transitionDuration === "0s"));
```
Current: pass.

## Names, roles, values

### 22. Icons and images (1.1.1)
Test: decorative SVGs are `aria-hidden="true"` and sit next to text; informative images have `alt`; icon-only links have an accessible name.
```js
check("icons", await page.evaluate(() => [...document.querySelectorAll("svg")].every((s) => s.getAttribute("aria-hidden") === "true" || s.querySelector("title")) && [...document.querySelectorAll("img")].every((i) => i.hasAttribute("alt")) && [...document.querySelectorAll("a")].every((a) => (a.textContent.trim() || a.getAttribute("aria-label") || a.querySelector("img[alt]:not([alt=''])")))));
```
Current: pass.

### 23. Status dots and counts have text (1.1.1, 1.3.1)
Test: the step list's problem dot and platform dots have screen-reader text (`.sr-only` or `aria-label`); the count after a platform dot names the platform.
```js
check("dots", await page.evaluate(() => document.querySelectorAll(".dot-flag:not([aria-label]):not(:has(.sr-only))").length === 0 && document.querySelectorAll(".stepnav .dot:not([aria-label]):not(:has(.sr-only))").length === 0));
```
Current: fail (9 dots with `title` only, 36 platform dots with nothing).

### 24. Current tab / current step (4.1.2, 1.3.1)
Test: the selected section link and the selected step link carry `aria-current="page"` (or `"true"` for the step), and the radio-based tab strips use `role="tablist"` / `role="tab"` / `aria-selected` when the enhancement layer runs; without it the radios keep their native semantics (acceptable).
```js
check("aria-current", await page.evaluate(() => document.querySelectorAll(".toptabs a[aria-current], nav[aria-label] a[aria-current]").length >= 1));
```
Current: fail (none).

### 25. Interactive roles (4.1.2)
Test: nothing focusable has `role="note"`, `role="presentation"` or no role at all while behaving like a button; `summary` elements are the native kind.
```js
check("roles", await page.evaluate(() => document.querySelectorAll("[tabindex='0'][role='note'], [tabindex='0']:not(a, button, input, summary, [role])").length === 0));
```
Current: fail (406 `span[role=note][tabindex=0]`).

### 26. Link purpose and new windows (2.4.4, G201)
Test: no link reads "here"/"link"; links with `target="_blank"` say "opens in a new tab" (text or `aria-label`) and have `rel="noopener"`.
```js
check("links", await page.evaluate(() => [...document.querySelectorAll("a[target=_blank]")].every((a) => /new (tab|window)|yeni sekme/i.test(a.getAttribute("aria-label") || a.textContent) && /noopener/.test(a.rel))));
```
Current: fail (8 external links without the note).

### 27. Label in name (2.5.3)
Test: controls with an `aria-label` include their visible text in it (filter labels, tab labels, chips).
```js
check("label in name", await page.evaluate(() => [...document.querySelectorAll("[aria-label]")].filter((e) => e.textContent.trim()).every((e) => e.getAttribute("aria-label").toLowerCase().includes(e.textContent.trim().toLowerCase().slice(0, 12)))));
```
Current: fail for the "?" tips (visible "?" is not in the label); pass elsewhere.

### 28. Stable ids for deep links (2.4.4, and the spec's cross-links)
Test: every finding card, step, hit row and network row has an `id`; ids are unique; every `href="#…"` in the page resolves.
```js
check("ids", await page.evaluate(() => { const ids = [...document.querySelectorAll("[id]")].map((e) => e.id); const dup = ids.length !== new Set(ids).size; const dead = [...document.querySelectorAll("a[href^='#']")].filter((a) => a.getAttribute("href").length > 1 && !document.getElementById(decodeURIComponent(a.getAttribute("href").slice(1)))).length; return !dup && dead === 0 && document.querySelectorAll(".finding:not([id])").length === 0; }));
```
Current: fail (findings have no `id`; no dead links).

## Print

### 29. Print is a document (not a WCAG item, a release gate)
Test: `page.emulateMedia({ media: "print" })` then `page.pdf()`; page count for the sample ≤ 12; the network section is replaced by a pointer line; external link URLs are printed; every `h2` starts a page.
```js
await page.emulateMedia({ media: "print" });
check("print hides network", await page.evaluate(() => getComputedStyle(document.querySelector("#network .evlist, #network table") || document.body).display === "none"));
check("print link urls", await page.evaluate(() => getComputedStyle(document.querySelector(".verify a"), "::after").content.includes("attr(href)")));
```
Current: fail (90 pages, everything expanded, no URLs).

## Sign-off

Record the run in the PR: the date, the sample report used, the snippet output (zero lines), and the three manual checks (skip link visible on focus, screen-reader pass through Verdict → Priorities → one finding with a desktop screen reader or Orca, keyboard-only completion of task D1 from `ux-audit.md`).
