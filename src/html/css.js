// The report's stylesheet: one constant per part, joined in this order: tokens, components, shell, product (the few
// rules the product's markup needs beyond the mockup's), then the sections in rail order. Each section's builder edits
// only its own constant, so parallel changes never touch the same lines.
// No url(data:...) anywhere (test/html-shell.test.js checks it): icons come from the inline sprite. The search icon the
// mockup drew as a data URI in the filter bar is the sprite's ui-search, placed by the filter bar's markup.
import { brandCss } from "../whitelabel.js";

// ---------- tokens: colours (light, then dark under both selectors), spacing, radii, fonts ----------
const TOKENS = `/* Direction D tokens. Light on :root; dark twice (OS preference unless the page forces light, and the forced dark theme),
   so <html data-theme> beats the OS both ways. Every -fg passes 4.5:1 on --card, --page and its own -bg in both modes;
   every base passes 3:1 on --card (VISUAL.md has the table). Builders reference these names only, never a hex. */
:root{
color-scheme:light dark;
--page:#F6F7F9;--card:#FFFFFF;--well:#EEF1F6;--fg:#111827;--muted:#4B5567;--border:#D9DEE8;--border-strong:#C3CAD8;
--accent:#2E6CDB;--accent-fg:#2459C0;--accent-bg:#EBF1FE;
--shadow-sm:0 1px 2px rgb(16 24 40 / 6%);--shadow-md:0 1px 2px rgb(16 24 40 / 5%),0 4px 16px -4px rgb(16 24 40 / 10%);
--sev-broken:#D92D20;--sev-broken-fg:#B42318;--sev-broken-bg:#FEE4E2;
--sev-risk:#9B3B9A;--sev-risk-fg:#86338A;--sev-risk-bg:#F7E8F7;
--sev-warning:#C07B03;--sev-warning-fg:#7A5A00;--sev-warning-bg:#FBF0D0;
--sev-info:#5B6B8C;--sev-info-fg:#3F4D6B;--sev-info-bg:#E9EDF5;
--sev-ok:#17805A;--sev-ok-fg:#167A55;--sev-ok-bg:#E1F3EA;
--owner-developer:#5550C0;--owner-developer-fg:#5A58C2;--owner-developer-bg:#EDEFFE;
--owner-gtm:#0593BF;--owner-gtm-fg:#026F90;--owner-gtm-bg:#DFF4FE;
--owner-marketing:#A72A6A;--owner-marketing-fg:#AE3A72;--owner-marketing-bg:#FEEAF1;
--plat-ga4:#D17102;--plat-ga4-fg:#9C5301;--plat-ga4-bg:#FEECE0;
--plat-meta:#3F87FE;--plat-meta-fg:#105FD9;--plat-meta-bg:#E8F1FE;
--plat-google_ads:#299E48;--plat-google_ads-fg:#02782E;--plat-google_ads-bg:#DFF8E1;
--vp-desktop:#08908C;--vp-desktop-fg:#097376;--vp-desktop-bg:#D2F9FA;
--vp-mobile:#799506;--vp-mobile-fg:#596F01;--vp-mobile-bg:#EBF5D8;
--consent-granted:#019F68;--consent-granted-fg:#167A55;--consent-granted-bg:#E1F3EA;
--consent-denied:#B1011B;--consent-denied-fg:#B1011B;--consent-denied-bg:#FFEFEF;
--consent-none:#5F636C;--consent-none-fg:#555963;--consent-none-bg:#EEF0F4;
--plat-tiktok:#1F2433;--plat-tiktok-fg:#252B3B;--plat-tiktok-bg:#E9EBF0;
/* Aliases: a semantic family that means the same as a status wears its colours, defined once so dark mode follows. */
--run-completed:var(--sev-ok);--run-completed-fg:var(--sev-ok-fg);--run-completed-bg:var(--sev-ok-bg);
--run-incomplete:var(--sev-warning);--run-incomplete-fg:var(--sev-warning-fg);--run-incomplete-bg:var(--sev-warning-bg);
--group-failed:var(--sev-broken);--group-failed-fg:var(--sev-broken-fg);--group-failed-bg:var(--sev-broken-bg);
--group-unverified:var(--sev-info);--group-unverified-fg:var(--sev-info-fg);--group-unverified-bg:var(--sev-info-bg);
--group-passed:var(--sev-ok);--group-passed-fg:var(--sev-ok-fg);--group-passed-bg:var(--sev-ok-bg);
--score-fail:var(--sev-broken);--score-fail-fg:var(--sev-broken-fg);--score-fail-bg:var(--sev-broken-bg);
--score-mid:var(--sev-warning);--score-mid-fg:var(--sev-warning-fg);--score-mid-bg:var(--sev-warning-bg);
--score-pass:var(--sev-ok);--score-pass-fg:var(--sev-ok-fg);--score-pass-bg:var(--sev-ok-bg);
--score-track:var(--well);
--s1:4px;--s2:8px;--s3:12px;--s4:16px;--s5:24px;--s6:32px;--s7:48px;
--r-sm:4px;--r-md:8px;--r-lg:12px;--r-pill:999px;
--font-sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif;
--font-mono:ui-monospace,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
--rail:200px;--top:48px}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
--page:#0B0F19;--card:#141927;--well:#1B2235;--fg:#EEF2FF;--muted:#9AA4BD;--border:#263050;--border-strong:#34406A;
--accent:#4F8EF7;--accent-fg:#8CBBFF;--accent-bg:#1A2F5C;
--shadow-sm:none;--shadow-md:none;
--sev-broken:#F04438;--sev-broken-fg:#FDA29B;--sev-broken-bg:#3D1D1D;
--sev-risk:#D78AD6;--sev-risk-fg:#E3A6E0;--sev-risk-bg:#34203A;
--sev-warning:#E8B44A;--sev-warning-fg:#F5C451;--sev-warning-bg:#352B10;
--sev-info:#8191B8;--sev-info-fg:#B4C0DC;--sev-info-bg:#1E2536;
--sev-ok:#3FB98A;--sev-ok-fg:#5BD39A;--sev-ok-bg:#113128;
--owner-developer:#6967E1;--owner-developer-fg:#A2A8FE;--owner-developer-bg:#262748;
--owner-gtm:#059AC7;--owner-gtm-fg:#3CBFF0;--owner-gtm-bg:#013041;
--owner-marketing:#C64082;--owner-marketing-fg:#F490BA;--owner-marketing-bg:#421E2D;
--plat-ga4:#B76300;--plat-ga4-fg:#F09C59;--plat-ga4-bg:#412308;
--plat-meta:#2974F0;--plat-meta-fg:#83B2FE;--plat-meta-bg:#192B49;
--plat-google_ads:#078C38;--plat-google_ads-fg:#70C47E;--plat-google_ads-bg:#133319;
--vp-desktop:#029394;--vp-desktop-fg:#0FC6CB;--vp-desktop-bg:#023234;
--vp-mobile:#728D05;--vp-mobile-fg:#A2BC59;--vp-mobile-bg:#263009;
--consent-granted:#0AB074;--consent-granted-fg:#5BD39A;--consent-granted-bg:#113128;
--consent-denied:#D01C29;--consent-denied-fg:#FF8A85;--consent-denied-bg:#4A1418;
--consent-none:#747982;--consent-none-fg:#ABB0B9;--consent-none-bg:#282B31;
--plat-tiktok:#E4E8F1;--plat-tiktok-fg:#E4E8F1;--plat-tiktok-bg:#272C3A;}}
:root[data-theme="dark"]{
--page:#0B0F19;--card:#141927;--well:#1B2235;--fg:#EEF2FF;--muted:#9AA4BD;--border:#263050;--border-strong:#34406A;
--accent:#4F8EF7;--accent-fg:#8CBBFF;--accent-bg:#1A2F5C;
--shadow-sm:none;--shadow-md:none;
--sev-broken:#F04438;--sev-broken-fg:#FDA29B;--sev-broken-bg:#3D1D1D;
--sev-risk:#D78AD6;--sev-risk-fg:#E3A6E0;--sev-risk-bg:#34203A;
--sev-warning:#E8B44A;--sev-warning-fg:#F5C451;--sev-warning-bg:#352B10;
--sev-info:#8191B8;--sev-info-fg:#B4C0DC;--sev-info-bg:#1E2536;
--sev-ok:#3FB98A;--sev-ok-fg:#5BD39A;--sev-ok-bg:#113128;
--owner-developer:#6967E1;--owner-developer-fg:#A2A8FE;--owner-developer-bg:#262748;
--owner-gtm:#059AC7;--owner-gtm-fg:#3CBFF0;--owner-gtm-bg:#013041;
--owner-marketing:#C64082;--owner-marketing-fg:#F490BA;--owner-marketing-bg:#421E2D;
--plat-ga4:#B76300;--plat-ga4-fg:#F09C59;--plat-ga4-bg:#412308;
--plat-meta:#2974F0;--plat-meta-fg:#83B2FE;--plat-meta-bg:#192B49;
--plat-google_ads:#078C38;--plat-google_ads-fg:#70C47E;--plat-google_ads-bg:#133319;
--vp-desktop:#029394;--vp-desktop-fg:#0FC6CB;--vp-desktop-bg:#023234;
--vp-mobile:#728D05;--vp-mobile-fg:#A2BC59;--vp-mobile-bg:#263009;
--consent-granted:#0AB074;--consent-granted-fg:#5BD39A;--consent-granted-bg:#113128;
--consent-denied:#D01C29;--consent-denied-fg:#FF8A85;--consent-denied-bg:#4A1418;
--consent-none:#747982;--consent-none-fg:#ABB0B9;--consent-none-bg:#282B31;
--plat-tiktok:#E4E8F1;--plat-tiktok-fg:#E4E8F1;--plat-tiktok-bg:#272C3A;}`;
// ---------- end of tokens ----------

