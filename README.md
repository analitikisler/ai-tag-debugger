English | [Türkçe](README.tr.md)

# AI Tag Debugger

**An open-source AI agent that QA-tests your website's analytics and ad tracking.**

An AI model drives a real browser through your key journeys (product → cart → checkout, lead forms) like a real visitor. While it browses, `ai-tag-debugger` records every tracking hit (GA4, Google Ads, Meta Pixel, TikTok and about a dozen more platforms) and every dataLayer push. It then checks them against your measurement plan and Consent Mode setup and writes a plain-language report of what broke and how to fix it, in English or Turkish.

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
Report: reports/demo/localhost/runs/2026-10-16_0800/report.html
```

## Why

Tracking breaks silently. A redesign renames a button, a new template forgets a field, a consent banner update lets pixels fire too early. Nobody gets an alert. You find out weeks later, after ad platforms have optimized on bad conversions.

Manual tag QA catches this, but it's tedious, so it rarely happens after every release. `ai-tag-debugger` makes it a command you can run in CI.

## What it checks

| Check | Example finding |
|---|---|
| Missing events | `purchase` never fired on the checkout journey |
| Missing parameters | `purchase` sent without `value` and `currency` on mobile |
| Invalid purchase value | `purchase` sent with `value` `0`, a negative number or text such as `"free"` |
| Invalid purchase currency | `purchase` sent with currency `usd` or `TL` instead of a 3-letter ISO code such as `USD` or `TRY` |
| Empty purchase items | `purchase` sent with an empty `items` list |
| Purchase mismatch | GA4 sends `value` 120 and Meta sends 115 for the same order ID |
| Duplicates | `add_to_cart` sent twice by one click |
| Consent | Meta `PageView` fired before the visitor accepted cookies, Consent Mode default missing or set too late, Consent Mode v2 signals (`ad_user_data`, `ad_personalization`) missing, tracking cookies set before consent, tags or cookies still active after the `decline_cookies` journey rejects the banner, a reject button that does nothing |
| Personal data | An email address sent to an ad platform in plain text |
| Unplanned events | Events firing that aren't in your measurement plan |
| Plan coverage | Each planned event sorted into implemented, missing, missing parameters, wrong values or not checked (see [Plan vs. site](#plan-vs-site)) |

Platforms: GA4 (including server-side GTM endpoints and Google tag gateway paths on the site's own domain; hits to a server container are marked server-side, and Stape and Elevar requests are recognised), Google Ads conversions, Meta Pixel, TikTok Pixel, basic X Pixel events, LinkedIn Insight Tag, Microsoft Advertising UET, Criteo OneTag, and Pinterest, Snapchat and Klaviyo events. Adobe Analytics, Matomo and Piwik PRO events are read too (page views, links, goals, site search and ecommerce orders), and Microsoft Clarity and Hotjar tag loads name the project or site id.

### Choose the platforms to check

By default an audit checks GA4, Google Ads, Meta and TikTok, and also any other platform the site turns out to use. That platform is checked from its first request, with no setting needed. Choosing platforms turns this detection off. Pick a fixed list with `--platforms ga4,meta,x`, `"providers"` in the config, or `providers` on the MCP `start_audit` and `run_audit` tools. You can choose from `ga4`, `google_ads`, `meta`, `tiktok`, `x`, `linkedin`, `microsoft_ads`, `pinterest`, `snapchat`, `criteo`, `klaviyo`, `adobe`, `matomo`, `piwik_pro`, `clarity`, `hotjar`, `doubleclick` and `adsense`. Events are parsed for GA4, Google Ads, Meta, TikTok, X, LinkedIn, Microsoft Ads, Pinterest, Snapchat, Criteo, Klaviyo, Adobe Analytics, Matomo and Piwik PRO. Clarity and Hotjar show their tag loads, and the others show their network requests. `--providers` still works as the old name of `--platforms` for one more minor version and prints a note.

Requests to platforms you didn't choose are still answered locally, so they never reach those accounts either. They are left out of the timeline, the CSV and the checks, and only counted: the report lists them with their request counts (for example "61 out-of-scope requests were skipped: Microsoft Clarity, DoubleClick"), and each step says how many it skipped. Without `--platforms`, any platform your measurement plan names or the site sends to is added to the default list. Planned events for platforms you did leave out are listed in one info finding instead of being reported as missing. Tag manager and consent platform requests are always shown.

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

### Vercel AI Gateway

One key for many models. Set `AI_GATEWAY_API_KEY` from your Vercel dashboard and pick a model as `<provider>/<model>`:

```bash
export AI_GATEWAY_API_KEY=...
aitd run --site https://yourshop.com --journey purchase --model google/gemini-3.6-flash
```

Without `--model` it uses `anthropic/claude-opus-5.5`. Usage and costs show in Vercel's AI Gateway dashboard and are billed by Vercel. To see which AI a run will use, run `aitd`: the last line says, for example, `AI: vercel (anthropic/claude-opus-5.5) · also set: anthropic (pick with --provider)`.

### Cloudflare AI Gateway

To see logs, costs and rate limits for every AI call, send them through [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/). Your provider key stays the same:

```bash
export AI_GATEWAY_URL=https://gateway.ai.cloudflare.com/v1/<account id>/default
export AI_GATEWAY_TOKEN=...   # only if the gateway has authentication on
```

This works with `anthropic`, `openai` and `gemini`. Leave caching off in the gateway so each run sees your live site. Cloudflare Workers AI models also work through the OpenAI-compatible provider, with `--base-url https://api.cloudflare.com/client/v4/accounts/<account id>/ai/v1`.

