# Changelog

## 0.7.0 (2026-10-12)

Fixes from the first audit run across 18 real shops.

- **GA4 hits with a `gaf` parameter were missed and sent to the real GA4 property** (since 0.6.2). Some sites send `gaf=2` on every normal hit, so `view_item`, `add_to_cart` and others were reported as missing, and the test visits reached the site's analytics. Only copies to `www.google.com` and `doubleclick.net` are now left out, whatever their parameters, and every GA4 request is answered locally again.
- More Google tag pings are answered locally instead of reaching the real accounts: Google Ads remarketing (`www.google.com/rmkt/collect`), Merchant Center (`merchant-center-analytics.goog/mc/collect`), the Google tag's `/g/s/collect`, and consent mode pings on any host, including Google tag gateway paths on the site's own domain (`/<id>/gs/ccm/collect`).
- One browsing step can no longer stall a run: a model call that doesn't answer within 3 minutes, or a browser action that doesn't finish within 2, ends the journey as incomplete with a note.
- **Saved sites and `replay`.** `run --save-site <dir>` also saves every response the site sent (as a Playwright HAR file per journey and viewport, without tracking requests, cookies sent or set, authorization headers, form bodies, or requests with user data in their address) and the steps taken. `replay <dir>...` audits those pages again offline, with no network and no AI model, and lists findings that are new or gone. It exits with code 1 when any changed; `--update` makes the new findings the expected ones. Steps the AI took by ref are saved as CSS paths, or as visible text inside iframes. Images, fonts and video are left out of the recording; when the browser closed early, there is no recording to clean instead of an error.

## 0.6.3 (2026-10-12)

- The audited site's own email address in a `mailto:` link or a link field (`link_url`, `link_text`, `gtm.elementUrl`, `gtm.elementText`), such as the contact link in a GTM `gtm.linkClick` push, is no longer reported as unhashed user data or redacted. An own-domain address anywhere else, and every named user data field (`email`, `user_data`, `em`, …), is still redacted and reported.

## 0.6.2 (2026-10-12)

Fixes from Bahadır's audit of analitikisler.com.

