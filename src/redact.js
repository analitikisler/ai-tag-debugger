// Ad platforms receive user data for matching (GA4 and Google Ads enhanced conversions,
// Meta advanced matching, TikTok context.user), and sites push it to the dataLayer for
// their tags. The audit stores and shows requests and pushes, so those values are replaced
// with a marker that keeps only their length and whether they look hashed. The plain ones
// are reported as a personal data risk.

const USER_KEYS = new Set([
  "em", "ph", "fn", "ln", "ge", "db", "ct", "st", "zp", "country", "external_id", "uid", "user_id", "_uid",
  "email", "phone", "phone_number", "first_name", "last_name", "street", "city", "region", "postal_code", "zip",
  "sha256_email_address", "sha256_phone_number", "sha256_email", "sha256_phone", "email_address",
]);
// In dataLayer pushes, short names like "city" or "country" are often page data, so only
// these names, values under a user data object, and email-like values are redacted there.
const PUSH_KEYS = new Set(["email", "email_address", "phone", "phone_number", "sha256_email_address", "sha256_phone_number", "sha256_email", "sha256_phone"]);
const USER_OBJECTS = /(^|\.)(user_data|user_provided_data|enhanced_conversion_data)(\.|$)/;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A value that is an email address, whatever its field is called. */
const isEmail = (v) => typeof v === "string" && EMAIL.test(v.trim());

/** Whether a request parameter (or dotted JSON path) carries user data for ad matching. */
export function isUserDataKey(key) {
  const k = String(key).toLowerCase();
  if (/^ud(ff)?\[.+\]$/.test(k)) return true; // Meta advanced matching: ud[em], and udff[em] in newer pixels
  if (/^(ep|epn|up|upn)\.(user_data|email|phone|user_id)/.test(k)) return true;
  if (/^context\.user\.(email|phone|phone_number|external_id)$/.test(k)) return true;
  if (USER_OBJECTS.test(k)) return true;
  return USER_KEYS.has(k.split(".").pop());
}

/** Whether a dataLayer push field carries user data: see PUSH_KEYS. */
const isPushUserKey = (path) => USER_OBJECTS.test(path.toLowerCase()) || PUSH_KEYS.has(path.toLowerCase().split(".").pop());

/** "tv.1~em.<hash>" and plain hex or base64 digests count as hashed; anything with @ or spaces doesn't. */
export function looksHashed(value) {
  const v = String(value);
  if (/[@\s]/.test(v)) return false;
  return v.split("~").every((p) => p === "" || /^tv\.\d+$/.test(p) || /^[A-Za-z0-9+/=_-]{32,}$/.test(p.replace(/^[a-z0-9]{1,4}\./i, "")));
}

const marker = (value) => `[redacted: ${String(value).length} chars, ${looksHashed(value) ? "looks hashed" : "plain"}]`;
const emptyFound = () => ({ fields: [], plain: [] });

/** Collects what was redacted: { fields: keys, plain: keys whose value was not hashed }. */
function note(found, key, value) {
  found.fields.push(key);
  if (!looksHashed(value)) found.plain.push(key);
  return marker(value);
}

/** Redacts form-encoded parameters (a URL query or a GA4 body line). Returns null when nothing needed it. */
function redactParamString(text, found) {
  const params = new URLSearchParams(text);
  if (![...params].some(([k, v]) => isUserDataKey(k) || isEmail(v))) return null;
  const out = new URLSearchParams();
  for (const [k, v] of params) out.append(k, isUserDataKey(k) || isEmail(v) ? note(found, k, v) : v);
  return out.toString();
}

/** Redacts user data in a URL's query. Returns the URL unchanged when there is none. */
export function redactUrl(url, found = emptyFound()) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { url, ...found };
  }
  const query = redactParamString(u.search, found);
  if (query === null) return { url, ...found };
  u.search = query;
  return { url: u.href, ...found };
}

function redactJson(value, path, found, isKey) {
  if (Array.isArray(value)) return value.map((v) => redactJson(v, path, found, isKey));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactJson(v, path ? `${path}.${k}` : k, found, isKey)]));
  }
  if ((typeof value === "string" || typeof value === "number") && ((path && isKey(path)) || isEmail(value))) return note(found, path || "(value)", value);
  return value;
}

// "key": "value" and "key": 123 pairs, for JSON cut at the size limit.
const PAIR = /"([^"\\]{1,64})"(\s*:\s*)("(?:[^"\\]|\\.)*"|-?\d[\d.eE+-]*)/g;
// A string value the cut left open at the very end.
const OPEN_VALUE = /("(?:[^"\\]{1,64})"\s*:\s*)"(?:[^"\\]|\\.)*$/;

/** Redacts user data in a POST body: JSON (TikTok) or form-encoded lines (GA4 batches). */
export function redactBody(body, found = emptyFound()) {
  const text = String(body ?? "");
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return { text: JSON.stringify(redactJson(JSON.parse(trimmed), "", found, isUserDataKey)), ...found };
    } catch {
      // Cut at the size limit: redact pairs by name or email-like value, and drop a value left open at the end.
      const redacted = text
        .replace(PAIR, (all, k, sep, raw) => {
          const v = raw.startsWith('"') ? raw.slice(1, -1) : raw;
          return isUserDataKey(k) || isEmail(v) ? `"${k}"${sep}"${note(found, k, v)}"` : all;
        })
        .replace(OPEN_VALUE, '$1"[cut]');
      return { text: redacted, ...found };
    }
  }
  if (/^[^\s{]*=/.test(trimmed)) {
    const lines = text.split("\n").map((line) => redactParamString(line, found) ?? line);
    return { text: lines.join("\n"), ...found };
  }
  return { text, ...found };
}

/** Redacts user-data entries in parsed hit parameters. */
export function redactParams(params, found = emptyFound()) {
  const out = {};
  for (const [k, v] of Object.entries(params ?? {})) out[k] = isUserDataKey(k) || isEmail(v) ? note(found, k, v) : v;
  return out;
}

/**
 * Redacts user data in a dataLayer push (GTM objects or gtag.js arguments):
 * email and phone fields, anything under user_data, and email-like values.
 */
export function redactPush(value, found = emptyFound()) {
  // gtag("set", "user_data", {...}) has no user_data key: the objects after the name are the user data.
  if (Array.isArray(value) && value.includes("user_data")) {
    return { value: value.map((v) => (v && typeof v === "object" ? redactJson(v, "user_data", found, isPushUserKey) : v)), ...found };
  }
  return { value: redactJson(value, "", found, isPushUserKey), ...found };
}
