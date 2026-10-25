# ai · brand guide for the Analitik İşler tools

> Version 1.0 · 25 Oct 2026 · owner: Analitik İşler.
> One guide for every tool in the family: ai tag debugger, ai tagging server, ai cloud, ai visibility, ai analyst.
> Each tool repo copies this folder (or links to it) instead of keeping a brand of its own. If a tool's own brand
> file disagrees with this one, this one wins.
> Visual board: `board.html` in this folder. Every logo file is in `assets/`.

---

## 1. The idea

**ai** means two things at once: **AI**, and the initials of **a**nalitik **i**şler. Every tool Analitik İşler builds
carries it, lowercase, in front of a plain name that says what the tool does.

The family has one mark, one red and one way of writing names. The products differ by name and by the small red-pen
glyph on their app icon, never by colour.

| Retired | Now |
|---|---|
| AI Tag Debugger (orange tag lockup) | **ai tag debugger** |
| Tagport (teal) | **ai tagging server** |
| Analitik İşler Cloud | **ai cloud** |
| Overt (blue `#2F5CF6`) | **ai visibility**, keeping its tagline "Be the answer." (§2) |
| (new) | **ai analyst** |

The old product colours (aitd orange, Tagport teal, Overt blue) are retired. Do not use them in new work.

---

## 2. The family

Always in this order: the order the work happens (check the tracking → carry it → run it for you → see AI answers → ask
the data).

| Product | What it does (one line) | Status word |
|---|---|---|
| **ai tag debugger** | An AI model walks the site like a visitor; rules check every GA4, Google Ads, Meta and TikTok hit against the plan and Consent Mode. | Open source · MIT |
| **ai tagging server** | A small server-side tagging server in Rust. It already carries analitikisler.com's own tracking. | Early development |
| **ai cloud** | ai tag debugger, run on every release, with run history and alerts. | Early access |
| **ai visibility** | Shows how ChatGPT, Claude, Gemini and Perplexity describe a brand, why competitors get picked instead, and what to change. | Early access |
| **ai analyst** | Analytics agents on a brand's own data and metric definitions. Every answer shows its query, its definition and its check. | Alpha |

Turkish status words: Açık kaynak · MIT, Erken aşamada, Erken erişim, Alfa.

**Family line** (for an index, a README or a footer):
EN "“ai” stands for two things: AI, and the initials of analitik işler."
TR "“ai” iki şeyi anlatır: yapay zekâyı (AI) ve analitik işler’in baş harflerini."

**Taglines.** A tool may have one tagline of its own; today only ai visibility has one:

| Product | Tagline |
|---|---|
| **ai visibility** | **Be the answer.** |

- Written as a sentence, with its full stop; never in capitals, never inside the logo file.
- Set in the UI font, beside or under the lockup, or as the line after the name in a title: "ai visibility · Be the answer."
- English everywhere, like the names: it is not translated on Turkish pages.
- The family itself has no tagline; its line is the "ai stands for…" sentence above.

**Tools and services.** A tool is a product; a service is work Analitik İşler does. The AI search optimisation
service is not the ai visibility tool, and the AI Agents service is not ai analyst (ai analyst is one ready tool; the
service builds any multi-agent system a client needs). Never write that a service "runs on" a tool unless it does.

---

## 3. Naming

- **Always lowercase**: `ai` + lowercase name, in logos and in running text, also at the start of a sentence or a
  title. ai tag debugger, never "AI Tag Debugger", "Ai Tag Debugger", "A.I.", "AI-Tag-Debugger".
- The company is written **Analitik İşler** in running text; only the master logo is lowercase.
- **Names are not translated.** In Turkish text the name stays English and takes an apostrophe suffix that follows how
  the last word is said: ai tag debugger’ı, ai tag debugger’da, ai tagging server’a, ai cloud’u, ai cloud’da,
  ai visibility’yi, ai visibility’ye, ai visibility’nin, ai analyst’te. Use the typographic apostrophe (’).
- Code identifiers keep their own form: npm `@analitikisler/ai-tag-debugger`, repo slugs `ai-tag-debugger`,
  `tagging-server`. In prose, use the product name, not the slug.
