import { providerOf } from "./parsers.js";
import { siteOf } from "./redact.js";

// Cookies the vendors' own scripts set on the site's domain.
const COOKIE_VENDORS = [
  [/^(_ga|_gid|_gat)(_|$)/, "ga4"],
  [/^(_gcl_|_gac_|IDE$|test_cookie$)/, "google_ads"],
  [/^_fb[pc]$/, "meta"],
  [/^(_ttp|ttclid|_tt_enable_cookie)$/, "tiktok"],
  [/^(_li_|li_|bcookie|lidc|UserMatchHistory)/, "linkedin"],
  [/^(_uet|MUID)/, "microsoft_ads"],
  [/^(_pin_|_pinterest_)/, "pinterest"],
  [/^(_scid|sc_at)/, "snapchat"],
  [/^(_cto_|cto_)/, "criteo"],
  [/^__kla_id$/, "klaviyo"],
  [/^_hj/, "hotjar"],
  [/^_clck|^_clsk/, "clarity"],
];

const hostOf = (url) => {
  try { return new URL(url).hostname; } catch { return ""; }
};

const pathOf = (url) => {
  try { const u = new URL(url); return `${u.hostname}${u.pathname}`; } catch { return ""; }
};

/**
 * Every vendor the site talked to: the pages it loaded or sent from, whether its requests went to the
 * site's own domain (first party) or to the vendor (third party), and the cookie names tied to it.
 * Cookies no vendor owns are listed apart. Only cookie names are kept, never values.
 */
export function buildInventory(runs) {
  const vendors = new Map();
  for (const r of runs) {
    for (const c of r.network ?? []) {
      if (!c.vendor || !c.pageUrl) continue;
      const v = vendors.get(c.vendor) ?? { vendor: c.vendor, keys: new Set(), pages: new Set(), first: 0, third: 0, requests: 0, cookies: new Set() };
      v.keys.add(c.provider);
      v.pages.add(pathOf(c.pageUrl));
      v.requests++;
      v[siteOf(hostOf(c.url)) === siteOf(hostOf(c.pageUrl)) ? "first" : "third"]++;
      vendors.set(c.vendor, v);
    }
  }
  const other = new Map();
  for (const r of runs) {
    for (const ck of r.cookieLog ?? []) {
      const domain = String(ck.domain ?? "").replace(/^\./, "");
      const key = COOKIE_VENDORS.find(([re]) => re.test(ck.name))?.[1] ?? providerOf(`https://${domain}/`)?.key;
      const owners = [...vendors.values()].filter((v) => key && v.keys.has(key));
      if (owners.length) for (const v of owners) v.cookies.add(ck.name);
      else other.set(`${domain}|${ck.name}`, { name: ck.name, domain });
    }
  }
  const sites = new Set(runs.flatMap((r) => (r.network ?? []).map((c) => c.pageUrl)).filter(Boolean).map((u) => siteOf(hostOf(u))));
  return {
    vendors: [...vendors.values()]
      .map((v) => ({
        vendor: v.vendor,
        party: v.first && v.third ? "both" : v.first ? "first" : "third",
        pages: [...v.pages].sort(),
        requests: v.requests,
        cookies: [...v.cookies].sort(),
      }))
      .sort((a, b) => b.pages.length - a.pages.length || a.vendor.localeCompare(b.vendor)),
    otherCookies: [...other.values()].map((c) => ({ name: c.name, party: sites.has(siteOf(c.domain)) ? "first" : "third" })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}