**A word on model choice.** The AI browses by calling tools, one step at a time, for 5 to 30 steps. Models differ a lot in how reliably they do that: smaller and local models may click the wrong thing, loop, or stop early. The checks stay correct whatever the model does, because they come from the captured hits, but a journey that doesn't finish can't show its later events. If a model struggles, try a larger one, a ready-made journey with a short goal, or `--max-steps`. The Anthropic, OpenAI and Gemini defaults are the tested ones.

Adding a native provider means implementing two functions in [`src/providers.js`](src/providers.js): a tool-calling conversation and a structured JSON call.

## Quick start

Requires Node 20+.

```bash
npm install -g @analitikisler/ai-tag-debugger
npx -y playwright@1.56.1 install chromium   # the browser version this release uses
export ANTHROPIC_API_KEY=...                # or OPENAI_API_KEY, or GEMINI_API_KEY

ai-tag-debugger run --site https://staging.yourshop.com --journey add_to_cart --headed
```

The global install also adds `aitd`, a short alias: `aitd run --site … --journey add_to_cart` does the same.

Or run it without installing: `npx -y @analitikisler/ai-tag-debugger run --site … --journey add_to_cart`.

Run `aitd --help` to see the commands, and `aitd run --help` (or `plan`, `replay`, `mcp`) for each command's options.

### Try the demo shop (from source)

The repository includes a demo shop with three deliberate tracking bugs:

```bash
git clone https://github.com/analitikisler/ai-tag-debugger.git
cd ai-tag-debugger
npm install
npx playwright install chromium   # run again after upgrading, so the browser matches Playwright
npm run demo:serve                # in one terminal: http://localhost:4321
node src/cli.js run --config examples/demo.config.json --data-dir reports/demo
open reports/demo/localhost/runs/*/report.html
```

No API key yet? Replay the fixed steps without any AI model:

```bash
node src/cli.js run --config examples/demo.config.json --scripted --no-ai --data-dir reports/demo
```

## Just ask

You don't have to learn the options first. Put a plain sentence in quotes and aitd turns it into the matching command, prints that command and asks `Run this? (Y/n)` before it runs anything:

```bash
aitd "check my google analytics tags"
# aitd run --platforms ga4
# Run this? (Y/n)
```

| You type | aitd runs |
|---|---|
| `"Check my google analytics tags"` | `aitd run --platforms ga4` |
| `"What changed on my site since the last run"` | `aitd run` (every run already reports what changed) |
| `"Compare my site against the plan"` | `aitd run --against latest` |
| `"What custom events does my site need"` | `aitd plan --topic custom-events` |
| `"Is my Meta pixel firing on checkout?"` | `aitd run --platforms meta --goal "reach checkout"` |
| `"Test signing up for the newsletter"` | `aitd run --goal "sign up for the newsletter"` |
| `"Does my purchase event send the right revenue?"` | `aitd run --journey purchase` |
| `"Make a tracking plan for example.com"` | `aitd plan --site https://example.com` |
| `"What ecommerce events should an online shop track?"` | `aitd plan --topic ecommerce` |
| `"Check TikTok and Google Ads on the contact form"` | `aitd run --platforms google_ads,tiktok --goal "submit the contact form"` |

Add `-y` to skip the question: `aitd -y "check my google analytics tags"`.

