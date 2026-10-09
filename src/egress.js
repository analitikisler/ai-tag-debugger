// A small local proxy that all browser traffic goes through when private addresses
// are blocked (MCP over HTTP). It resolves each host once, refuses private
// addresses, and connects to exactly the address it checked. Chromium never
// resolves the host itself, so a DNS answer that changes between the check and
// the connection (DNS rebinding) can't reach a private address. It covers plain
// HTTP, HTTPS and WebSocket (ws:// and wss://) traffic alike.
import { createServer, request as httpRequest } from "node:http";
import { connect as netConnect, isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { isPrivateAddress } from "./guard.js";

const HOP_HEADERS = ["proxy-connection", "proxy-authorization", "connection", "keep-alive", "te", "trailer", "transfer-encoding", "upgrade"];

/** Splits "host:port" or "[v6]:port". */
function splitHostPort(value, defaultPort) {
  const m = value.match(/^\[([^\]]+)\](?::(\d+))?$/) ?? value.match(/^([^:]+)(?::(\d+))?$/);
  if (!m) return null;
  return { host: m[1], port: Number(m[2] ?? defaultPort) };
}

/**
 * @param {{ isBlocked?: (ip: string) => boolean, lookup?: (host: string) => Promise<{ address: string, family: number }[]> }} [opts]
 *   isBlocked: which resolved addresses to refuse (default: private ones). lookup: injectable for tests.
 * @returns {Promise<{ url: string, refused: string[], close: () => Promise<void> }>}
 */
export async function startEgressProxy(opts = {}) {
  const isBlocked = opts.isBlocked ?? isPrivateAddress;
  const lookup = opts.lookup ?? ((host) => dnsLookup(host, { all: true, verbatim: true }));
  const refused = [];

  /** The one address to connect to, or throws when the host is refused or unresolvable. */
  async function resolve(host) {
    const bare = host.replace(/^\[|\]$/g, "");
    const addrs = isIP(bare) ? [{ address: bare, family: isIP(bare) }] : await lookup(bare);
    if (!addrs.length) throw new Error(`${host} did not resolve`);
    if (bare === "localhost" || bare.endsWith(".localhost") || addrs.some((a) => isBlocked(a.address))) {
      refused.push(host);
      throw Object.assign(new Error(`${host} is a private network address`), { refused: true });
    }
    return addrs[0];
  }

  const sockets = new Set();
  const track = (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
    s.on("error", () => s.destroy());
    return s;
  };

  const server = createServer(async (req, res) => {
    // Plain http:// requests arrive with an absolute URL.
    let target;
    try {
      target = new URL(req.url);
      if (target.protocol !== "http:") throw new Error("only http");
    } catch {
      res.writeHead(400).end();
      return;
    }
    let addr;
    try {
      addr = await resolve(target.hostname);
    } catch (err) {
      res.writeHead(err.refused ? 403 : 502).end();
      return;
    }
    const headers = { ...req.headers };
    for (const h of HOP_HEADERS) delete headers[h];
    const upstream = httpRequest(
      { host: addr.address, family: addr.family, port: Number(target.port) || 80, method: req.method, path: target.pathname + target.search, headers, setHost: false },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", () => (res.headersSent ? res.destroy() : res.writeHead(502).end()));
    req.pipe(upstream);
  });

  // HTTPS and WebSockets: a CONNECT tunnel to the checked address.
  server.on("connect", async (req, client, head) => {
    track(client);
    const target = splitHostPort(req.url, 443);
    let addr;
    try {
      if (!target) throw new Error("bad target");
      addr = await resolve(target.host);
    } catch (err) {
      client.end(`HTTP/1.1 ${err.refused ? "403 Forbidden" : "502 Bad Gateway"}\r\n\r\n`);
      return;
    }
    const upstream = track(netConnect({ host: addr.address, port: target.port, family: addr.family }, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head?.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    }));
    upstream.on("error", () => client.destroy());
  });

  // A ws:// upgrade sent as a plain proxied request, in case the browser doesn't tunnel it.
  server.on("upgrade", async (req, client, head) => {
    track(client);
    let target;
    let addr;
    try {
      target = new URL(req.url);
      addr = await resolve(target.hostname);
    } catch {
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const upstream = track(netConnect({ host: addr.address, port: Number(target.port) || 80, family: addr.family }, () => {
      const headers = Object.entries(req.headers).filter(([k]) => !k.startsWith("proxy-")).map(([k, v]) => `${k}: ${v}`);
      upstream.write(`${req.method} ${target.pathname}${target.search} HTTP/1.1\r\n${headers.join("\r\n")}\r\n\r\n`);
      if (head?.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    }));
    upstream.on("error", () => client.destroy());
  });
  server.on("connection", track);

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    refused,
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(() => r()));
    },
  };
}
