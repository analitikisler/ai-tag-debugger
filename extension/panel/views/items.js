// The Items card (§5.9): three columns at any width; a click on an item opens every decoded field, grouped, with
// the fields other items carry and this one lacks marked "not sent". Compare turns the card into fields × items.
import { state, m, render } from "../state.js";
import { el, icon, button } from "../ui.js";
import { ITEM_FIELDS_ORDER, ITEM_GROUPS, itemField } from "../../core/glossary.js";
import { itemGaps, itemsTotal } from "../model.js";
import { card, valueCheck } from "./common.js";

const ROW_FIELDS = new Set(["item_id", "item_name", "price", "quantity"]);
const LIMIT = 10;

/** An item's extra fields in display order: [field, value, group, wire, label]; custom pairs and unknown keys last. */
function fieldsOf(it) {
  const known = ITEM_FIELDS_ORDER.filter((f) => !ROW_FIELDS.has(f) && it[f] !== undefined).map((f) => ({ field: f, value: it[f], ...itemField(f, state.lang) }));
  const other = Object.keys(it).filter((k) => k !== "custom" && !ITEM_FIELDS_ORDER.includes(k)).map((k) => ({ field: k, value: it[k], ...itemField(k, state.lang) }));
  const custom = (it.custom ?? []).map(([k, v], i) => ({ field: `custom:${k}`, value: v, wire: `k${i}/v${i}`, group: "custom", label: k }));
  return [...known, ...custom, ...other];
}

function expanded(it, gaps) {
  const g = m().detail.itemGroups;
  const fields = fieldsOf(it);
  const missing = (gaps?.missing ?? []).filter((f) => !ROW_FIELDS.has(f)).map((f) => ({ field: f, value: null, ...itemField(f, state.lang) }));
  const out = [];
  for (const group of ITEM_GROUPS) {
    const list = [...fields, ...missing].filter((f) => f.group === group);
    if (!list.length) continue;
    out.push(el("div", { class: "gl2", text: g[group] }));
    for (const f of list) {
      out.push(el("div", { class: "l" }, f.label, el("span", { class: "w", text: f.wire })),
        f.value === null ? el("div", { class: "v miss", text: m().detail.notSent }) : el("div", { class: "v", text: String(f.value) }));
    }
  }
  return el("tr", {}, el("td", { colspan: "3", class: "ifields" }, el("div", { class: "ifg" }, out)));
}

function compareTable(items) {
  const g = m().detail.itemGroups;
  const fields = new Map();
  items.forEach((it) => fieldsOf(it).forEach((f) => fields.set(f.field, f)));
  for (const f of ["item_name", "item_id", "price", "quantity"]) if (items.some((it) => it[f] !== undefined)) fields.set(f, { field: f, ...itemField(f, state.lang) });
  const valueOf = (it, f) => (f.startsWith("custom:") ? (it.custom ?? []).find(([k]) => k === f.slice(7))?.[1] : it[f]);
  const rows = [];
  for (const group of ["row", ...ITEM_GROUPS]) {
    const list = [...fields.values()].filter((f) => f.group === group);
    if (!list.length) continue;
    if (group !== "row") rows.push(el("tr", { class: "g" }, el("td", { colspan: String(items.length + 1), text: g[group] })));
    for (const f of list) {
      const vals = items.map((it) => valueOf(it, f.field));
      const differ = new Set(vals.map((v) => v ?? "")).size > 1;
      rows.push(el("tr", {}, el("th", { scope: "row", text: f.label }), vals.map((v) => el("td", { class: v === undefined ? "none" : differ ? "diff" : null, text: v ?? "—" }))));
    }
  }
  return el("div", { class: "cmpwrap" }, el("table", { class: "cmp" }, el("thead", {}, el("tr", {}, el("th", {}), items.map((_, i) => el("th", { text: `#${i + 1}` })))), el("tbody", {}, rows)));
}