If a sentence leaves something out, aitd asks one short question instead of guessing: plan or run, which site, or what to test. Reports can't be filtered from a sentence yet (`"Show me only the errors from the last report"` says so). Without an AI key, a small keyword matcher handles the common phrases. With one, the AI reads any wording, but it can only pick options that exist, so it never invents a flag.

## Plan, then audit

A run checks what a site sends against a **plan**: the events, parameters and user properties you expect. Three steps:

```bash
# 1. Draft a plan. The AI explores the site and proposes what should be tracked.
aitd plan --site https://yoursite.com

# 2. Optional: edit it in a spreadsheet, then save the edited copy as a new plan.
aitd plan export latest --site https://yoursite.com     # writes plan.xlsx next to the plan
aitd plan import plan.xlsx --site https://yoursite.com  # saves a new plan; the old one is untouched

# 3. Audit the site against the plan.
aitd run --site https://yoursite.com --against latest
```

**Drafting a plan** needs no tracking code. The AI explores one page of each type: the home page, a category, a product, the cart, the first checkout step, search, and any sign-up or contact forms. It never pays, and it never submits a form with personal details. `--provider`, `--model` and `--max-steps` (default 25, the most AI steps) work as they do for `run`. The output prints "Page types found" and "Not present on this site", so you can see which page types the AI reached. A small site, with only 2 pages, is fine.

To draft a plan for one kind of event only, add `--topic`: `custom-events`, `ecommerce`, `forms` or `consent`. The plan then covers just those events, and the rest of the plan format is unchanged:

```bash
aitd plan --site https://yoursite.com --topic ecommerce
```

The plan is saved in a new folder, `aitd/<domain>/plans/<id>/`, as `measurement-plan.json` and a readable `plan.html`. For each event it lists:

- `name` and `platform`. Events specific to your site, such as a size guide or a store locator, are marked `custom: true`.
- `description` and `trigger`: the page type and the visible label of the element that fires the event.
- `parameters`: each with a description and an example value. Custom parameters are marked. `required_params` lists the ones that must be present.
- `user_properties`: suggested ones such as `customer_type`, each with a description and an example.

Events your site already sends are marked `"seen": true`.

Review the plan before you use it. The examples and suggestions come from the pages the AI saw, so check that each event fits your business. The extra fields are ignored by the checks.

**Spreadsheet import and export.** `aitd plan export <plan> --site <url>` writes `plan.xlsx` next to the plan, with one row per event parameter on an `events` tab (`event, platform, parameter, required, example, trigger, description`) and one row per user property on a `user_properties` tab. Add `--format csv` to get `events.csv` and `user_properties.csv` instead; CSV needs no extra package. `.xlsx` uses one small library, `fflate`, which is installed with the tool as an optional dependency. `aitd plan import <file> --site <url>` reads the spreadsheet back and saves it as a new plan folder. Import never edits an existing plan. Unknown columns are ignored with a warning, and an error names the tab, row and fix, for example `events, row 7: "required" must be yes or no (found "maybe").`

`measurement-plan.json` looks like this:

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

Event names are matched loosely, so `dl_add_to_cart` (Elevar), `addToCart` and `Add To Cart` count as `add_to_cart`, and `transaction` or `order_completed` as `purchase`. Add your own with `"aliases": ["my_event"]` on a planned event. Required parameters are also found under their usual other names: `products` for `items`, `revenue` for `value`, `order_id` for `transaction_id`.

**Auditing against a plan.** `run --against <plan>` takes `latest` (or `last`), `first`, a plan ID, or a path to a plan file or its folder. When `--site` is not given, the site comes from the plan. Give the run a journey as well and it walks only that flow, checking only the plan events expected there; the rest of the plan is reported as not checked, never as missing. Used alone, `--against` derives up to six journeys from the plan: it groups the planned events by the page they are triggered on and makes one journey per page, at most six (the smallest groups share the last journey), with no extra AI call. The chosen journeys are printed before the browser starts. Every report header then says `Checked against plan <id>`.

`run` needs something to test: `--against`, `--journey`, `--goal`, or journeys in your config file. Without one, it stops before opening the browser with `Nothing to test. Add --against latest, --journey <id> or --goal "<text>".`, so it can't wander and spend API usage. If a site has no plan yet, `run --against` says `No plan yet for example.com. Draft one with: aitd plan --site https://example.com`.

`aitd plan list --site <url>` lists the site's plan IDs, oldest first.

### Plan vs. site

When a run uses `--against`, the report starts with a **Plan vs. site** section, in `report.html` and `report.md`. Each planned event lands in one bucket:

