# Security

## What the tool does with data

`ai-tag-debugger` drives a real browser through a website and records its tracking requests. These are the measures that keep that data, and the machine it runs on, contained:

- **User data is redacted before it is stored.** `src/redact.js` replaces values sent for ad matching (emails, phone numbers, names, addresses, user ids in GA4 and Google Ads enhanced conversions, Meta advanced matching, TikTok `context.user`, and `user_data` pushed to the dataLayer) with a marker that keeps only the length and whether the value looked hashed. Any value that looks like an email address is redacted whatever its field is called, except the audited site's own address in a link. This happens at capture, in `AuditSession` (`src/browser.js`), so `capture.json`, the reports and the MCP tool results never hold the plain value. `--keep-bodies` turns it off on purpose.
- **Bodies are capped.** Stored request bodies are cut at 32 KB each and 2 MB per journey (`MAX_TOTAL_BODIES` in `src/browser.js`). Cookies are recorded by name only.
- **A run's files hold no secrets of yours.** `shareableConfig` in `src/audit.js` leaves the config's alert targets (a Slack webhook address), AI endpoint, session file and Chrome address out of `capture.json`, and a saved site leaves them out too. An SMTP login is sent only over `smtps://`, or to a server on the same computer.
- **Reports can't be written by the site.** Values from the page are escaped in the HTML report (which also carries a hash-only content security policy, as the plan page carries one without scripts), can't form links or images in `report.md`, and can't start a formula in `timeline.csv` or a plan's CSV.
- **Entries are capped.** `ENTRY_LIMITS` in `src/browser.js` bounds what one page can add: a dataLayer push over 16 KB keeps its event name and size only, a hit parameter is cut at 4,096 characters, and 200 page errors are kept per journey. The explain call sends the hits whole only while they fit its budget (`explainInput` in `src/report.js`).
- **Secrets stay out of the browser.** `browserEnv` in `src/browser.js` starts Chromium with an environment stripped of anything that looks like a key, token, password or credential, so a page or extension cannot read your API keys.
- **The browser is sandboxed and current.** `launchChromium` in `src/browser.js` starts Chromium with its own sandbox on, and without it only where Chromium cannot use one (as root, or without user namespaces), which it says on stderr. Each release takes the current Playwright, and with it a current Chromium. Service workers and downloads are off in the audit browser.
- **The test account belongs to one site.** `loginFromEnv` in `src/login.js` gives an audit the account only when its site is one `AITD_LOGIN_SITE` names, and the browser types it only on those hosts, not on `allowed_hosts`. A server reached over HTTP offers none.
- **The browser stays on the site.** `hostScope` in `src/guard.js` limits navigation to the audited host, its subdomains and the `allowed_hosts` you name, over `http` and `https` only. Page content reaches the model inside a delimiter it cannot close (`pageView` in `src/agent.js`), and the model is told it is data; the navigation limits are what contain a misled model. What a site sends while it is audited (hits, dataLayer pushes, and the findings and reports built from them) reaches a chat app's model, the model that explains findings and the one that drafts a plan the same way, inside `<captured_data>` (`src/untrusted.js`).
- **Private addresses are blocked in HTTP mode, and for public sites everywhere.** When the MCP server runs with `--http`, or when an audit's site and allowed hosts are all public (`autoBlockPrivate` in `src/guard.js`; not behind a proxy named in the environment, and not in your own Chrome), `isPrivateAddress` in `src/guard.js` refuses loopback, private, link-local and cloud metadata ranges, and all browser traffic, WebSockets included, goes through the egress proxy in `src/egress.js`, which resolves each host once and connects only to the address it checked, so DNS rebinding cannot reach a private address. `--allow-private-network` (or `"allow_private_network": true` in a config) turns this off for a local tunnel or a local mock you control.
- **The HTTP server is behind a secret.** The endpoint is `/mcp/<secret>`; `--token` sets it (16 characters or more) or a random one is generated. `src/mcp.js` compares it in constant time, answers 404 to anything else, limits request bodies to 1 MB, serves only the reports it wrote itself, and closes audits idle for 15 minutes. Report links carry a key derived from the secret (`reportKey`) that opens reports and nothing else, never the secret itself. Over HTTP it reads no files from disk, does not offer `run_audit`, offers `make_plan` only with `--allow-plan`, and runs four browsers at most across audits, consent comparisons and plans.
- **Tracking requests are answered locally** by default (`isCollectionEndpoint` in `src/parsers.js`), so test traffic does not reach real analytics and ad accounts.

The tests for these are in `test/security.test.js`, `test/injection.test.js`, `test/login.test.js`, `test/redact.test.js` and `test/scope.test.js`.

## What is in scope

Please report:

- A way for page content to make the agent leave the host scope, visit a blocked address, or act outside the journey (a prompt-injection bypass of the navigation limits).
- A redaction gap: user data that reaches `capture.json`, a report, a saved site or an MCP result in plain text without `--keep-bodies`.
- SSRF through the MCP HTTP mode, or from a public site audited any other way: reaching localhost, a private range or cloud metadata without `--allow-private-network`, including through redirects, DNS tricks or WebSockets.
- Token handling: using the HTTP server without the secret, learning it from logs, reports or a report link, or a timing difference in the check.
- The test account typed on, or shown to, anything but the site `AITD_LOGIN_SITE` names.
- Text a site sends reaching a model outside `<page_content>` and `<captured_data>`, or closing either one.
- Secrets leaking into the browser environment, a report or a saved site.

Out of scope: findings about websites you audit (they are the site's problem, not the tool's), the behavior of the AI models themselves, and anything that needs `--keep-bodies`, `--allow-private-network`, `allow_private_network: true`, `--allow-live`, `--allow-plan`, `live: true` or `block_hits: false` to be set on purpose.

## How to report

Do not open a public issue for a vulnerability. Use GitHub's private vulnerability reporting on the repository (the Security tab, "Report a vulnerability") if it is enabled there. If it is not, reach the maintainers, Analitik İşler, through https://analitikisler.com, the address given as `author` in `package.json`. Say which version you tested, what you did and what you saw; a small reproduction is the most useful thing you can send.

Fixes ship as a patch release and are noted in CHANGELOG.md. Please give the maintainers time to release one before you publish details.

## Supported versions

Only the latest minor version receives fixes. Upgrade with `npm install -g @analitikisler/ai-tag-debugger@latest`, or let `npx -y` pick the newest one.

## Sites you do not own

Run the tool only against sites you own or are authorized to test. Reports about using it against other people's sites are out of scope, and so is any help with doing so.