// ---------- components: chips, badges, cards, tabs, filter bar, tables, scorecard ----------
const COMPONENTS = `/* Direction D shared components. Written against CONTRACT.md "Generic behaviors"; no section ids here.
   Colours only through tokens.css. Order: reset, type, chips, badges, cards, tabs, filter bar, tables,
   info grid, scorecard, print. */

/* ---------- reset and type ---------- */
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--page);color:var(--fg);font:400 14px/1.5 var(--font-sans);-webkit-font-smoothing:antialiased}
h1,h2,h3,h4,h5,h6,p,ul,ol,figure{margin:0}
ul,ol{padding:0}
h1{font-size:24px;line-height:1.2;font-weight:700;letter-spacing:-.01em;overflow-wrap:anywhere}
h2{font-size:17px;line-height:1.3;font-weight:600}
h3,h4{font-size:14px;line-height:1.4;font-weight:600}
h5,h6{font-size:12px;line-height:1.4;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
b,strong{font-weight:600}
a{color:var(--accent-fg);text-decoration:none}
a:hover{text-decoration:underline}
code,kbd,pre,.mono{font-family:var(--font-mono)}
code{font-size:12.5px;background:var(--well);padding:1px 5px;border-radius:var(--r-sm);overflow-wrap:anywhere}
pre{font-size:12px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--well);padding:var(--s2) var(--s3);border-radius:var(--r-sm)}
svg{flex:none}
.ic{width:16px;height:16px;flex:none;vertical-align:-3px}
.muted{color:var(--muted)}
.xs{font-size:12.5px}
.num,.tnum{font-variant-numeric:tabular-nums}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.n{display:inline-block;min-width:18px;padding:0 5px;border-radius:var(--r-sm);background:var(--well);color:var(--muted);font:500 11px/17px var(--font-mono);text-align:center;font-variant-numeric:tabular-nums}
.btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--card);color:var(--fg);font:500 12.5px var(--font-sans);cursor:pointer}
.btn:hover{background:var(--well)}
.chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}

/* ---------- chips ----------
   <span class="chip chip-<kind> <value>">[icon] [<span class="k">key</span>] text</span>
   Each value sets --k (mark), --k-fg (text) and --k-bg (tint); one rule paints them all. */
.chip{--k:var(--muted);--k-fg:var(--muted);--k-bg:var(--well);
  display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border:1px solid var(--border);border-radius:var(--r-sm);
  border-color:color-mix(in srgb,var(--k) 38%,var(--border));
  background:var(--card);color:var(--k-fg);font:500 12px/1 var(--font-sans);font-variant-numeric:tabular-nums;white-space:nowrap;vertical-align:middle}
.chip>svg{color:var(--k)}
.chip>svg{width:13px;height:13px}
.chip>svg:first-child{margin-left:-3px}
.chip b{font-weight:700}
.chip .k{color:var(--fg);font-weight:400}
.chip.mono{font-family:var(--font-mono);font-size:11.5px}
.chip .dot,.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--k,var(--muted));flex:none}
.chip.lg{height:28px;padding:0 12px;gap:6px;font-size:13px}
.chip.lg>svg{width:15px;height:15px}
.chip.plain{--k-bg:var(--card);border-color:var(--border);color:var(--fg)}
a.chip:hover{text-decoration:none;border-color:var(--k)}

.chip-sev.broken{--k:var(--sev-broken);--k-fg:var(--sev-broken-fg);--k-bg:var(--sev-broken-bg)}
.chip-sev.risk{--k:var(--sev-risk);--k-fg:var(--sev-risk-fg);--k-bg:var(--sev-risk-bg)}
.chip-sev.warning{--k:var(--sev-warning);--k-fg:var(--sev-warning-fg);--k-bg:var(--sev-warning-bg)}
.chip-sev.info{--k:var(--sev-info);--k-fg:var(--sev-info-fg);--k-bg:var(--sev-info-bg)}
.chip-sev.ok{--k:var(--sev-ok);--k-fg:var(--sev-ok-fg);--k-bg:var(--sev-ok-bg)}
.chip-consent.granted{--k:var(--consent-granted);--k-fg:var(--consent-granted-fg);--k-bg:var(--consent-granted-bg)}
.chip-consent.denied{--k:var(--consent-denied);--k-fg:var(--consent-denied-fg);--k-bg:var(--consent-denied-bg)}
.chip-consent.none{--k:var(--consent-none);--k-fg:var(--consent-none-fg);--k-bg:var(--consent-none-bg)}
.chip-owner.developer{--k:var(--owner-developer);--k-fg:var(--owner-developer-fg);--k-bg:var(--owner-developer-bg)}
.chip-owner.gtm{--k:var(--owner-gtm);--k-fg:var(--owner-gtm-fg);--k-bg:var(--owner-gtm-bg)}
.chip-owner.marketing{--k:var(--owner-marketing);--k-fg:var(--owner-marketing-fg);--k-bg:var(--owner-marketing-bg)}
.chip-plat.ga4{--k:var(--plat-ga4);--k-fg:var(--plat-ga4-fg);--k-bg:var(--plat-ga4-bg)}
.chip-plat.meta{--k:var(--plat-meta);--k-fg:var(--plat-meta-fg);--k-bg:var(--plat-meta-bg)}
.chip-plat.google_ads{--k:var(--plat-google_ads);--k-fg:var(--plat-google_ads-fg);--k-bg:var(--plat-google_ads-bg)}
.chip-plat.tiktok{--k:var(--plat-tiktok);--k-fg:var(--plat-tiktok-fg);--k-bg:var(--plat-tiktok-bg)}
.chip-vp.desktop{--k:var(--vp-desktop);--k-fg:var(--vp-desktop-fg);--k-bg:var(--vp-desktop-bg)}
.chip-vp.mobile{--k:var(--vp-mobile);--k-fg:var(--vp-mobile-fg);--k-bg:var(--vp-mobile-bg)}
.chip-run.completed{--k:var(--run-completed);--k-fg:var(--run-completed-fg);--k-bg:var(--run-completed-bg)}
.chip-run.incomplete{--k:var(--run-incomplete);--k-fg:var(--run-incomplete-fg);--k-bg:var(--run-incomplete-bg)}
.chip-group.failed{--k:var(--group-failed);--k-fg:var(--group-failed-fg);--k-bg:var(--group-failed-bg)}
.chip-group.unverified{--k:var(--group-unverified);--k-fg:var(--group-unverified-fg);--k-bg:var(--group-unverified-bg)}
.chip-group.passed{--k:var(--group-passed);--k-fg:var(--group-passed-fg);--k-bg:var(--group-passed-bg)}
/* a zero count keeps its word and glyph but drops the colour, so the eye lands on what is there */
.chip.zero{--k-fg:var(--muted);--k-bg:var(--well);--k:var(--border-strong);border-color:var(--border);border-style:dashed}
/* Denied shares broken's red on purpose; it is told apart by weight: a deeper red, an outline and a bold value,
   in the mono key/value form, never with the octagon. Broken is a filled tint with the octagon glyph. */
.chip-consent{font-family:var(--font-mono);font-size:11.5px}
.chip-consent.denied{border-color:var(--k);font-weight:700}
.chip-consent.granted{font-weight:600}
.chip-consent.none{font-weight:500}

/* ---------- severity badge (C's, unchanged in shape) ---------- */
.sev-broken{--sev:var(--sev-broken);--sev-fg:var(--sev-broken-fg);--sev-bg:var(--sev-broken-bg)}
.sev-risk{--sev:var(--sev-risk);--sev-fg:var(--sev-risk-fg);--sev-bg:var(--sev-risk-bg)}
.sev-warning{--sev:var(--sev-warning);--sev-fg:var(--sev-warning-fg);--sev-bg:var(--sev-warning-bg)}
.sev-info{--sev:var(--sev-info);--sev-fg:var(--sev-info-fg);--sev-bg:var(--sev-info-bg)}
.sev-ok{--sev:var(--sev-ok);--sev-fg:var(--sev-ok-fg);--sev-bg:var(--sev-ok-bg)}
.badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px 2px 6px;border:1px solid var(--border);border-radius:var(--r-sm);font:500 12px/16px var(--font-sans);white-space:nowrap;background:var(--card);color:var(--muted)}
.badge>svg{width:14px;height:14px}
.badge[class*=sev-]{color:var(--sev-fg);border-color:color-mix(in srgb,var(--sev) 38%,var(--border))}
.badge[class*=sev-]>svg{color:var(--sev)}

/* ---------- cards ----------
   <details class="card [sev-x]"><summary>…</summary><div class="body">…</div></details>, collapsed unless [open].
   A plain <div class="card"> is the Summary's static card. */
.card{display:block;background:var(--card);border:1px solid var(--border);border-radius:var(--r-md);box-shadow:var(--shadow-sm);min-width:0}
.card+.card{margin-top:var(--s2)}
.card[class*=sev-]{border-left:3px solid var(--sev)}
.card>.body{padding:var(--s3) var(--s4) var(--s4)}
div.card>.body{padding-top:var(--s4)}
details.card>summary{display:flex;align-items:center;gap:var(--s2) var(--s3);flex-wrap:wrap;min-height:44px;padding:10px 40px 10px var(--s4);position:relative;cursor:pointer;list-style:none;border-radius:calc(var(--r-md) - 1px);user-select:none}
details.card>summary::-webkit-details-marker{display:none}
details.card>summary::after{content:"";position:absolute;right:18px;top:50%;width:7px;height:7px;margin-top:-5px;border-right:1.75px solid var(--muted);border-bottom:1.75px solid var(--muted);transform:rotate(-45deg);transition:transform .15s}
details.card[open]>summary::after{transform:rotate(45deg);margin-top:-6px}
details.card>summary:hover{background:var(--well)}
details.card>summary:hover::after{border-color:var(--fg)}
details.card>summary:focus-visible{outline-offset:-2px}
details.card[open]>summary{border-bottom:1px solid var(--border);border-bottom-left-radius:0;border-bottom-right-radius:0}
details.card>summary .t{font-weight:600;min-width:0;overflow-wrap:anywhere}
details.card>summary .end{margin-left:auto;display:inline-flex;align-items:center;gap:6px}
/* nested cards sit inside a body: hairline only, no second shadow */
.card .card{box-shadow:none}
.card .card>summary{min-height:38px;padding-top:7px;padding-bottom:7px}

/* ---------- tabs ----------
   <div class="tabs" data-tabs><div role="tablist"><button role="tab" aria-selected aria-controls>Label <span class="n">9</span></button></div>
   <div role="tabpanel" id data-label="Label">…</div></div>. shell.js adds .js and the hidden attributes. */
.tabs{min-width:0}
.tabs [role=tablist]{display:flex;gap:2px;border-bottom:1px solid var(--border);overflow-x:auto;scrollbar-width:none;position:relative}
.tabs [role=tablist]::-webkit-scrollbar{display:none}
.tabs [role=tab]{appearance:none;background:none;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;padding:8px 12px;color:var(--muted);font:500 13px/1.3 var(--font-sans);white-space:nowrap;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:color .15s,border-color .15s}
.tabs [role=tab]:hover{color:var(--fg)}
.tabs [role=tab][aria-selected=true]{color:var(--fg);border-bottom-color:var(--accent)}
.tabs [role=tab][aria-selected=true] .n{background:var(--accent-bg);color:var(--accent-fg)}
.tabs [role=tab]:focus-visible{outline-offset:-2px}
.tabs [role=tabpanel]{padding-top:var(--s3);min-width:0}
.tabs [role=tabpanel][hidden]{display:none}
/* without JS the buttons do nothing: hide them and stack the panels under their data-label */
.tabs:not(.js) [role=tablist]{display:none}
.tabs:not(.js) [role=tabpanel]{display:block}
.tabs:not(.js) [role=tabpanel]+[role=tabpanel]{margin-top:var(--s3);border-top:1px solid var(--border)}
.tabs:not(.js) [role=tabpanel][data-label]::before{content:attr(data-label);display:block;margin-bottom:var(--s2);font:600 12px/1.4 var(--font-sans);color:var(--muted);text-transform:uppercase;letter-spacing:.04em}

/* ---------- filter bar ----------
   <div class="filterbar" data-filterbar="#LIST"><span class="fl">Severity</span><button data-filter="sev=broken"
   aria-pressed="false" class="chip-sev broken"><span class="dot"></span>Broken <span class="n">2</span></button>…
   <input type="search" data-filter-search placeholder="Search"><p data-filter-count>4 of 4</p></div> */
.filterbar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:var(--s2) var(--s3);background:var(--card);border:1px solid var(--border);border-radius:var(--r-md);box-shadow:var(--shadow-sm)}
.filterbar .fl{font:600 11px/1 var(--font-sans);color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin:0 2px 0 6px}
.filterbar .fl:first-child{margin-left:0}
.filterbar .sep{width:1px;align-self:stretch;margin:2px 4px;background:var(--border)}
.filterbar [data-filter]{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--card);color:var(--fg);font:500 12.5px/1 var(--font-sans);white-space:nowrap;cursor:pointer;font-variant-numeric:tabular-nums}
.filterbar [data-filter]:hover{border-color:var(--border-strong);background:var(--well)}
.filterbar [data-filter][aria-pressed=true]{background:var(--accent-bg);border-color:var(--accent);color:var(--accent-fg)}
.filterbar [data-filter][aria-pressed=true]::before{content:"";width:8px;height:4px;margin:-3px 0 0 -1px;border-left:1.75px solid currentColor;border-bottom:1.75px solid currentColor;transform:rotate(-45deg)}
.filterbar [data-filter] svg{width:14px;height:14px}
.filterbar [data-filter-search]{flex:1 1 180px;min-width:0;max-width:320px;height:30px;margin-left:auto;padding:0 12px 0 32px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--page) no-repeat 11px 50%/14px 14px;color:var(--fg);font:400 13px var(--font-sans);}
.filterbar [data-filter-search]::placeholder{color:var(--muted)}
.filterbar [data-filter-search]:focus{outline:2px solid var(--accent);outline-offset:0;border-color:var(--accent)}
.filterbar [data-filter-count]{flex-basis:100%;margin:2px 0 0;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.filterbar [data-filter-count]:empty{display:none}
html:not(.js) .filterbar{display:none}

/* ---------- tables ---------- */
.tscroll{overflow-x:auto;position:relative;border:1px solid var(--border);border-radius:var(--r-md);background:var(--card)}
.tbl{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
.tbl th,.tbl td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:middle;overflow-wrap:anywhere}
.tbl thead th{font-weight:500;font-size:12px;color:var(--muted);background:var(--well);white-space:nowrap}
.tbl tbody th{font-weight:500}
.tbl th:first-child,.tbl td:first-child{padding-left:var(--s4)}
.tbl th:last-child,.tbl td:last-child{padding-right:var(--s4)}
.tbl tbody tr:last-child>*{border-bottom:0}
.tbl tbody tr:hover>*{background:color-mix(in srgb,var(--well) 55%,transparent)}
.tbl .num{text-align:right;font-family:var(--font-mono);white-space:nowrap}
.tbl .bad{color:var(--sev-broken-fg);font-weight:600}
.tbl .dim{color:var(--muted)}

/* ---------- info grid (Summary option cards) ----------
   <div class="grid"><div class="info"><span class="ic-plate"><svg/></span><span class="lbl">Vendors</span>
   <span class="val">2 of 4</span><span class="sub">GA4 · Meta</span></div></div> */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:var(--s3)}
.grid>.info{display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-areas:"ic lbl" "val val" "sub sub";align-items:center;gap:6px var(--s2);padding:14px var(--s4);background:var(--card);border:1px solid var(--border);border-radius:var(--r-md);box-shadow:var(--shadow-sm);min-width:0}
.info .ic-plate{grid-area:ic;display:grid;place-items:center;width:26px;height:26px;border-radius:var(--r-sm);background:var(--well);color:var(--muted)}
.info .ic-plate svg{width:15px;height:15px}
.info .lbl{grid-area:lbl;font-size:12.5px;font-weight:500;color:var(--muted)}
.info .val{grid-area:val;margin-top:4px;font-size:20px;line-height:1.2;font-weight:650;letter-spacing:-.01em;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.info .val small{font-size:13px;font-weight:500;color:var(--muted);letter-spacing:0}
.info .sub{grid-area:sub;font-size:12.5px;color:var(--muted);display:flex;flex-wrap:wrap;gap:4px;align-items:center;min-width:0}
.grid>.info.wide{grid-column:span 2}
@media (max-width:520px){.grid>.info.wide{grid-column:auto}}

/* ---------- scorecard ----------
   A ring, not a bare number: the arc shows "25 of 100" as a share at a glance and carries the band colour
   as a printable stroke, so the card itself never needs a tint.
   <div class="scorecard band-fail">
     <div class="sc-ring" role="img" aria-label="Score 25 of 100"><svg viewBox="0 0 120 120"><circle class="trk" cx="60" cy="60" r="52"/>
       <circle class="arc" cx="60" cy="60" r="52" pathLength="100" style="--score:25"/></svg><span class="sc-num">25</span><span class="sc-of">/100</span></div>
     <p class="sc-verdict"><svg class="ic"><use href="#sev-broken"/></svg>Fail</p>
     <p class="sc-head">Purchase tracking is broken on mobile.</p>
     <ul class="sc-costs"><li class="sev-broken"><span class="pts">−60</span>…</li></ul>
     <div class="sc-chips chips">…chip-sev lg…</div>
   </div> */
.band-fail{--band:var(--score-fail);--band-fg:var(--score-fail-fg);--band-bg:var(--score-fail-bg)}
.band-mid{--band:var(--score-mid);--band-fg:var(--score-mid-fg);--band-bg:var(--score-mid-bg)}
.band-pass{--band:var(--score-pass);--band-fg:var(--score-pass-fg);--band-bg:var(--score-pass-bg)}
.scorecard{display:grid;grid-template-columns:120px minmax(0,1fr);grid-template-areas:"ring verdict" "ring head" "ring costs" "chips chips";column-gap:var(--s6);align-items:start;padding:var(--s5) var(--s6);background:var(--card);border:1px solid var(--border);border-top:4px solid var(--band);border-radius:var(--r-lg);box-shadow:var(--shadow-md)}
.sc-ring{grid-area:ring;position:relative;width:120px;height:120px;display:grid;place-items:center;align-self:center}
.sc-ring svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg)}
.sc-ring .trk{fill:none;stroke:var(--score-track);stroke-width:10}
.sc-ring .arc{fill:none;stroke:var(--band);stroke-width:10;stroke-linecap:round;stroke-dasharray:var(--score) 100}
.sc-num{position:relative;font:700 44px/1 var(--font-sans);letter-spacing:-.03em;color:var(--fg);margin-top:-8px}
.sc-of{position:absolute;left:0;right:0;top:calc(50% + 18px);text-align:center;font:500 12px/1 var(--font-mono);color:var(--muted)}
.sc-verdict{grid-area:verdict;align-self:end;display:flex;align-items:center;gap:8px;font:700 30px/1.1 var(--font-sans);letter-spacing:-.02em;color:var(--sev,var(--band))}
/* the verdict is large text (24–30px bold), where 3:1 is the bar; the solid band colour clears it in both modes
   and keeps the amber of "Needs attention" from turning brown, as the 4.5:1 text step would */
.sc-verdict .ic{width:26px;height:26px}
.sc-head{grid-area:head;margin-top:6px;font-size:17px;line-height:1.4;font-weight:500;color:var(--fg);max-width:60ch}
.sc-costs{grid-area:costs;list-style:none;margin-top:var(--s3);display:grid;gap:6px}
.sc-costs li{display:grid;grid-template-columns:44px minmax(0,1fr);align-items:baseline;gap:var(--s2);font-size:13.5px;line-height:1.45}
.sc-costs .pts{font:600 13px/1 var(--font-mono);color:var(--sev-fg,var(--band-fg));font-variant-numeric:tabular-nums}
.sc-costs .pts+span{min-width:0;overflow-wrap:anywhere}
.sc-chips{grid-area:chips;margin-top:var(--s5);padding-top:var(--s4);border-top:1px solid var(--border)}
.scorecard.band-pass .sc-head{color:var(--muted)}
@media (max-width:640px){
  .scorecard{grid-template-columns:88px minmax(0,1fr);grid-template-areas:"ring verdict" "ring head" "costs costs" "chips chips";column-gap:var(--s4);padding:var(--s4)}
  .sc-ring{width:88px;height:88px;align-self:start}
  .sc-num{font-size:32px;margin-top:-6px}
  .sc-of{top:calc(50% + 12px);font-size:10.5px}
  .sc-verdict{font-size:24px;gap:6px}
  .sc-verdict .ic{width:20px;height:20px}
  .sc-head{font-size:15px;margin-top:4px}
  .sc-costs{margin-top:var(--s4)}
  .sc-costs li{font-size:13px}
  .sc-chips{margin-top:var(--s4);padding-top:var(--s3)}
}

/* ---------- motion and print ---------- */
@media (prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;animation:none!important}}
@media print{
  body{background:#fff;font-size:12.5px}
  .card,.grid>.info,.scorecard,.filterbar{box-shadow:none}
  .chip,.badge,.n{background:none!important;border:1px solid currentColor}
  .chip.zero{border-color:var(--border)}
  .tbl thead th{background:none;border-bottom:1px solid #000}
  .info .ic-plate{background:none}
  details.card>summary:hover{background:none}
  details.card>summary::after,.filterbar,.tabs [role=tablist]{display:none}
  .tabs [role=tabpanel],.tabs [role=tabpanel][hidden]{display:block}
  .tabs [role=tabpanel][data-label]::before{content:attr(data-label);display:block;margin:var(--s2) 0;font:600 11px/1.4 var(--font-sans);text-transform:uppercase;letter-spacing:.04em}
  /* writePdf prints with JavaScript off, so a card marked data-print-open is opened by CSS alone */
  details.card[data-print-open]::details-content{content-visibility:visible;display:block}
  details.card[data-print-open]>summary{border-bottom:1px solid var(--border)}
  .card,.grid>.info,.scorecard,.tbl tr{break-inside:avoid}
  .scorecard{border-top-width:4px}
}`;
// ---------- end of components ----------