| Bucket | Meaning |
|---|---|
| Implemented | Planned, fired, all required parameters present, no value problems |
| Missing | Planned for a journey the run walked, but never fired |
| Missing params | Fired, but a required parameter is absent |
| Wrong values | Fired with a value problem, from the same checks as purchase value, currency and items |
| Unplanned | Fired, but isn't in the plan |
| Not checked | Planned, but its journey or platform wasn't part of this run |

The coverage score is implemented divided by the planned events that were checkable (all except not checked), shown overall and per platform, for example `Coverage 7 of 11 (64%), 2 events not checked`. The same entries are in `plan-check.json`, one per planned event with its bucket. Exit codes don't change: `--fail-on` still looks at finding severity. Without `--against`, the report is exactly as before.

### Folder layout and plan IDs

Plans and runs are kept in `aitd/` in the folder you run the tool from:

```
aitd/
  example.com/                      the site's host, without www.
    plans/2026-10-16_0900/          measurement-plan.json, plan.html, plan.xlsx (after an export)
    runs/2026-10-16_0912/           report.html, report.md, timeline.csv, capture.json
                                    and plan-check.json (with --against)
```

An ID is the local time, `YYYY-MM-DD_HHMM`. When that minute is already taken, seconds are added (`_HHMMSS`). Nothing is ever replaced: each draft, import and run gets a new folder. Use `--data-dir <dir>` to keep the `aitd/` folder somewhere else. `replay` and `--save-site` folders are not affected.

Each report opens with a "Changed since last run" section that compares the run with the site's previous one in `runs/`, for example `2 events fixed, 1 new problem`, and lists each one. When both runs used `--against`, it compares plan coverage (an event that went from Missing to Implemented is fixed); otherwise it compares the health findings. The first run for a site says there is nothing to compare yet. There is no flag to set. The comparison is also saved under `changes` in `capture.json`.

## Choose what to test

You don't need a config file to start. Pick ready-made journeys, describe your own in plain language, check against a plan, and narrow the check to the events you care about:

```bash
# Check the site against its latest saved plan.
aitd run --site https://staging.yourshop.com --against latest

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

Not sure what to test? `aitd plan --site https://yoursite.com` drafts a measurement plan, and `--against latest` checks the site against it.

### Keeping API usage down

Each browsing step is one model call, so usage grows with **journeys × viewports × steps**, plus one call at the end to explain the findings. The checks themselves never call the model.

