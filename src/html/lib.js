// Helpers every section of the HTML report uses: escaping, the icon sprite, platform names and icons, chips and
// badges, the ids that link Findings, Journeys and Summary to each other, and page titles for steps. The 0.17
// renderer imports its icon, logo and id helpers from here, so the sections cannot drift apart while
// both exist; this module imports neither of them. CONTRACT-IMPL.md in the build notes lists what each helper is for.
import { hitMatchesEvent } from "../checks.js";
import { LOGOS, LOGO_ART } from "../brand.js";
import { OWNERS, ownerOf } from "../verify.js";
import { escapeHtml, platformLabel, safeKey, sortPlatforms } from "../report-shared.js";

/* ---------- icons: one inline SVG sprite, referenced with <use> ---------- */

const STROKE = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';
// Severity glyphs (shape and mark, so they survive greyscale) and the interface icons (Lucide).
const UI_SYMBOLS = {
  "sev-broken": '<path d="M8.2 2.5h7.6l5.7 5.7v7.6l-5.7 5.7H8.2l-5.7-5.7V8.2z"/><path d="m9.5 9.5 5 5m0-5-5 5"/>',
  "sev-risk": '<path d="M12 2.5 21.5 12 12 21.5 2.5 12z"/><path d="M12 8v5"/><path d="M12 16.5h.01"/>',
  "sev-warning": '<path d="m12 3.5 9.5 16.5h-19z"/><path d="M12 10v4.5"/><path d="M12 17.5h.01"/>',
  "sev-info": '<circle cx="12" cy="12" r="9.5"/><path d="M12 11v5.5"/><path d="M12 7.5h.01"/>',
  "sev-ok": '<circle cx="12" cy="12" r="9.5"/><path d="m7.5 12.5 3 3 6-6.5"/>',
  "ui-chevron": '<path d="m9 18 6-6-6-6"/>',
  "ui-impact": '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
  "ui-cause": '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  "ui-evidence": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  "ui-fix": '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  "ui-where": '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  "ui-verify": '<path d="M9 12l2 2 4-4"/><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"/>',
  "ui-external": '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  "ui-theme": '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/>',
  "ui-gtm": '<path d="M4 4h6v6H4z"/><path d="M14 4h6v6h-6z"/><path d="M4 14h6v6H4z"/><path d="M14 14h6v6h-6z"/>',
};
// Platform artwork, the same drawings the report used as data URIs before, as symbols. Dark glyphs (TikTok, X) sit on a plate that follows the card colour.
const PLATFORM_ART = {
  ga4: '<rect x="15" y="2" width="6" height="20" rx="3" fill="#F9AB00"/><rect x="9" y="9" width="6" height="13" rx="3" fill="#E37400"/><circle cx="6" cy="19" r="3" fill="#E37400"/>',
  google_ads: '<rect x="9.5" y="1.5" width="6" height="21" rx="3" transform="rotate(30 12.5 12)" fill="#FBBC04"/><rect x="8.5" y="1.5" width="6" height="21" rx="3" transform="rotate(-30 11.5 12)" fill="#4285F4"/><circle cx="5.5" cy="18.5" r="3" fill="#34A853"/>',
  meta: '<path d="M2.5 15.5c0-4.4 2.3-9 5-9 3.4 0 6 11 9.5 11 2.2 0 4.5-2.6 4.5-6.5S19.8 6.5 17.5 6.5c-3.4 0-6 11-9.8 11-2.9 0-5.2-.7-5.2-2z" fill="none" stroke="#0866FF" stroke-width="2.4" stroke-linejoin="round"/>',
  tiktok: '<rect class="plate" x="0" y="0" width="24" height="24" rx="5"/><g fill="none" stroke-width="2.6" stroke-linecap="round"><path d="M13 3v11.5a3.5 3.5 0 1 1-3-3.46M13 3c.5 2.5 2.5 4 5 4" stroke="#25F4EE" transform="translate(-1 -1)"/><path d="M13 3v11.5a3.5 3.5 0 1 1-3-3.46M13 3c.5 2.5 2.5 4 5 4" stroke="#FE2C55" transform="translate(1 1)"/><path d="M13 3v11.5a3.5 3.5 0 1 1-3-3.46M13 3c.5 2.5 2.5 4 5 4" stroke="#111"/></g>',
  x: '<rect class="plate" x="0" y="0" width="24" height="24" rx="5"/><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" fill="#000" transform="translate(3 3) scale(.75)"/>',
  linkedin: '<path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" fill="#0A66C2"/>',
  microsoft_ads: '<rect x="1" y="1" width="10.5" height="10.5" fill="#F25022"/><rect x="12.5" y="1" width="10.5" height="10.5" fill="#7FBA00"/><rect x="1" y="12.5" width="10.5" height="10.5" fill="#00A4EF"/><rect x="12.5" y="12.5" width="10.5" height="10.5" fill="#FFB900"/>',
  pinterest: '<path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.401.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.354-.629-2.758-1.379l-.749 2.848c-.269 1.045-1.004 2.352-1.498 3.146 1.123.345 2.306.535 3.55.535 6.607 0 11.985-5.365 11.985-11.987C23.97 5.39 18.592.026 11.985.026L12.017 0z" fill="#BD081C"/>',
  snapchat: '<rect width="24" height="24" rx="5" fill="#FFFC00"/><path d="M12.206.793c.99 0 4.347.276 5.93 3.821.529 1.193.403 3.219.299 4.847l-.003.06c-.012.18-.022.345-.03.51.075.045.203.09.401.09.3-.016.659-.12 1.033-.301.165-.088.344-.104.464-.104.182 0 .359.029.509.09.45.149.734.479.734.838.015.449-.39.839-1.213 1.168-.089.029-.209.075-.344.119-.45.135-1.139.36-1.333.81-.09.224-.061.524.12.868l.015.015c.06.136 1.526 3.475 4.791 4.014.255.044.435.27.42.509 0 .075-.015.149-.045.225-.24.569-1.273.988-3.146 1.271-.059.091-.12.375-.164.57-.029.179-.074.36-.134.553-.076.271-.27.405-.555.405h-.03c-.135 0-.313-.031-.538-.074-.36-.075-.765-.135-1.273-.135-.3 0-.599.015-.913.074-.6.104-1.123.464-1.723.884-.853.599-1.826 1.288-3.294 1.288-.06 0-.119-.015-.18-.015h-.149c-1.468 0-2.427-.675-3.279-1.288-.599-.42-1.107-.779-1.707-.884-.314-.045-.629-.074-.928-.074-.54 0-.958.089-1.272.149-.211.043-.391.074-.54.074-.374 0-.523-.224-.583-.42-.061-.192-.09-.389-.135-.567-.046-.181-.105-.494-.166-.57-1.918-.222-2.95-.642-3.189-1.226-.031-.063-.052-.15-.055-.225-.015-.243.165-.465.42-.509 3.264-.54 4.73-3.879 4.791-4.02l.016-.029c.18-.345.224-.645.119-.869-.195-.434-.884-.658-1.332-.809-.121-.029-.24-.074-.346-.119-1.107-.435-1.257-.93-1.197-1.273.09-.479.674-.793 1.168-.793.146 0 .27.029.383.074.42.194.789.3 1.104.3.234 0 .384-.06.465-.105l-.046-.569c-.098-1.626-.225-3.651.307-4.837C7.392 1.077 10.739.807 11.727.807l.419-.015h.06z" transform="translate(3 3) scale(.75)" fill="#fff" stroke="#000" stroke-width="1.3"/>',
  criteo: '<circle cx="12" cy="12" r="11" fill="#FE5000"/><path d="M16.2 8.6a5 5 0 1 0 0 6.8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>',
  hotjar: '<path d="M10.119 9.814C12.899 8.27 16.704 6.155 16.704 0h-4.609c0 3.444-1.676 4.375-4.214 5.786C5.1 7.33 1.295 9.444 1.295 15.6h4.61c0-3.444 1.676-4.376 4.214-5.786zM18.096 8.4c0 3.444-1.677 4.376-4.215 5.785-2.778 1.544-6.585 3.66-6.585 9.815h4.609c0-3.444 1.676-4.376 4.214-5.786 2.78-1.544 6.586-3.658 6.586-9.814h-4.609z" fill="#FF3C00"/>',
  adobe: '<path d="M0 2h8.5L0 22zM24 2h-8.5L24 22zM12 9l5.5 13h-3.6l-1.7-4.2H8.9z" fill="#EB1000"/>',
  matomo: '<path d="M6 18l6-9 6 9" fill="none" stroke="#3152A0" stroke-width="2"/><circle cx="6" cy="18" r="3" fill="#95C748"/><circle cx="12" cy="9" r="3" fill="#3152A0"/><circle cx="18" cy="18" r="3" fill="#3152A0"/>',
  piwik_pro: '<rect width="24" height="24" rx="5" fill="#0C2D5B"/><path d="M8 18V6h5a3.5 3.5 0 010 7H8" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  clarity: '<rect width="24" height="24" rx="5" fill="#0078D4"/><path d="M12 5a7 7 0 100 14M12 9a3 3 0 100 6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>',
};