// ---------- shell: top bar, rail, layout, 390 px, no-JS and print ----------
const SHELL = `/* Page shell: skip link, top bar, rail (expanded 200 px, collapsed 48 px, strip under 720 px), main, section switching,
   expand/collapse row, reveal flash, footer, no-JS and print. Driven by js/shell.js through html.js, html[data-rail],
   body[data-state] and the hidden attribute. */

/* JS hides with the hidden attribute; a section rule that sets display must not bring a hidden row back on screen. */
@media screen{[hidden]{display:none!important}}

/* shell-level helpers (C had them; components.css does not) */
.js-only{display:none!important}
html.js .js-only{display:inline-flex!important}
html.js .sec-tools.js-only{display:flex!important}
.logo{display:inline-flex}
.logo .l-dark{display:none}
html[data-theme="dark"] .logo .l-light{display:none}
html[data-theme="dark"] .logo .l-dark{display:inline}
@media (prefers-color-scheme:dark){html:not([data-theme="light"]) .logo .l-light{display:none}html:not([data-theme="light"]) .logo .l-dark{display:inline}}
.eyebrow{font:600 11px/1.4 var(--font-sans);text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.mock-note{display:flex;gap:var(--s2);align-items:flex-start;padding:var(--s2) var(--s3);margin:var(--s3) 0 var(--s4);border:1px dashed var(--sev-info);border-radius:var(--r-sm);color:var(--sev-info-fg);font-size:12.5px}
.mock-note .ic{margin-top:2px}

.skip{position:absolute;left:var(--s4);top:-48px;z-index:50;padding:var(--s2) var(--s3);background:var(--card);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--fg)}
.skip:focus{top:var(--s2)}

/* ---------- top bar ---------- */
.top{position:sticky;top:0;z-index:30;height:var(--top);display:flex;align-items:center;gap:var(--s3);padding:0 var(--s4);background:var(--card);border-bottom:1px solid var(--border);white-space:nowrap}
.top .brand{display:inline-flex;align-items:center;flex:none}
.top .l-mark{display:none}
.top-site{display:flex;align-items:baseline;gap:var(--s2);min-width:0;overflow:hidden}
.top-site b{font-weight:600;overflow:hidden;text-overflow:ellipsis}
.top-date{font-size:12.5px;font-variant-numeric:tabular-nums}
.top-verdict{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;border:1px solid var(--border);border-color:color-mix(in srgb,var(--v) 45%,var(--border));border-radius:var(--r-sm);background:var(--card);color:var(--v-fg);font:500 12.5px/1 var(--font-sans);font-variant-numeric:tabular-nums;flex:none}
.top-verdict b{font-weight:700;font-size:14px}
.top-verdict .sc-l{color:var(--muted)}
.top-verdict:hover{text-decoration:none;filter:brightness(.97)}
.top-verdict .sc{font-weight:500;color:var(--muted)}
.v-fail{--v:var(--score-fail);--v-fg:var(--score-fail-fg);--v-bg:var(--score-fail-bg)}
.v-mid{--v:var(--score-mid);--v-fg:var(--score-mid-fg);--v-bg:var(--score-mid-bg)}
.v-pass{--v:var(--score-pass);--v-fg:var(--score-pass-fg);--v-bg:var(--score-pass-bg)}
.top-end{margin-left:auto;display:flex;align-items:center;gap:var(--s2)}
.byline{display:inline-flex;align-items:center;gap:var(--s2);font-size:12px;color:var(--muted);margin-right:var(--s2)}
.mock-switch{align-items:center;gap:.3em;height:28px;padding:0 10px;border:1px dashed var(--border-strong);border-radius:var(--r-sm);background:none;color:var(--muted);font:500 12px var(--font-sans);cursor:pointer}
.mock-switch:hover{color:var(--fg);border-color:var(--muted)}
.mock-switch[aria-pressed=true]{border-color:var(--sev-info);color:var(--sev-info-fg);background:var(--sev-info-bg)}
.icon-btn{align-items:center;justify-content:center;width:32px;height:32px;padding:0;border:0;border-radius:var(--r-sm);background:none;color:var(--muted);cursor:pointer}
.icon-btn:hover{background:var(--well);color:var(--fg)}

/* ---------- shell and rail ---------- */
.shell{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start}
.rail{position:sticky;top:var(--top);z-index:20;width:var(--rail);height:calc(100vh - var(--top));overflow:hidden auto;padding:var(--s2) 4px;border-right:1px solid var(--border);background:var(--card)}
html.rail-anim .rail{transition:width .2s ease}
.rail ul{list-style:none;margin:0;padding:0;display:grid;gap:2px}
.r-head{display:flex;margin-bottom:var(--s2);padding-bottom:var(--s2);border-bottom:1px solid var(--border)}
.r-toggle,.rail a{position:relative;display:flex;align-items:center;gap:10px;height:36px;padding:0 10px 0 11px;border-radius:var(--r-sm);color:var(--fg);font-size:13.5px;white-space:nowrap}
.r-toggle{width:40px;border:0;background:none;color:var(--muted);cursor:pointer}
.r-toggle .ic{transform:rotate(180deg);transition:transform .2s}
.r-toggle:hover,.rail a[href]:hover{background:var(--well);text-decoration:none}
.rail a[aria-disabled]{color:var(--muted);opacity:.6}
.rail a[aria-current]{background:var(--accent-bg);color:var(--accent-fg);font-weight:600;box-shadow:inset 3px 0 var(--accent)}
.rail .ic{width:18px;height:18px}
.r-l{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;transition:opacity .15s}
.r-t{display:inline-flex;align-items:center;min-width:20px;justify-content:center;padding:0 6px;border-radius:var(--r-pill);background:var(--t-bg);color:var(--t-fg);font:500 11.5px/18px var(--font-mono);font-variant-numeric:tabular-nums}
.r-t .ic{width:14px;height:14px;color:var(--t)}
.r-t:has(.ic){background:none;padding:0}
.r-d{display:none;position:absolute;left:26px;top:7px;width:6px;height:6px;border-radius:50%;background:var(--t);box-shadow:0 0 0 2px var(--card)}
[data-tone=broken]{--t:var(--sev-broken);--t-fg:var(--sev-broken-fg);--t-bg:var(--sev-broken-bg)}
[data-tone=risk]{--t:var(--sev-risk);--t-fg:var(--sev-risk-fg);--t-bg:var(--sev-risk-bg)}
[data-tone=warning]{--t:var(--sev-warning);--t-fg:var(--sev-warning-fg);--t-bg:var(--sev-warning-bg)}
[data-tone=info]{--t:var(--sev-info);--t-fg:var(--sev-info-fg);--t-bg:var(--sev-info-bg)}
[data-tone=ok]{--t:var(--sev-ok);--t-fg:var(--sev-ok-fg);--t-bg:var(--sev-ok-bg)}
[data-tone=completed]{--t:var(--run-completed);--t-fg:var(--run-completed-fg);--t-bg:var(--run-completed-bg)}
[data-tone=incomplete]{--t:var(--run-incomplete);--t-fg:var(--run-incomplete-fg);--t-bg:var(--run-incomplete-bg)}
[data-tone=neutral]{--t:var(--muted);--t-fg:var(--muted);--t-bg:var(--well)}
/* tooltip from data-tip: always on the toggle, on the links only when collapsed */
.rail [data-tip]::after{content:attr(data-tip);position:absolute;left:calc(100% + 8px);top:50%;transform:translateY(-50%);padding:4px 8px;border-radius:var(--r-sm);background:var(--fg);color:var(--card);font:500 12px/1.4 var(--font-sans);white-space:nowrap;pointer-events:none;opacity:0;visibility:hidden;z-index:40;box-shadow:var(--shadow-md)}
.r-toggle:is(:hover,:focus-visible)::after{opacity:1;visibility:visible}
@media (min-width:720px){
  html[data-rail=collapsed] .rail{width:48px;overflow:visible}
  html[data-rail=collapsed] .r-toggle .ic{transform:none}
  html[data-rail=collapsed] .r-l,html[data-rail=collapsed] .r-t{opacity:0;width:0;min-width:0;padding:0;overflow:hidden}
  html[data-rail=collapsed] .r-d{display:block}
  html[data-rail=collapsed] .rail a[data-tip]:is(:hover,:focus-visible)::after{opacity:1;visibility:visible}
}

/* ---------- main and sections ---------- */
main{min-width:0;padding:var(--s5) var(--s6) var(--s7)}
main:focus{outline:none}
.sec{position:relative}
.sec>h2:focus{outline:none}
main [id]{scroll-margin-top:calc(var(--top) + var(--s3))}
html:not(.js) main>.sec+.sec{margin-top:var(--s7);padding-top:var(--s5);border-top:1px solid var(--border)}
/* The failed run is a mockup-only state reached through the top-bar switch, so without JS it stays out of the page. */
html:not(.js) main>.sec[id^="failed-"]{display:none}
/* expand / collapse all, top right of the section, level with its h2 */
.sec-tools{position:absolute;top:-4px;right:0;gap:var(--s1)}
.sec-tools .btn{height:26px;padding:0 8px;font-size:12px;color:var(--muted)}
.sec-tools .btn:hover{color:var(--fg)}
.sec:has(>.sec-tools) h2{padding-right:190px}
.fb-clear{height:28px}
/* revealed element: a 1.5 s accent outline; the tint fades unless motion is reduced */
.flash{outline:2px solid var(--accent)!important;outline-offset:2px;border-radius:var(--r-sm);animation:aitd-flash 1.5s ease-out}
@keyframes aitd-flash{from{background-color:var(--accent-bg)}}

.footer{display:flex;align-items:center;gap:var(--s4);padding:var(--s4);border-top:1px solid var(--border);background:var(--card)}
.footer img{vertical-align:-3px}

/* ---------- under 720 px: the rail becomes a strip under the top bar ---------- */
@media (max-width:719.98px){
  :root{--top:44px}
  .top{gap:var(--s2);padding:0 var(--s3)}
  .top .l-lockup,.top-site .eyebrow,.top-date,.byline{display:none}
  .top .l-mark{display:block}
  .mock-switch .m-pre{display:none}
  .shell{display:block}
  .rail{top:var(--top);width:auto;height:auto;padding:0;border-right:0;border-bottom:1px solid var(--border);overflow:visible}
  .r-head{display:none}
  .rail ul{display:flex;gap:0;padding:0 var(--s2);overflow-x:auto;scrollbar-width:none;-webkit-mask-image:linear-gradient(to right,black calc(100% - 28px),transparent);mask-image:linear-gradient(to right,black calc(100% - 28px),transparent)}
  .rail ul::-webkit-scrollbar{display:none}
  .rail a{height:40px;gap:6px;padding:0 10px;border-radius:0;font-size:13px;border-bottom:2px solid transparent}
  .rail a>.ic{display:none}
  .rail a[aria-current]{background:none;box-shadow:none;border-bottom-color:var(--accent)}
  .rail [data-tip]::after{display:none}
  main{padding:var(--s4) var(--s4) var(--s6)}
  main [id]{scroll-margin-top:calc(var(--top) + 42px + var(--s3))}
  .sec:has(>.sec-tools) h2{padding-right:150px}
  .sec-tools .btn{padding:0 6px}
}

/* ---------- print: the no-JS layout, sections stacked one per page ---------- */
@media print{
  :root{--top:0px}
  .top,.rail,.skip,.sec-tools,.mock-note,.fb-clear,html.js .js-only,html.js .sec-tools.js-only{display:none!important}
  .shell{display:block}
  main{padding:0}
  main>.sec[hidden],[data-select-pane][hidden],[data-inspector][hidden],[data-filter-group][hidden],[data-text][hidden]{display:block!important}
  li[data-text][hidden]{display:list-item!important}
  tr[data-text][hidden]{display:table-row!important}
  main>.sec[id^="failed-"]{display:none!important}
  main>.sec+.sec{break-before:page}
  .flash{outline:0!important;animation:none}
}`;
// ---------- end of shell ----------

