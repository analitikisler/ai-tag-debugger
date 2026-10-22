import { VERSION } from "./report-shared.js";
import { TOKENS, COMPONENTS, PRODUCT } from "./html/css.js";
import { chip, escapeHtml, logo, plat, platformLabel, sprite } from "./html/lib.js";
import { LOGOS } from "./brand.js";

const e = escapeHtml;
const text = (v) => (v === undefined || v === null || v === "" ? `<span class="muted">–</span>` : e(v));

// Only what the plan page needs on top of the report's tokens and components: the top bar (a trimmed copy of the
// report shell's, which this page does not load, with no rail or verdict), the page column, and the event list. Colours come from tokens, so dark mode
// follows both selectors in TOKENS and nothing here names a colour.
const PLAN_CSS = `
.top{display:flex;align-items:center;gap:var(--s3);height:var(--top);padding:0 var(--s4);background:var(--card);border-bottom:1px solid var(--border);white-space:nowrap}
.top .brand{display:inline-flex;align-items:center;flex:none}
.top .l-mark{display:none}
.top-site{display:flex;align-items:baseline;gap:var(--s2);min-width:0;overflow:hidden}
.top-site b{font-weight:600;overflow:hidden;text-overflow:ellipsis}
.top-end{margin-left:auto;display:flex;align-items:center;gap:var(--s2)}
.byline{display:inline-flex;align-items:center;gap:var(--s2);font-size:12px;color:var(--muted)}
.logo{display:inline-flex}
.logo .l-dark{display:none}
html[data-theme="dark"] .logo .l-light{display:none}
html[data-theme="dark"] .logo .l-dark{display:inline}
@media (prefers-color-scheme:dark){html:not([data-theme="light"]) .logo .l-light{display:none}html:not([data-theme="light"]) .logo .l-dark{display:inline}}
.eyebrow{font:500 12px/1.4 var(--font-sans);color:var(--muted)}
.plan{max-width:1100px;margin:0 auto;padding:var(--s5) var(--s6) var(--s7)}
.plan-title{display:grid;gap:var(--s2);margin-bottom:var(--s5)}
.plan-title .chips{margin-top:var(--s1)}
.plan .card+.card{margin-top:var(--s4)}
.pl-card-h{padding:var(--s3) var(--s4);border-bottom:1px solid var(--border)}
.pl-card-d{margin-top:2px;font-size:12.5px;color:var(--muted)}
.pl-empty{padding:var(--s3) var(--s4)}
.pl-event{padding:var(--s4)}
.pl-event+.pl-event{border-top:1px solid var(--border)}
.pl-head{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s2)}
.pl-head code{font-size:14px}
.pl-desc{margin:6px 0 10px}
.pl-trigger{font-size:12px;color:var(--muted);margin-bottom:10px}
.pl-trigger b{font-weight:500;color:var(--fg)}
.chip .plat{display:inline-flex;align-items:center;gap:5px}
.chip.on{--k:var(--accent);--k-fg:var(--accent-fg)}
.chip.req{--k:var(--sev-warning);--k-fg:var(--sev-warning-fg)}
.pl-card-body{padding:var(--s4)}
.tbl td,.tbl th{vertical-align:top}
/* a narrow table scrolls inside its .tscroll instead of breaking names mid-word */
.plan .tbl{min-width:480px}
.plan .tbl td:first-child code{white-space:nowrap}
.footer{display:flex;align-items:center;gap:var(--s4);padding:var(--s4);border-top:1px solid var(--border);background:var(--card)}
.footer a{color:var(--fg)}
.logo-link{display:inline-flex}
.f-links{display:flex;flex-wrap:wrap;gap:var(--s2) var(--s4)}
.footer .f-meta{margin-left:auto}
@media (max-width:719.98px){
  :root{--top:44px}
  .top{gap:var(--s2);padding:0 var(--s3)}
  .top .l-lockup,.top-site .eyebrow,.byline{display:none}
  .top .l-mark{display:block}
  .plan{padding:var(--s4) var(--s4) var(--s6)}
  .footer{flex-wrap:wrap}
}
@media print{.top{display:none}.plan{padding:0}}
`;

const flag = (label, cls = "") => `<span class="chip ${cls}">${e(label)}</span>`;