- A status ("early access", "alpha") is a word beside the name, never part of it or of the logo.

---

## 4. Colour

The family has **two inks and one red**. The red is the same red the Analitik İşler site uses for "broken": the site
has one red, and the logo's point, the red pen and the error state all use it (owner decision, 25 Oct 2026).

| Role | Light | Dark | Notes |
|---|---|---|---|
| **Ink** (logo, text) | `#17140F` | `#F1ECE2` | 16.1 : 1 on paper / 15.8 : 1 on dark paper |
| **Paper** (logo ground, app tiles) | `#F3F0E8` | `#151310` | |
| **Point / red pen** | `#C12D30` | `#FA6B6D` | 5.0 : 1 on paper, 5.7 : 1 on white, 6.5 : 1 on dark paper. Site tokens `ref.red.53` / `ref.red.71` (`--color-bad`, `--color-brand-point`). |
| **Pencil** (status words, captions) | `#6A645A` | `#A39C8F` | 5.2 : 1 / 6.8 : 1 |

- On a product's own UI the logo takes the page's text colour (`currentColor`); only the point stays red. On the
  Analitik İşler site that is the site's navy ink (`#071529` light / `#F9FBFF` dark).
- **One red point per logo.** The red never fills a shape larger than the point or a pen stroke. An endorsed lockup
  is two logos together, so it carries two points: the product's and the one on the master logo's işler.
- **Mono** files are one colour throughout (point included) for print, embossing, single-colour places.
- Never place the red point on a red or orange ground; use mono there.
- UI colours of a product (links, buttons, charts) come from the Analitik İşler design system (Tally), not from this
  guide. `tokens.css` / `tokens.json` here carry only the brand colours above.

---

## 5. The mark

Lowercase `ai`, drawn from Schibsted Grotesk 800 and adjusted by hand: the a's spur trimmed so the i sits close, the
i's stem cut at 9°, and the point a pressed felt-tip dot (not a circle), turned −16°. Files: `assets/mark/ai-mark-{light,dark,mono}.svg`.

- The point is the only red in the mark. It is a dot, not a tick, so the i stays an i at small sizes.
- Never redraw, retype or re-space the mark; use the files. Never set "ai" in a font and call it the logo.
- Minimum size: 24 px tall. Below that use the favicon files.

---

## 6. Lockups

Every product has three lockups, each in light, dark and mono (`assets/lockups/`):

| Lockup | File | Use |
|---|---|---|
| **Horizontal** | `ai-<product>-{light,dark,mono}.svg` | Default: headers, cards, READMEs, slides. |
| **Stacked** | `ai-<product>-stacked-…svg` | Square spaces: social avatars, stickers. Min 28 px tall. |
| **Endorsed** | `ai-<product>-endorsed-…svg` | Lockup + "by" + the Analitik İşler master logo (its red point and three bars): outside analitikisler.com (npm, GitHub social cards, marketplaces, sharing images). |

`<product>` = `tag-debugger`, `tagging-server`, `cloud`, `visibility`, `analyst`.