/** An icon from the sprite. Decorative: the text next to it names the thing. */
const use = (id, size = 16, cls = "") => `<svg class="ic${cls ? ` ${cls}` : ""}" width="${size}" height="${size}" aria-hidden="true"><use href="#${id}"/></svg>`;

/** The sprite with only the symbols the page references, so a report never carries artwork it does not show. */
function sprite(html) {
  const used = new Set([...html.matchAll(/href="#((?:sev|ui)-[a-z]+|p-[a-z0-9_]+|logo-[a-z-]+)"/g)].map((x) => x[1]));
  const symbols = [...used].sort().map((id) => {
    if (id.startsWith("p-")) return `<symbol id="${id}" viewBox="0 0 24 24">${PLATFORM_ART[id.slice(2)]}</symbol>`;
    if (id.startsWith("logo-")) return `<symbol id="${id}" viewBox="${LOGO_ART[id.slice(5)].viewBox}">${LOGO_ART[id.slice(5)].art}</symbol>`;
    return `<symbol id="${id}" ${STROKE}>${UI_SYMBOLS[id]}</symbol>`;
  });
  return `<svg hidden style="display:none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${symbols.join("")}</svg>`;
}

/** The platform's icon, or for a platform without artwork its initials on a neutral square. Screen readers get the name as text. */
function platIcon(key, size = 16, label = platformLabel(key)) {
  const k = safeKey(key);
  const art = PLATFORM_ART[k] ? use(`p-${k}`, size) : `<span class="plat-fb s${size}" aria-hidden="true">${escapeHtml(label.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase())}</span>`;
  return `${art}<span class="sr">${escapeHtml(label)} </span>`;
}
/** Icon and name of a platform. */
function plat(key, size = 16, label = platformLabel(key)) {
  const k = safeKey(key);
  const art = PLATFORM_ART[k] ? use(`p-${k}`, size) : `<span class="plat-fb s${size}" aria-hidden="true">${escapeHtml(label.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase())}</span>`;
  return `<span class="plat">${art}<span>${escapeHtml(label)}</span></span>`;
}

