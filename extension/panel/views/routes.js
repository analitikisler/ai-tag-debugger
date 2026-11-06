// "Where hits go" (§5.10): one block per destination host, server routes first, then hits that went straight to
// Google for a property that also has a server route (a leak), then the pixels that go to their own vendors.
import { state, m, render } from "../state.js";
import { el, icon, since, upper } from "../ui.js";
import { badge } from "./common.js";

const line = (k, ...v) => [el("span", { class: "k", text: k }), el("span", {}, v)];

function lifetime(c) {
  if (!c.expires) return null;
  const days = Math.round((c.expires * 1000 - Date.now()) / 864e5);
  return days > 0 ? m().routes.days(days) : null;
}

function block(b, model) {
  const rt = m().routes;
  const type = b.kind === "sgtm" ? (b.firstParty ? rt.types.sgtmFirst : rt.types.sgtmThird) : rt.types[b.kind];
  const rows = [];
  if (b.kind !== "direct") rows.push(...line(rt.type, type));
  const container = model.containers.filter((c) => /^GTM-/.test(c)).join(", ");
  rows.push(...line(rt.sends, b.sends.map((s) => el("span", {}, badge(s.platform, true), " ", el("span", { class: "mono", text: s.ids.join(", ") }), " ")),
    b.kind === "direct" && b.first ? `${b.first.name}, ${m().events.stepShort(b.first.step + 1)}, ${since(b.first.t, model.steps[b.first.step]?.t ?? b.first.t)}` : container ? rt.from(container) : null));
  if (b.kind === "direct") {
    rows.push(...line(rt.why, el("span", { style: { color: "var(--warning)" } }, "⚠ ", b.beforeConfig ? rt.leakWhy : rt.leakWhyGeneric)));
  } else {
    rows.push(...line(rt.setBy, b.config ? [el("span", { class: "mono", text: b.config.key }), " ", rt.setByConfig(b.config.push.index + 1)] : rt.setByGtm));
    rows.push(...line(m().tabs.consent, b.noConsent ? el("span", { style: { color: "var(--warning)" } }, `⚠ ${rt.consentMissing(b.noConsent)}`) : rt.consentOk));
    if (b.cookies.length) {
      rows.push(...line(rt.cookies, b.cookies.map((c) => el("span", {}, el("span", { class: "ck", text: c.name }), " ")),
        rt.cookieFlags([b.cookies.some((c) => c.httpOnly) ? "HttpOnly" : null, lifetime(b.cookies[0])].filter(Boolean).join(", "), b.cookies.some((c) => c.beforeConsent))));
    }
  }
  return el("div", { class: "dest" },
    el("div", { class: "dh" }, el("span", { class: `route${b.kind === "direct" ? " direct" : ""}`, text: rt.badge[b.kind] }), el("b", { title: b.host, text: b.host }), el("span", { class: "n", text: rt.hits(b.hits) })),
    el("div", { class: "dl2" }, rows));
}

export function routesCard(routes, model) {
  const rt = m().routes;
  // Collapsed by default; it opens by itself once, the first time a leak is found.
  if (state.routesOpen === undefined && routes.leaks) state.routesOpen = true;
  const open = Boolean(state.routesOpen);
  const summary = [rt.routes(routes.routes), routes.leaks ? rt.leaks(routes.leaks) : null].filter(Boolean).join(" · ");
  const head = el("button", { class: "rc-h", type: "button", style: { width: "100%", border: 0, cursor: "pointer", textAlign: "left" }, "aria-expanded": String(open),
    onclick: () => { state.routesOpen = !open; render(); } },
  el("span", { style: { display: "inline-flex", color: "var(--fg-3)", transform: open ? "" : "rotate(-90deg)" } }, icon("chev-d", "s")), upper(rt.title), el("span", { class: "r", text: summary }));
  const v = routes.vendor;
  const vendor = v ? el("div", { class: "dest" },
    el("div", { class: "dh" }, el("span", { class: "route", style: { color: "var(--fg-3)", background: "var(--bg-hover)" }, text: rt.badge.vendor }), el("b", { title: v.hosts.join(", "), text: v.hosts.join(" · ") }), el("span", { class: "n", text: rt.hits(v.hits) })),
    el("div", { class: "dl2" },
      line(rt.sends, v.sends.map((s) => el("span", {}, badge(s.platform, true), ` ${s.count} `)), rt.fromBrowser),
      v.meta ? line(rt.note, v.metaWithoutEventId ? el("span", { style: { color: "var(--warning)" } }, `⚠ ${rt.capiMissing(v.metaWithoutEventId)}`) : rt.capiOk) : null)) : null;
  return el("section", { class: "route-card", "aria-label": rt.title }, head, open ? [routes.blocks.map((b) => block(b, model)), vendor] : null);
}
