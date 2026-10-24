# Threat model: ai-tag-debugger

This file is read by Anthropic's OSS Scanner before it audits the repository. SECURITY.md is the
authoritative statement of the security measures and what counts as a vulnerability; this file
adds the context a scanner needs: where untrusted input enters, what matters most, how to run the
code and how we rate severity.

## What the project does and where untrusted input enters

ai-tag-debugger is a Node CLI and an MCP (Model Context Protocol) server that QA-tests a website's
analytics, ad and consent tracking. An AI model, or a replay of saved steps, drives a real Chromium
through a journey with Playwright. The tool records every tracking request and dataLayer push,
redacts user data, checks the hits against a measurement plan with deterministic rules, and writes
HTML, Markdown and CSV reports. It runs on a developer's machine or in CI, and in MCP HTTP mode as a
small server that chat apps connect to over the network.

Untrusted input, from most to least hostile:

1. **Content of the audited website.** Page HTML, text, scripts, link targets, redirects, request
   URLs and bodies, response headers, cookies and dataLayer pushes. A site may be malicious or
   compromised. This content reaches the AI model as text (`pageView` in `src/agent.js`), is parsed
   into hits (`src/parsers.js`), redacted (`src/redact.js`), stored in `capture.json` and rendered
   into the HTML report (`src/html/`). Treat it as attacker-controlled.
2. **The AI model's output.** The model chooses browser actions (URLs to open, selectors to click,
   text to type) and writes explanations into reports. A model misled by page content is in scope:
   the navigation limits in `src/guard.js` and the egress proxy in `src/egress.js` are what contain
   it, not the model's good behaviour.
3. **MCP requests in HTTP mode** (`src/mcp.js` with `--http`). Anyone who can reach the port can
   send requests; only the secret path `/mcp/<secret>` should let them through. Tool parameters
   (site URL, journeys, config) come from the connected chat app and its user.
4. **Files the user points the tool at:** config JSON, measurement plans, a GTM container export
   (`src/gtm.js`), a plan imported from a spreadsheet (`src/sheet.js`), a baseline file, saved
   sites for replay (`src/replay.js`). These are semi-trusted: supplied by the operator, but often
   exported from third-party tools or shared between colleagues.
5. **Environment and CLI flags.** Trusted; set by the operator.

## Components that matter most

In scope, highest value first:

- `src/guard.js` and `src/egress.js`: host scope (the browser must stay on the audited host, its
  subdomains and `allowed_hosts`, over http and https only), the private-address block in HTTP mode
  (loopback, RFC 1918, link-local, cloud metadata, including through redirects, DNS rebinding and
  WebSockets). A bypass is SSRF from a server that chat apps expose on a network.
- `src/mcp.js`: constant-time secret comparison, 404 for anything else, 1 MB body limit, serving
  only the reports it wrote itself, no file reads from disk over HTTP, no `run_audit` over HTTP, the
  15-minute idle close. Path traversal in the report routes, or a way to read arbitrary files, is
  critical.
- `src/redact.js` and the capture path in `src/browser.js` (`AuditSession`): user data from ad
  matching and enhanced conversions must never reach `capture.json`, a report, a saved site or an
  MCP result in plain text unless `--keep-bodies` is set. Body size caps (`MAX_TOTAL_BODIES`).
- `src/browser.js` `browserEnv`: the environment handed to Chromium must contain no API keys,
  tokens or credentials.
- `src/agent.js`: page content must stay inside its delimiter; a way for a page to close the
  delimiter or otherwise redirect the agent outside the journey is a prompt-injection finding.
- `src/html/` and `src/report.js`: the HTML report embeds attacker-controlled page content
  (titles, URLs, parameter values, model text). Unescaped output is stored XSS in a file the operator
  opens locally or serves from the MCP server.
- `src/workspace.js`: run and plan IDs and the `--data-dir` layout must not let a site name or an
  ID escape the data folder.
- `src/notify.js`: alert payloads (Slack, email) built from report content.

Lower priority but in scope:

- `src/parsers.js`, `src/consent.js`, `src/inventory.js`, `src/checks.js`, `src/metrics.js`,
  `src/history.js`: parsing of attacker-controlled URLs, bodies and dataLayer values. Crashes and
  catastrophic regex backtracking on hostile input are denial of service of a single run.