const hostPath = (url) => {
  try {
    const u = new URL(url);
    return u.host + u.pathname;
  } catch {
    return String(url ?? "");
  }
};

/** A severity badge: glyph and word, never colour alone. A badge without a severity is a plain grey chip. */
const badge = (sev, text) => (UI_SYMBOLS[`sev-${sev}`] ? `<span class="badge sev-${sev}">${use(`sev-${sev}`, 14)}${escapeHtml(text)}</span>` : `<span class="badge">${escapeHtml(text)}</span>`);
/**
 * A logo at a given height. The brand's own logos (LOGO_ART) are drawn from the sprite, so their ink is the text colour and
 * only the point is red, as brand/ai/BRAND.md §4 asks of a product's UI. Anything else in LOGOS (the favicon tiles, which
 * carry their own ground) comes as its light and dark images, and the CSS shows the one that fits the colour scheme.
 */
export const logo = (key, alt, height, cls) => {
  const art = LOGO_ART[key];
  if (!art) return `<span class="logo ${cls}"><img class="l-light" src="${LOGOS[`${key}-light`]}" alt="${alt}" height="${height}"><img class="l-dark" src="${LOGOS[`${key}-dark`]}" alt="${alt}" height="${height}"></span>`;
  const [, , w, h] = art.viewBox.split(" ").map(Number);
  const named = alt ? `role="img" aria-label="${escapeHtml(alt)}"` : 'aria-hidden="true"';
  return `<svg class="logo ${cls}" width="${+((height * w) / h).toFixed(1)}" height="${height}" ${named}><use href="#logo-${key}"/></svg>`;
};

