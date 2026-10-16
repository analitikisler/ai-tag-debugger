// Campaign parameters an ad click puts on the landing address. They have to survive the site's
// redirects and show up in the page address its tags report, or the visit is credited to "direct".

export const CLICK_IDS = ["gclid", "wbraid", "gbraid", "fbclid", "ttclid", "msclkid"];
export const UTM_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
export const CAMPAIGN_PARAMS = [...CLICK_IDS, ...UTM_PARAMS];

// Values a run adds to a landing address that has none of its own. Hits are held back by default
// (block_hits), so these never reach a real analytics property.
const TEST_PARAMS = { utm_source: "aitd", utm_medium: "check", utm_campaign: "aitd-campaign-check", gclid: "aitd-gclid", fbclid: "aitd-fbclid" };

/** The campaign parameters in an address, as {name: value}. */
export function campaignParamsIn(url) {
  try {
    const u = new URL(url);
    return Object.fromEntries(CAMPAIGN_PARAMS.filter((n) => u.searchParams.get(n)).map((n) => [n, u.searchParams.get(n)]));
  } catch {
    return {};
  }
}

/** The address with test campaign parameters added, unless it already carries campaign parameters. */
export function withCampaignParams(url) {
  if (Object.keys(campaignParamsIn(url)).length) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(TEST_PARAMS)) u.searchParams.set(k, v);
  return u.href;
}
