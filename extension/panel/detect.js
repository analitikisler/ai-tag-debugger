// Which tracking platforms a page has, read from the globals their snippets define. It runs in the page itself
// (chrome.scripting.executeScript, world MAIN) only to suggest platforms in setup; it reads, never calls anything.
// Self-contained: executeScript serializes the function, so it may not use anything outside it.
export function platformsInPage() {
  const w = window;
  const found = new Set();
  const gtm = w.google_tag_manager && typeof w.google_tag_manager === "object" ? Object.keys(w.google_tag_manager) : [];
  if (gtm.some((k) => /^G-/.test(k))) found.add("ga4");
  if (gtm.some((k) => /^(AW|DC)-/.test(k))) found.add("google_ads");
  // gtag with no registry yet: GA4 is by far the usual reason.
  if (!gtm.length && typeof w.gtag === "function") found.add("ga4");
  const has = (name) => {
    try { return w[name] !== undefined && w[name] !== null; } catch { return false; }
  };
  const map = {
    meta: ["fbq", "_fbq"], tiktok: ["ttq"], adobe: ["_satellite", "s_c_il", "AppMeasurement"], matomo: ["_paq", "Matomo", "Piwik"],
    piwik_pro: ["_ppas", "ppms"], microsoft_ads: ["uetq", "UET"], linkedin: ["_linkedin_partner_id", "lintrk"], pinterest: ["pintrk"],
    snapchat: ["snaptr"], x: ["twq"], criteo: ["criteo_q"], klaviyo: ["klaviyo", "_learnq"], clarity: ["clarity"], hotjar: ["hj", "_hjSettings"],
  };
  for (const [key, names] of Object.entries(map)) if (names.some(has)) found.add(key);
  return [...found];
}