/** The journey and step a finding's place points at. Steps are named by label; when labels repeat, prefer the step where the finding's event fired. */
function whereTarget(runs, w, f) {
  const ri = runs.findIndex((r) => r.journeyId === w.journey && r.viewport === w.viewport);
  if (ri < 0) return null;
  const candidates = w.step ? runs[ri].steps.filter((s) => s.index > 0 && s.label === w.step) : [];
  const step = candidates.find((s) => runs[ri].hits.some((h) => h.step === s.index && h.platform === f.platform && h.name === f.event)) ?? candidates[0];
  return { ri, step };
}

const pathOf = (url) => {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return String(url ?? "");
  }
};

/** Stable card ids (f-<platform>-<event>-<check>, with a counter when two cards would share one) for the problem rows. */
function cardIds(rows) {
  const taken = new Map();
  const ids = new Map();
  for (const f of rows) {
    if (f.severity === "ok") continue;
    const base = ["f", safeKey(f.platform ?? "site"), f.event ? safeKey(f.event) : "", safeKey(f.check)].filter(Boolean).join("-");
    const n = (taken.get(base) ?? 0) + 1;
    taken.set(base, n);
    ids.set(f, n === 1 ? base : `${base}-${n}`);
  }
  return ids;
}

/** Runs where the finding's event fired but the finding did not: the "desktop sent both" contrast. */
function alsoFineOn(runs, f) {
  if (!f.event || !f.platform) return [];
  const flagged = new Set(f.where.map((w) => `${w.journey}|${w.viewport}`));
  return runs.filter((r) => !flagged.has(`${r.journeyId}|${r.viewport}`) && r.hits.some((h) => h.platform === f.platform && h.name === f.event));
}

/** The plan's required parameters the finding's event lacks, as evidence rows marked "missing". */
function missingParamRows(plan, f, evidence) {
  if (f.check !== "missing_params" || !f.event) return [];
  const ev = (plan?.events ?? []).find((e) => String(e.platform ?? "").toLowerCase() === f.platform && hitMatchesEvent({ ...e, platform: f.platform }, { platform: f.platform, name: f.event }));
  return (ev?.required_params ?? []).filter((p) => !(p in evidence));
}

/** The captured hit a finding points at, for evidence when the finding carries none. */
function hitFor(runs, f) {
  for (const w of f.where) {
    const t = whereTarget(runs, w, f);
    if (!t?.step) continue;
    const hit = runs[t.ri].hits.find((h) => h.step === t.step.index && h.platform === f.platform && h.name === f.event);
    if (hit) return { run: runs[t.ri], hit };
  }
  return null;
}

// AI text marks numbers with **x** and names with `x`. Only those two marks become HTML; everything else is escaped.
const fmt = (s) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>");
// Finding texts quote event and parameter names ("add_to_cart"); show those as code.
const detailHtml = (s) => escapeHtml(s).replace(/&quot;([^&]+?)&quot;/g, "<code>$1</code>");

