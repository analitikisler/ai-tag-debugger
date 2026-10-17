# Changelog

## 0.15.0 (unreleased)

- The first run learns the plan. When a site has no saved plan, `aitd run` lists the events it already sends and asks whether to save them as its plan. Add `--yes` to save without asking; in a script without `--yes`, nothing is saved.
- With `--against`, the report header says how the plan changed since the version before it: `Plan changed since <id>: 1 added, 0 removed, 2 changed`, or `Plan unchanged since <id>`. Each change is listed. `capture.json` has the same comparison under `planChanges`.
- `aitd plan import` reads Google Sheets downloads: the events CSV with its `<Doc> - user_properties.csv` beside it, and checkboxes as yes and no (TRUE and FALSE).
- Consent scenarios: each audit opens the start page once per consent choice (accept all, reject all, analytics only) and shows the hits each tag sent after each choice. Analytics only works with OneTrust and Cookiebot. Set `"consent_scenarios": false` in the config to turn them off.
- Tag inventory: the report lists every vendor the site sent requests to, first or third party, the pages it was seen on, and its cookie names (never values). Each network call in `capture.json` now has a `pageUrl`, redacted unless `keep_bodies` is on.

## 0.14.0 (2026-10-17)

- The MCP server has a `what_changed` tool that returns only the "since last run" diff for a site: what was fixed and what is new, without browsing or an AI.
- Alerts: `notify` in the config sends the "Changed since last run" diff to Slack and/or email (`SMTP_URL`) after each saved run.
- Scheduled runs: GitHub Actions and cron templates in `examples/` keep the run history between runs, so "Changed since last run" works on a fresh runner.
- Repeat runs start from the route the last completed run took, so the AI goes straight to the goal. Only for the same goal, and only for AI runs.
- `--model cheap` picks a small, inexpensive model for each provider, for routine CI runs.
- Cloudflare Workers AI is a built-in provider, set with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## 0.13.0 (2026-10-17)

- Each journey step has a **Timeline** tab: every dataLayer push, the GTM event it raised (or the consent command), then the platform hits it caused. Hits with no push are listed last.
- Findings are grouped by who fixes them (Developer, Tag Manager, Marketing). Each one has a **How to verify** list linking to the tool that shows the fix: Tag Assistant, GA4 DebugView, Meta Test Events, TikTok Pixel Helper or the Consent Mode guide.
- When the AI took a different route through the site than in the last run, the report header names the journeys, and the Changed since last run section lists the pages before and after.
- Platforms are detected automatically: a platform the site sends to is checked from its first request. No flag needed. Choosing platforms with `--platforms` or `providers` turns detection off.
- New platforms: LinkedIn Insight Tag, Microsoft Advertising UET and Criteo OneTag (events are read); Adobe Analytics, Matomo and Piwik PRO (page views, links, goals, site search and ecommerce orders); Microsoft Clarity and Hotjar tag loads, which name the project or site id.

## 0.12.0 (2026-10-16)

- The HTML report uses the Analitik İşler design system and the new ai tag debugger logo. The large title is now a compact `Site: example.com` line.
- Overview has a "This run" card: platforms checked, AI provider and model (or off), plan, journeys, viewports, language and version.
- Platforms show their icons instead of colored squares, in findings, events, steps and tables.
- Each journey opens with a Consent card: the Consent Mode default and every update, one tile per signal, granted or denied.
- Fix: no "not in the measurement plan" finding when no plan is attached.
- Fix: the server-side note only mentions Meta and TikTok when they were checked.
- Fix: no "Run without --no-ai" text on AI runs or on info findings.
- Fix: switching tabs no longer shifts the page sideways.

## 0.11.3 (2026-10-16)

