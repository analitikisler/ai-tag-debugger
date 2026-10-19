# ai-tag-debugger

An open-source Node CLI and MCP server that QA-tests a website's analytics and ad tracking. An AI model (or a scripted replay) drives a real browser through a journey with Playwright; the tool records every tracking hit and dataLayer push, checks them against a measurement plan with deterministic rules, and writes an HTML, Markdown and CSV report in English or Turkish. README.md is the user manual and CONTRIBUTING.md the contributor guide; read them before changing behavior.

## Pipeline

1. Plan and journeys: `src/discover.js` drafts a plan, `src/journeys.js` holds the ready-made journeys, `src/learn.js` learns one from a first run, `src/sheet.js` imports and exports it.
2. Browse: `src/agent.js` runs the model loop through `src/providers.js`; `src/browser.js` (`AuditSession`) drives Chromium within the limits of `src/guard.js` and `src/egress.js`.
3. Capture: `src/parsers.js` turns requests into hits, `src/redact.js` strips user data, `src/consent.js` and `src/inventory.js` add consent scenarios and the tag inventory, `src/gtm.js` reads a container export.
4. Check: `src/checks.js` emits findings with no model call; `src/verify.js` adds owners and verify links; `src/changes.js` compares with the previous run.
5. Explain and report: `src/report.js` asks the model for causes and fixes and renders the reports with strings from `src/i18n.js`.
6. After the run: `src/audit.js` ties it together, `src/workspace.js` places the folders, `src/notify.js` sends alerts, `src/replay.js` replays saved sites. Entry points are `src/cli.js`, `src/ask.js` and `src/mcp.js`.

## Commands

```bash
npm run setup                     # npm ci + Chromium
npm test                          # all tests, no API key needed (fake model clients)
node --test test/checks.test.js   # one test file
npm run demo:serve                # demo shop on http://localhost:4321
npm run demo                      # scripted, no-AI run against it, saved under aitd/localhost/runs/
```

## Conventions

- Plain ESM JavaScript on Node 20+. No build step, no TypeScript, no transpiling.
- Tests use `node:test` and `node:assert/strict`; one file per concern in `test/`.
- Comments say why something is there, not what the code does.
- All user-visible strings live in `src/i18n.js` and exist in every language in `LANGUAGES` (`en` and `tr`).
- Every new flag, config field or MCP parameter gets a row in README's tables, and every user-visible change gets a line in CHANGELOG.md.
- `server.json` carries the same version as `package.json` in two places; `test/server-json.test.js` enforces it.
- Commit messages are one imperative sentence about what changed for the user.

## Do not

- Add a dependency without discussing it first. The project ships the official AI SDKs, Playwright, zod and the MCP SDK, and `fflate` as an optional one.
- Introduce TypeScript, a bundler or any build step.
- Skip, weaken or delete a test to make a change pass. Fix the code or the test's expectation with a reason.
- Edit README.tr.md without making the same change in README.md, or the other way round.
- Put a user-facing string in a module other than `src/i18n.js`, or in one language only.
- Loosen the navigation limits, redaction or the HTTP server's checks (see SECURITY.md).

## Where things live

Plans and runs go under `aitd/` in the working directory unless `--data-dir` says otherwise (`DEFAULT_DATA_DIR` in `src/workspace.js`):

```
aitd/
  example.com/                  domainOf(site): the host without www.
    plans/2026-10-16_0900/      measurement-plan.json, plan.html, plan.xlsx after an export
    runs/2026-10-16_0912/       report.html, report.md, timeline.csv, capture.json,
                                plan-check.json with --against, report.pdf with pdf: true
```

IDs are local time, `YYYY-MM-DD_HHMM`, with seconds added when the minute is taken (`newId`). Folders are never overwritten. `resolvePlan` turns `latest`, `first`, a plan ID or a path into a plan file. The MCP server writes reports to `~/ai-tag-debugger-reports` unless `--reports` is given. `aitd/`, `reports/` and `saved/` are gitignored.