// ---------- product: dark-glyph plates (TikTok, X), initials for a platform without artwork, a white label's name ----------
const PRODUCT = `.plate{fill:var(--card);stroke:var(--border);stroke-width:1}
.plat-fb{display:inline-grid;place-items:center;border-radius:var(--r-sm);background:var(--well);color:var(--muted);font:500 10px var(--font-mono);flex:none}
.plat-fb.s12{width:12px;height:12px;font-size:8px}
.plat-fb.s14{width:14px;height:14px;font-size:9px}
.plat-fb.s16{width:16px;height:16px}
.plat-fb.s18{width:18px;height:18px;font-size:10px}
.plat-fb.s20{width:20px;height:20px;font-size:11px}
.brand-name{font:600 16px var(--font-sans);color:var(--fg)}`;
// ---------- end of product ----------

// ---------- summary: #summary ----------
const SUMMARY = `/* Summary (SPEC §2): scorecard with status chips, then six "about this run" cards.
   Scoped by .sm, the class on both #summary and #failed-summary; components.css supplies .scorecard, .chip, .grid>.info. */
.sm>.scorecard{margin-top:var(--s4)}
.sm>.sm-about{margin-top:var(--s5)}

/* scorecard: a larger ring than the gallery's 120px; this is the one big thing on the screen */
.sm .scorecard{grid-template-columns:136px minmax(0,1fr);row-gap:0;padding:var(--s5) var(--s6) var(--s4)}
.sm .sc-ring{width:136px;height:136px}
.sm .sc-ring .trk,.sm .sc-ring .arc{stroke-width:9}
.sm .sc-num{font-size:48px;margin-top:-10px}
.sm .sc-of{top:calc(50% + 20px)}
.sm .sc-num.sm-none{margin-top:0;color:var(--muted);font-weight:500}
.sm .sc-verdict{margin-top:2px}
.sm .sc-head{margin-top:var(--s1)}

/* explanation lines: one subgrid so points, text, platform chips and the where chip line up across lines */
.sm .sc-costs{grid-template-columns:44px auto auto auto minmax(0,1fr);column-gap:var(--s3);row-gap:0;margin-top:var(--s3)}
.sm .sc-costs li{grid-column:1/-1;display:grid;grid-template-columns:subgrid;font-size:14px}
.sm .sc-costs li>a{grid-column:1/-1;display:grid;grid-template-columns:subgrid;align-items:center;min-height:32px;padding:3px var(--s2);margin:0 calc(-1 * var(--s2));border-radius:var(--r-sm);color:var(--fg)}
.sm .sc-costs li>a:hover{background:var(--well);text-decoration:none}
.sm .sc-costs .pts{grid-column:1;font-size:14px}
.sm .sc-costs .what{grid-column:2;min-width:0}
.sm .sc-costs .pl{grid-column:3;display:flex;gap:4px}
.sm .sc-costs .wh{grid-column:4;display:flex;gap:4px}
.sm .sc-costs.nopts{grid-template-columns:auto auto auto minmax(0,1fr)}
.sm .sc-costs.nopts .what{grid-column:1}
.sm .sc-costs.nopts .pl{grid-column:2}
.sm .sc-costs.nopts .wh{grid-column:3}
.sm .sc-costs code{font-size:12.5px}
.sm .sc-chips{margin-top:var(--s4);padding-top:var(--s4)}
.sm .sc-chips .chip.zero{cursor:default}

/* about this run: 3 / 2 / 1 columns, every card the same height */
.sm .sm-about{grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:1fr;gap:var(--s3)}
.sm .sm-about>.info{grid-template-rows:auto 1fr auto;align-items:start;row-gap:var(--s2);padding:var(--s4)}
.sm .info .lbl{align-self:center;display:inline-flex;align-items:center;gap:2px;justify-self:start;color:var(--muted)}
.sm .info .lbl svg{opacity:.55}
.sm .info .lbl:hover{color:var(--accent-fg);text-decoration:none}
.sm .info .lbl:hover svg{opacity:1}
.sm .info .val{margin-top:0;align-self:center;font-size:18px}
.sm .info .val .chip{vertical-align:2px}
.sm .info .sub{align-self:end}
.sm .sm-chipval .val .chips{gap:4px}
/* a vendor that was not seen keeps its word but loses colour, logo included (as .chip.zero) */
.sm .chip.sm-unseen{--k-fg:var(--muted);--k-bg:transparent;border-color:var(--border);border-style:dashed}
.sm .chip.sm-unseen svg{filter:grayscale(1);opacity:.5}

/* journeys matrix: rows = journeys, columns = viewports, cell = run state + logos seen */
.sm-matrix{border-collapse:collapse;font-size:13px;line-height:1}
.sm-matrix th,.sm-matrix td{padding:0}
.sm-matrix thead th{padding:0 0 4px 9px;text-align:left;color:var(--muted)}
.sm-matrix tbody th{padding-right:var(--s2);text-align:left;font-weight:500;color:var(--fg)}
.sm-matrix td a{display:inline-flex;align-items:center;gap:5px;padding:3px 8px 3px 6px;border-radius:var(--r-sm);color:var(--fg)}
.sm-matrix td a:hover{background:var(--well);text-decoration:none}
.sm-matrix .chip{width:20px;height:20px;padding:0;justify-content:center}
.sm-matrix .chip>svg:first-child{margin:0}
.sm-logo{display:inline-flex}

/* four vendor chips wrap 3 + 1 in a third-width card; two by two reads as a set */
@media (min-width:1024px){.sm .sm-chipval .val .chips{display:grid;grid-template-columns:repeat(2,max-content)}}
@media (max-width:1023px){.sm .sm-about{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:900px){
.sm .sc-costs,.sm .sc-costs.nopts{display:grid;grid-template-columns:minmax(0,1fr)}
.sm .sc-costs li,.sm .sc-costs li>a{grid-column:auto;grid-template-columns:none}
.sm .sc-costs li>a{display:flex;flex-wrap:wrap;align-items:center;gap:4px var(--s2);padding:var(--s1) var(--s2)}
.sm .sc-costs .pts{flex:0 0 36px}
.sm .sc-costs .what{flex:1 1 calc(100% - 52px)}
.sm .sc-costs:not(.nopts) .pl{margin-left:44px}
.sm .sc-costs:not(.nopts) .pl:empty+.sr+.wh,.sm .sc-costs:not(.nopts) .pl:empty~.wh{margin-left:44px}
}
@media (max-width:640px){
.sm .scorecard{grid-template-columns:96px minmax(0,1fr);padding:var(--s4)}
.sm .sc-ring{width:96px;height:96px}
.sm .sc-num{font-size:34px;margin-top:-6px}
.sm .sc-of{top:calc(50% + 13px)}
}
@media (max-width:599px){.sm .sm-about{grid-template-columns:minmax(0,1fr);grid-auto-rows:auto}}
@media print{
.sm .sc-costs li>a{padding-left:0;padding-right:0;margin:0}
.sm .sm-about{grid-template-columns:repeat(3,minmax(0,1fr))}
.sm .chip.sm-unseen{border-style:dashed}
}`;
// ---------- end of summary ----------