- `src/gtm.js`, `src/sheet.js`, `src/schema.js`: parsing of operator-supplied files. Prototype
  pollution or code execution from a crafted container export or spreadsheet is high.
- `src/providers.js`: handling of provider responses and the retry on transient failures.

Out of scope:

- `examples/`: the demo shop is a deliberately buggy test fixture served on localhost for the
  tests and the demo. Its three tracking bugs are intentional.
- `docs/`, `test/` fixtures, `scripts/setup.js`.
- Behaviour that requires an opt-out flag the operator set on purpose: `--keep-bodies`,
  `--allow-private-network`, `block_hits: false`.
- Findings about the websites being audited, and the behaviour of the AI models themselves.
- Vulnerabilities inside dependencies (the official Anthropic, OpenAI and Google SDKs, Playwright,
  zod, the MCP SDK, fflate) unless this project uses them in an unsafe way.

## How to exercise it

Everything runs without an API key or Internet access.

- `npm test` runs every test file (`node --test test/*.test.js`). `npm run test:unit` runs the
  browser-free subset. The end-to-end tests start the demo shop from `examples/serve.js` on their
  own localhost ports and drive real Chromium with fake model clients.
- The security tests are `test/security.test.js`, `test/scope.test.js`, `test/redact.test.js`,
  `test/injection.test.js` (prompt injection regressions) and `test/mcp.test.js` (the MCP server,
  including HTTP mode). Start new reproducers from these.
- A scripted run against the demo shop: `npm run demo:serve` in one process, then
  `node src/cli.js run --config examples/demo.config.json --scripted --no-ai`. Output goes under
  `aitd/localhost/runs/`.
- The MCP server in HTTP mode: `node src/cli.js mcp --http --port 8787 --token <16+ chars>`; the
  endpoint is `/mcp/<token>`. Without `--allow-private-network`, requests to private addresses
  must be refused.
- Each module is plain ESM with no build step, so a unit-level reproducer is
  `import { hostScope } from "./src/guard.js"` and a call.

## How we rate severity

- **Critical:** reading arbitrary files or executing code on the operator's machine from the
  audited website, from a model response or from an MCP HTTP request; using the HTTP server without
  the secret; SSRF from HTTP mode to cloud metadata or a private address without
  `--allow-private-network`.
- **High:** a page-content or model-driven escape of the host scope (navigating the browser to a
  host that is not the audited one or an allowed host, or a non-http scheme); redacted user data
  (emails, phones, names, addresses, user IDs, hashed matching values) reaching a stored file or an
  MCP result in plain text; API keys or tokens reaching the browser environment, a report or a
  saved site; XSS in the HTML report from page content; path traversal in report serving or the
  data folder; prototype pollution or code execution from a config, plan, container export or
  spreadsheet.
- **Medium:** learning the HTTP secret from logs or reports, or a measurable timing difference in
  its check; denial of service of the server or a run from a single hostile page (unbounded memory,
  catastrophic regex, a hang the idle timer does not clear); the body-size caps not holding.
- **Low:** denial of service that needs an operator-supplied file; information leaks limited to
  the operator's own machine; report content that is wrong but not exploitable.

Anything that is only reachable after the operator sets `--keep-bodies`,
`--allow-private-network` or `block_hits: false` is informational.

## Anything to leave alone

- Tracking requests are answered locally by default (`isCollectionEndpoint` in `src/parsers.js`),
  so test traffic never reaches real analytics accounts. This is intentional, not a hijack.
- The demo shop in `examples/` lacks CSRF protection, input validation and sane tracking on
  purpose. It only ever listens on localhost for the tests and the demo.
- The HTML report's script is inlined and hashed (`src/html/script.js`) so the report works as a
  single file opened from disk; the hash is a CSP measure, not a secret.
- Reports and plans are written under the operator's `aitd/` folder with predictable, time-based
  IDs by design; folders are never overwritten (`newId` in `src/workspace.js`).
- The tool has to run against a real site the operator owns. Findings of the form "the tool can be
  pointed at a site the operator is not authorised to test" are out of scope; SECURITY.md says so.

## Reports

Email the primary contact in the enrolment's `project.yaml`. A report is most useful with the
version tested, the module and function, a minimal reproducer (a test in the style of
`test/security.test.js` is ideal) and a patch that keeps `npm test` green. Please follow the
disclosure guidance in SECURITY.md: fixes ship as a patch release noted in CHANGELOG.md.
