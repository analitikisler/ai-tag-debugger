import { LANGUAGES } from "./i18n.js";
import { PROVIDERS, aiStatus } from "./providers.js";
import { JOURNEY_PRESETS } from "./journeys.js";

const journeys = Object.keys(JOURNEY_PRESETS).join(", ");

const MAIN = `aitd: an open-source AI agent that QA-tests your analytics and ad tracking.

Usage: aitd <command> [options]

Commands:
  plan     Draft a measurement plan: what should be tracked
  run      Audit what a site actually sends, and compare it to a plan
  replay   Re-check saved sites offline, without AI
  mcp      Start the MCP server for Claude, ChatGPT and other chat apps

Examples:
  aitd plan --site https://example.com
  aitd run --site https://example.com --against latest
  aitd run --site https://example.com --journey purchase
  aitd "check my GA tags on example.com"    (shows the command first; -y skips the question)

Run "aitd <command> --help" for that command's options.   -h, --help   -v, --version`;

const RUN = `Usage: aitd run --site <url> (--against <plan> | --journey <id> | --goal "<text>")

Audit what a site actually sends while an AI agent walks its journeys. Needs an AI key
(${Object.values(PROVIDERS).map((p) => p.env).join(", ")}) unless --no-ai. Each run is saved in
aitd/<domain>/runs/<id>/ and its report says what changed since the site's previous run.

What to test (at least one):
  --against <plan>     Check against a plan: latest, first, a plan ID or a plan file or folder
  --journey <id>       A ready-made journey: ${journeys} (repeatable)
  --goal "<text>"      A journey in plain language (repeatable)

Options:
  --site <url>         The site to audit
  --config <file>      Take the site and journeys from a config file
  --events <names>     Only check these events, e.g. purchase,add_to_cart
  --lang <code>        Report language: ${Object.keys(LANGUAGES).join(" or ")}
  --headed             Show the browser window
  --fail-on <level>    Exit 1 at this level: broken (default), risk, warning, never

AI:  --provider <name>   --model <id|cheap>   (default: whichever API key is set)

Advanced:
  --max-steps <n>   --platforms <list>   --viewport <name>   --data-dir <dir>
  --scripted   --no-ai   --save-site <dir>   --save-steps <file>   (see the README)
  --scripted replays each journey's fixed steps; a journey without any repeats the steps
  of its last completed run, which every run saves in its folder as steps.json.`;

const PLAN = `Usage: aitd plan --site <url>
       aitd plan list --site <url>
       aitd plan import <file> --site <url>
       aitd plan export <plan> --site <url>

Draft a measurement plan: what should be tracked. The AI explores one page of each type
and proposes events, parameters and user properties. Plans are saved in
aitd/<domain>/plans/<id>/. Needs an AI key (${Object.values(PROVIDERS).map((p) => p.env).join(", ")}).

Commands:
  (none)               Draft a new plan from the site
  list                 List the site's plan IDs, oldest first
  import <file>        Save a plan from a spreadsheet (xlsx or csv) as a new plan
  export <plan>        Write a plan to a spreadsheet to edit; <plan> is latest, first, an ID or a path

Options:
  --site <url>         The site (required)
  --topic <name>       Only plan one kind of event: custom-events, ecommerce, forms or consent
  --headed             Show the browser window

AI:  --provider <name>   --model <id|cheap>   (default: whichever API key is set)

Advanced:
  --max-steps <n>   --data-dir <dir>   --format <xlsx|csv>   (see the README)`;

const REPLAY = `Usage: aitd replay <dir>... [--update]

Audit sites saved with "aitd run --save-site <dir>" again, offline and without AI, and
list findings that changed. Exits with code 1 when any did.

Options:
  --update             Make this replay's findings the expected ones (check the changes first)

Advanced:
  --out <dir>          Where to write the reports (default: <dir>/last-replay)`;

const MCP = `Usage: aitd mcp [--http] [--port <n>]

Start the MCP server for Claude, ChatGPT, Gemini and other chat apps. It talks over
stdio unless you pass --http.

Options:
  --http               Serve over Streamable HTTP, for apps that connect to a URL
  --port <n>           HTTP port (default 8787)

Advanced:
  --host <addr>        HTTP host (default 127.0.0.1)
  --token <secret>     Secret URL path segment, at least 16 characters (default: random)
  --allow-private-network   Over HTTP, let audits open localhost and private addresses
  --reports <dir>      Where finished audits write reports (default: ~/ai-tag-debugger-reports)
  --public-url <url>   The HTTPS address of your tunnel or host, so audits can link to reports`;

const HELP = { run: RUN, plan: PLAN, replay: REPLAY, mcp: MCP };

/** Help text for a command, or the top-level help when the command is unknown or missing. */
export function helpText(command) {
  // The main help ends with which AI a run would use, so a mix of exported keys is never a surprise.
  return HELP[command] ?? `${MAIN}\n\n${aiStatus()}`;
}