// ---------- findings: #findings ----------
const FINDINGS = `/* Findings (Direction D). Everything is scoped under .fnd so no rule leaks into another section.
   Generic pieces (.card, .tabs, .chip, .filterbar, .badge, .n) come from components.css; this file only tunes them. */

/* ---------- filter bar: one line at 1280, a "Filters (n)" fold under 720 ---------- */
.fnd .filterbar{position:relative;margin-top:var(--s2);gap:8px 10px;padding:8px 12px;counter-reset:fc}
/* desktop: row 1 = severity, owner, clear and "n of m"; row 2 = platform, journey, viewport and the search.
   The groups wrapper dissolves so every piece can be ordered; ::after forces the row break. */
.fnd .fb-groups{display:contents}
.fnd .fb-groups>.fg{order:1}
.fnd .filterbar::after{content:"";order:4;flex:1 0 100%;height:0;margin-top:-8px}
.fnd .fb-rest{order:5;display:flex;flex-wrap:wrap;align-items:center;gap:6px 0;min-width:0}
.fnd .fg{display:inline-flex;align-items:center;gap:4px;flex:none}
.fnd .fg+.fg,.fnd .fb-rest .fg+.fg{margin-left:8px;padding-left:8px;border-left:1px solid var(--border)}
.fnd .filterbar .fl{margin:0 4px 0 0;font-size:10.5px;letter-spacing:.06em}
.fnd .filterbar [data-filter]{height:26px;padding:0 8px;gap:5px;font-size:12px}
.fnd .filterbar [data-filter] .n{min-width:0;padding:0;background:none;font-size:11px;line-height:1;color:var(--muted)}
.fnd .filterbar [data-filter][aria-pressed=true] .n{color:var(--accent-fg)}
.fnd .filterbar [data-filter]:disabled,.fnd .filterbar [data-filter].zero{color:var(--muted);cursor:default;background:transparent;border-style:dashed}
.fnd .filterbar [data-filter]:disabled .dot{background:var(--border-strong)}
.fnd .filterbar [data-filter].chip-vp svg{color:var(--k)}
.fnd .filterbar [data-filter][aria-pressed=true] svg{color:currentColor}
.fnd .filterbar [data-filter][aria-pressed=true]{counter-increment:fc}
/* the search field's icon is the sprite's ui-search inside the label (the CSS may carry no data URI) */
.fnd .fb-search{order:6;position:relative;display:flex;align-items:center;flex:1 1 120px;min-width:100px;max-width:260px;margin-left:auto}
.fnd .fb-search>svg{position:absolute;left:11px;width:14px;height:14px;color:var(--muted);pointer-events:none}
.fnd .filterbar [data-filter-search]{flex:1 1 auto;width:100%;max-width:none;margin-left:0;height:28px}
.fnd .fb-clear{order:2;margin-left:auto;height:28px;padding:0 10px;border:0;border-radius:var(--r-pill);background:none;color:var(--accent-fg);font:500 12.5px var(--font-sans);cursor:pointer}
.fnd .fb-clear:hover{background:var(--accent-bg)}
.fnd .fb-clear[hidden]~[data-filter-count]{margin-left:auto}
.fnd .filterbar [data-filter-count]{order:3;flex:none;margin:0 0 0 -4px;min-width:46px;text-align:right;font:500 12px var(--font-mono);color:var(--muted);white-space:nowrap}
.fnd .filterbar [data-filter-count]:empty{display:block}
.fnd .fb-fold{display:none}
@media (max-width:719px){
  .fnd .filterbar{padding:8px}
  .fnd .fb-search{order:1;flex:1 1 100px;min-width:100px;max-width:none;margin-left:0}
  .fnd .fb-fold{order:2;display:inline-block;appearance:none;-webkit-appearance:none;margin:0;height:28px;padding:0 12px;border:1px solid var(--border);border-radius:var(--r-pill);background:var(--card);color:var(--fg);cursor:pointer;font:500 12.5px/26px var(--font-sans);white-space:nowrap}
  .fnd .fb-fold::after{content:attr(data-label)}
  .fnd .filterbar:has([aria-pressed=true]) .fb-fold{border-color:var(--accent);background:var(--accent-bg);color:var(--accent-fg)}
  .fnd .filterbar:has([aria-pressed=true]) .fb-fold::after{content:attr(data-label) " (" counter(fc) ")"}
  .fnd .filterbar:has(.fb-fold:focus-visible) .fb-fold{outline:2px solid var(--accent);outline-offset:2px}
  .fnd .filterbar::after{display:none}
  .fnd .fb-clear{order:3;margin-left:0}
  .fnd .filterbar [data-filter-count]{order:4;margin:0}
  /* folded: the boxes stay (so the pressed chips are counted) but cannot be seen or focused */
  .fnd .fb-groups{order:5;flex:1 1 100%;display:flex;flex-direction:column;align-items:stretch;gap:10px;max-height:0;overflow:hidden;visibility:hidden}
  .fnd .filterbar:has(.fb-fold:checked) .fb-groups{max-height:none;overflow:visible;visibility:visible;padding-top:8px;border-top:1px solid var(--border)}
  .fnd .fb-groups>.fg,.fnd .fb-rest{order:0}
  .fnd .fb-rest{display:flex;flex-direction:column;align-items:stretch;gap:10px}
  .fnd .fg{flex-wrap:wrap;gap:6px}
  .fnd .fg+.fg,.fnd .fb-rest .fg+.fg{margin:0;padding:0;border:0}
  .fnd .filterbar .fl{flex-basis:100%;margin:0}
  .fnd .filterbar [data-filter]{height:30px}
}

/* ---------- groups: a line with the group chip and its count ---------- */
.fnd-list{margin-top:var(--s4)}
.fnd .group{margin-top:var(--s4)}
.fnd .group:first-child{margin-top:0}
.fnd .group>h3,.fnd .group>summary>h3{display:flex;align-items:center;gap:var(--s3);flex:1;margin:0}
.fnd .group>h3::after,.fnd .group>summary>h3::after{content:"";flex:1;height:1px;background:var(--border)}
.fnd .group>h3{margin-bottom:var(--s2)}
.fnd details.group>summary{display:flex;align-items:center;position:relative;padding:2px 28px var(--s2) 0;cursor:pointer;list-style:none;user-select:none}
.fnd details.group>summary::-webkit-details-marker{display:none}
.fnd details.group>summary::after{content:"";position:absolute;right:16px;top:50%;width:7px;height:7px;margin-top:-6px;border-right:1.75px solid var(--muted);border-bottom:1.75px solid var(--muted);transform:rotate(-45deg);transition:transform .15s}
.fnd details.group[open]>summary::after{transform:rotate(45deg);margin-top:-7px}
.fnd details.group>summary:hover::after{border-color:var(--fg)}
.fnd details.group>summary:focus-visible{outline-offset:2px;border-radius:var(--r-sm)}
.fnd .chip.lg b{font-weight:700}
.fnd .g-rows>.card+.card{margin-top:6px}
.fnd [hidden]{display:none!important}

/* ---------- the collapsed row: badge · title · owner · platform · where, in aligned columns ---------- */
.fnd details.card>summary,.fnd .card.line{display:grid;grid-template-columns:92px minmax(0,1fr) 112px 150px 132px;align-items:center;column-gap:var(--s3);row-gap:6px;flex-wrap:nowrap;min-height:44px;padding:8px 40px 8px var(--s3)}
.fnd .card.line{min-height:38px;padding-top:6px;padding-bottom:6px;position:relative}
.fnd .card>summary>.badge,.fnd .card.line>.badge{justify-self:start}
.fnd .card .f-t{font-weight:500;min-width:0;overflow-wrap:anywhere;line-height:1.4}
.fnd .card.line .f-t{font-weight:400}
.fnd .card .f-t .muted{font-weight:400}
.fnd .f-t{grid-column:2}
.fnd .c-owner{grid-column:3}
.fnd .c-plat{grid-column:4}
.fnd .c-where{grid-column:5}
.fnd .card.line .f-t{grid-column:2 / 4}
.fnd .card.line .c-owner{display:none}
.fnd .c-owner,.fnd .c-plat,.fnd .c-where{display:flex;gap:4px;align-items:center;min-width:0}
.fnd .card.line .c-owner{display:none}
.fnd .run-multi svg:first-child{margin-left:0}
.fnd .run-multi .vp-desktop{color:var(--vp-desktop-fg)}
.fnd .run-multi .vp-mobile{color:var(--vp-mobile-fg)}
.fnd .run-multi{gap:3px}
.fnd .card .f-t code{font-size:12px}
.fnd .card.line .go{position:absolute;right:12px;top:50%;margin-top:-10px;display:grid;place-items:center;width:20px;height:20px;color:var(--muted);border-radius:var(--r-sm)}
.fnd .card.line .go:hover{color:var(--fg);background:var(--well);text-decoration:none}
.fnd .card.line .go svg{width:14px;height:14px}
.fnd .card.line.flash,.fnd .card.flash{outline:2px solid var(--accent);outline-offset:1px}
@media (max-width:719px){
  .fnd details.card>summary,.fnd .card.line{display:flex;flex-wrap:wrap;column-gap:8px;padding:8px 36px 8px 12px}
  .fnd .card>summary>.badge,.fnd .card.line>.badge{order:1}
  .fnd .card .c-where{order:2;margin-left:auto}
  .fnd .card .f-t,.fnd .card.line .f-t{order:3;flex:1 0 100%}
  .fnd .card .c-owner{order:4}
  .fnd .card .c-plat{order:5}
  .fnd .c-owner:empty,.fnd .c-plat:empty,.fnd .c-where:empty{display:none}
  .fnd .card.line .go{right:8px;top:12px;margin-top:0}
}

/* ---------- the open row ---------- */
.fnd .card>.body{padding:0 var(--s4) var(--s3)}
.fnd .card .tabs [role=tab]{padding:8px 12px 7px}
.fnd .card .tabs [role=tabpanel]{padding-top:var(--s3)}
.fnd-impact{display:flex;gap:8px;align-items:center;padding:6px 10px;margin-bottom:var(--s3);border-radius:var(--r-sm);background:var(--sev-bg);color:var(--sev-fg);font-size:13px;line-height:1.4}
.fnd-impact .ic{width:14px;height:14px}
.fnd-kv{width:100%;border-collapse:collapse;font-size:13px}
.fnd-kv th,.fnd-kv td{text-align:left;padding:5px 0;border-bottom:1px solid var(--border);vertical-align:middle;overflow-wrap:anywhere}
.fnd-kv tr:last-child>*{border-bottom:0}
.fnd-kv th{width:128px;padding-right:var(--s3);font-weight:500;color:var(--muted);font-size:12.5px;white-space:nowrap}
.fnd-kv td .chip{margin-right:4px}
.fnd-kv td code{font-size:12px}
.fnd-fine{display:flex;flex-wrap:wrap;gap:6px;margin-top:var(--s3)}
.fnd-line{margin-top:var(--s3);font-size:13px}
.fnd-raw{margin-top:var(--s2);font-size:12.5px}
.fnd-raw>summary{cursor:pointer;color:var(--accent-fg);list-style:none;display:inline-flex;align-items:center;gap:4px}
.fnd-raw>summary::-webkit-details-marker{display:none}
.fnd-raw>summary::before{content:"";width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform .15s}
.fnd-raw[open]>summary::before{transform:rotate(45deg)}
.fnd-raw pre{margin-top:var(--s2);max-height:240px;overflow:auto}
.fnd-fix{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;font-size:13.5px}
.fnd-snip{margin-top:var(--s3);padding:var(--s3);overflow-x:auto;white-space:pre}
.fnd-snip code,.fnd pre code{background:none;padding:0;font-size:12px;overflow-wrap:normal}
.fnd-where{list-style:none;display:grid;gap:6px}
.fnd-where li{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;font-size:13px}
.fnd-step{min-width:0}
.fnd .fnd-h{margin:var(--s4) 0 var(--s2);display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.fnd .fnd-h .chip{text-transform:none;letter-spacing:0}
.fnd .fnd-h>svg{width:14px;height:14px}
.fnd-fix>span{min-width:0}
.fnd-recipe{list-style:none;counter-reset:rc;display:grid;gap:2px;margin:0;padding:var(--s2) var(--s3);background:var(--well);border-radius:var(--r-sm)}
.fnd-recipe li{counter-increment:rc;display:flex;gap:10px;font-size:12px;line-height:1.6}
.fnd-recipe li::before{content:counter(rc);min-width:18px;text-align:right;color:var(--muted);font:500 11px/1.9 var(--font-mono)}
.fnd-recipe code{background:none;padding:0;overflow-wrap:anywhere}
.fnd-links{display:flex;flex-wrap:wrap;gap:var(--s2) var(--s5);font-size:13px}
.fnd-links a{display:inline-flex;align-items:center;gap:4px}

@media print{
  .fnd .filterbar{display:none}
  .fnd details.group[data-filter-group]::details-content{content-visibility:visible;display:block}
  .fnd details.group>summary::after{display:none}
  .fnd .card{break-inside:avoid;box-shadow:none}
  .fnd-impact{background:none!important;border:1px solid currentColor}
  .fnd-recipe{background:none;border:1px solid var(--border)}
}

.fnd .fnd-empty{display:flex;align-items:center;gap:6px;padding:var(--s4);border:1px dashed var(--border);border-radius:var(--r-md)}

/* ---------- product data the mockup did not show: the check's detail, the model's explanation, GTM tags, accepted ---------- */
.fnd-detail{margin-bottom:var(--s3);font-size:13px;overflow-wrap:anywhere}
.fnd-detail code{font-size:12px}
.fnd-ai{margin-top:var(--s3);padding:var(--s2) var(--s3);border-left:2px solid var(--border);color:var(--muted);font-size:13px}
.fnd-ai p+p,.fnd-ai p+ol{margin-top:6px}
.fnd-ai-h{display:flex;align-items:center;gap:6px;font-weight:500}
.fnd-ai-h .ic{width:14px;height:14px}
p.fnd-ai{border-left:0;padding:0}
.fnd .fix-steps{margin:6px 0 0;padding-left:20px;display:grid;gap:4px}
.fnd .gtm-tags th{white-space:normal}
.fnd .gtm-why{margin-top:4px;color:var(--muted)}
.fnd .note{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:var(--s3) 0 0;color:var(--muted)}
.fnd .f-t>.badge{margin-left:6px;vertical-align:1px}
.fnd .fnd-none{display:flex;align-items:center;gap:6px;padding:var(--s2) 0;font-size:13px}
.fnd .g-rows:empty{display:none}
a.chip.chip-sev:hover{text-decoration:none}

/* ---------- changed since last run: a collapsed card between the filter bar and the groups ---------- */
.fnd .fnd-changes{margin-top:var(--s3)}
.fnd details.fnd-changes>summary{display:flex;flex-wrap:wrap;gap:var(--s2) var(--s3);padding:8px 40px 8px var(--s4)}
.fnd details.fnd-changes>summary h3{font-size:14px}
.fnd .fnd-changes>.body{padding:var(--s3) var(--s4)}
.fnd-change-list{list-style:none;display:grid;gap:6px;margin-top:var(--s2);font-size:13px}
.fnd-change-list li{display:flex;flex-wrap:wrap;align-items:center;gap:6px;overflow-wrap:anywhere}`;
// ---------- end of findings ----------

