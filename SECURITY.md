# Security

## What the tool does with data

`ai-tag-debugger` drives a real browser through a website and records its tracking requests. These are the measures that keep that data, and the machine it runs on, contained:

- **User data is redacted before it is stored.** `src/redact.js` replaces values sent for ad matching (emails, phone numbers, names, addresses, user ids in GA4 and Google Ads enhanced conversions, Meta advanced matching, TikTok `context.user`, and `user_data` pushed to the dataLayer) with a marker that keeps only the length and whether the value looked hashed. Any value that looks like an email address is redacted whatever its field is called, except the audited site's own address in a link. This happens at capture, in `AuditSession` (`src/browser.js`), so `capture.json`, the reports and the MCP tool results never hold the plain value. `--keep-bodies` turns it off on purpose.
- **Bodies are capped.** Stored request bodies are cut at 32 KB each and 2 MB per journey (`MAX_TOTAL_BODIES` in `src/browser.js`). Cookies are recorded by name only.
- **Secrets stay out of the browser.** `browserEnv` in `src/browser.js` starts Chromium with an environment stripped of anything that looks like a key, token, password or credential, so a page or extension cannot read your API keys.
- **The browser stays on the site.** `hostScope` in `src/guard.js` limits navigation to the audited host, its subdomains and the `allowed_hosts` you name, over `http` and `https` only. Page content reaches the model inside a delimiter it cannot close (`pageView` in `src/agent.js`), and the model is told it is data; the navigation limits are what contain a misled model.
- **Private addresses are blocked in HTTP mode.** When the MCP server runs with `--http`, `isPrivateAddress` in `src/guard.js` refuses loopback, private, link-local and cloud metadata ranges, and all browser traffic, WebSockets included, goes through the egress proxy in `src/egress.js`, which resolves each host once and connects only to the address it checked, so DNS rebinding cannot reach a private address. `--allow-private-network` turns this off for a local tunnel you control.
- **The HTTP server is behind a secret.** The endpoint is `/mcp/<secret>`; `--token` sets it (16 characters or more) or a random one is generated. `src/mcp.js` compares it in constant time, answers 404 to anything else, limits request bodies to 1 MB, serves only the reports it wrote itself, and closes audits idle for 15 minutes. Over HTTP it reads no files from disk and does not offer `run_audit`.
- **Tracking requests are answered locally** by default (`isCollectionEndpoint` in `src/parsers.js`), so test traffic does not reach real analytics and ad accounts.

The tests for these are in `test/security.test.js`, `test/redact.test.js` and `test/scope.test.js`.

## What is in scope

Please report:

- A way for page content to make the agent leave the host scope, visit a blocked address, or act outside the journey (a prompt-injection bypass of the navigation limits).
- A redaction gap: user data that reaches `capture.json`, a report, a saved site or an MCP result in plain text without `--keep-bodies`.
- SSRF through the MCP HTTP mode: reaching localhost, a private range or cloud metadata without `--allow-private-network`, including through redirects, DNS tricks or WebSockets.
- Token handling: using the HTTP server without the secret, learning it from logs or reports, or a timing difference in the check.
- Secrets leaking into the browser environment, a report or a saved site.

Out of scope: findings about websites you audit (they are the site's problem, not the tool's), the behavior of the AI models themselves, and anything that needs `--keep-bodies`, `--allow-private-network` or `block_hits: false` to be set on purpose.

## How to report

Do not open a public issue for a vulnerability. Use GitHub's private vulnerability reporting on the repository (the Security tab, "Report a vulnerability") if it is enabled there. If it is not, reach the maintainers, Analitik İşler, through https://analitikisler.com, the address given as `author` in `package.json`. Say which version you tested, what you did and what you saw; a small reproduction is the most useful thing you can send.

Fixes ship as a patch release and are noted in CHANGELOG.md. Please give the maintainers time to release one before you publish details.

## Supported versions

Only the latest minor version receives fixes. Upgrade with `npm install -g @analitikisler/ai-tag-debugger@latest`, or let `npx -y` pick the newest one.

## Sites you do not own

Run the tool only against sites you own or are authorized to test. Reports about using it against other people's sites are out of scope, and so is any help with doing so.