function paramsTable(event) {
  const params = Object.entries(event.parameters ?? {});
  if (!params.length) return `<p class="muted xs">No parameters.</p>`;
  const required = new Set(event.required_params ?? []);
  const rows = params
    .map(([name, p]) => `<tr><td><code>${e(name)}</code>${p?.custom ? ` ${flag("custom")}` : ""}</td><td>${required.has(name) ? flag("required", "req") : `<span class="muted">optional</span>`}</td><td class="mono">${text(p?.example)}</td><td>${text(p?.description)}</td></tr>`)
    .join("");
  return `<div class="tscroll"><table class="tbl"><thead><tr><th>Parameter</th><th>Required</th><th>Example</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function eventCard(event) {
  const trigger = event.trigger ?? {};
  const platform = event.platform ?? "ga4";
  return `<div class="pl-event">
<div class="pl-head">${chip("plat", platform, plat(platform, 13, platformLabel(platform)))}<code>${e(event.name)}</code>${flag(event.custom ? "custom event" : "standard event", event.custom ? "on" : "")}</div>
<p class="pl-desc">${text(event.description)}</p>
<p class="pl-trigger"><b>Trigger</b> · page: ${text(trigger.page)} · element: ${text(trigger.element)}</p>
${paramsTable(event)}
</div>`;
}

function userPropertiesCard(props) {
  const body = props.length
    ? `<div class="pl-card-body"><div class="tscroll"><table class="tbl"><thead><tr><th>Name</th><th>Example</th><th>Description</th></tr></thead><tbody>${props
        .map((p) => (typeof p === "string" ? { name: p } : p))
        .map((p) => `<tr><td><code>${e(p.name)}</code></td><td class="mono">${text(p.example)}</td><td>${text(p.description)}</td></tr>`)
        .join("")}</tbody></table></div></div>`
    : `<p class="pl-empty muted xs">No user properties.</p>`;
  return `<section class="card"><div class="pl-card-h"><h2>User properties</h2></div>${body}</section>`;
}

/** A single self-contained, readable page for a measurement plan. Respects branding false like the report. */
export function renderPlanHtml(plan, { id = "", generatedAt = "", branding = true } = {}) {
  const events = plan.events ?? [];
  const custom = events.filter((ev) => ev.custom).length;
  const title = `Measurement plan${plan.site ? `: ${plan.site}` : ""}`;
  const meta = [id && `Plan ${id}`, generatedAt, `${events.length} events (${custom} custom)`, `ai-tag-debugger ${VERSION}`].filter(Boolean).join(" · ");
  const consent = plan.consent_mode ? flag("Consent mode on", "on") : flag("Consent mode off");
  const footer = branding
    ? `<a href="https://analitikisler.com" class="logo-link" aria-label="analitikisler.com" rel="noopener noreferrer">${logo("stacked", "Analitik İşler", 40, "logo-s")}</a><div class="f-links xs"><a href="https://analitikisler.com" rel="noopener noreferrer">analitikisler.com</a><a href="https://github.com/analitikisler/ai-tag-debugger" rel="noopener noreferrer">GitHub</a></div><p class="f-meta xs muted">v${VERSION}</p>`
    : `<p class="xs">AI Tag Debugger</p><p class="f-meta xs muted">v${VERSION}</p>`;
  const body = `<header class="top"><span class="brand">${logo("atd-lockup", "AI Tag Debugger", 22, "l-lockup")}<img class="l-mark" src="${LOGOS["atd-icon"]}" alt="AI Tag Debugger" height="24"></span><span class="top-site"><span class="eyebrow">Measurement plan</span>${plan.site ? `<b>${e(plan.site)}</b>` : ""}</span><div class="top-end">${branding ? `<a href="https://analitikisler.com" class="byline" rel="noopener noreferrer"><span>by</span>${logo("horizontal", "Analitik İşler", 16, "logo-h")}</a>` : ""}</div></header>
<main class="plan">
<div class="plan-title"><div class="eyebrow">Measurement plan</div><h1>${e(title)}</h1><div class="muted xs">${e(meta)}</div><div class="chips">${consent}</div></div>
<section class="card"><div class="pl-card-h"><h2>Events</h2><p class="pl-card-d">What should be tracked, where it fires and which parameters it carries.</p></div>${events.length ? events.map(eventCard).join("") : `<p class="pl-empty muted xs">No events.</p>`}</section>
${userPropertiesCard(plan.user_properties ?? [])}
</main>
<footer class="footer">${footer}</footer>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${e(title)}</title><link rel="icon" type="image/png" href="${LOGOS.favicon}">
<style>${TOKENS}\n${COMPONENTS}\n${PRODUCT}\n${PLAN_CSS}</style></head><body>
${sprite(body)}
${body}
</body></html>`;
}
