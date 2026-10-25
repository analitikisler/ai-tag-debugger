# Contributing

`ai-tag-debugger` is a Node CLI and MCP server. There is no build step: the files in `src/` are what runs. This page says how to set up, where things live, and how to add the pieces people most often add. [README.md](README.md) is the user manual; read it first.

## Setting up

Requires Node 20 or newer (CI tests on 20 and 22).

```bash
git clone https://github.com/analitikisler/ai-tag-debugger.git
cd ai-tag-debugger
npm run setup   # checks Node, runs npm ci, installs Chromium, says whether an AI key is set
npm test        # every test file: node --test test/*.test.js
```

Run one test file with the Node test runner directly:

```bash
node --test test/parsers.test.js
```

The tests need no API key. The end-to-end tests drive a real Chromium against the demo shop with fake model clients: `test/agent.test.js` uses a fake Anthropic client, `test/providers.test.js` fake OpenAI and Gemini clients, and `test/mcp.test.js` an in-memory MCP client. They start `examples/serve.js` themselves on their own ports.

The demo shop has three deliberate tracking bugs. To see a run end to end:

```bash
npm run demo:serve   # one terminal: the shop on http://localhost:4321
npm run demo         # another: a scripted run with no AI model, saved under aitd/localhost/runs/
```

`npm run demo` is `node src/cli.js run --config examples/demo.config.json --scripted --no-ai`. With an API key set, drop `--scripted --no-ai` to let a model browse instead.

There is a dev container in `.devcontainer/devcontainer.json`. Open the repository in VS Code with the Dev Containers extension or in GitHub Codespaces: it runs `npm run setup -- --with-deps`, which also installs Chromium's system libraries, and forwards port 4321 for the demo shop. API keys are not set there; add one as a Codespaces secret or export it in the container's terminal.

## Project layout

One module per concern in `src/`, in the order a run goes through them.

**Plan and journeys**

- `discover.js`: drafts a measurement plan by exploring one page of each type (`discoverPlan`, `TOPICS`, `PAGE_TYPES`).
- `journeys.js`: the ready-made journeys (`JOURNEY_PRESETS`), their expected events, and `journeysFromPlan`, which derives up to `MAX_PLAN_JOURNEYS` journeys from a plan.
- `learn.js`: `learnPlan`, a plan built from the events a site already sends.
- `plan.js` and `plan-html.js`: save a plan folder (`savePlan`) and render its `plan.html`.
- `sheet.js`: plan import and export as `.xlsx` (through the optional `fflate`) or CSV.
- `campaign.js`: the UTM and click-id parameters a run puts on the landing address.

**Browse**