/* ---------- added for the new report's sections ---------- */

// Icons the new report adds. The ones above keep their drawings, so the 0.17 report renders as before.
Object.assign(UI_SYMBOLS, {
  "ui-page": '<path d="M4 4h10l6 6v10a0 0 0 0 1 0 0H4z"/><path d="M14 4v6h6"/>',
  "ui-desktop": '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  "ui-mobile": '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18h2"/>',
  "ui-clock": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  "ui-shield": '<path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
  "ui-spark": '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  "ui-list": '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  "ui-route": '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16"/>',
  "ui-stack": '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  "ui-user": '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  "ui-vendors": '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  "ui-journeys": '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16"/>',
  "ui-events": '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  "ui-consent": '<path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
  "ui-ai": '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  // The filter bar's search field: the mockup drew it as a CSS data URI, which the report's CSS may not carry.
  "ui-search": '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
});

const esc = escapeHtml;

/** A coloured chip. kind: sev, consent, owner, plat, vp or run; value: the colour key (broken, denied, developer, ga4,
 *  desktop, completed, ...). label is HTML, so escape text before passing it; it may hold an icon. */
const chip = (kind, value, label) => `<span class="chip chip-${kind} ${safeKey(value)}">${label}</span>`;
/** A count in a tab label, a chip or a heading. */
const n = (count) => `<span class="n">${count}</span>`;

/** Time since the run started, as the new report writes it ("+1.2 s"). The 0.17 report's seconds() writes "+1.2s". */
const secs = (run, t) => `+${((t - (run.startedAt ?? run.steps?.[0]?.t ?? t)) / 1000).toFixed(1)} s`;

/**
 * The title of the page a step is on: the page_title of the first GA4 hit in that step, else of the nearest earlier
 * step that has one ("Home · Demo Shop" gives "Home": a trailing " · Site", " | Site", " – Site" or " — Site" is the
 * site's name and repeats on every page), else the path of the step's page.
 */
function pageTitle(run, stepIndex) {
  for (let i = stepIndex; i >= 0; i--) {
    const hit = (run.hits ?? []).find((h) => h.step === i && h.platform === "ga4" && h.params?.page_title);
    if (hit) return String(hit.params.page_title).replace(/\s+[·|–—]\s+[^·|–—]+$/, "") || String(hit.params.page_title);
  }
  const step = (run.steps ?? []).find((s) => s.index === stepIndex);
  const url = step?.pagePath ?? step?.label?.match(/https?:\/\/\S+/)?.[0] ?? run.landing?.final;
  return url ? pathOf(url) : "/";
}

/** A step's label for lists: "Open http://host/" becomes "Open Home"; every other label stays as the journey wrote it. */
function stepTitle(run, step) {
  const m = /^(\S+) (?:https?:\/\/|\/)\S*$/.exec(step.label ?? "");
  return m ? `${m[1]} ${pageTitle(run, step.index)}` : step.label;
}

/* ---------- ids: one scheme for every link between sections ---------- */

/** A run's step: j<run index>-s<step index>. The step index is step.index, not its position in the list. */
const stepAnchor = (ri, si) => `j${ri}-s${si}`;
/** A step's hits in firing order: the order that numbers them in hit ids. */
const hitsOf = (run, si) => (run.hits ?? []).filter((h) => h.step === si).sort((a, b) => a.t - b.t);
/** A step's dataLayer pushes in time order: the order that numbers them in push ids. */
const pushesOf = (run, si) => (run.dataLayerLog ?? []).filter((e) => e.step === si).sort((a, b) => a.t - b.t);
/** A step's network requests in capture order: the order that numbers them in request ids. */
const requestsOf = (run, si) => (run.network ?? []).filter((c) => c.step === si);
/** Hit, push and request ids: j<r>-s<n>-h<k>, -d<k>, -q<k>, k 0-based in the orders above. */
const hitId = (ri, si, k) => `${stepAnchor(ri, si)}-h${k}`;
const pushId = (ri, si, k) => `${stepAnchor(ri, si)}-d${k}`;
const requestId = (ri, si, k) => `${stepAnchor(ri, si)}-q${k}`;

