# brand

ai tag debugger takes its look from **Çini · Mercan**, the Analitik İşler design system, through the kit in [`cini/`](../cini/): colour roles in light and dark (`tokens.css`, `tokens.json`), the two faces Gabarito and Azeret Mono (`fonts.css`, `fonts/`), the base and controls (`cini.css`), the Pano pattern (`pano.js`), and every logo, lockup and favicon (`logos/`). `cini/` is the kit's `dist/`, copied unchanged; `cini/VERSION` names the build. Don't edit it here: rebuild the kit and copy its `dist/` again.

The names, the family, the logos and their spacing are in the brand guide, **BRAND.md v1.1** (11 Nov 2026), kept by Analitik İşler with the kit in its design files (`13-ai-brand/BRAND.md`). Where this repository and the guide disagree, the guide wins.

The reports and `plan.html` are one file each, so they carry what they use from the kit:

- `node scripts/cini.js` writes `src/cini.js`: the three stylesheets with the fonts as data URIs, and the colour roles for code that cannot read a CSS variable. `test/cini.test.js` fails when it no longer matches `cini/`.
- `node scripts/brand.js` writes `src/brand.js`: the lockup, the ai mark and the master logo as sprite symbols, and the favicons as data URIs, from `cini/logos/`. `test/brand-script.test.js` fails when it no longer matches.

Run both after copying the kit again. The Pano band above the footer is drawn by `cini/pano.js` when a page is written.

`plugin/.claude-plugin/icon.png` is the Claude plugin's icon: `cini/logos/icons/ai-tag-debugger-512.svg`, unchanged, rendered at 1024 × 1024. The plugin directory takes it as the listing icon only once, when the plugin is first submitted.

`social-preview.png` is the repository's sharing image: the endorsed lockup from `cini/logos/lockups/ai-tag-debugger-endorsed-light.svg`, unchanged, on the kit's glaze white (`--color-bg`), with a Pano band along the foot, at GitHub's 1280 × 640. GitHub has no file for it; upload it under the repository's Settings, General, Social preview.

The brands that came before are in the repository's history, before this folder pointed to the kit.