// ---------- journeys: #journeys ----------
const JOURNEYS = `/* Journeys (Direction D): journey tabs + viewport switch, step timeline, step pane with Hits / Data Layer / Requests tabs.
   Section-scoped; generic .tabs/.card/.chip come from components.css. No max-width anywhere: the pane takes what is left. */
#journeys{min-width:0}

/* ---------- picker: journey tabs, viewport switch on the same line (right) ---------- */
#journeys .jr-pick{position:relative}
#journeys .jr-pick.js>[role=tablist]{padding-right:230px}
#journeys .jr-pick>[role=tablist]>[role=tab]{font-size:14px;padding:9px 14px;text-transform:capitalize}
#journeys .jr-gl{display:inline-flex;gap:2px}
#journeys .jr-g{display:inline-flex;color:var(--sev-fg)}
#journeys .jr-g .ic{width:13px;height:13px;vertical-align:0}
/* the viewport switch ([data-vp-switch]): a two-segment control; the pressed segment takes its viewport hue (identity, not status) */
#journeys .jr-vp{display:inline-flex;gap:0;padding:2px;border:1px solid var(--border);border-radius:var(--r-pill);background:var(--well);margin:var(--s3) 0 var(--s2)}
#journeys .jr-pick.js .jr-vp{position:absolute;top:3px;right:0;margin:0}
html:not(.js) #journeys .jr-vp{display:none}
#journeys .jr-vpb{--k:var(--vp-desktop);--k-fg:var(--vp-desktop-fg);--k-bg:var(--vp-desktop-bg);appearance:none;display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 11px;border:0;border-radius:var(--r-pill);background:none;color:var(--muted);font:500 12.5px/1 var(--font-sans);white-space:nowrap;cursor:pointer}
#journeys .jr-vpb.mobile{--k:var(--vp-mobile);--k-fg:var(--vp-mobile-fg);--k-bg:var(--vp-mobile-bg)}
#journeys .jr-vpb:hover{color:var(--fg)}
#journeys .jr-vpb .ic{width:14px;height:14px}
#journeys .jr-vpb[aria-pressed=true]{background:var(--k-bg);color:var(--k-fg);box-shadow:inset 0 0 0 1px var(--k);font-weight:600}
#journeys .jr-pick>[role=tabpanel]{padding-top:var(--s3)}
#journeys .jr-run[hidden]{display:none}
html:not(.js) #journeys .jr-run+.jr-run{margin-top:var(--s5)}
html.js #journeys .jr-runh{display:none}

/* ---------- status line: run state chip, three numbers, the goal on one line ---------- */
#journeys .jr-status{display:flex;align-items:center;gap:var(--s2) var(--s3);min-width:0;margin-bottom:var(--s3);font-size:12.5px}
#journeys .jr-nums{white-space:nowrap;font-variant-numeric:tabular-nums}
#journeys .jr-goal{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)}

/* ---------- inspector: step timeline | pane ---------- */
#journeys .jr-insp{display:grid;grid-template-columns:clamp(296px,22vw,380px) minmax(0,1fr);gap:var(--s4);align-items:start}
html:not(.js) #journeys .jr-insp{grid-template-columns:minmax(0,1fr)}
html:not(.js) #journeys .jr-steps{display:none}
#journeys .jr-steps{position:sticky;top:calc(var(--top) + var(--s3));max-height:calc(100vh - var(--top) - var(--s5));overflow:auto;background:var(--card);border:1px solid var(--border);border-radius:var(--r-md);box-shadow:var(--shadow-sm);padding:var(--s1) 0 var(--s2);scrollbar-width:thin}
#journeys .jr-steps ul{list-style:none;margin:0;padding:0}
/* the timeline: one 2px line through the number column, from the first page to the last step */
#journeys .jr-steps li{position:relative}
#journeys .jr-steps li::before{content:"";position:absolute;left:24px;top:0;bottom:0;width:2px;background:var(--border)}
#journeys .jr-steps li:first-child::before{top:18px}
#journeys .jr-steps li:last-child::before{bottom:50%}
#journeys .jr-pg{display:grid;grid-template-columns:24px auto minmax(0,1fr);column-gap:10px;align-items:baseline;padding:8px 12px 2px 13px}
#journeys .jr-pg+.jr-st,#journeys .jr-st+.jr-pg{margin-top:0}
#journeys .jr-st+.jr-pg{margin-top:4px}
#journeys .jr-pg-i{align-self:center;position:relative;z-index:1;display:grid;place-items:center;width:24px;height:24px;border-radius:var(--r-sm);background:var(--well);border:1px solid var(--border);color:var(--muted)}
#journeys .jr-pg-t{font-weight:600;font-size:13px;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#journeys .jr-pg-p{justify-self:start;background:none;padding:0;font-size:11.5px;line-height:1.3;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#journeys .jr-st>button{appearance:none;position:relative;width:100%;display:grid;grid-template-columns:24px minmax(0,1fr) repeat(var(--jr-plats,2),30px) 14px;column-gap:6px;align-items:center;min-height:32px;padding:3px 12px 3px 13px;border:0;background:none;color:var(--fg);font:13px/1.3 var(--font-sans);text-align:left;cursor:pointer}
#journeys .jr-st>button>.jr-t{margin-left:4px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#journeys .jr-st>button:hover{background:var(--well)}
#journeys .jr-st>button:focus-visible{outline-offset:-2px}
#journeys .jr-st>button:is([aria-selected=true],[aria-current=true],[aria-current=step],[aria-pressed=true],.selected){background:var(--accent-bg);box-shadow:inset 3px 0 0 var(--accent)}
#journeys .jr-st>button:is([aria-selected=true],[aria-current=true],[aria-current=step],[aria-pressed=true],.selected)>.jr-t{font-weight:600}
#journeys .jr-n{position:relative;z-index:1;display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--card);border:1.5px solid var(--border-strong);color:var(--fg);font:600 11px/1 var(--font-mono);font-variant-numeric:tabular-nums}
#journeys .jr-st.zero .jr-n{border-style:dashed;color:var(--muted)}
#journeys .jr-st.zero .jr-t{color:var(--muted)}
#journeys .jr-st[class*=sev-] .jr-n{background:var(--sev-bg);border-color:var(--sev);color:var(--sev-fg)}
#journeys .jr-hc{display:flex;justify-content:flex-end}
#journeys .jr-hc .chip{height:18px;padding:0 5px 0 4px;gap:2px;font:600 11px/1 var(--font-mono)}
#journeys .jr-hc .chip>svg{width:11px;height:11px;margin-left:0}
#journeys .jr-gs{display:flex;justify-content:center}

/* ---------- pane ---------- */
#journeys .jr-panes{min-width:0;container:jrpane/inline-size}
#journeys .jr-pane{padding:0}
#journeys .jr-pane+.jr-pane{margin-top:var(--s3)}
#journeys .jr-pane:focus{outline:none}
#journeys .jr-pane[data-select-pane][hidden]{display:none}
#journeys .jr-ph{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px var(--s3);align-items:center;padding:var(--s3) var(--s4) 0}
#journeys .jr-ph h3{display:flex;align-items:center;gap:10px;font-size:16px;line-height:1.3;min-width:0}
#journeys .jr-ph h3 .jr-n{width:26px;height:26px;font-size:12px}
#journeys .jr-pane[class*=sev-] .jr-ph .jr-n{background:var(--sev-bg);border-color:var(--sev);color:var(--sev-fg)}
#journeys .jr-ph-e{display:inline-flex;gap:6px;align-items:center}
#journeys .jr-ph-m{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:0 var(--s2);padding-left:36px;font:12px/1.5 var(--font-mono);color:var(--muted);min-width:0}
#journeys .jr-ph-m>span{overflow-wrap:anywhere}
#journeys .jr-ph-m>span+span::before{content:"·";margin-right:var(--s2)}
#journeys .jr-pane>.tabs{padding:0 var(--s4) var(--s4)}
#journeys .jr-pane>.tabs>[role=tablist]{margin-top:var(--s2)}
#journeys .jr-pane>.tabs>[role=tablist]>[role=tab][disabled]{opacity:.45;cursor:default}
#journeys .jr-pane>.tabs:not(.js)>[role=tabpanel].jr-none{display:none}
#journeys .jr-pane>p.jr-empty{padding:var(--s2) var(--s4) var(--s4) 52px}
#journeys .jr-empty{margin:0}
#journeys .jr-list>.card+.card{margin-top:6px}

/* hit, push rows: fixed columns so platform, event, consent, severity and time line up from row to row */
#journeys .jr-list>details.card>summary{display:grid;align-items:center;column-gap:10px;row-gap:4px;min-height:40px;padding:7px 36px 7px 12px}
#journeys .jr-list>details.card>summary::after{right:15px}
#journeys .jr-hit>summary{grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"p e s" "k k k" "c c t"}
#journeys .jr-c-p{grid-area:p;display:flex}
#journeys .jr-hit .jr-ev{grid-area:e}
#journeys .jr-hit .jr-c-k{grid-area:k}
#journeys .jr-c-c{grid-area:c;display:flex;gap:4px;flex-wrap:wrap;min-width:0}
#journeys .jr-c-s{grid-area:s;display:flex}
#journeys .jr-hit .jr-tm{grid-area:t}
#journeys .jr-c-s:empty,#journeys .jr-c-k:empty{display:none}
#journeys code.jr-ev{background:none;padding:0;font-size:13px;font-weight:600;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
#journeys .jr-c-k{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;min-width:0;font-size:12.5px}
#journeys .jr-kv{display:inline-flex;gap:5px;align-items:baseline;min-width:0;white-space:nowrap}
#journeys .jr-kv .k{color:var(--muted);font:11.5px var(--font-mono)}
#journeys .jr-kv .v{font:12.5px var(--font-mono);overflow:hidden;text-overflow:ellipsis}
#journeys .jr-miss{height:20px}
#journeys .jr-miss .k{color:inherit;font-weight:600;font-family:var(--font-mono)}
#journeys .jr-tm{font:11.5px var(--font-mono);color:var(--muted);white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums}
#journeys .chip-consent .k{color:inherit;font-weight:400;opacity:.85}
#journeys .jr-push>summary{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"e t" "k k"}
@container jrpane (min-width:520px){
  #journeys .jr-hit>summary{grid-template-columns:76px minmax(0,1fr) 112px 84px 46px;grid-template-areas:"p e c s t" ". k k k k"}
}
@container jrpane (min-width:820px){
  #journeys .jr-hit>summary{grid-template-columns:76px 140px minmax(0,1fr) 112px 84px 46px;grid-template-areas:"p e k c s t"}
  #journeys .jr-push>summary{grid-template-columns:minmax(0,220px) minmax(0,1fr) 46px;grid-template-areas:"e k t"}
}
#journeys .jr-push .jr-ev{grid-area:e;font-weight:500}
#journeys .jr-push .jr-c-k{grid-area:k;gap:4px 6px}
#journeys .jr-push .jr-tm{grid-area:t}

/* open hit: flag line, parameters | items, raw request */
#journeys .jr-list>.card>.body{padding:var(--s3)}
#journeys .jr-flag{display:flex;flex-wrap:wrap;gap:6px;align-items:flex-start;margin:0 0 var(--s3);padding:6px 10px;border-radius:var(--r-sm);background:var(--sev-bg);color:var(--sev-fg);font-size:12.5px}
#journeys .jr-flag .ic{margin-top:2px}
#journeys .jr-flag>span{flex:1 1 200px;min-width:0}
#journeys .jr-hb{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:var(--s3) var(--s4)}
#journeys .jr-hb h5{display:flex;align-items:center;gap:6px;margin-bottom:6px}
#journeys .jr-hb .tbl{font-size:12.5px;border:1px solid var(--border);border-radius:var(--r-sm);border-collapse:separate;border-spacing:0}
#journeys .jr-hb .tbl th,#journeys .jr-hb .tbl td{padding:4px 8px}
#journeys .jr-kvt tbody th{width:38%;font:11.5px var(--font-mono);color:var(--muted);vertical-align:top}
#journeys .jr-kvt td{font:12px var(--font-mono)}
#journeys .jr-raw{margin-top:var(--s3)}
#journeys .jr-raw>summary{flex-wrap:nowrap;font-size:12.5px}
#journeys .jr-raw>summary .t{font-weight:500;white-space:nowrap}
#journeys .jr-raw>summary .end{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}
#journeys .jr-raw pre,#journeys .jr-push pre{margin:0}
#journeys .jr-push>.body{padding:var(--s2)}

/* requests: one compact table, URL truncated (full URL in the title) */
#journeys .jr-req{table-layout:fixed;font-size:12.5px;min-width:520px}
#journeys .jr-req th,#journeys .jr-req td{padding:5px 8px}
#journeys .jr-req th:nth-child(1){width:96px}
#journeys .jr-req th:nth-child(2){width:64px}
#journeys .jr-req th:nth-child(4){width:60px}
#journeys .jr-req th:nth-child(5){width:84px}
#journeys .jr-req th:nth-child(6){width:64px}
#journeys .jr-url span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
#journeys .jr-req td.mono{font-size:12px}

/* not fired (only where the run stopped) */
#journeys .jr-nf{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:var(--s3);font-size:12.5px}
#journeys .jr-nf code{background:none;padding:0;font-size:11.5px}

/* ---------- 900 px and below: step strip over the pane ---------- */
@media (max-width:900px){
  #journeys .jr-pick.js>[role=tablist]{padding-right:96px}
  #journeys .jr-pick>[role=tablist]>[role=tab]{padding:9px 10px}
  #journeys .jr-vpl{display:none}
  #journeys .jr-vpb{padding:0 9px}
  #journeys .jr-status{flex-wrap:wrap}
  #journeys .jr-goal{flex-basis:100%}
  #journeys .jr-insp{grid-template-columns:minmax(0,1fr);gap:var(--s3)}
  #journeys .jr-steps{position:relative;top:auto;max-height:none;overflow-x:auto;overflow-y:hidden;padding:6px;scrollbar-width:none}
  #journeys .jr-steps ul{display:flex;align-items:center;gap:4px;width:max-content}
  #journeys .jr-steps li::before{display:none}
  #journeys .jr-pg{display:block;width:1px;align-self:stretch;margin:4px 4px!important;padding:0;background:var(--border)}
  #journeys .jr-pg:first-child{display:none}
  #journeys .jr-pg>*{display:none}
  #journeys .jr-st>button{display:flex;gap:3px;width:auto;min-height:36px;padding:4px 6px;border-radius:var(--r-sm)}
  #journeys .jr-st>button>.jr-t,#journeys .jr-hc{display:none}
  #journeys .jr-gs:empty{display:none}
  #journeys .jr-st>button:is([aria-selected=true],[aria-current=true],[aria-current=step],[aria-pressed=true],.selected){box-shadow:inset 0 -3px 0 var(--accent)}
  #journeys .jr-ph{padding:var(--s3) var(--s3) 0}
  #journeys .jr-ph-m{padding-left:0}
  #journeys .jr-pane>.tabs{padding:0 var(--s3) var(--s3)}
  #journeys .jr-pane>.tabs>[role=tablist]>[role=tab]{padding:8px 9px}
}

/* ---------- print: the no-JS layout; unflagged steps print as their header line only ---------- */
@media print{
  #journeys .jr-steps{display:none}
  #journeys .jr-insp{grid-template-columns:minmax(0,1fr)}
  #journeys .jr-pane,#journeys .jr-pick [role=tabpanel]{display:block!important}
  #journeys .jr-pane:not([data-flagged])>.tabs,#journeys .jr-pane:not([data-flagged])>p.jr-empty{display:none}
  #journeys .jr-pane:not([data-flagged]) .jr-ph{padding-bottom:var(--s2)}
  #journeys .jr-pane{break-inside:avoid;box-shadow:none}
  /* on paper a step is its hits; the dataLayer and the requests stay in the HTML and capture.json */
  #journeys .jr-pane [role=tabpanel][id$="-dl"],#journeys .jr-pane [role=tabpanel][id$="-req"]{display:none!important}
  #journeys .jr-pane:not([data-flagged]){padding-bottom:0}
  #journeys .jr-flag{background:none;border:1px solid currentColor}
  #journeys .jr-vp{display:none}
  #journeys .jr-run[hidden]{display:block!important}
  #journeys .jr-runh{display:inline-flex!important}
  #journeys .jr-pane>.tabs:not(.js)>[role=tabpanel].jr-none,#journeys .jr-pane>.tabs>[role=tabpanel].jr-none{display:none}
}`;
// ---------- end of journeys ----------