/**
 * Where one place of a grouped finding links to: the hit that carried its event when the step has one, else the
 * step, else the run. { ri, step, k, id }, or null when the place names a run that is not in the capture.
 */
function hitAnchor(runs, f, w) {
  const t = whereTarget(runs, w, f);
  if (!t) return null;
  if (!t.step) return { ri: t.ri, step: null, k: -1, id: `j${t.ri}` };
  const k = hitsOf(runs[t.ri], t.step.index).findIndex((h) => h.platform === f.platform && h.name === f.event);
  return { ri: t.ri, step: t.step, k, id: k >= 0 ? hitId(t.ri, t.step.index, k) : stepAnchor(t.ri, t.step.index) };
}

const PROBLEM_RANK = { broken: 0, risk: 1, warning: 2 };
/** The worst grouped problem row that points at this hit (same run, step label, platform and event), or null. Its card id is ids.get(row). */
function hitFinding(rows, run, step, hit) {
  let worst = null;
  for (const f of rows) {
    if (!(f.severity in PROBLEM_RANK) || f.platform !== hit.platform || f.event !== hit.name) continue;
    if (!f.where.some((w) => w.journey === run.journeyId && w.viewport === run.viewport && w.step === step.label)) continue;
    if (!worst || PROBLEM_RANK[f.severity] < PROBLEM_RANK[worst.severity]) worst = f;
  }
  return worst;
}

/**
 * The Passed rows Findings lists, in list order, and the number Summary's OK chip and the rail show: the campaign
 * parameters check (one row with every place it passed), plan coverage when any planned event was implemented, the
 * Consent Mode default when one was pushed, and each purchase that passed every conversion check. Each is { kind, ... }:
 * kind campaign_params (row: a grouped finding), coverage (coverage: metrics.coverage), consent_default (consentMode:
 * metrics.consent.consentMode) or conversion (conv: a metrics.conversions row). groupFindings keeps one ok row per run,
 * so the campaign row is rebuilt from the raw findings.
 */
function passedRows({ findings, metrics }) {
  const out = [];
  const camp = findings.filter((f) => f.severity === "ok" && f.check === "campaign_params");
  if (camp.length) out.push({ kind: "campaign_params", row: { ...camp[0], where: camp.map((f) => ({ journey: f.journey, viewport: f.viewport, step: f.step })) } });
  if (metrics.coverage?.counts?.implemented) out.push({ kind: "coverage", coverage: metrics.coverage });
  if (metrics.consent?.consentMode?.defaultPresent) out.push({ kind: "consent_default", consentMode: metrics.consent.consentMode });
  for (const conv of (metrics.conversions?.rows ?? []).filter((r) => r.pass)) out.push({ kind: "conversion", conv });
  return out;
}

/** A section of the page: <section class="sec" id> with its <h2>, as the shell's routing and the rail expect. heading is HTML. */
const sectionBlock = (id, heading, body, cls = "") => `<section class="sec${cls ? ` ${cls}` : ""}" id="${id}" aria-labelledby="${id}-h"><h2 id="${id}-h">${heading}</h2>
${body}
</section>`;

export {
  sectionBlock, STROKE, UI_SYMBOLS, PLATFORM_ART, use, sprite, platIcon, plat, badge, hostPath, pathOf, whereTarget, cardIds, alsoFineOn,
  missingParamRows, hitFor, fmt, detailHtml, esc, escapeHtml, platformLabel, safeKey, sortPlatforms, ownerOf, OWNERS, chip, n, secs,
  pageTitle, stepTitle, passedRows, stepAnchor, hitsOf, pushesOf, requestsOf, hitId, pushId, requestId, hitAnchor, hitFinding,
};