- `aitd` and `aitd --help` end with the AI a run would use: `AI: anthropic (claude-opus-5-5) via Cloudflare AI Gateway · also set: gemini (pick with --provider)`, or `AI: no key set`. The first line of a run names the other keys too.
- Vercel AI Gateway: set `AI_GATEWAY_API_KEY` and pick any model it offers with `--model <provider>/<model>`, e.g. `google/gemini-3.6-flash`. The default is `anthropic/claude-opus-5.5`.

## 0.11.2 (2026-10-16)

- Fix sentence requests (`aitd "check my GA tags"`) failing with a 400 "Invalid schema" error from the Anthropic API. The request schema now writes optional values in a form Anthropic, OpenAI and Gemini all accept.
- When `AI_GATEWAY_URL` is set, the first line of a run says so: `Using anthropic (claude-opus-5-5) via Cloudflare AI Gateway`.

## 0.11.1 (2026-10-16)

- Set `AI_GATEWAY_URL` (and `AI_GATEWAY_TOKEN` if the gateway has authentication on) to send Anthropic, OpenAI and Gemini calls through Cloudflare AI Gateway, for logs and cost tracking. Unset, nothing changes.

## 0.11.0 (2026-10-16)

- Every saved run is compared with the site's previous run. The report opens with a "Changed since last run" section (`2 events fixed, 1 new problem`) that lists what was fixed and what is new, by plan coverage when both runs used `--against` and by health findings otherwise. The first run says there is nothing to compare yet. No new flag; the result is also in `capture.json` under `changes`.
- A plain sentence can be a request: `aitd "check my GA tags"`. The sentence becomes a fixed command through the AI provider, or a keyword matcher when no key is set. aitd prints the command and asks before running it; `-y` skips the question. An unclear sentence gets one short question back. A sentence that names no journey, goal or plan asks what to test, and suggests the site's latest plan when it has one.
- `aitd plan --topic <name>` limits a plan to one kind of event: `custom-events`, `ecommerce`, `forms` or `consent`. Sentences such as "what custom events does my site need" use it.
- The MCP server has a `make_plan` tool that drafts a tracking plan for a site, with an optional topic. Chat apps use it when a user asks what a site should track, and `run_audit` or `finish_audit` checks the audit against the plan.

## 0.10.0 (2026-10-16)

- Plan, then audit. `aitd plan --site <url>` drafts a measurement plan in its own folder, `aitd/<domain>/plans/<id>/`: the events a site should send, with a description, the page and element that trigger each one, its parameters (custom ones marked) with example values, and suggested user properties. Events the site already sends are marked `seen`. It browses one page of each type (home, a category, a product, cart, first checkout step, search, sign-up and contact forms) without paying or submitting personal details, and prints the page types it found and the ones the site doesn't have.
- `aitd run --against <plan>` checks a run against a plan. `<plan>` is `latest`, `first`, a plan ID or a path to a plan file or folder; with `--against` alone the journeys are derived from the plan's trigger pages (at most six), and with `--journey` or `--goal` only the events expected on that flow are checked. The run records the plan ID in its report. The same option works on the `run_audit` and `finish_audit` MCP tools.
- The report has a "Plan vs. site" section for runs with `--against`, at the top of `report.html` and `report.md`, with a coverage score (`Coverage 7 of 11 (64%), 2 events not checked`). Each planned event is marked Implemented, Missing, Missing params, Wrong values, or Not checked, and unplanned events are listed. The same results are written to `plan-check.json`. Without a plan the report is unchanged.
- Each plan folder has a `plan.html` page showing its events, parameters, user properties and the consent-mode flag.
- `aitd plan list --site <url>` lists the plan IDs for a site. `aitd plan export <plan> --site <url>` writes a plan to `plan.xlsx` (or `events.csv` and `user_properties.csv` with `--format csv`), and `aitd plan import <file> --site <url>` saves an edited spreadsheet as a new plan. Import never changes an existing plan; errors name the tab, row and fix.
- Runs are saved in `aitd/<domain>/runs/<id>/` (report, timeline, capture and plan check) with IDs in local time. `--data-dir <dir>` moves the `aitd/` folder; it replaces `run --out`, which still works as a hidden alias for one minor version.
- The help is redesigned: a short `aitd --help` with the commands and three examples, and one help text per command that lists the essential options first. `--no-ai` now implies `--scripted`, and the missing-key error names the environment variables to set.
- `aitd plan --site` prints the page types it found, and `aitd run` without `--journey`, `--goal`, `--against` or journeys in the `--config` file stops before the browser or the model starts, so a run can't wander and spend API usage.
- Fixed: `npm test` no longer keeps running for about 15 minutes after the MCP tests. A refused `finish_audit` now says the audit is still open and to call it again.