// ---------- consent: #consent ----------
const CONSENT = `/* Consent: platform status lines, then the Consent Mode and Scenarios cards. Colours only through tokens;
   denied/granted/none come from .chip-consent in components.css (denied is the crimson red token, never amber). */
#consent .cs-list{list-style:none;margin:var(--s3) 0 var(--s2);padding:0;display:grid;gap:var(--s2)}
#consent .cs-row{display:flex;align-items:center;flex-wrap:wrap;gap:var(--s2) var(--s3);min-height:48px;padding:8px var(--s4);margin:0}
#consent .cs-cells{display:flex;flex-wrap:wrap;align-items:center;gap:6px var(--s4);min-width:0}
#consent .cs-p{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
#consent .cs-k{font-size:12px;color:var(--muted)}
#consent .cs-go{margin-left:auto;display:inline-flex;align-items:center;gap:2px;font-size:12.5px;font-weight:500}
#consent .card+.card{margin-top:var(--s2)}
#consent details.card>summary .chip.plain{color:var(--muted)}
/* Consent Mode body */
#consent .cm-list{list-style:none;margin:0;padding:0;display:grid;gap:var(--s2)}
#consent .cm-list li{display:grid;grid-template-columns:64px minmax(0,220px) minmax(0,1fr);align-items:center;gap:var(--s2) var(--s3);padding:8px var(--s3);border:1px solid var(--border);border-radius:var(--r-sm);background:var(--page)}
#consent .cm-l{font-weight:600}
#consent .cm-w{font-size:12.5px;color:var(--muted)}
#consent .cm-s{display:flex;flex-wrap:wrap;gap:6px}
#consent .cm-rep{margin-top:var(--s2);display:flex;align-items:center;gap:5px}
#consent .cm-timing{list-style:none;margin:0 0 var(--s3);padding:0;display:grid;gap:6px}
#consent .cm-timing li{display:flex;align-items:center;flex-wrap:wrap;gap:4px var(--s3)}
#consent .cm-timing .chip{min-width:92px}
#consent .cm-runs{margin:var(--s3) 0 var(--s2)}
#consent .cm-find{margin-top:var(--s2)}
#consent .cs-none{margin:var(--s2) 0 0}
/* scenarios table */
#consent .cs-tag{display:inline-flex;align-items:center;gap:8px;white-space:nowrap}
#consent .cs-tag code{white-space:nowrap}
#consent .cs-c{display:inline-flex;align-items:center;gap:8px;white-space:nowrap}
#consent .cs-c .num{font-size:13px;min-width:12px;text-align:right}
#consent .cs-tbl td.cs-bad{background:color-mix(in srgb,var(--sev-risk-bg) 55%,transparent)}
#consent .cs-tbl tbody tr:hover>td.cs-bad{background:var(--sev-risk-bg)}
#consent .cs-c a{display:inline-flex;align-items:center;font-size:12.5px;font-weight:500}
@media (max-width:900px){
#consent .cm-list li{grid-template-columns:minmax(0,1fr)}
#consent .cs-go{margin-left:0}
}
@media print{
#consent .cs-row{box-shadow:none;break-inside:avoid}
}
/* journeys.css still has a bare .t (mono time); keep the card title independent of it */
#consent details.card>summary>.t{font:600 14px/1.4 var(--font-sans);color:var(--fg);margin-left:0;white-space:normal}
#consent .cs-tbl{min-width:560px}
#consent .cs-tbl td,#consent .cs-tbl th{white-space:nowrap}`;
// ---------- end of consent ----------

