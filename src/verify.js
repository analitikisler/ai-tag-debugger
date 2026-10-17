// Who fixes a finding, and where to check the fix. Both are fixed tables over
// the check names, so they work with or without the AI explanation.

export const OWNERS = ["developer", "gtm", "marketing"];

const OWNER_BY_CHECK = {
  missing_params: "developer",
  purchase_value_invalid: "developer",
  purchase_currency_invalid: "developer",
  purchase_items_empty: "developer",
  purchase_mismatch: "developer",
  pii_datalayer: "developer",
  journey_incomplete: "developer",
  server_side: "developer",
  unplanned_events: "marketing",
  planned_out_of_scope: "marketing",
};

/** Who most likely fixes this finding: the site's developer, whoever runs Tag Manager, or marketing (the plan itself). Tag and consent setup is the default. */
export function ownerOf(finding) {
  return OWNER_BY_CHECK[finding.check] ?? "gtm";
}

const LINKS = {
  tagAssistant: { name: "Tag Assistant", url: "https://tagassistant.google.com/" },
  ga4Debug: { name: "GA4 DebugView", url: "https://support.google.com/analytics/answer/7201382" },
  metaTest: { name: "Meta Test Events", url: "https://www.facebook.com/business/help/2040882565969969" },
  tiktokHelper: { name: "TikTok Pixel Helper", url: "https://chromewebstore.google.com/detail/tiktok-pixel-helper/aelgobmabdmlfmiblddjfnjodalhidnn" },
  consentMode: { name: "Consent Mode", url: "https://developers.google.com/tag-platform/security/guides/consent" },
};

const PLATFORM_LINKS = {
  ga4: ["tagAssistant", "ga4Debug"],
  google_ads: ["tagAssistant"],
  meta: ["metaTest"],
  tiktok: ["tiktokHelper"],
};

/** Tools where the person fixing this finding can see the result: a list of { key, name, url }. Empty when no tool fits. */
export function verifyLinks(finding) {
  const keys = new Set(PLATFORM_LINKS[finding.platform] ?? []);
  if (/^(consent_|cookies_|reject_|before_consent|after_reject)/.test(finding.check)) {
    keys.add("tagAssistant");
    keys.add("consentMode");
  }
  if (!keys.size && ["unplanned_events", "journey_incomplete"].includes(finding.check)) keys.add("tagAssistant");
  return [...keys].map((key) => ({ key, ...LINKS[key] }));
}
