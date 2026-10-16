import { CSS, VERSION, escapeHtml, logo, platformLabel } from "./report.js";
import { LOGOS } from "./brand.js";

const e = escapeHtml;
const text = (v) => (v === undefined || v === null || v === "" ? `<span class="muted">–</span>` : e(v));

const PLAN_CSS = `
.pl-event{padding:16px 20px}
.pl-event+.pl-event{border-top:1px solid var(--border)}
.pl-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.pl-head code{font-size:14px}
.pl-desc{margin:6px 0 10px}
.pl-trigger{font-size:12px;color:var(--muted);margin-bottom:10px}
.pl-trigger b{font-weight:500;color:var(--fg)}
.flag{display:inline-flex;align-items:center;font:500 12px/1 var(--font-sans);padding:4px 8px;border-radius:4px;background:var(--muted-bg);color:var(--muted)}
.flag.on{background:var(--accent-bg);color:var(--accent-fg)}
.flag.req{background:var(--warn-bg);color:var(--warn)}
table.dt td,table.dt th{vertical-align:top}
`;

const flag = (label, cls = "") => `<span class="flag ${cls}">${e(label)}</span>`;

function paramsTable(event) {
  const params = Object.entries(event.parameters ?? {});
  if (!params.length) return `<p class="muted xs">No parameters.</p>`;
  const required = new Set(event.required_params ?? []);
  const rows = params
    .map(([name, p]) => `<tr><td><code>${e(name)}</code>${p?.custom ? ` ${flag("custom")}` : ""}</td><td>${required.has(name) ? flag("required", "req") : `<span class="muted">optional</span>`}</td><td class="mono">${text(p?.example)}</td><td>${text(p?.description)}</td></tr>`)
    .join("");
  return `<div class="tscroll"><table class="dt"><thead><tr><th>Parameter</th><th>Required</th><th>Example</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function eventCard(event) {
  const trigger = event.trigger ?? {};
  return `<div class="pl-event">
<div class="pl-head"><span class="ptag">${e(platformLabel(event.platform ?? "ga4"))}</span><code>${e(event.name)}</code>${flag(event.custom ? "custom event" : "standard event", event.custom ? "on" : "")}</div>
<p class="pl-desc">${text(event.description)}</p>
<p class="pl-trigger"><b>Trigger</b> · page: ${text(trigger.page)} · element: ${text(trigger.element)}</p>
${paramsTable(event)}
</div>`;
}

function userPropertiesCard(props) {
  const body = props.length
    ? `<div class="tscroll"><table class="dt"><thead><tr><th>Name</th><th>Example</th><th>Description</th></tr></thead><tbody>${props
        .map((p) => (typeof p === "string" ? { name: p } : p))
        .map((p) => `<tr><td><code>${e(p.name)}</code></td><td class="mono">${text(p.example)}</td><td>${text(p.description)}</td></tr>`)
        .join("")}</tbody></table></div>`
    : `<p class="muted xs">No user properties.</p>`;
  return `<section class="card"><div class="card-h"><div class="card-t">User properties</div></div><div class="card-c">${body}</div></section>`;
}

/** A single self-contained, readable page for a measurement plan. Respects branding false like the report. */
export function renderPlanHtml(plan, { id = "", generatedAt = "", branding = true } = {}) {
  const events = plan.events ?? [];
  const custom = events.filter((ev) => ev.custom).length;
  const title = `Measurement plan${plan.site ? `: ${plan.site}` : ""}`;
  const meta = [id && `Plan ${id}`, generatedAt, `${events.length} events (${custom} custom)`, `ai-tag-debugger ${VERSION}`].filter(Boolean).join(" · ");
  const consent = plan.consent_mode ? flag("Consent mode on", "on") : flag("Consent mode off");
  const footer = branding
    ? `<div class="wrap"><a href="https://analitikisler.com" class="logo-link" aria-label="analitikisler.com" rel="noopener noreferrer">${logo("stacked", "Analitik İşler", 56, "logo-s")}</a><div><div class="f-links"><a href="https://analitikisler.com" rel="noopener noreferrer">analitikisler.com</a><a href="https://github.com/analitikisler/ai-tag-debugger" rel="noopener noreferrer">GitHub</a></div></div><div class="f-meta">v${VERSION}</div></div>`
    : `<div class="wrap plain"><div class="f-meta">AI Tag Debugger</div><div class="f-meta">v${VERSION}</div></div>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)}</title><link rel="icon" type="image/png" href="${LOGOS.favicon}">
<style>${CSS}${PLAN_CSS}</style></head><body>
<div class="topbar"><div class="wrap"><span class="product-logo">${logo("atd-lockup", "AI Tag Debugger", 26, "logo-atd")}</span>${branding ? `<a href="https://analitikisler.com" class="byline" rel="noopener noreferrer"><span>by</span>${logo("horizontal", "Analitik İşler", 18, "logo-h")}</a>` : ""}</div></div>
<header class="wrap title"><div class="eyebrow">Measurement plan</div><h1>${e(title)}</h1><div class="meta">${e(meta)}</div></header>
<main class="wrap" style="padding-top:24px;padding-bottom:64px"><div class="stack">
<div>${consent}</div>
<section class="card"><div class="card-h"><div class="card-t">Events</div><div class="card-d">What should be tracked, where it fires and which parameters it carries.</div></div><div class="card-c tight">${events.length ? events.map(eventCard).join("") : `<p class="muted xs" style="padding:12px">No events.</p>`}</div></section>
${userPropertiesCard(plan.user_properties ?? [])}
</div></main>
<footer class="footer">${footer}</footer>
</body></html>`;
}