**Breaking changes**

- The default output folder is now `./aitd`. Runs and plans are no longer written to `reports/`.
- `aitd plan --from` is removed. Draft a plan with `aitd plan --site <url>` instead.
- `plan --out` and `plan --force` are removed. Each plan is saved in a new folder, so nothing is replaced.
- `run --out` is replaced by `--data-dir <dir>`.
- `--providers` is renamed `--platforms`. The old name still works for one minor version and prints a note.

## 0.9.0 (2026-10-15)

- `aitd run ... --save-steps <file>` writes the steps each journey took into `journeys[].steps` of that config file (creating it if needed, and adding the run's plan when the config has none). A later `aitd run --config <file> --scripted --no-ai` repeats them with no AI model or API key. A journey run on several viewports keeps the steps of its first viewport.
- New purchase checks: a purchase sent with a value that is 0, negative or not a number (`purchase_value_invalid`), a currency that isn't a 3-letter ISO code such as USD (`purchase_currency_invalid`), or no items (`purchase_items_empty`). GA4 and Meta reporting the same order with a different value or currency is flagged as `purchase_mismatch`; purchases are paired by order ID, or taken as one order when the journey has a single purchase on each.

## 0.8.2 (2026-10-15)

- A journey that fails with an error, such as the AI provider's API refusing a request or the browser crashing, no longer ends the whole audit. That journey is marked unfinished with the error as its note, what it captured until then is kept, the other journeys still run, and the report is written. This applies to the CLI and to `run_audit` over MCP.
- A Consent Mode default pushed after the first Google hit is now reported as late (`consent_default_late`) when both happen on the same step, such as the start page. The check used to compare only step numbers, so it missed this. Only Google hits count, since Consent Mode only governs Google tags.
- An unknown viewport, given with `--viewport` or in the config's `viewports`, now stops the audit at once with a message listing the allowed values (desktop, mobile). Before, it failed only when the browser started for that journey, after the model was set up and earlier journeys had run.
- `ai-tag-debugger --version` (or `aitd -v`) prints the installed version.
- New short command `aitd`, an alias for `ai-tag-debugger` installed alongside it.
- For contributors: `npm run setup` checks the Node version, installs the dependencies and Chromium, and says whether an AI provider key is set. A dev container (`.devcontainer/devcontainer.json`) runs it, so VS Code and Codespaces open the repository ready to run.

## 0.8.1 (2026-10-15)

- A run with no AI provider key set now stops at once with a message naming the keys to set and the `--scripted --no-ai` option, instead of starting the browser and failing at the first step with the SDK's "Could not resolve authentication method".
- Over MCP, `run_audit` with `scripted: false` and no key returns an error that tells the chat app what to do next: call it again with `scripted: true`, or browse with `start_audit`. It doesn't mention CLI flags.
- The README points to `ai-tag-debugger --help` for the full list of commands and options.
- `npm run demo` replays the demo shop with no AI model (`--no-ai`), so it works without an API key.

## 0.8.0 (2026-10-14)

- The browser installs itself the first time an audit starts, so connecting the MCP server no longer needs a separate `playwright install` step. Progress goes to stderr.
- Listed in the official MCP Registry as `io.github.analitikisler/ai-tag-debugger` (`mcpName` in package.json, `server.json`).
- The README has one-line and one-click setup for Claude Code, Cursor and VS Code.
- The MCP server reports its real version instead of a fixed 0.6.3.

## 0.7.9 (2026-10-14)

- A planned event is found under the name the site uses: `dl_add_to_cart` (Elevar), `addToCart` and `Add To Cart` all count as `add_to_cart`, and similar variants of the other ecommerce events too. Sites like these no longer get a false "missing add_to_cart". A plan event can list more names in `aliases`.
- A required parameter is also found under its usual other name (`products` for `items`, `revenue` for `value`, `order_id` for `transaction_id`).
- The plan coverage table in the report uses the same matching.
- Server-side tagging is recognised where the browser can see it. A GA4 hit to a server container (server-side GTM, Stape, Elevar) is marked server-side, a hit through Google tag gateway (`/g/c`) is not, and requests to Stape and Elevar hosts show in the timeline. An info finding lists, per platform, which events went server-side and which went from the browser. The report tags server-side events.
- Meta (`eid`) and TikTok (`event_id`) event IDs are read from the browser hit. The duplicate check no longer flags hits that repeat one event ID, since the platform counts those once.
- New info finding when a server-side setup is seen and a Meta or TikTok browser event has no event ID, so the platform can't match it to its server copy. Meta Conversions API and TikTok Events API requests themselves are sent server to server and can't be seen from the browser.
- New parsers for the Pinterest tag, Snap Pixel, Klaviyo onsite events and Hotjar API calls. Pinterest, Snap and Klaviyo hits show their event name, id, value fields and, when present, the hashed or plain user data they send (redacted like Meta's). Hotjar shows the site id.
- A Meta hit now shows `event_id` (`eid`), the value a Conversions API copy must repeat to be deduplicated, and its advanced matching fields (`ud[...]`).
- Klaviyo is a selectable provider.
- Consent Mode v2: the report flags a default that leaves out `ad_user_data` or `ad_personalization`, and an accept whose update does not grant them.
- New `decline_cookies` journey (also `decline`, `reject`): the AI rejects all cookies, browses on, and the report checks that nothing is sent afterwards. It flags ad pixels and Google hits that claim consent after the reject, a Consent Mode update that grants consent after it, and a banner that is still showing after the reject click. Clicks carry `rejects_consent`, like `accepts_consent` for accepting; replays keep it.
- Tracking cookies (`_ga`, `_fbp`, `_gcl_*`, `_ttp` and similar) are noted with the step that set them, by name only. Ones set before the visitor chose, or after they rejected, are flagged.
- More consent platforms are recognized as banners that block a click (Osano, Iubenda, Complianz, CookieFirst, Axeptio, Sourcepoint, TrustArc, Borlabs, Klaro, Termly and others) and as consent requests in the timeline (Didomi, Quantcast, TrustArc, Sourcepoint, Iubenda, Termly and others).

## 0.7.8 (2026-10-14)

- Unnamed TikTok pings are left out of the duplicate check. TikTok sends them on its own timing, so their count changed between a save and its replay without the site changing.
- A replay skips a malformed address in a recording instead of stopping, and reads the recording once.

## 0.7.7 (2026-10-14)

- A replay answers a request from the recording when the address only differs by a timestamp (`_=1791977697130`, `ts`, `timestamp`, `cb`, `nocache`). Magento sites reload the basket this way after "add to basket", so the replay never got the answer that makes the page send `add_to_cart`. Exact matches still come from the recording as before.
- A click found without a saved path no longer keeps its text when it looks like an email address or phone number.

## 0.7.6 (2026-10-14)

- `replay` says when a saved click was found by its text rather than its saved place (`~` lines), since that may not be the element that was saved.
- Only clicks fall back to their text. Typing into a field or choosing an option uses its saved place only.
- A click's text is not saved when it looks like an email address or phone number.

## 0.7.5 (2026-10-14)

- A saved click keeps the element's text as well as its path through the page. When a replay finds nothing visible at that path (a banner or overlay shifted the layout), it clicks the element with that text instead. Sites saved before 0.7.5 have no text to fall back on; save them again to use it.

## 0.7.4 (2026-10-14)

- Saving a site no longer fails on pages that keep a request open after they are left (a GA4 hit to `www.google.com/g/collect`, for example). The recording waited for it until the 30-second limit and was then skipped, so the site was not saved. The browser's pages are now closed before the recording is written.
- Fewer test hits from popups reach the real account while a recording is written.

## 0.7.3 (2026-10-13)

- `replay` no longer crashes with `NavigationAbortedError: net::ERR_BLOCKED_BY_CLIENT` when a saved page redirects to another site. The redirect is refused again, so the journey stays unfinished as it was saved, and the other sites are still replayed.
- Tracking hits sent while the browser closes are answered locally again on normal runs. In 0.7.2 the routes were removed before closing, so a hit sent at that moment could reach the real account. They are now removed only on `replay`, which never goes online.

## 0.7.2 (2026-10-13)

- **GA4 and Google Ads hits sent through Google tag gateway are captured.** Sites using the gateway send GA4 to a short path on their own domain (`/<prefix>/ag/g/c`, `/<prefix>/ga/g/c`) and Google Ads to `/<prefix>/as/p/c/<id>/`. These were neither recognized nor answered locally, so their events were reported as missing and the audit's visits reached the site's real accounts. A `/g/c` path counts as GA4 only with a GA4 measurement id (`tid=G-…`).
- Google Tag Manager and gtag.js loaded from the site's own domain are labelled as such in the network timeline.
- Two more Google pings are answered locally instead of reaching Google: `www.google.com/measurement/conversion` and `google.<tld>/ads/ga-audiences`.
- Saved sites also leave out cookies named like a login or token (`auth_token`, `sid`, `csrftoken`, …) and cookies holding an email address, even when they aren't HttpOnly.
- Writing a saved site's recording can no longer stall a run: the page is left first, so what it is still loading is cancelled, and after 30 seconds the recording is skipped (the site is then not saved). The log says when the recording is being written. Reading the browser's cookies at the end of a journey has a time limit too.
- `replay` no longer crashes with "Target page, context or browser has been closed" when a request is still being answered as the browser closes.
- A saved journey whose start page could not be opened (a redirect to another site, a bot check) can be replayed; it stays unfinished with its saved note.
- When a site can't be saved, a `site.json` from an earlier save is removed so it can't be replayed against the new recordings, and `run` exits with code 1.

## 0.7.1 (2026-10-13)

- A page whose script stops responding after a step can no longer stall a run. Reading the page now has a 1 minute limit too, and when it runs out the journey ends as incomplete with a note. Before, only the model call and the browser action itself had a limit.
- When a saved site's recording can't be cleaned, a warning now says so before the file is deleted.

Replays of saved sites are closer to the saved run, after the first save of 18 real shops:

- Scripted runs, and so replays, wait 3 seconds after the last step, so tags that send a moment after the last click (GA4 batches events) are captured as in an AI run.
- A step that failed in the saved run is tried again on replay without ending the journey there.
- A journey the AI could not finish (no cart, a bot check) stays unfinished on replay, so its missing events are not reported as broken.
- Cookies the server sets for the page's scripts, such as a country, are kept in the recording; HttpOnly cookies, where sessions and logins live, are still left out. Some sites don't render without them, for example a cookie banner that never appears.
- Images, fonts and video left out of the recording get an empty answer on replay instead of failing, since a failed image can stop a script.
- Requests that had no answer yet when the browser closed are left out of the recording. On replay they made the page that asked for them again never finish loading.
- A site whose recording is missing (the browser closed early) is not saved, and `replay` reports a saved site it can't replay and goes on with the next one instead of stopping.

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