- Mark and name share baseline and x-height; the name is Schibsted Grotesk 450. The gap between mark and name is 1.5 S
  (S = the i's stem width).
- **Clear space**: 2 S on every side, from the ink (the point included).
- **Minimum size**: the mark's x-height at least 9 px (2.5 mm in print).
- **Same height in a row**: when several lockups sit together, give them all the same height. The site crops all five
  to one shared ascender–descender box (`scripts/gen-ai-artwork.ts` in the site repo), so the marks match.
- **"by analitik işler" is always the master logo.** Wherever Analitik İşler stands next to a tool as its maker (an
  endorsement line, a footer under a tool's logo, a social card, a slide), use the master logo with its red point and
  three bars (`assets/master/`, or the endorsed lockups, which already contain it), never the name set in type and
  never the bare wordmark without bars (owner decision, 25 Oct 2026). In running text the company stays "Analitik
  İşler" in words.
- Don't: stretch, outline, add shadows or gradients, recolour the name, swap the point colour, put the status inside
  the lockup, set the name in another font, or use an old product logo.

---

## 7. App icons and favicons

- **App icons** (`assets/icons/ai-<product>-{512,64,32}.svg`): a square paper tile (no radius; platforms mask it),
  the mark centred at 70% of the width, and one red-pen glyph in the empty corner above the a, like a margin note.
  `-ink` suffix = the dark tile. Glyphs: tag debugger = a tick beside a tag; tagging server = a forked route; cloud = a
  cloud in one line; visibility = an answer (speech mark); analyst = a circled "=" (sağlama).
- **Favicons for the tools** (`assets/icons/favicon-ai-{16,32,64}[-ink].svg`): the mark alone, pixel-fitted. Every
  tool uses the same favicon at 16 px; the glyph appears from 32 px up.
- **The company's own favicon is different**: Analitik İşler (the site, the practice) uses the **three black bars** of
  the master logo, flat ink, no red (`assets/favicon/analitik-isler-bars.svg`, `favicon.ico` 16 + 32,
  `apple-touch-icon.png` 180). Don't use the ai mark as the company favicon or the bars as a tool favicon.

---

## 8. The master logo (Analitik İşler)

`assets/master/analitik-isler-{light,dark,mono}.svg`: the original "analitik işler" wordmark outlines, unchanged, with
the three bars flattened to ink and a red point on the i of işler (the same point as the ai mark). It is the parent of
the family: the endorsed lockups carry it, and the site header uses it. Keep the bars flat ink; the blue gradient bars
are retired.

---

## 9. The red pen

The family's one graphic device, shared with the Analitik İşler site: a hand-drawn stroke in the point red that marks a
**real** finding: a tick, a circle, an underline, a strike. Source shapes: `design/10-rework/system/redpen.svg` in the
site repo.

- Only on something true: the number that is wrong, the event that is missing, the claim the page makes.
- At most two marks on one screen. Never as decoration, never on a logo.
- Animated draw-on is allowed if it respects reduced motion.

---

## 10. Type

- **Logos**: Schibsted Grotesk (800 for the mark, 450 for names), already outlined in the files; nobody needs the font
  to use a logo.
- **Product UIs, docs, READMEs, slides**: the Analitik İşler system fonts: Google Sans for text and headings, a mono
  for code and numbers. **No second heading font** (owner decision): Schibsted lives inside the logo files only.

---

## 11. Voice

- The products speak plainly and show their working: the number, the source, the check. No hype words ("magic",
  "revolutionary", "supercharge"), no exclamation marks.
- The maker is **Analitik İşler**, not "we" and not a person's name (Bahadır appears as founder only where a person is
  meant: About, author bylines, legal).
- Statuses are plain words (Early access, Alpha), no ✓ or ! in front.
- No durations or promises of time for any service. Tool release dates and versions are facts and may be stated.
- Turkish copy is written natively, not translated: no second-person possessives, short noun-phrase headings,
  "Server-side tracking" in headings (never "taraflı").
- No invented numbers: where a figure is not known, use a `[placeholder]`; an example is labelled "example".

---

## 12. Files in this folder

| Path | What |
|---|---|
| `BRAND.md` | This guide. |
| `board.html` | Every asset on one page, light and dark. |
| `tokens.css`, `tokens.json` | The brand colours (ink, paper, point, pencil) as CSS variables and design tokens. |
| `assets/mark/` | The ai mark, light / dark / mono. |
| `assets/lockups/` | Horizontal, stacked and endorsed lockups for the five products, light / dark / mono (45 files). |
| `assets/icons/` | App icons 512 / 64 / 32 (paper and ink tiles) and the tool favicons 16 / 32 / 64. |
| `assets/master/` | The Analitik İşler master logo, light / dark / mono. |
| `assets/favicon/` | The company favicon: three black bars (SVG, ICO 16 + 32, Apple touch icon 180). |

All SVGs are outlined paths (no `<text>`), carry a `<title>`, and use only the colours in §4. They were generated by
`design/10-rework/brand/src/build.py` in the site repo and recoloured to the site red on 25 Oct 2026; to rebuild them,
change the red there (`#C8281E` → `#C12D30`, `#FF5B4D` → `#FA6B6D`) and run the build.