- **Run only the journeys you need.** This is the biggest saving: `--journey add_to_cart` instead of the full `purchase` journey takes a few steps instead of ten or more.
- **Run one viewport.** `--viewport mobile` halves the calls compared with desktop and mobile.
- **Cap the steps.** `--max-steps 15` stops a journey that wanders.
- **Expect bigger pages to cost more.** Each step sends the page view (up to 250 elements and 3,000 characters of text) to the model, so busy pages use more tokens per step than simple ones.
- **Use `--events`** to keep the report focused. It doesn't shorten browsing, so it barely changes usage.
- **Replay without AI.** After one AI run, add `--save-steps <file>` to save its steps, then run that config with `--scripted --no-ai` on every deploy. See [Save the steps and replay them without AI](#save-the-steps-and-replay-them-without-ai).
- **Use a chat app.** Over MCP, the chat app's own model does the browsing, so no API key is used at all.

### Check a new version against saved sites

`--save-site <dir>` also saves every response the site sent and the steps taken. `replay` then audits the same pages again offline, with no network and no AI model, so it costs nothing. It lists findings that are new or gone compared with the saved run:

```bash
npx @analitikisler/ai-tag-debugger run --site https://www.yourshop.com --journey purchase --save-site saved/yourshop
npx @analitikisler/ai-tag-debugger replay saved/*
✗ https://www.yourshop.com (saved/yourshop): 0 new, 1 gone
    - warning duplicate purchase desktop ga4 page_view
```

The first run's findings become the expected ones. When a change is right, for example a false alarm that is fixed, `replay --update` makes the new findings the expected ones. Use it to check a new version of the tool against sites you know, or a site change against its last good run. A saved site is usually a few MB. It leaves out tracking requests, images and video, HttpOnly and login cookies and the cookies the browser sent, authorization headers, form data, and requests with an email or other user data in their address. It still holds the site's pages and scripts, so keep sites you don't own out of public repositories.

### Save the steps and replay them without AI

`--save-steps <file>` writes the steps each journey took into `journeys[].steps` of a config file. It creates the file if it's missing, and it also saves the run's plan when the config has none. The same config then repeats the journey with no AI model and no API key:

```bash
ai-tag-debugger run --site https://www.yourshop.com --journey purchase --save-steps ai-tag-debugger.config.json
ai-tag-debugger run --config ai-tag-debugger.config.json --scripted --no-ai
```

When a journey ran on both viewports, only the first viewport's steps are kept. Keep the config in your repository and run the second command on every deploy to check the same journey without any model calls.

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
| `plan` | Measurement plan: a file path or an inline object (below). Optional with ready-made journeys. A run with `--against` uses that plan instead. |
| `gtm_container` | Optional GTM container export (Admin → Export container), so explanations can name tags and triggers. |
| `viewports` | `desktop` and/or `mobile`. |
| `journeys` | Optional when you pick ready-made journeys with `--journey`, describe one with `--goal`, or check against a plan with `--against`. |
| `journeys[].goal` | What the AI should do, in plain language. |
| `journeys[].start` | Optional start path (default `/`). |
| `journeys[].steps` | Optional fixed steps for `--scripted` runs: `{ "action": "click", "selector": "#add-to-cart" }`. |
| `allowed_hosts` | Other hosts journeys may visit, e.g. `["checkout.payments-provider.com"]` for a hosted checkout. The browser otherwise stays on the `site` host and its subdomains. Same as `--allow-host`. |
| `providers` | Tracking platforms to check, e.g. `["ga4", "meta"]`. Default `["ga4", "google_ads", "meta", "tiktok"]`, plus any other platform the site sends to while this is unset. Same as `--platforms`. |
| `block_hits` | Default `true`. Set to `false` to let hits reach your real endpoints. |
| `language` | Report language, `en` (default) or `tr`. Same as `--lang`. |
| `keep_bodies` | Default `false`. Set to `true` to store tracking requests as sent, without redacting user data. Same as `--keep-bodies`. |
| `branding` | Default `true`. Set to `false` to leave the Analitik İşler logo and the "Generated by AI Tag Debugger · analitikisler.com" line out of the reports. Same as `--no-branding`, or `branding: false` on the MCP `finish_audit` and `run_audit` tools. |
| `provider` | Optional: `anthropic`, `openai`, `gemini` or `openai-compatible`. Same as `--provider`. |
| `base_url`, `model` | Optional: the API address and model id, e.g. for `openai-compatible`. Same as `--base-url` and `--model`. |

## CLI

```
aitd "<sentence>" [-y]
aitd plan --site <url> [--topic <name>] [--headed] [--provider <name>] [--model <id>] [--max-steps <n>] [--data-dir <dir>]
aitd plan list --site <url> [--data-dir <dir>]
aitd plan import <file> --site <url> [--data-dir <dir>]
aitd plan export <plan> --site <url> [--format xlsx|csv] [--data-dir <dir>]
aitd run --site <url> (--against <plan> | --journey <id> | --goal "<text>") [--config <file>] [--events <names>]
         [--max-steps <n>] [--viewport desktop|mobile] [--platforms <list>] [--data-dir <dir>]
         [--provider anthropic|openai|gemini|openai-compatible] [--model <id>] [--lang en|tr] [--headed]
         [--fail-on broken|risk|warning|never] [--scripted] [--no-ai] [--save-site <dir>] [--save-steps <file>]
aitd replay <dir>... [--update] [--out <dir>]
aitd mcp [--http] [--port <n>] [--host <addr>] [--token <secret>] [--public-url <https url>] [--reports <dir>]
         [--allow-private-network]
```

`aitd` is a short alias for `ai-tag-debugger` and takes the same commands and options. Run `aitd <command> --help` for the essential options of each command.

### All options

| Option | Commands | Meaning |
|---|---|---|
| `--site <url>` | plan, run | The site. Required for `plan`; for `run`, needed unless `--against` or the config gives it. |
| `--against <plan>` | run | Check against a plan: `latest` (or `last`), `first`, a plan ID, or a path to a plan file or folder. |
| `--journey <id>` | run | A ready-made journey (repeatable). |
| `--goal "<text>"` | run | A journey in plain language (repeatable). |
| `--config <file>` | run | Take the site, journeys and plan from a config file. |
| `--events <names>` | run | Only check these events, e.g. `purchase,add_to_cart`. |
| `--viewport <name>` | run | `desktop` or `mobile` (repeatable). |
| `--platforms <list>` | run | Platforms to check, e.g. `ga4,meta`. Replaces `--providers`, which still works for one more minor version. |
| `--max-steps <n>` | plan, run | The most AI steps per journey (default 25 for `plan`). |
| `--lang <code>` | run | Report language: `en` or `tr`. |
| `--fail-on <level>` | run | Exit with 1 at this level: `broken` (default), `risk`, `warning` or `never`. |
| `--headed` | plan, run | Show the browser window. |
| `--provider <name>`, `--model <id>` | plan, run | The AI provider and model. Default: whichever API key is set. |
| `--scripted` | run | Replay each journey's fixed steps, with no AI navigation. |
| `--no-ai` | run | No AI model at all. Implies `--scripted`. |
| `--save-site <dir>` | run | Save the site's responses for `replay`. |
| `--save-steps <file>` | run | Write the steps each journey took into a config file. |
| `--data-dir <dir>` | plan, run | Where `aitd/` (plans and runs) is kept. Default: `./aitd`. Replaces `run --out`. |
| `--format xlsx\|csv` | plan export | The spreadsheet format. Default: `xlsx`. |
| `--update` | replay | Make this replay's findings the expected ones. |
| `--out <dir>` | replay | Where to write the replay reports. For `run`, `--out` still works as a hidden alias for one minor version and prints a note; use `--data-dir`. |
| `--base-url <url>` | run | The API address for an OpenAI-compatible provider. |
| `--allow-host <host>` | run | Another host journeys may visit (repeatable). Same as `allowed_hosts`. |
| `--keep-bodies` | run | Store tracking requests as sent, without redacting user data. |
| `--no-branding` | plan, run | Leave the logo and credit line out of the reports and `plan.html`. |
| `--http`, `--port`, `--host`, `--token`, `--public-url`, `--reports`, `--allow-private-network` | mcp | See the MCP section below. |

Removed in 0.10.0: `plan --from`, `plan --out` and `plan --force`. Drafting a plan always saves a new folder, and a removed flag prints what to run instead.

The exit code is `1` when findings reach `--fail-on` (default `broken`), so it can gate a deploy. See [`examples/github-actions/ai-tag-debugger.yml`](examples/github-actions/ai-tag-debugger.yml) for running it after every deployment.

Output:

- `report.html`: one file with four tabs. Links work across tabs (a finding's "Where" chip opens that step), and every view has its own URL you can bookmark or share.
  - **Overview**: problem counts, the AI summary (most important problem first, plus things worth checking that the findings don't cover), the journeys with their problem counts, a **This run** card (platforms, AI provider and model, plan, journeys, viewports, language, version), and, with `--against`, the [Plan vs. site](#plan-vs-site) coverage. When the AI took a different route through the site than in the last run, the header names the journeys whose route changed, and the **Changed since last run** section shows the pages before and after.
  - **Findings**: grouped by who fixes them (Developer, Tag Manager, Marketing) and filterable by severity. Each one has its impact, likely cause, evidence, numbered fix steps, the steps where it happened, and a **How to verify** list of tools to check the fix in, such as Tag Assistant, GA4 DebugView, Meta Test Events or TikTok Pixel Helper.
  - **Journeys**: one journey at a time. A **Consent** card at the top lists the Consent Mode default and every update, one tile per signal. Below it are the steps on the left and the selected step on the right. It opens on the first step with a problem. Each step has four tabs:
    - **Timeline**: the step in order. Each dataLayer push comes first, then the GTM event it raised (or the consent command), then the platform hits it caused. Hits with no push are listed last.
    - **Events**: each tracking hit with its parameters, consent state, the dataLayer push and request behind it, and a note when a finding points at it.
    - **dataLayer**: every push in the step.
    - **Network requests**: every request to the chosen platforms, decoded into a parameter table with a `?` tip on each parameter. A batched GA4 request shows each of its events.
  - **Scope and plan**: whether each planned event was sent on each journey, and the platforms checked or left out, with request counts.

  Events and requests can be filtered by source. GA4 item strings (`pr1`…) and dataLayer `ecommerce.items` are shown as item cards, with custom item parameters in their own group. The report has no scripts: tabs and filters are plain HTML and CSS (they need Chrome 105, Safari 15.4 or Firefox 121 or newer), and printing shows every tab. The logos are embedded, so nothing is loaded from the internet. `--no-branding` leaves out the Analitik İşler logo and credit line.
- `timeline.csv`: the same timeline as one row per hit, dataLayer push and network call, ready for Excel or Google Sheets.
- `report.md`: the report in Markdown, e.g. for a pull request comment.
- `capture.json`: everything captured, for your own analysis.
- `plan-check.json`: with `--against`, one entry per planned event with its bucket.
- `plan.html` (in the plan's folder): a readable page of the plan's events, parameters and user properties.

Reports end with a credit line, "Generated by AI Tag Debugger · analitikisler.com", where the domain is a plain link (no images, no tracking, and no referrer, so report URLs aren't leaked). `--no-branding` removes it along with the logo.

Use `--lang tr` for a Turkish report. Finding texts, headings, and the model's explanations and fixes are all written in Turkish, and the agent describes its steps in Turkish too.

## Use it from your AI chat app (MCP)

`aitd mcp` starts a [Model Context Protocol](https://modelcontextprotocol.io) server. Your chat app's model then runs the audit itself: you ask "check the tracking on the checkout of staging.myshop.com" and it opens the browser, clicks through, and explains the findings in the chat. No API key is needed, because the app's own model does the thinking.

Tools the server offers:

| Tool | What it does |
|---|---|
| `make_plan` | Drafts a tracking plan for a site (what should be tracked), the same as `aitd plan --site`. Pass `topic` (`custom-events`, `ecommerce`, `forms`, `consent`) to limit it to one kind of event. The plan is saved and its ID can be given as `against` to `finish_audit`. It uses the AI provider configured on the computer that runs the server and takes a few minutes. |
| `start_audit` | Opens a fresh browser on a URL and starts recording all tracking. Pass a ready-made journey (`purchase`, `sign_up`, …) to get its goal and expected events, and `providers` to choose the platforms to check. The assistant asks you which platforms to check first. |
| `browser_action` | One click, fill, select, goto, scroll or wait. Returns the page and the tracking hits that step sent. |
| `get_page` | Shows the current page. |
| `finish_audit` | Checks everything against your measurement plan (JSON), a saved one given as `against` (`latest`, `first`, a plan ID, or on a local server a path), or the ready-made journey's events, optionally only the `events` you name, and writes the full HTML report with the timeline. The site comes from the audit. |
| `run_audit` | Runs a config file end to end. With `against`, it checks the run against a saved plan and, when the config has no journeys, walks the journeys derived from that plan. Local only for file paths. |

`against` takes the same values as the CLI's `--against`. Over HTTP it takes only `latest`, `first` or a plan ID, never a path. Plans are the ones saved by `aitd plan --site <url>` or by `make_plan`. Ask for a plan when you want to know what to track, and for an audit when you want to know what the site sends.

The browser runs on the computer where the server runs, so it can reach your staging and `localhost` sites. Tracking requests are answered locally as usual.

### Apps that start a local server: Claude Desktop, Gemini CLI, Cursor, VS Code, Claude Code

Add the server to the app's MCP config. For Claude Desktop that is Settings → Developer → Edit Config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ai-tag-debugger": {
      "command": "npx",
      "args": ["-y", "@analitikisler/ai-tag-debugger", "mcp"]
    }
  }
}
```

The browser (Chromium) downloads itself the first time you run an audit, about a minute, one time. To get it ahead of time: `npx -y playwright@1.56.1 install chromium`.

One-click and one-line setup:

- **Claude Code:** `claude mcp add ai-tag-debugger -- npx -y @analitikisler/ai-tag-debugger mcp`
- **Cursor:** [Add to Cursor](https://cursor.com/en/install-mcp?name=ai-tag-debugger&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBhbmFsaXRpa2lzbGVyL2FpLXRhZy1kZWJ1Z2dlciIsIm1jcCJdfQ==)
- **VS Code:** [Install in VS Code](https://insiders.vscode.dev/redirect/mcp/install?name=ai-tag-debugger&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40analitikisler%2Fai-tag-debugger%22%2C%22mcp%22%5D%7D), or `code --add-mcp '{"name":"ai-tag-debugger","command":"npx","args":["-y","@analitikisler/ai-tag-debugger","mcp"]}'`
- **Claude Desktop, Gemini CLI and others:** the JSON block above. Gemini CLI uses the same `mcpServers` block in `~/.gemini/settings.json`.

Restart the app, and the ai-tag-debugger tools appear. If the app can't find `npx`, use its full path (`which npx`, for example `/opt/homebrew/bin/npx` on a Mac with Homebrew). Reports are written to `~/ai-tag-debugger-reports`.

Running from a clone instead? Use `"command": "node"` and `"args": ["/path/to/ai-tag-debugger/src/cli.js", "mcp"]`.

### Apps that connect to a URL: ChatGPT, Gemini

These apps connect to MCP servers over HTTPS (in ChatGPT, through developer mode connectors, depending on your plan). Start the server in HTTP mode and expose it with a tunnel:

```bash
cloudflared tunnel --url http://localhost:8787     # or: ngrok http 8787; note the https address it prints
npx -y @analitikisler/ai-tag-debugger mcp --http --port 8787 --public-url https://<your-tunnel-address>
```

The server prints a URL with a random secret path, like `https://<your-tunnel-address>/mcp/<secret>`. Add that URL as a connector in the app. Anyone with the URL can use the browser on your machine, so keep it private and stop the server when you're done. A secret of your own (`--token`) must be at least 16 characters.

In HTTP mode, the server is more locked down than locally:

- It doesn't read measurement plans or configs from your disk (pass the plan as JSON text in the chat, or name a saved plan with `against: latest`, `first` or its ID), and `run_audit` isn't offered. It only serves the reports it wrote itself.
- The browser opens only `http` and `https` pages, and refuses `localhost` and private network addresses (such as `192.168.x.x` or `169.254.169.254`), so the URL can't be used to look into your network. All browser traffic, WebSockets included, goes through a small built-in proxy that resolves each host once and connects only to the address it checked, so a DNS answer that changes mid-audit can't get around the check. To audit a local staging site this way anyway, start the server with `--allow-private-network`.
- Audits left open for 15 minutes are closed, and request bodies are limited to 1 MB.

A hosted server, so you don't need a tunnel, is part of the [Analitik İşler](https://analitikisler.com) Cloud version.

## Safety

- The agent is told to use obvious test data and **never to enter real payment details**. If a journey needs a real payment or account, it stops and reports that instead.
- Tracking requests to the platforms listed in [How it works](#how-it-works) are answered locally by default, so those analytics and ad accounts don't receive test conversions.
- The browser stays on the audited site and its subdomains, plus any `allowed_hosts`. It opens only `http` and `https` pages.
- The model is told that page content is data, never instructions. A prompt rule can't guarantee a model is never misled, so the navigation limits above contain what a misled model can do.
- The browser runs without your API keys and other secrets in its environment.
- **User data sent for ad matching is redacted** before it is stored in `capture.json` or shown in the report: emails, phone numbers, names, addresses and user ids in GA4 and Google Ads enhanced conversions (`em`, `ph`, `uid`, …), Meta advanced matching (`ud[*]`, `udff[*]`), TikTok `context.user`, and the `user_data` the site pushes to the dataLayer for enhanced conversions. Any value that looks like an email address is redacted whatever its field is called, except the audited site's own address in a `mailto:` link or a link field (`link_url`, `link_text`, `gtm.elementUrl`, …), such as a contact link in a GTM click event, which is not visitor data. Each value becomes a marker such as `[redacted: 64 chars, looks hashed]`, and a value that wasn't hashed is reported as a personal data risk. `--keep-bodies` (`"keep_bodies": true`) stores requests as sent, for debugging.
- Stored request bodies are capped at 32 KB per request and 2 MB per journey. Past that, the report says the body wasn't stored.
- Only run it against sites you own or are authorized to test.
- Hosting the HTTP server for other people? Also block private and cloud metadata address ranges at the network level (an egress firewall or an isolated network), as defense in depth.

## Roadmap

- Consent Check: deeper audits of cookie banners and Consent Mode v2 against GDPR/KVKK.
- Measurement Plan: draft a plan and dataLayer spec from a URL.
- Hosted version with scheduled runs, deploy webhooks, a hosted MCP server and multi-site dashboards for agencies at [analitikisler.com](https://analitikisler.com).

## Development

```bash
npm run setup   # checks Node, installs the dependencies and Chromium, says whether an AI provider key is set
npm test        # parsers, checks, each AI provider and the MCP server, end to end against the demo shop
```

The repository also has a dev container (`.devcontainer/devcontainer.json`). Open it in VS Code with the Dev Containers extension, or in GitHub Codespaces, and it runs `npm run setup` for you, Chromium's system libraries included. To use an AI model there, add your key as a Codespaces secret or export it in the container's terminal.

The end-to-end tests use fake model clients, so they run without an API key.

## Hosted version

For hosted runs, scheduling and agency dashboards, see [analitikisler.com](https://analitikisler.com).

## License

MIT © Analitik İşler
