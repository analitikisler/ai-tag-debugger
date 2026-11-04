# ai tag debugger

Ask Claude to QA-test a website's analytics, ad and consent tracking: GA4, Google Tag Manager, Google Ads, Meta Pixel, TikTok Pixel and Consent Mode, plus a dozen other platforms. Claude drives a real Chromium browser on your computer through the journey you describe (a purchase, a sign-up, a lead form, rejecting cookies), records every tracking hit and dataLayer push, checks them against your measurement plan with fixed rules, and explains what is broken, why, and how to fix it. Reports are written as HTML, Markdown and CSV, in English or Turkish.

This plugin adds the open-source [ai-tag-debugger](https://github.com/analitikisler/ai-tag-debugger) MCP server and a skill that walks Claude through a good audit. Audits need no API key: the model in your Claude app does the thinking.

## Install

In Claude Code:

```
/plugin install ai-tag-debugger --marketplace analitikisler/ai-tag-debugger
```

Or find **ai tag debugger** in the plugin directory. Then ask, for example: "Check the purchase tracking on shop.example.com" or "Does my consent banner stop Meta from tracking when I reject cookies?"

It works where Claude can run programs on your computer: Claude Code, and Cowork running on your computer. It needs Node.js 22 or later.

## What it runs, fetches and writes

- **The server.** The plugin starts `npx -y @analitikisler/ai-tag-debugger@<version> mcp` on your computer, so npm downloads that exact version of the package the first time.
- **A local browser.** The first audit downloads Chromium (about 150 MB, once) from Playwright's download servers. Each audit opens a headless Chromium on your computer, or, when you ask for it with `connect`, a fresh private window in a Google Chrome you started with a debugging port on the same computer; that window closes when the audit ends and your Chrome keeps running.
- **The sites you name.** The browser visits only the site you ask about (its subdomains and any hosts you allow), loading its pages and scripts like a visitor would. It uses obvious test data and never enters real payment details.
- **Tracking requests are kept out of your accounts.** Collection requests to GA4, Google Ads, Meta, TikTok and the other platforms it reads are answered inside the browser, so test traffic does not reach the site's analytics or ad accounts. Tag scripts and some vendors it only recognises by host still load from their servers. Only when you ask for a live audit (`live: true`) are tracking requests let through to the real accounts.
- **Personal data.** Email addresses and other user data in hits are redacted before anything is stored; cookie values and the values of messages iframes post are never stored.
- **Files.** Reports are written to `~/ai-tag-debugger-reports` on your computer. Saved measurement plans and runs go under `aitd/` in the folder the server runs in.
- **Logins.** A test account you set in `AITD_LOGIN_EMAIL` and `AITD_LOGIN_PASSWORD` is typed only into the audited site's pages; Claude sees only placeholders, and the values are kept out of everything the tool stores. A login session saved with `aitd login` lives in `aitd/<domain>/session.json`, readable only by you.
- **AI providers, only if you set them up.** Two tools can call an AI provider's API: `make_plan` (drafting a measurement plan) and `run_audit` with `scripted: false` (browsing with a model instead of Claude). They work only when `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GEMINI_API_KEY` is set on your computer, and then send the pages they explore and the tracking they capture to that provider. Without a key they say so and do nothing.
- **Alerts, only if a config file asks.** `run_audit` with a config file that has a `notify` block sends a summary of what changed to the Slack webhook or email address it names.
- **Nothing is sent to us.** The tool has no telemetry and sends nothing to Analitik İşler. Apart from the two cases above, its only network traffic is npm, Playwright's Chromium download, and the sites you audit.

## Learn more

The [full documentation](https://github.com/analitikisler/ai-tag-debugger#readme) covers every finding, the tools Claude can call, and the CLI. The guide to [Google containers, embedded widgets and iframes](https://github.com/analitikisler/ai-tag-debugger/blob/main/docs/guides/containers-and-widgets.md) explains the container and widget findings.

Made by [Analitik İşler](https://analitikisler.com). MIT licence.