export function itemsCard(row) {
  const d = m().detail;
  const items = row.items;
  const gaps = itemGaps(items);
  const currency = row.hit.params?.currency ?? "";
  const comparing = state.compare.has(row.key);
  const showAll = state.openSecs.has(`items-all:${row.key}`);
  const list = showAll ? items : items.slice(0, LIMIT);
  const keyOf = (i) => `${row.key}#${i}`;
  const right = el("span", {},
    items.some((it, i) => fieldsOf(it).length || gaps[i]) ? button(d.expandAll, () => { const all = list.every((_, i) => state.openItems.has(keyOf(i))); list.forEach((_, i) => (all ? state.openItems.delete(keyOf(i)) : state.openItems.add(keyOf(i)))); render(); }, { cls: "linkbtn" }) : null,
    items.some((it, i) => fieldsOf(it).length || gaps[i]) ? " · " : null,
    button(comparing ? d.table : d.compare, () => { comparing ? state.compare.delete(row.key) : state.compare.add(row.key); render(); }, { cls: "linkbtn" }),
    currency ? el("span", { style: { marginLeft: "8px" }, text: currency }) : null);
  let body;
  if (comparing) body = compareTable(list);
  else {
    const rows = [];
    list.forEach((it, i) => {
      const open = state.openItems.has(keyOf(i));
      const extras = fieldsOf(it);
      const gap = gaps[i];
      const sub = [it.item_id, it.item_variant].filter(Boolean).join(" · ");
      const cat = ["item_category", "item_category2", "item_category3", "item_category4", "item_category5"].map((k) => it[k]).filter(Boolean).join(" › ");
      const useful = [it.coupon && `${it.coupon}${it.discount ? ` −${it.discount}` : ""}`, it.index !== undefined ? d.listPos(it.index) : null].filter(Boolean).join(" · ");
      const more = gap && gap.missing.some((f) => !ROW_FIELDS.has(f))
        ? el("div", { class: "imore warn", text: `⚠ ${d.itemGap(gap.missing.filter((f) => !ROW_FIELDS.has(f)).map((f) => itemField(f, state.lang).label.toLocaleLowerCase(state.lang)).join(", "), gap.from + 1)}` })
        : extras.length ? el("div", { class: "imore", text: [d.moreFields(extras.length), useful].filter(Boolean).join(" · ") }) : null;
      const expandable = extras.length > 0 || Boolean(gap);
      const toggle = () => { if (!expandable) return; open ? state.openItems.delete(keyOf(i)) : state.openItems.add(keyOf(i)); render(); };
      rows.push(el("tr", { class: `irow${open ? " iopen" : ""}${expandable ? "" : " flat"}`, tabindex: expandable ? "0" : null, "aria-expanded": expandable ? String(open) : null, onclick: toggle,
        onkeydown: (e) => { if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); if ((e.key === "ArrowLeft") === open || e.key === "Enter" || e.key === " ") toggle(); } } },
      el("td", {}, el("div", { class: "iname" }, expandable ? el("span", { class: "ichev" }, icon("chev-r", "s")) : null, it.item_name ?? it.item_id ?? `#${i + 1}`),
        sub ? el("div", { class: "isub", text: sub }) : null, cat && !open ? el("div", { class: "icat", text: cat }) : null, open ? null : more),
      el("td", { class: "num", text: it.quantity ?? "1" }), el("td", { class: "num", text: it.price ?? "—" })));
      if (open && expandable) rows.push(expanded(it, gap));
    });
    if (items.length > LIMIT && !showAll) rows.push(el("tr", { class: "more" }, el("td", { colspan: "3" }, button(d.moreItems(items.length - LIMIT), () => { state.openSecs.add(`items-all:${row.key}`); render(); }, { cls: "linkbtn" }))));
    const qty = items.reduce((n, it) => n + (Number(it.quantity ?? 1) || 0), 0);
    const total = itemsTotal(items);
    rows.push(el("tr", { class: "total" }, el("td", { text: d.total }), el("td", { class: "num", text: String(qty) }), el("td", { class: "num", text: total === null ? "—" : String(total) })));
    body = el("table", { class: "items" }, el("thead", {}, el("tr", {}, el("th", { text: d.itemCols.item }), el("th", { class: "num", text: d.itemCols.qty }), el("th", { class: "num", text: d.itemCols.price }))), el("tbody", {}, rows));
  }
  const vc = valueCheck(row);
  const check = vc ? el("div", { class: `check-line ${vc.ok ? "okc" : "warnc"}` }, icon(vc.ok ? "check" : "warn", "s"), el("span", { text: vc.ok ? d.valueOk(vc.value) : d.problems.valueTotal(vc.value, vc.total) })) : null;
  // Not collapsible: its header holds buttons (Expand all, Compare), which a collapsing header button cannot contain.
  return card(d.items, { count: items.length, right, body: [body, check] });
}
