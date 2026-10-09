// Ad platforms receive user data for matching (GA4 and Google Ads enhanced conversions,
// Meta advanced matching, TikTok context.user). The audit stores and shows the requests,
// so those values are replaced with a marker that keeps only their length and whether
// they look hashed. The plain ones are reported as a personal data risk.

const USER_KEYS = new Set([
  "em", "ph", "fn", "ln", "ge", "db", "ct", "st", "zp", "country", "external_id", "uid", "user_id", "_uid",
  "email", "phone", "phone_number", "first_name", "last_name", "street", "city", "region", "postal_code", "zip",
  "sha256_email_address", "sha256_phone_number", "sha256_email", "sha256_phone", "email_address",
]);

/** Whether a request parameter (or dotted JSON path) carries user data for ad matching. */
export function isUserDataKey(key) {
  const k = String(key).toLowerCase();
  if (/^ud\[.+\]$/.test(k)) return true; // Meta advanced matching
  if (/^(ep|epn|up|upn)\.(user_data|email|phone|user_id)/.test(k)) return true;
  if (/^context\.user\.(email|phone|phone_number|external_id)$/.test(k)) return true;
  if (/(^|\.)user_data(\.|$)/.test(k)) return true;
  return USER_KEYS.has(k.split(".").pop());
}

/** "tv.1~em.<hash>" and plain hex or base64 digests count as hashed; anything with @ or spaces doesn't. */
export function looksHashed(value) {
  const v = String(value);
  if (/[@\s]/.test(v)) return false;
  return v.split("~").every((p) => p === "" || /^tv\.\d+$/.test(p) || /^[A-Za-z0-9+/=_-]{32,}$/.test(p.replace(/^[a-z0-9]{1,4}\./i, "")));
}

const marker = (value) => `[redacted: ${String(value).length} chars, ${looksHashed(value) ? "looks hashed" : "plain"}]`;

/** Collects what was redacted: { fields: keys, plain: keys whose value was not hashed }. */
function note(found, key, value) {
  found.fields.push(key);
  if (!looksHashed(value)) found.plain.push(key);
  return marker(value);
}

/** Redacts user-data parameters in a URL's query. Returns the URL unchanged when there are none. */
export function redactUrl(url, found = { fields: [], plain: [] }) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { url, ...found };
  }
  const keys = [...u.searchParams.keys()].filter(isUserDataKey);
  if (!keys.length) return { url, ...found };
  const params = new URLSearchParams();
  for (const [k, v] of u.searchParams) params.append(k, isUserDataKey(k) ? note(found, k, v) : v);
  u.search = params.toString();
  return { url: u.href, ...found };
}

function redactJson(value, path, found) {
  if (Array.isArray(value)) return value.map((v) => redactJson(v, path, found));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => {
      const key = path ? `${path}.${k}` : k;
      if (isUserDataKey(key) && (typeof v === "string" || typeof v === "number")) return [k, note(found, key, v)];
      return [k, redactJson(v, key, found)];
    }));
  }
  return value;
}

/** Redacts user data in a POST body: JSON (TikTok) or form-encoded lines (GA4 batches). */
export function redactBody(body, found = { fields: [], plain: [] }) {
  const text = String(body ?? "");
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return { text: JSON.stringify(redactJson(JSON.parse(trimmed), "", found)), ...found };
    } catch {
      // Cut at the size limit: redact "key": "value" pairs by name instead.
      const redacted = text.replace(/"([^"\\]{1,64})"(\s*:\s*)"((?:[^"\\]|\\.)*)"/g, (all, k, sep, v) => (isUserDataKey(k) ? `"${k}"${sep}"${note(found, k, v)}"` : all));
      return { text: redacted, ...found };
    }
  }
  if (/^[^\s{]*=/.test(trimmed)) {
    const lines = text.split("\n").map((line) => {
      const params = new URLSearchParams(line);
      if (![...params.keys()].some(isUserDataKey)) return line;
      const out = new URLSearchParams();
      for (const [k, v] of params) out.append(k, isUserDataKey(k) ? note(found, k, v) : v);
      return out.toString();
    });
    return { text: lines.join("\n"), ...found };
  }
  return { text, ...found };
}

/** Redacts user-data entries in parsed hit parameters. */
export function redactParams(params, found = { fields: [], plain: [] }) {
  const out = {};
  for (const [k, v] of Object.entries(params ?? {})) out[k] = isUserDataKey(k) ? note(found, k, v) : v;
  return out;
}
