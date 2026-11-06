// A webRequest requestBody as the text the CLI's parsers read (Playwright's request.postData()): raw bytes decoded
// as UTF-8, gzip bodies (GA4 can compress its batches) unpacked, and form fields joined back into a query string.

const GZIP = [0x1f, 0x8b];

/** The bytes of a requestBody's raw parts in one array, or null. */
function rawBytes(raw) {
  const parts = (raw ?? []).map((p) => (p?.bytes ? new Uint8Array(p.bytes) : null)).filter(Boolean);
  if (!parts.length) return null;
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * The body as text, or null when there is none. max: characters kept, as the CLI keeps 32 KB per body.
 * @param {{ raw?: { bytes?: ArrayBuffer }[], formData?: Record<string, string[]>, error?: string } | undefined} requestBody
 */
export async function bodyText(requestBody, max = 32 * 1024) {
  if (!requestBody || requestBody.error) return null;
  if (requestBody.formData) {
    const params = new URLSearchParams();
    for (const [k, values] of Object.entries(requestBody.formData)) for (const v of values) params.append(k, v);
    return params.toString().slice(0, max);
  }
  let bytes = rawBytes(requestBody.raw);
  if (!bytes) return null;
  if (bytes[0] === GZIP[0] && bytes[1] === GZIP[1]) {
    try { bytes = await gunzip(bytes); } catch { return null; }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).slice(0, max);
}