- `agent.js`: the agent loop. `SYSTEM_PROMPT`, the `TOOLS` the model calls (`browser_action`, `finish`), `pageView` (the page as the model sees it, wrapped as untrusted data), `runAgentJourney` and `runScriptedJourney`.
- `browser.js`: `AuditSession`, the Playwright session that drives Chromium, records hits, dataLayer pushes, cookies and network calls, answers tracking requests locally and enforces the navigation limits. Also `browserEnv` and `VIEWPORTS`.
- `guard.js`: where the browser may go. `hostScope`, `isPrivateAddress`, `privateHostChecker`, `navigationError`.
- `egress.js`: `startEgressProxy`, the local proxy all browser traffic goes through when private addresses are blocked.
- `providers.js`: the AI providers behind one contract (see [How to add an AI provider](#how-to-add-an-ai-provider)).

**Capture**

- `parsers.js`: turns requests into normalized hits. `VENDORS`, the parsers, `parseTrackingRequest`, `isCollectionEndpoint`, `providerOf`, `vendorOf`, `resolveProviders`.
- `redact.js`: replaces user data sent for ad matching with a marker before anything is stored (`redactUrl`, `redactBody`, `redactParams`, `redactPush`).
- `consent.js`: the consent scenarios, one fresh browser per consent choice, and the table the report shows.
- `inventory.js`: `buildInventory`, the tag inventory (vendors, party, pages, cookie names).
- `gtm.js`: reads a GTM container export to name the tag and trigger behind a hit.

**Check**

- `checks.js`: the deterministic rules. `checkRun` emits findings, `planCheck` sorts planned events into buckets, `summarize` and `groupFindings` shape them for the reports.
- `verify.js`: who fixes a finding (`ownerOf`) and the tools to verify the fix in (`verifyLinks`).
- `changes.js`: the comparison with the site's previous run and plan (`compareRuns`, `comparePlans`, `sinceLastRun`, `routeHints`).

**Explain and report**

- `report.js`: `explainFindings` (the one model call that writes causes and fixes), `renderMarkdown`, `renderCsv`, and the exports every caller imports (`renderHtml`, `VERSION`, `escapeHtml`, `platformLabel`, `verdictHeadline`).
- `report-shared.js`: what the Markdown and HTML renderers share (grouped findings, platform names and order, the verdict sentence), so neither imports the other.
- `html/`: the HTML report. `legacy.js` is the 0.17 renderer `report.js` exports today; `shell.js` is the new one (top bar, rail, footer) with one module per section (`summary.js`, `findings.js`, `journeys.js`, `consent.js`, `scope.js`), and `lib.js`, `css.js` and `script.js` hold their helpers, stylesheet and inline script.
- `i18n.js`: every user-visible string, in `LANGUAGES`.
- `glossary.js`: what each request parameter means, for the `?` tips in the Network tab.
- `brand.js` and `whitelabel.js`: the embedded logos (written by `node scripts/brand.js` from `brand/ai/assets/`; the brand guide is `brand/ai/BRAND.md`), and the `report` setting (name, logo, color, PDF).

**After the run**

- `audit.js`: `runAudit`, the whole thing from a config: journeys, checks, explanation, reports, alerts. Shared by the CLI and the MCP `run_audit` tool.
- `workspace.js`: the `aitd/<domain>/plans/<id>` and `runs/<id>` folders, IDs, and `resolvePlan` for `--against`.
- `notify.js`: Slack and email alerts with the "since last run" diff.
- `replay.js`: saved sites, replayed offline to compare a new version of the tool against known findings.

**Entry points**

- `cli.js` and `help.js`: the `aitd` command and its help text.
- `ask.js`: turns a plain sentence into an `aitd` command.
- `mcp.js`: the MCP server over stdio or HTTP.

## How to add a tracking vendor

Everything is in `src/parsers.js`.

1. Write `parseX(url, postData)`. It returns an array of hits, or `null` when the request is not for that vendor. One request can carry several events (a batched GA4 POST does). A hit is `{ platform, name, params, url }` plus, when known, `id` (the tag or pixel id), `eventId` (for deduplication with a server-side copy), `delivery` (`"browser"` or `"server"`), `consent` and `userFields` (the raw user-data fields, so `redact.js` can replace them). Map the vendor's parameter names to the common ones the checks read: `value`, `currency`, `transaction_id`, `items`, `event_id`.
2. Add an entry to `VENDORS`: `{ key, label, hosts, parse }`. `key` is the id users pass to `--platforms` and write in a plan, `label` is the display name, `hosts` is a regex over the request hostname. Add `path` when the tracker has to be told apart by its path on a first-party or shared host (Piwik PRO has no `hosts` at all). Leave `parse` out for a vendor whose requests are only counted, like DoubleClick.
3. Decide what is answered locally. `isCollectionEndpoint` returns true for any request a parser recognizes, so those hits never reach the real account; beacons that are not parsed into hits (remarketing pings and similar) go in `OTHER_BEACONS`.
4. Give it an icon and a place: `PLATFORM_ART` in `src/html/lib.js` holds each platform's icon (a platform without one shows its initials), the 0.17 report's `CSS` in `src/html/legacy.js` has one `.dot.p-<key>,.ptag.p-<key>::before` rule per platform, and `PLATFORM_ORDER` in `src/report-shared.js` sets the order in tables.
5. Tests: a parsing test in `test/parsers.test.js` with a real request URL (and body, if the vendor POSTs), and a case in `test/vendors.test.js`, which also checks that every `VENDORS` entry has a label and that its hosts map back to it through `providerOf`.
6. Docs: the "Platforms:" paragraph and the list under "Choose the platforms to check" in README.md, the same places in README.tr.md, and a CHANGELOG line.

## How to add a check

`checkRun(plan, run, { lang })` in `src/checks.js` returns an array of findings. Each one is:

```js
{ journey, viewport, severity, check, platform, event, step, detail, evidence }
```

`severity` is `broken`, `risk`, `warning`, `info` or `ok`. `check` is a stable snake_case name (`missing_event`, `duplicate`, `before_consent`, …) that the report, `verify.js` and the replay comparison key on. `platform`, `event`, `step` and `evidence` are set when they apply; `detail` is the sentence the report shows and always comes from `messages(lang).detail`.

1. Add the rule to `checkRun`, after the related ones. Report each problem once (the existing checks keep a `Set` of what they already reported).
2. Add the `detail` function to the `detail` block of both `en` and `tr` in `src/i18n.js`. Both languages have every key; a missing one throws at run time.
3. In `src/verify.js`, add the check to `OWNER_BY_CHECK` unless its owner is the default (`gtm`), and extend `verifyLinks` when a tool other than the platform's default ones shows the fix.
4. A check that reports a wrong value on a planned event goes in `WRONG_VALUE_CHECKS` in `checks.js`, so `planCheck` puts the event in the "Wrong values" bucket.
5. Test it in `test/checks.test.js`, which has `plan`, `run()` and `hit()` helpers; assert on `severity:check:event` and, for the detail text, on both languages.
6. Add a row to "What it checks" in README.md (and README.tr.md) and a CHANGELOG line.

## How to add a report language

Copy the `en` block in `src/i18n.js`, translate every string and function, and add it to `LANGUAGES` (`{ en, tr }` today). The CLI help, `--lang`, the config `language` field and the MCP `language` parameter all read their options from `LANGUAGES`, so nothing else needs editing. Set `name` to the language's own name: the agent is told to write its step notes in `messages(lang).name` when the language is not English. `test/checks.test.js` and `test/report.test.js` show how the Turkish strings are tested.

## How to add an AI provider

The contract, from the header of `src/providers.js`: every provider is an object with

```
conversation({ system, tools, firstMessage }) -> { next(), addToolResults(results), addUserText(text) }
  next() returns { toolCalls: [{ id, name, input }], stop: "tool_use" | "end" | "refusal" | "max_tokens" }
json({ system, texts, schema }) -> { value } or { error }
```

`conversation` drives the browsing loop in `agent.js`; `json` is the structured call behind `explainFindings`, `discoverPlan` and `ask.js`. Tools arrive as `{ name, description, schema }` with a JSON Schema; the adapter converts them to the SDK's shape.

1. Write an adapter function like `anthropicProvider`, `openaiProvider` or `geminiProvider`, and wire it in `buildProvider` (or `builtInProvider` for a provider that can go through Cloudflare AI Gateway). Many APIs speak the OpenAI protocol; if yours does, a `PROVIDERS` entry that reuses `openaiProvider` with a base URL is enough, as `vercel` and `cloudflare` do.
2. Add the `PROVIDERS` entry: `{ label, env, defaultModel, cheapModel }`. `env` is the key variable, `cheapModel` is what `--model cheap` picks. Add the key variable to `hasApiKey` and to the detection order in `resolveProviderName`, and to `KEY_VARS` in `scripts/setup.js`, which cannot import `providers.js` and is kept in step by `test/setup.test.js`.
3. Test it in `test/providers.test.js` with a fake client passed as `createProvider({ name, client })`, the way the OpenAI and Gemini tests do: the fake answers the agent's tool calls against the demo shop, so the whole loop runs without a key.
4. Add it to the AI providers table in README.md and README.tr.md, and a CHANGELOG line.

## How to add an MCP tool

Tools are registered in `buildServer` in `src/mcp.js` with `server.registerTool(name, { title, description, inputSchema, annotations }, handler)`. `inputSchema` is a plain object of zod fields with `.describe()` on each; the description is what the chat app's model reads, so say what the tool is for and when to use another one instead. The handler returns `text(...)` or, for an error the model should see, `fail(...)`. Tools that read files or run a config belong inside the `if (opts.allowFiles)` block, so they are not offered over HTTP. Add the tool to the list `test/mcp.test.js` asserts in its first test, test it through the in-memory client there, and add a row to the tools table in README.md and README.tr.md.

## Conventions

- Plain ESM JavaScript, Node 20+, no build step, no TypeScript. Dependencies are the official SDKs, Playwright (pinned to an exact version, which README's install commands repeat), zod and the MCP SDK; a new one needs a reason.
- Tests use `node:test` and `node:assert/strict`. A new test file starts with a one-line comment saying what it covers, as most existing ones do.
- Comments explain why, not what. A regex or a workaround gets a line saying which site or SDK behavior it exists for.
- Every user-visible string goes through `src/i18n.js`, in every language in `LANGUAGES`.
- Every option is documented in README's tables: "All options" for flags, the config table for config fields, the MCP tools table for tool parameters. README.tr.md gets the same change.
- Every user-visible change gets a CHANGELOG line under the version it ships in. Entries are one sentence each, in the README's voice.
- `server.json` must say the same version as `package.json`, in `version` and in `packages[0].version`, and its description must stay within 100 characters; `test/server-json.test.js` fails otherwise.
- Commit messages are one imperative sentence saying what changed for the user.

## Releasing

1. Bump `version` in `package.json` (and `package-lock.json` through `npm install`), and both version fields in `server.json`.
2. Add the `## x.y.z (date)` section at the top of CHANGELOG.md with the lines collected for it. Update the version in README's Playwright install commands if Playwright changed.
3. Run `npm test`, then merge to `main` with a commit such as `Release 0.16.0`.
4. `.github/workflows/publish.yml` runs on every push to `main` that touches `package.json` (or by hand from the Actions tab). Its `check` job looks the version up on npm and stops if it is already there; otherwise `test` runs `npm ci`, installs Chromium and runs `npm test` on Node 22, and `publish` publishes with npm trusted publishing (OIDC, no stored token) from the `npm` environment with `npm publish --access public`.
5. The MCP Registry is updated by hand: once the version is on npm, run `.github/workflows/publish-mcp-registry.yml` from the Actions tab. It checks that `server.json`'s package version exists on npm, then signs in to the registry with GitHub OIDC and publishes `server.json` as it is on `main`.
