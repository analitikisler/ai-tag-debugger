# brand

`brand/ai/BRAND.md` is the brand guide: the names, the one mark and the one red, the lockups, icons and master logo under `brand/ai/assets/`, and the rules for using them. `brand/ai/` is a copy of `design/13-ai-brand` in the analitikisler.com repo; change it there first, then copy it here.

`brand/retired/` keeps the brands that came before, one folder each, with a note on when it was retired.

The reports embed the logos as data URIs so that a report is one file. `node scripts/brand.js` reads the files it names in `brand/ai/assets/` and writes `src/brand.js`; run it after `brand/ai/` changes. `test/brand-script.test.js` fails when `src/brand.js` no longer matches the assets.

`social-preview.png` is the repository's sharing image: the endorsed lockup from `brand/ai/assets/lockups/ai-tag-debugger-endorsed-light.svg`, unchanged, on the brand's paper colour, at GitHub's 1280 × 640. GitHub has no file for it; upload it under the repository's Settings, General, Social preview.