// ---------- scope: #coverage, #inventory and #run ----------
const SCOPE = `/* Scope (Coverage, Inventory, Run). Selectors are scoped by section id; colours only through tokens. */
/* journeys.css still has a bare .t (mono time); keep the card titles independent of it */
#coverage details.card>summary>.t,#inventory details.card>summary>.t,#run details.card>summary>.t{font:600 14px/1.4 var(--font-sans);color:var(--fg);margin-left:0;white-space:normal}
#coverage .card+.card,#run .card{margin-top:var(--s2)}

/* ----- Coverage ----- */
#coverage .cv-bar{display:inline-flex;gap:2px;align-items:center;height:14px;padding:0 2px}
#coverage .cv-bar i{width:7px;height:14px;border-radius:2px;background:var(--sev-ok)}
#coverage .cv-bar i.params{background:var(--sev-broken)}
#coverage .cv-bar i.missing{background:var(--sev-warning)}
#coverage .cv-pcs{gap:6px}
#coverage .cv-pc .chip{gap:4px}
#coverage .cv-pc .chip b{font-family:var(--font-mono);font-size:11px}
#coverage .filterbar{margin-bottom:var(--s3);box-shadow:none}
#coverage .cv-tbl .cv-c{text-align:center;white-space:nowrap}
#coverage .cv-tbl thead .cv-c{text-align:center}
#coverage .cv-tbl .cv-g{padding:0 5px;height:22px}
#coverage .cv-tbl .cv-g>svg:first-child{margin-left:0}
#coverage .cv-ev{display:inline-flex;align-items:center;gap:8px;white-space:nowrap}
#coverage .cv-ev code{white-space:nowrap}
#coverage .cv-needs code{margin:0 3px 3px 0;display:inline-block;font-size:11.5px}
#coverage code.cv-miss{background:var(--sev-broken-bg);color:var(--sev-broken-fg);font-weight:600}
#coverage .cv-tbl tbody tr[data-st=params]>th{box-shadow:inset 3px 0 0 var(--sev-broken)}
#coverage .cv-tbl tbody tr[data-st=missing]>th{box-shadow:inset 3px 0 0 var(--sev-warning)}
#coverage .cv-key{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s2) var(--s3);margin-top:var(--s3)}
/* first column stays put while the run columns scroll at 390 */
#coverage .cv-scroll .cv-tbl th:first-child{position:sticky;left:0;z-index:1;background:var(--card)}
#coverage .cv-scroll .cv-tbl thead th:first-child{background:var(--well)}

/* ----- Inventory ----- */
#inventory .inv-rows{list-style:none;display:grid;gap:var(--s2);margin-top:var(--s3)}
#inventory .inv-rows>li>.card{margin:0}
#inventory .inv-note{margin-top:var(--s3)}
#inventory .inv-note+.inv-note{margin-top:var(--s1)}
#inventory .inv-line{display:flex;align-items:center;flex-wrap:wrap;gap:var(--s2) var(--s3);min-height:44px;padding:10px var(--s4)}
#inventory .inv-line .chip-sev{opacity:.95}
#inventory .inv-m{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}
#inventory .inv-m b{color:var(--fg);font-family:var(--font-mono);font-weight:600}
#inventory .inv-m.zero b{color:var(--muted);font-weight:500}
#inventory .inv-list{list-style:none;margin:0;padding:0;display:grid;gap:6px}
#inventory .inv-list li{display:flex;align-items:center;flex-wrap:wrap;gap:var(--s2);min-width:0}
#inventory .inv-list li>svg{color:var(--muted)}
#inventory .inv-n{font-size:12.5px;color:var(--muted)}
#inventory .inv-n b{color:var(--fg);font-family:var(--font-mono);font-weight:600}
#inventory .inv-list .chip.plain{height:20px;font-size:11.5px}

/* ----- Run ----- */
#run .run-facts{margin:var(--s3) 0 var(--s2);padding:var(--s2) var(--s4);display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 var(--s5);background:var(--card);border:1px solid var(--border);border-radius:var(--r-md);box-shadow:var(--shadow-sm)}
#run .run-facts>div{display:grid;grid-template-columns:84px minmax(0,1fr);align-items:center;gap:var(--s2);min-height:38px;padding:5px 0;border-bottom:1px solid var(--border)}
#run .run-facts>div.wide{grid-column:1/-1}
#run .run-facts>div:nth-last-child(-n+1){border-bottom:0}
#run .run-facts dt{font:600 11px/1.2 var(--font-sans);color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
#run .run-facts dd{margin:0;display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-width:0}
#run .run-facts code{margin:0}
#run .run-facts code.file{display:inline-flex;align-items:center;gap:5px;color:var(--muted)}
#run .tm-tbl .tm-d{display:inline-block;width:80px;height:6px;margin-right:var(--s2);vertical-align:middle;border-radius:3px;background:var(--well);overflow:hidden;text-align:left}
#run .tm-tbl .tm-bar{display:block;height:100%;border-radius:3px;background:var(--muted)}
#run .tm-tbl .tm-bar.desktop{background:var(--vp-desktop)}
#run .tm-tbl .tm-bar.mobile{background:var(--vp-mobile)}
#run .tm-s{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap}

@media (max-width:900px){
#run .run-facts{grid-template-columns:minmax(0,1fr);padding:var(--s1) var(--s3)}
#run .run-facts>div{grid-template-columns:78px minmax(0,1fr)}
#run .run-facts>div:nth-last-child(2).wide{border-bottom:1px solid var(--border)}
}
@media print{
#run .run-facts{box-shadow:none;break-inside:avoid}
#inventory .inv-line{box-shadow:none;break-inside:avoid}
}
/* tables keep their shape and scroll inside .tscroll on a phone */
#coverage .cv-tbl{min-width:640px}
#coverage .cv-needs code{white-space:nowrap}
#run .tm-tbl{min-width:540px}
#coverage .cv-tbl td,#coverage .cv-tbl th,#run .tm-tbl td{white-space:nowrap}
#coverage .cv-tbl td.cv-needs{white-space:normal;min-width:150px}
#coverage .cv-tbl.cv-conv{min-width:760px}
#coverage .cv-conv thead th.cv-c{white-space:normal;overflow-wrap:normal;line-height:1.25}
#run .tm-tbl{min-width:600px}
#run .tm-s{flex-wrap:nowrap}
/* ----- additions for the product: search icon, links, plan vs site, trend ----- */
/* the search field's icon is a sprite symbol laid over the input; CSS may not carry a data URI */
#coverage .cv-search{position:relative;display:flex;flex:1 1 180px;min-width:0;max-width:320px;margin-left:auto}
#coverage .cv-search>svg{position:absolute;left:11px;top:50%;margin-top:-7px;width:14px;height:14px;color:var(--muted);pointer-events:none}
#coverage .cv-search [data-filter-search]{flex:1 1 auto;max-width:none;margin-left:0;width:100%}
#coverage a.cv-run,#run a.chip-run{text-decoration:none}
#coverage .cv-ev .badge{height:20px;font-size:11.5px}
#coverage .cv-lead{margin-bottom:var(--s3)}
#coverage .cv-none{margin-top:var(--s3)}
#coverage .pv-tbl td.xs{white-space:normal;min-width:220px}
#coverage .pv-scroll{margin-top:var(--s3)}
#coverage .pv-h{margin-top:var(--s4)}
#coverage .pv-changes{margin:var(--s1) 0 0 var(--s4)}
#run .run-facts dd>.xs{line-height:1.4}
#run .tr-body{display:grid;gap:var(--s3)}
#run .tr-chart{display:grid;gap:var(--s2)}
#run .spark{display:block;max-width:100%;height:auto}
#run .spark polyline{fill:none;stroke:var(--sev);stroke-width:1.75;stroke-linejoin:round}
#run .spark circle{fill:var(--sev);stroke:var(--card);stroke-width:1}
#run .spark circle.hollow{fill:var(--card);stroke:var(--sev);stroke-width:1.5}
#run .spark-legend{display:flex;flex-wrap:wrap;gap:4px 12px}
#run .spark-legend i{display:inline-block;width:10px;height:3px;background:var(--sev);margin-right:5px;vertical-align:middle;border-radius:2px}
#run .tr-tbl{min-width:420px}
#run .tr-tbl th[scope=row]{white-space:nowrap}
#run .tr-h{margin-top:var(--s2)}
#run .tr-list{list-style:none;display:grid;gap:6px}
#run .tr-list li{display:flex;align-items:baseline;gap:var(--s2);font-size:13px}
#run .tr-list li>.badge{flex:none}
@media print{#run .spark{print-color-adjust:exact;-webkit-print-color-adjust:exact}}`;
// ---------- end of scope ----------

export const CSS = [TOKENS, COMPONENTS, SHELL, PRODUCT, SUMMARY, FINDINGS, JOURNEYS, CONSENT, SCOPE].join("\n");

/** The shared parts on their own, for pages that are not the report (plan.html loads tokens, components and product, not the shell). */
export { TOKENS, COMPONENTS, SHELL, PRODUCT };

/** The white label's accent colour, written for the light theme and under both dark selectors (whitelabel.js). */
export { brandCss };
