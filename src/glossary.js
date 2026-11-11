// Which tip explains a tracking request parameter, for the "?" next to a hit's parameters. The tips themselves are
// strings like any other, in src/i18n.js (tips), grouped by the vendor whose requests carry the parameter.
import { messages } from "./i18n.js";

// Parameter names that follow a pattern, with the name of their tip in the strings' tips.patterns.
const PATTERNS = [
  [/^ep\.(.+)$/, "ep"],
  [/^epn\.(.+)$/, "epn"],
  [/^up\.(.+)$/, "up"],
  [/^upn\.(.+)$/, "upn"],
  [/^pr(\d+)$/, "pr"],
  [/^cd\[(.+)\]$/, "cd"],
  [/^ud\[(.+)\]$/, "ud"],
  [/^properties\.(.+)$/, "properties"],
];

// Which groups of tips a platform's requests are read with. A platform not listed here has no table of its own, so a
// short name such as "v" or "tid" is not explained with another vendor's meaning.
const TIP_GROUPS = { ga4: ["google"], google_ads: ["google_ads", "google"], meta: ["meta"], tiktok: ["tiktok"], x: ["x"] };

/**
 * The tip for a request parameter in the report language, or null. platform: the hit's platform, so the tip is the
 * one that vendor means; without it, the first group that knows the name answers.
 */
export function paramTip(key, lang = "en", platform = null) {
  const { patterns, ...groups } = messages(lang).tips;
  const group = (platform ? TIP_GROUPS[platform] ?? [] : Object.keys(groups)).find((name) => Object.hasOwn(groups[name], key));
  if (group) return groups[group][key];
  for (const [re, id] of PATTERNS) {
    const m = key.match(re);
    if (m) return patterns[id](m[1]);
  }
  return null;
}

// Parameters that describe the event itself; the rest (session, device, page, consent) are collapsed.
const EVENT_KEYS = /^(en|ev|event|label|value|currency_code|oid|cu|ep\..*|epn\..*|pr\d+|cd\[.*\]|properties\..*|eid|event_id|events|tw_sale_amount|tw_order_quantity)$/;
export const isEventParam = (key) => EVENT_KEYS.test(key);

// GA4 item string fields (pr1=…): two-letter keys, plus kN/vN custom item parameters.
const ITEM_FIELDS = {
  id: "item_id", nm: "item_name", br: "item_brand", ca: "item_category", c2: "item_category2", c3: "item_category3", c4: "item_category4", c5: "item_category5",
  va: "item_variant", pr: "price", qt: "quantity", cp: "coupon", ds: "discount", af: "affiliation", lp: "index", ln: "item_list_name", li: "item_list_id", lo: "location_id",
  pi: "promotion_id", pn: "promotion_name", cn: "creative_name", cs: "creative_slot",
};

/**
 * Decodes a GA4 item string ("nmShoe~id42~pr10~qt1~k0size~v0XL") into
 * { fields: [[item_name, "Shoe"], …], custom: [["size", "XL"]] }.
 */
export function decodeGa4Item(s) {
  const fields = [];
  const names = {};
  const values = {};
  const parts = String(s).split("~");
  // Custom parameter names first (k0size … k10fit): a name never starts with a digit, so its number reads whole.
  for (const part of parts) {
    const m = part.match(/^k(\d+)(.*)$/);
    if (m) names[Number(m[1])] = m[2];
  }
  for (const part of parts) {
    if (/^k\d/.test(part)) continue;
    const value = part.match(/^v(\d+)(.*)$/);
    if (value) {
      // A value can start with digits itself (v042 is 42 for parameter 0), so its number is the longest one a name was given for.
      const digits = value[1];
      let n = 1;
      for (let len = digits.length; len > 1; len--) if (Number(digits.slice(0, len)) in names) { n = len; break; }
      values[Number(digits.slice(0, n))] = digits.slice(n) + value[2];
      continue;
    }
    const m = part.match(/^([a-z][a-z0-9])(.*)$/);
    if (m) fields.push([ITEM_FIELDS[m[1]] ?? m[1], m[2]]);
  }
  return { fields, custom: Object.entries(values).map(([n, v]) => [names[n] ?? `custom_${n}`, v]) };
}