- GA4 resends (`gaf=1`, which gtag.js sends when it thinks the first send was lost) are not counted as hits on any host. Copies to `www.google.com` are labelled "Google Analytics (resend)" instead of "server-side".
- The duplicate check counts per page load (GA4's `_p`, or the page address). A step that opens a new page no longer adds the previous page's last `page_view` to the new one.
- A `page_view` sent while its page unloads is filed under the step that loaded that page, not the next step. A `page_view` for the page that is still open (for example GTM resending it after consent) stays in the step that sent it.
- dataLayer entries holding DOM elements or objects that refer to themselves (such as GTM click events) are kept, with the element shown as `<tag#id>` and only true cycles cut, instead of becoming "[object Object]".

## 0.6.1 (2026-10-12)

- GA4 events were reported as "sent 2 times" on sites with Google signals or ads features. gtag.js also sends a copy of those events to `www.google.com/g/collect` (or `doubleclick.net`), which GA4 doesn't count. Those copies are now still answered locally and listed under network requests, but no longer counted as hits. Requests to `analytics.google.com` still count: it is a primary GA4 endpoint.
- GA4 requests answered locally showed as "failed" in the network list, because Chromium reports answered keepalive requests as aborted. They now show the 204 the page received.
- Hits are read as each request is sent, rather than when it is answered. A request sent while the page navigates away is then still counted, even if it is cancelled before it can be answered. Requests the private-network guard stops are taken back out and shown as "blocked".

## 0.6.0 (2026-10-10)

- **Report v3.** The HTML report has four tabs: Overview, Findings, Journeys, and Scope and plan. They switch with the URL hash, so links work across tabs and every view can be shared. Still no scripts; printing shows everything.
  - Journeys show one journey at a time: a step list on the left and the selected step (with its Events, dataLayer and Network tabs) on the right. A journey opens on its first step with a problem.
  - Finding cards have a severity icon and color, the platform and how many journeys and steps they cover, an impact callout, numbered fix steps and "Where" chips that open the step.
  - Findings can be filtered by severity. Warnings are yellow and risks orange.
  - The Scope and plan tab has a plan coverage table (each planned event on each journey: sent, not sent, or not expected) and the providers table with request counts. It replaces the "Matching the plan" list.
  - Type sizes are 14, 12 and 24 px.
- **Logos.** The AI Tag Debugger logo is in the header, with "by Analitik İşler" on the right and the Analitik İşler logo and an open source credit line in the footer. Each has a dark version, and there is a favicon. They are embedded in the report, and the MCP report server's CSP now allows `img-src data:` for them. `--no-branding` leaves the Analitik İşler parts out.
- The AI is asked to mark numbers with `**…**` and names with backticks. The report shows those as bold and code and escapes everything else.
- The report's top line reads "AI tracking audit" ("Yapay zekâ ile izleme denetimi" in Turkish) instead of "Tracking QA report".

## 0.5.2 (2026-10-09)

First release on npm as `@analitikisler/ai-tag-debugger`. The test script now also runs on Node 20.

Fixes from the review of 0.5.1.

- Meta's newer advanced matching fields (`udff[em]`, `udff[ph]`, …) are redacted like `ud[…]`.
- dataLayer pushes are redacted too: email and phone fields, everything under `user_data` (including `gtag("set", "user_data", …)`), and email-like values. Page data with similar names, such as `page.city`, is kept. Unhashed user data in the dataLayer is reported as a warning: it is a valid setup for Google enhanced conversions, but every other tag on the page can read it. `--keep-bodies` keeps pushes as they were.
- Any value that looks like an email address is redacted, whatever its field is called (for example `ep.customer_email`).
- In bodies cut at the 32 KB limit, a value left open at the end is dropped, and numbers (such as a phone number sent as a number) are redacted by field name.

## 0.5.1 (2026-10-09)

Fixes from the review of 0.5.0.

- **User data for ad matching is redacted** before requests are stored or shown: emails, phone numbers, names, addresses and user ids in GA4 and Google Ads enhanced conversions, Meta advanced matching (`ud[*]`) and TikTok `context.user`, in URLs, POST bodies and hit parameters. Each value becomes `[redacted: N chars, looks hashed]` or `[redacted: N chars, plain]`, and plain values are reported as a personal data risk. `--keep-bodies` or `"keep_bodies": true` stores requests as sent.
- Stored request bodies are capped at 2 MB per journey on top of 32 KB per request. Requests past the limit say so in the report.
- Without `--providers`, the providers named in the measurement plan are added to the defaults. Plan platforms are compared in lower case, so `"GA4"` matches. Planned events for providers that were left out are listed in an info finding instead of disappearing.
- `report.md` escapes the report title and journey ids like the other fields.

## 0.5.0 (2026-10-09)

- **Report v2.** Every step has three tabs: Events, dataLayer and Network requests. They replace the per-event tabs and the "Other dataLayer pushes and network calls" box. Events and requests can be filtered by source (GA4, Google Ads, Meta, TikTok, …), with only the sources in the step offered. Still no scripts.
- Each event shows its parameters, consent, a Source box (the matched dataLayer push and the request with host, method and status) and, when a finding points at it, a note saying what is wrong.
- GA4 item strings (`pr1`…, including `k0`/`v0` custom item parameters) and dataLayer `ecommerce.items` are shown as item cards.
- Network requests are decoded into parameter tables with a `?` tip on each parameter (a GA4, Google Ads, Meta, TikTok and X glossary in English and Turkish). Event parameters come first; session, device, page and consent parameters are collapsed. The raw request is kept under "Raw request".
- GA4 batched POST bodies and TikTok JSON bodies are now recorded (up to 32 KB per request), so the Network tab shows every event in a batch.
- The AI summary is structured: a headline, a ranked list of issues with severity tags, and "Not in the findings list, but worth checking". Each explanation has an impact line and numbered fix steps. Findings are grouped by severity and are collapsible, and evidence is shown as a table. Older captures with a plain-text summary still render.
- **Choose the providers to check** with `--providers`, `"providers"` in the config, or `providers` on the MCP `start_audit` and `run_audit` tools (default GA4, Google Ads, Meta, TikTok). Requests to the others are still answered locally but are left out of the timeline, the CSV and the checks, and only counted. The report shows which providers were checked and how many requests were skipped, overall and per step. The MCP server asks the assistant to check with the user before starting.
- Basic X (Twitter) Pixel parsing: event name, pixel id, value and quantity.

## 0.4.9 (2026-10-09)

- The project moved to the `analitikisler` GitHub organization: the npm package is now `@analitikisler/ai-tag-debugger`, the repository is github.com/analitikisler/ai-tag-debugger, and `package.json` lists the repository, homepage, issue tracker and author.

## 0.4.8 (2026-10-09)

- Reports (HTML and Markdown, English and Turkish) end with a credit line, "Generated by AI Tag Debugger · analitikisler.com". The domain is a link with `rel="noopener noreferrer"`, and there are no images or tracking. `--no-branding`, `"branding": false` in the config, or `branding: false` on the MCP `finish_audit` and `run_audit` tools removes it together with the Analitik İşler logo.
- The README ends with a short pointer to the hosted version at analitikisler.com.

## 0.4.7 (2026-10-09)

- **Redesigned HTML report** in the Analitik İşler design system. Findings are cards linked to their step, there is a journey overview, and events are grouped by platform (GA4, Meta, Google Ads, TikTok, others). Each event has tabs for its parameters, its dataLayer push and its network calls. The report has no scripts, so it works under the report server's CSP and on phones down to 320px wide.
- dataLayer pushes are linked to events by name, including gtag.js array pushes and pixel aliases (Meta `AddToCart` to `add_to_cart`, `Contact`, `SubmitForm`, `Subscribe`, `StartTrial` and more). Duplicate hits are paired with their pushes in order, and finding links pick the right step when step labels repeat.

## 0.4.6 (2026-10-09)

- Fix: elements whose class merely contains "cmp" (such as Adobe AEM's `cmp-navigation` headers) no longer count as consent banners. Real consent tools are still recognized by name.

## 0.4.5 (2026-10-09)

- Cookie and consent banners (OneTrust, Cookiebot, Usercentrics, Didomi, CookieYes and fixed elements named cookie, consent, GDPR or KVKK) block clicks underneath even when they cover less than half the screen.
- Errors and notes that quote a covering element's text get the same untrusted-content treatment as the page view.
- Ad slots in `about:blank` iframes (`google_ads_iframe_*`, `aswift_*`) are skipped.

## 0.4.4 (2026-10-09)

Fixes from the review of 0.4.3's element finding and clicking.

- **No clicking through consent walls.** When something covers the element, the click is refused if the cover is a dialog, a modal, or covers at least half the screen, and the agent is told to deal with it first. Otherwise (a sticky header, a small badge), the agent clicks a part of the element nothing covers, with real mouse events. A synthetic click is only the last resort. Either way, the agent is told, and the report marks the step.
- **Exact text matches first.** Clicking by `text` tries exact matches before partial ones, only visible elements, in the order button, link, label, placeholder, then any text, on the main page before iframes. When several elements match, the agent is asked to use a ref instead of a guess being made.
- **Text reaches iframes.** Clicking by text also searches visible iframes.
- **Fewer, better iframes.** Hidden, tiny and ad, analytics or consent vendor iframes are skipped, so they don't use up the list or get clicked. "Not in view" for iframe elements accounts for the frame's position on the page.
- **Shadow DOM refs.** Old refs are cleared inside shadow roots too, so a stale element can't share a ref with a new one.
- Faster page views on big pages (the pointer-cursor scan only looks near the visible area). Fewer duplicates: `label[for]` is no longer listed separately, and the shadow-root parent check is fixed. "More elements not listed" only shows when visible elements were actually left out. A non-integer `ref` is rejected.

## 0.4.3 (2026-10-09)

The agent finds the buttons real sites build.

- **Custom controls are listed.** Besides links, buttons and form fields, the page view now includes controls built from divs and spans: role attributes, `tabindex`, and elements with a pointer cursor (such as a styled "Rezervasyon Yap" div with a JavaScript click handler). Labels also come from `aria-labelledby`, `<label for>`, image alt text and icon titles.
- **On-screen elements come first.** Elements that are actually visible at their position are listed before those out of view, and covered or clipped ones (collapsed mega menus, overlays) come last. A long menu can no longer push the button the agent needs out of the list. Up to 250 elements are listed, up from 150.
- **Iframes and shadow DOM.** Elements inside embedded frames (booking and payment widgets) and open shadow roots get refs too.
- **Click by visible text.** `browser_action` accepts `text` instead of `ref`, e.g. `text: "Rezervasyon Yap"`, matching a button or link name, a label, a placeholder, or any visible text.
- **More reliable clicks and scrolling.** A click blocked by a sticky header or overlay falls back to a direct click event. `scroll` takes `up` or `down`, and scrolls the window directly when the page ignores the mouse wheel.

## 0.4.2 (2026-10-09)

Follow-up hardening from the 0.4.1 re-review, for the HTTP MCP server.

- **DNS rebinding.** When private addresses are blocked (`mcp --http`), all browser traffic goes through a small local proxy (`src/egress.js`). It resolves each host once, refuses private addresses, and connects to exactly the address it checked, so Chromium never resolves hosts itself.
- **WebSockets.** `ws://` and `wss://` connections go through the same proxy, so the private-address block applies to them too. Non-proxied WebRTC UDP is turned off in this mode.
- **IPv6 forms of private IPv4 addresses** (NAT64 `64:ff9b::/96`, 6to4 `2002::/16`, IPv4-compatible `::a.b.c.d`, hex-form IPv4-mapped) count as private, and Teredo addresses are refused.
- README: the prompt-injection line no longer promises more than a prompt rule can, and hosted setups are advised to block private ranges at the network level as well.

## 0.4.1 (2026-10-09)

Security and robustness fixes from the first full code and security review, before the first public release.

- **Navigation limits.** The audit browser now opens only `http` and `https` pages and stays on the audited site and its subdomains. Other hosts can be allowed with `allowed_hosts` in the config, `--allow-host`, or `allowed_hosts` on the MCP `start_audit` tool. Redirects and links that leave the site are blocked and the browser goes back.
- **Private addresses blocked over HTTP.** In `mcp --http` mode, audits refuse `localhost`, private, link-local and similar addresses, for the start page, navigations and every request. `--allow-private-network` turns this off.
- **Page content is untrusted.** The page view the model sees is wrapped in `<page_content>` tags, and the prompts say that this content is data, never instructions.
- **No secrets in the browser.** Chromium starts without API keys, tokens and other secrets in its environment.
- **MCP HTTP hardening.** Request bodies are limited to 1 MB, `--token` needs at least 16 characters, the secret is compared in constant time, binding to a non-loopback host prints a warning, and reports are served with security headers.
- **Abandoned audits close.** MCP audits idle for 15 minutes are closed, and per-audit logs are capped.
- **More beacons answered locally.** Google Ads remarketing (`viewthroughconversion`, `1p-user-list`, `ccm/collect`, `td.doubleclick.net`), Meta privacy sandbox, Microsoft Ads, LinkedIn, Pinterest, Snapchat and X pixels no longer reach real accounts during audits.
- **Fixes.** A malformed `%` in a tracking URL no longer crashes the checks. An unknown viewport no longer leaks a browser. The Gemini key is read from the injected environment.
- **Report safety.** CSV cells that start with `=`, `+`, `-` or `@` are prefixed so spreadsheets don't run them as formulas, and `report.md` escapes HTML in page-controlled values.
- **Reproducible installs.** `package-lock.json` is committed and Playwright is pinned to 1.56.1. The CI example pins a released npm version, installs the matching browser, sets `permissions: contents: read` and passes one API key. The repository has its own test workflow.
- The demo shop server listens on `127.0.0.1` only and checks paths correctly.

## 0.4.0

First complete version: CLI and MCP server, Anthropic, OpenAI, Gemini and OpenAI-compatible providers, ready-made journeys, Turkish reports, full event timeline and CSV.
