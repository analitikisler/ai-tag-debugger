# AI Tag Debugger

**An open-source AI agent that QA-tests your website's analytics and ad tracking.**

An AI model drives a real browser through your key journeys (product → cart → checkout, lead forms) like a real visitor. While it browses, `ai-tag-debugger` records every GA4, Google Ads, Meta Pixel and TikTok hit and every dataLayer push. It then checks them against your measurement plan and Consent Mode setup and writes a plain-language report of what broke and how to fix it, in English or Turkish.

Use it in two ways:

- **From your terminal or CI**, with your own API key for Anthropic (Claude), OpenAI, Google Gemini, or any OpenAI-compatible API (Kimi, GLM, DeepSeek, OpenRouter, a local Ollama and more).
- **From your AI chat app** (Claude, ChatGPT, Gemini and other apps that support MCP). The app's own model drives the audit, so you don't need a separate API key.

Built by [Analitik İşler](https://analitikisler.com). MIT licensed.

```
▶ checkout (mobile)
  Accept cookies
  Open the first product
  Add to cart
  Open the cart
  Go to checkout
  …
  Place the order
  ✓ All scripted steps completed. · 20 tracking hits captured

2 broken · 1 risk · 1 warning · 4 ok
Report: reports/demo/report.html
```

## Why

Tracking breaks silently. A redesign renames a button, a new template forgets a field, a consent banner update lets pixels fire too early. Nobody gets an alert. You find out weeks later, after ad platforms have optimized on bad conversions.

Manual tag QA catches this, but it's tedious, so it rarely happens after every release. `ai-tag-debugger` makes it a command you can run in CI.

## What it checks

| Check | Example finding |
|---|---|
| Missing events | `purchase` never fired on the checkout journey |
| Missing parameters | `purchase` sent without `value` and `currency` on mobile |
| Duplicates | `add_to_cart` sent twice by one click |
| Consent | Meta `PageView` fired before the visitor accepted cookies, Consent Mode default missing or set too late |
| Personal data | An email address sent to an ad platform in plain text |
| Unplanned events | Events firing that aren't in your measurement plan |

Platforms: GA4 (including server-side GTM endpoints), Google Ads conversions, Meta Pixel, TikTok Pixel, and basic X Pixel events.

### Choose the providers to check

By default an audit checks GA4, Google Ads, Meta and TikTok. Pick others with `--providers ga4,meta,x`, `"providers"` in the config, or `providers` on the MCP `start_audit` and `run_audit` tools. You can choose from `ga4`, `google_ads`, `meta`, `tiktok`, `x`, `linkedin`, `microsoft_ads`, `pinterest`, `snapchat`, `clarity`, `hotjar`, `doubleclick` and `adsense`. Events are parsed for GA4, Google Ads, Meta, TikTok and X; the others show their network requests.

Requests to providers you didn't choose are still answered locally, so they never reach those accounts either. They are left out of the timeline, the CSV and the checks, and only counted: the report shows "Providers checked: … · Out of scope: Microsoft Clarity, DoubleClick (61 requests skipped)", and each step says how many it skipped. Without `--providers`, any provider your measurement plan names is added to the default list. Planned events for providers you did leave out are listed in one info finding instead of being reported as missing. Tag manager and consent platform requests are always shown.

## How it works

1. **Browse:** the AI model gets a goal in plain language ("add any product to the cart and complete checkout with the test payment") and a text view of the page. It acts through two tools, `browser_action` (goto, click, fill, select, scroll, wait) and `finish`, one step at a time with Playwright.
2. **Capture:** every request to a tracking endpoint is parsed into normalized hits and tagged with the step that caused it. Every dataLayer push is recorded through an init script, including `gtag('consent', ...)` commands. By default, the collection requests of GA4, Google Ads, Meta, TikTok, Microsoft Ads, LinkedIn, Pinterest, Snapchat and X are answered locally, so **test traffic doesn't reach those real accounts**. Tags from other vendors still send their requests; the network part of the timeline shows each call and whether it was answered locally.
3. **Check:** deterministic rules compare the hits with your measurement plan. This part needs no API calls, so results are reproducible.
4. **Explain:** the model reads the findings, the hits per step and (optionally) your GTM container export. It writes the likely cause and fix for each problem, naming the tags and triggers involved.

## AI providers

Bring your own API key. `ai-tag-debugger` uses the official SDK of each provider:

| Provider | API key variable | Default model |
|---|---|---|
| Anthropic (Claude) | `ANTHROPIC_API_KEY` | `claude-opus-5-5` |
| OpenAI | `OPENAI_API_KEY` | `gpt-5.5` |
| Google Gemini | `GEMINI_API_KEY` | `gemini-pro-latest` |

The provider is picked from whichever key is set (Anthropic first if several are). Choose explicitly with `--provider anthropic|openai|gemini` or `"provider"` in the config, and pick another model with `--model`. Navigation asks for low reasoning effort to keep runs cheap; explanations ask for high effort and structured JSON output.

### Any OpenAI-compatible API: Kimi, GLM, DeepSeek, OpenRouter, Ollama and more

Many providers offer an API that works like OpenAI's. Point `ai-tag-debugger` at it with its address and a model id:

```bash
export OPENAI_COMPATIBLE_API_KEY=...        # leave unset for a local Ollama
ai-tag-debugger run --site https://yourshop.com --journey add_to_cart \
  --provider openai-compatible --base-url <API address> --model <model id>
```

| Provider | `--base-url` |
|---|---|
| Moonshot (Kimi) | `https://api.moonshot.ai/v1` |
| Z.ai (GLM) | `https://api.z.ai/api/paas/v4` |
| DeepSeek | `https://api.deepseek.com` |
| Mistral | `https://api.mistral.ai/v1` |
| Groq | `https://api.groq.com/openai/v1` |
| OpenRouter (hundreds of models) | `https://openrouter.ai/api/v1` |
| Ollama on your computer | `http://localhost:11434/v1` |

Use the model id from your provider's documentation. You can also set `OPENAI_COMPATIBLE_BASE_URL` and `OPENAI_COMPATIBLE_MODEL` instead of the flags, or `"provider"`, `"base_url"` and `"model"` in the config. When the API can't return strict JSON schemas, the explanations fall back to plain JSON mode.

**A word on model choice.** The AI browses by calling tools, one step at a time, for 5 to 30 steps. Models differ a lot in how reliably they do that: smaller and local models may click the wrong thing, loop, or stop early. The checks stay correct whatever the model does, because they come from the captured hits, but a journey that doesn't finish can't show its later events. If a model struggles, try a larger one, a ready-made journey with a short goal, or `--max-steps`. The Anthropic, OpenAI and Gemini defaults are the tested ones.

Adding a native provider means implementing two functions in [`src/providers.js`](src/providers.js): a tool-calling conversation and a structured JSON call.

## Quick start

Requires Node 20+.

```bash
git clone https://github.com/analitikisler/ai-tag-debugger.git
cd ai-tag-debugger
npm install
npx playwright install chromium   # run again after upgrading, so the browser matches Playwright
export ANTHROPIC_API_KEY=...   # or OPENAI_API_KEY, or GEMINI_API_KEY
```

Try it on the included demo shop. It has three deliberate tracking bugs:

```bash
npm run demo:serve        # in one terminal: http://localhost:4321
node src/cli.js run --config examples/demo.config.json --out reports/demo
open reports/demo/report.html
```

No API key yet? Replay the fixed steps without any AI model:

```bash
node src/cli.js run --config examples/demo.config.json --scripted --no-ai --out reports/demo
```

## Choose what to test

You don't need a config file to start. Pick ready-made journeys, describe your own in plain language, and narrow the check to the events you care about:

```bash
# Ready-made journeys come with a goal and the GA4 and Meta events to expect.
ai-tag-debugger run --site https://staging.yourshop.com --journey purchase --journey sign_up

# Describe a journey in your own words. The events you name are expected on it.
ai-tag-debugger run --site https://yoursite.com --goal "Subscribe to the newsletter in the footer" --events newsletter_signup

# Only check some events.
ai-tag-debugger run --config ai-tag-debugger.config.json --events purchase,add_to_cart
```

| Ready-made journey | What the AI does | Events it expects |
|---|---|---|
| `purchase` (or `checkout`) | Product → cart → checkout → order with the test payment option | GA4 `view_item`, `add_to_cart`, `begin_checkout`, `purchase`; Meta `AddToCart`, `InitiateCheckout`, `Purchase` |
| `add_to_cart` (or `cart`) | Opens a product and adds it to the cart | GA4 `view_item`, `add_to_cart`; Meta `AddToCart` |
| `sign_up` (or `signup`, `register`) | Creates an account with test data | GA4 `sign_up`; Meta `CompleteRegistration` |
| `lead` (or `contact`, `form`) | Fills in and sends a contact, quote or demo form | GA4 `generate_lead`; Meta `Lead` |
| `search` | Searches the site and opens a result | GA4 `search` with `search_term`; Meta `Search` |

`--journey` also picks journeys from your config by id. With a config, ready-made journeys add their events to your plan.

### Keeping API usage down

Each browsing step is one model call, so usage grows with **journeys × viewports × steps**, plus one call at the end to explain the findings. The checks themselves never call the model.

- **Run only the journeys you need.** This is the biggest saving: `--journey add_to_cart` instead of the full `purchase` journey takes a few steps instead of ten or more.
- **Run one viewport.** `--viewport mobile` halves the calls compared with desktop and mobile.
- **Cap the steps.** `--max-steps 15` stops a journey that wanders.
- **Expect bigger pages to cost more.** Each step sends the page view (up to 250 elements and 3,000 characters of text) to the model, so busy pages use more tokens per step than simple ones.
- **Use `--events`** to keep the report focused. It doesn't shorten browsing, so it barely changes usage.
- **Replay without AI.** After one AI run, copy the steps into `journeys[].steps` and use `--scripted` (with `--no-ai` for zero model calls) on every deploy.
- **Use a chat app.** Over MCP, the chat app's own model does the browsing, so no API key is used at all.

## Configure your site

`ai-tag-debugger.config.json`:

```json
{
  "site": "https://staging.yourshop.com",
  "plan": "measurement-plan.json",
  "gtm_container": "GTM-XXXX_workspace.json",
  "viewports": ["desktop", "mobile"],
  "journeys": [
    {
      "id": "checkout",
      "goal": "Accept cookies, add any product to the cart and complete checkout using the test payment method."
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `site` | Base URL. Use staging when you can. |
| `plan` | Measurement plan: a file path or an inline object (below). Optional with ready-made journeys. |
| `gtm_container` | Optional GTM container export (Admin → Export container), so explanations can name tags and triggers. |
| `viewports` | `desktop` and/or `mobile`. |
| `journeys` | Optional when you pick ready-made journeys with `--journey` or describe one with `--goal`. |
| `journeys[].goal` | What the AI should do, in plain language. |
| `journeys[].start` | Optional start path (default `/`). |
| `journeys[].steps` | Optional fixed steps for `--scripted` runs: `{ "action": "click", "selector": "#add-to-cart" }`. |
| `allowed_hosts` | Other hosts journeys may visit, e.g. `["checkout.payments-provider.com"]` for a hosted checkout. The browser otherwise stays on the `site` host and its subdomains. Same as `--allow-host`. |
| `providers` | Tracking providers to check, e.g. `["ga4", "meta"]`. Default `["ga4", "google_ads", "meta", "tiktok"]`. Same as `--providers`. |
| `block_hits` | Default `true`. Set to `false` to let hits reach your real endpoints. |
| `language` | Report language, `en` (default) or `tr`. Same as `--lang`. |
| `keep_bodies` | Default `false`. Set to `true` to store tracking requests as sent, without redacting user data. Same as `--keep-bodies`. |
| `branding` | Default `true`. Set to `false` to leave the Analitik İşler logo and the "Generated by AI Tag Debugger · analitikisler.com" line out of the reports. Same as `--no-branding`, or `branding: false` on the MCP `finish_audit` and `run_audit` tools. |
| `provider` | Optional: `anthropic`, `openai`, `gemini` or `openai-compatible`. Same as `--provider`. |
| `base_url`, `model` | Optional: the API address and model id, e.g. for `openai-compatible`. Same as `--base-url` and `--model`. |

`measurement-plan.json`:

```json
{
  "consent_mode": true,
  "events": [
    { "platform": "ga4", "name": "add_to_cart", "required_params": ["currency", "value", "items"] },
    { "platform": "ga4", "name": "purchase", "journeys": ["checkout"], "required_params": ["transaction_id", "currency", "value", "items"] },
    { "platform": "meta", "name": "Purchase", "journeys": ["checkout"], "required_params": ["value", "currency"] }
  ]
}
```

`platform` is `ga4`, `google_ads`, `meta` or `tiktok`. `journeys` limits where an event is expected (default: every journey). Set `allow_multiple: true` for events that may legitimately fire more than once per action.

## CLI

```
ai-tag-debugger run [--site <url>] [--config <file>] [--journey <id>] [--goal "<text>"] [--events <names>]
                [--max-steps <n>] [--out <dir>] [--viewport desktop|mobile] [--providers <list>]
                [--provider anthropic|openai|gemini|openai-compatible] [--model <id>] [--base-url <url>]
                [--lang en|tr] [--allow-host <host>] [--keep-bodies] [--scripted] [--no-ai] [--fail-on broken|risk|warning|never] [--headed]
ai-tag-debugger mcp [--http] [--port <n>] [--host <addr>] [--token <secret>] [--public-url <https url>] [--reports <dir>]
                [--allow-private-network]
```

The exit code is `1` when findings reach `--fail-on` (default `broken`), so it can gate a deploy. See [`examples/github-actions/ai-tag-debugger.yml`](examples/github-actions/ai-tag-debugger.yml) for running it after every deployment.

Output:

- `report.html`: a summary with the most important problem first, findings grouped by severity (each with its impact, likely cause, evidence and fix steps), and a **full event timeline**. Every step of every journey has three tabs:
  - **Events**: each tracking hit with its parameters, consent state, the dataLayer push and request behind it, and a note when a finding points at it.
  - **dataLayer**: every push in the step.
  - **Network requests**: every request to the chosen providers, decoded into a parameter table with a `?` tip on each parameter. A batched GA4 request shows each of its events.

  Events and requests can be filtered by source. GA4 item strings (`pr1`…) and dataLayer `ecommerce.items` are shown as item cards, with custom item parameters in their own group. The report has no scripts.
- `timeline.csv`: the same timeline as one row per hit, dataLayer push and network call, ready for Excel or Google Sheets.
- `report.md`: the report in Markdown, e.g. for a pull request comment.
- `capture.json`: everything captured, for your own analysis.

Reports end with a credit line, "Generated by AI Tag Debugger · analitikisler.com", where the domain is a plain link (no images, no tracking, and no referrer, so report URLs aren't leaked). `--no-branding` removes it along with the logo.

Use `--lang tr` for a Turkish report. Finding texts, headings, and the model's explanations and fixes are all written in Turkish, and the agent describes its steps in Turkish too.

## Use it from your AI chat app (MCP)

`ai-tag-debugger mcp` starts a [Model Context Protocol](https://modelcontextprotocol.io) server. Your chat app's model then runs the audit itself: you ask "check the tracking on the checkout of staging.myshop.com" and it opens the browser, clicks through, and explains the findings in the chat. No API key is needed, because the app's own model does the thinking.

Tools the server offers:

| Tool | What it does |
|---|---|
| `start_audit` | Opens a fresh browser on a URL and starts recording all tracking. Pass a ready-made journey (`purchase`, `sign_up`, …) to get its goal and expected events, and `providers` to choose what to check. The assistant asks you which platforms to check first. |
| `browser_action` | One click, fill, select, goto, scroll or wait. Returns the page and the tracking hits that step sent. |
| `get_page` | Shows the current page. |
| `finish_audit` | Checks everything against your measurement plan (JSON) or the ready-made journey's events, optionally only the `events` you name, and writes the full HTML report with the timeline. |
| `run_audit` | Runs a config file end to end (local only). |

The browser runs on the computer where the server runs, so it can reach your staging and `localhost` sites. Tracking requests are answered locally as usual.

### Apps that start a local server: Claude Desktop, Gemini CLI, Cursor, VS Code, Claude Code

Add the server to the app's MCP config, pointing at your copy of the repository. For Claude Desktop that is Settings → Developer → Edit Config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ai-tag-debugger": {
      "command": "node",
      "args": ["/path/to/ai-tag-debugger/src/cli.js", "mcp"]
    }
  }
}
```

Gemini CLI uses the same `mcpServers` block in `~/.gemini/settings.json`. Claude Code: `claude mcp add ai-tag-debugger -- node /path/to/ai-tag-debugger/src/cli.js mcp`. Restart the app, and the ai-tag-debugger tools appear. If the app can't find `node`, use its full path (`which node`). Reports are written to `~/ai-tag-debugger-reports`.

### Apps that connect to a URL: ChatGPT, Gemini

These apps connect to MCP servers over HTTPS (in ChatGPT, through developer mode connectors, depending on your plan). Start the server in HTTP mode and expose it with a tunnel:

```bash
cloudflared tunnel --url http://localhost:8787     # or: ngrok http 8787; note the https address it prints
node src/cli.js mcp --http --port 8787 --public-url https://<your-tunnel-address>
```

The server prints a URL with a random secret path, like `https://<your-tunnel-address>/mcp/<secret>`. Add that URL as a connector in the app. Anyone with the URL can use the browser on your machine, so keep it private and stop the server when you're done. A secret of your own (`--token`) must be at least 16 characters.

In HTTP mode, the server is more locked down than locally:

- It doesn't read measurement plans or configs from your disk (pass the plan as JSON text in the chat), and `run_audit` isn't offered. It only serves the reports it wrote itself.
- The browser opens only `http` and `https` pages, and refuses `localhost` and private network addresses (such as `192.168.x.x` or `169.254.169.254`), so the URL can't be used to look into your network. All browser traffic, WebSockets included, goes through a small built-in proxy that resolves each host once and connects only to the address it checked, so a DNS answer that changes mid-audit can't get around the check. To audit a local staging site this way anyway, start the server with `--allow-private-network`.
- Audits left open for 15 minutes are closed, and request bodies are limited to 1 MB.

A hosted server, so you don't need a tunnel, is part of the [Analitik İşler](https://analitikisler.com) Cloud version.

## Safety

- The agent is told to use obvious test data and **never to enter real payment details**. If a journey needs a real payment or account, it stops and reports that instead.
- Tracking requests to the platforms listed in [How it works](#how-it-works) are answered locally by default, so those analytics and ad accounts don't receive test conversions.
- The browser stays on the audited site and its subdomains, plus any `allowed_hosts`. It opens only `http` and `https` pages.
- The model is told that page content is data, never instructions. A prompt rule can't guarantee a model is never misled, so the navigation limits above contain what a misled model can do.
- The browser runs without your API keys and other secrets in its environment.
- **User data sent for ad matching is redacted** before it is stored in `capture.json` or shown in the report: emails, phone numbers, names, addresses and user ids in GA4 and Google Ads enhanced conversions (`em`, `ph`, `uid`, …), Meta advanced matching (`ud[*]`) and TikTok `context.user`. Each value becomes a marker such as `[redacted: 64 chars, looks hashed]`, and a value that wasn't hashed is reported as a personal data risk. `--keep-bodies` (`"keep_bodies": true`) stores requests as sent, for debugging.
- Stored request bodies are capped at 32 KB per request and 2 MB per journey. Past that, the report says the body wasn't stored.
- Only run it against sites you own or are authorized to test.
- Hosting the HTTP server for other people? Also block private and cloud metadata address ranges at the network level (an egress firewall or an isolated network), as defense in depth.

## Roadmap

- Consent Check: deeper audits of cookie banners and Consent Mode v2 against GDPR/KVKK.
- Measurement Plan: draft a plan and dataLayer spec from a URL.
- Hosted version with scheduled runs, deploy webhooks, a hosted MCP server and multi-site dashboards for agencies at [analitikisler.com](https://analitikisler.com).

## Development

```bash
npm test   # parsers, checks, each AI provider and the MCP server, end to end against the demo shop
```

The end-to-end tests use fake model clients, so they run without an API key.

## Hosted version

For hosted runs, scheduling and agency dashboards, see [analitikisler.com](https://analitikisler.com).

## License

MIT © Analitik İşler
