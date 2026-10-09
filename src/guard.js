// Limits where the audit browser may go: only http(s), only the audited site
// (plus any hosts the user allows), and, when asked, never private network addresses.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Lowercase host without a leading "www.", so www.example.com and example.com match each other. */
const baseHost = (host) => host.toLowerCase().replace(/^www\./, "");

/**
 * Hosts the browser may navigate to: the audited site and its subdomains, plus
 * each allowed host and its subdomains. Entries may be hosts or full URLs.
 * @param {string} site
 * @param {string[]} [allowedHosts]
 */
export function hostScope(site, allowedHosts = []) {
  const bases = [site, ...allowedHosts]
    .map((entry) => String(entry).trim())
    .filter(Boolean)
    .map((entry) => {
      try {
        return baseHost(new URL(entry.includes("://") ? entry : `http://${entry}`).hostname);
      } catch {
        throw new Error(`"${entry}" in allowed_hosts is not a valid host.`);
      }
    })
    .map((h) => h.replace(/^\*\./, ""));
  return {
    hosts: [...new Set(bases)],
    allows(hostname) {
      const h = hostname.toLowerCase();
      return this.hosts.some((b) => h === b || h === `www.${b}` || h.endsWith(`.${b}`));
    },
  };
}

function ipv4Private(ip) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/** The 8 groups of an IPv6 address as numbers, including a trailing dotted IPv4 part, or null. */
function ipv6Groups(ip) {
  let a = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const v4 = a.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const [w, x, y, z] = v4[1].split(".").map(Number);
    a = a.slice(0, -v4[1].length) + `${((w << 8) | x).toString(16)}:${((y << 8) | z).toString(16)}`;
  }
  const [head, tail] = a.includes("::") ? a.split("::") : [a, null];
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = tail === null ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  return groups.length === 8 ? groups.map((g) => parseInt(g || "0", 16)) : null;
}

const v4From = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/**
 * True for loopback, private, link-local, carrier-grade NAT and other non-public
 * addresses, including IPv6 forms that carry an IPv4 address inside.
 */
export function isPrivateAddress(ip) {
  const v = isIP(String(ip).replace(/^\[|\]$/g, "").split("%")[0]);
  if (v === 4) return ipv4Private(ip);
  if (v !== 6) return false;
  const g = ipv6Groups(ip);
  if (!g) return true;
  const [g0, g1, g2, g3, , g5, g6, g7] = g;
  const zeroTo = (n) => g.slice(0, n).every((x) => x === 0);
  if (zeroTo(8) || (zeroTo(7) && g7 === 1)) return true; // :: and ::1
  if (zeroTo(5) && g5 === 0xffff) return ipv4Private(v4From(g6, g7)); // ::ffff:a.b.c.d
  if (zeroTo(6)) return ipv4Private(v4From(g6, g7)); // ::a.b.c.d (IPv4-compatible)
  if (g0 === 0x64 && g1 === 0xff9b) return ipv4Private(v4From(g6, g7)); // NAT64 64:ff9b::/96 (and the local-use /48)
  if (g0 === 0x2002) return ipv4Private(v4From(g1, g2)); // 6to4
  if (g0 === 0x2001 && g1 === 0) return true; // Teredo: the IPv4 address is obscured, so refuse
  return (g0 & 0xfe00) === 0xfc00 || (g0 & 0xffc0) === 0xfe80 || (g0 & 0xff00) === 0xff00 || (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0); // ULA, link-local, multicast, discard
}

/**
 * Resolves a hostname and reports whether it points at a private address.
 * Results are cached per checker. This is the early, friendly check; the egress
 * proxy (egress.js) is what makes sure the browser only connects to checked addresses.
 */
export function privateHostChecker(isBlocked = isPrivateAddress) {
  const cache = new Map();
  return async (hostname) => {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost")) return true;
    if (isIP(host)) return isBlocked(host);
    if (!cache.has(host)) {
      cache.set(
        host,
        lookup(host, { all: true, verbatim: true })
          .then((addrs) => addrs.some((a) => isBlocked(a.address)))
          .catch(() => false), // unresolvable: the browser will fail to load it anyway
      );
    }
    return cache.get(host);
  };
}

/**
 * Checks a navigation target. Returns an error message, or null when allowed.
 * @param {string} url
 * @param {{ scope?: ReturnType<typeof hostScope>, isPrivate?: (host: string) => Promise<boolean> }} rules
 */
export async function navigationError(url, { scope, isPrivate } = {}) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return `"${url}" is not a valid URL.`;
  }
  if (u.protocol === "about:" && u.href === "about:blank") return null;
  if (!["http:", "https:"].includes(u.protocol)) return `Only http and https pages can be opened, not ${u.protocol} URLs.`;
  if (scope && !scope.allows(u.hostname)) {
    return `${u.hostname} is outside the audited site (${scope.hosts.join(", ")}). Stay on the site. If the journey really needs this host (for example a hosted checkout), add it to allowed_hosts.`;
  }
  if (isPrivate && (await isPrivate(u.hostname))) return `${u.hostname} is a private network address, which this server doesn't open.`;
  return null;
}
