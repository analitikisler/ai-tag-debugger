# Run history: from "changed since last run" to "trend"

`src/changes.js` compares a run with the one before it. `src/history.js` reads every run in a window
(30 by default) and turns them into views the report, the CLI and the alert can show. This document
is the data model, the views with an example from the test fixture, the rules behind them, the
sparkline spec, what each surface should show, and the storage decision.

## What a run folder gives us

`aitd/<domain>/runs/<id>/capture.json` holds `config`, `runs` (one per journey and viewport, with
`completed`, `note`, `hits`, `steps`), `findings` (one per problem per journey and viewport, with
`severity`, `check`, `platform`, `event`, `journey`, `viewport`, `detail`), `explained`, and
`consentScenarios`. It does not record the tool version or the model: `renderHtml` prints `VERSION`
and `ai` into the report, but `audit.js` does not write them into the capture. The history keeps
`version` and `ai` as `null` until the lead adds them to the capture (one line in `writeReports`) or
passes them to `updateHistoryIndex`.

The run id (`YYYY-MM-DD_HHMM`, local time, from `workspace.newId`) is the date. Ids sort as strings,
which is the order every view uses.

## Data model

`loadHistory(dataDir, site, { limit = 30 })` returns the newest `limit` runs, oldest first, each a
`runSummary`:

```json
{
  "id": "2026-10-01_0900",
  "date": "2026-10-01T09:00",
  "version": null,
  "ai": null,
  "journeys": [
    { "id": "browse", "viewport": "desktop", "completed": true, "hits": 9 },
    { "id": "checkout", "viewport": "mobile", "completed": true, "hits": 20 }
  ],
  "counts": { "broken": 2, "risk": 1, "warning": 1, "info": 0, "ok": 4 },
  "findings": [
    { "key": "risk before_consent browse desktop meta PageView", "check": "before_consent", "severity": "risk",
      "platform": "meta", "event": "PageView", "journey": "browse", "viewport": "desktop" },
    { "key": "broken missing_params checkout mobile ga4 purchase", "check": "missing_params", "severity": "broken",
      "platform": "ga4", "event": "purchase", "journey": "checkout", "viewport": "mobile" }
  ]
}
```

- `counts` are the grouped counts the report header and the CLI print (`summarize(groupFindings())`):
  the same problem on four journeys is one risk, not four.
- `findings` are the problems only (`broken`, `risk`, `warning`), one per journey and viewport, with
  `ok` and `info` left out: they are confirmations and notes, and `counts` keeps their numbers.
- `key` is the replay key from `src/replay.js` (`findingKeys`): `severity check journey viewport
  platform event`. `src/history.js` has the same expression inline as `findingKey` rather than
  importing it, because `replay.js` loads the audit and the browser and the report must stay
  importable without them; `test/history.test.js` pins the two to the same output. Severity is part of
  the key, so a warning that becomes broken is "one fixed, one new", as it is for a replay.
- A run whose `capture.json` is missing or unreadable is skipped. An older capture with fields missing
  gives nulls and empty lists, never throws.

Memory: `loadHistory` reads the captures one at a time, parses, keeps the summary (about 2 KB for the
sample run) and drops the parsed object before the next read, so the peak is one capture. The sample
capture is 137 KB and reads and parses in about 3 ms; a 2 MB capture from a real shop is roughly
40 ms, so thirty of them without an index are about a second and a few hundred MB of churn. With the
index (below) it is one small file.

## Views

The test fixture (`test/history.test.js`) has seven run folders on seven days: the consent risk is
open since the first run, the duplicate `add_to_cart` goes away in the second run and comes back in
the third, the purchase problem is last seen in the second run, the third run's checkout on mobile
stops early, the fifth capture is corrupt and the sixth is missing, and the seventh run adds a TikTok
warning. Five runs load.

### Finding timeline, `findingTimeline(history)`

One entry per finding key, open ones first and the one open longest on top, then the fixed ones with
the most recently fixed on top:

```json
{ "key": "warning duplicate browse desktop ga4 add_to_cart", "check": "duplicate", "severity": "warning",
  "platform": "ga4", "event": "add_to_cart", "journey": "browse", "viewport": "desktop",
  "firstSeen": "2026-10-01_0900", "lastSeen": "2026-10-07_0900", "seenIn": 4,
  "openNow": true, "openSince": "2026-10-03_0900", "flapping": true, "fixedIn": null }

{ "key": "broken missing_params checkout mobile ga4 purchase", "check": "missing_params", "severity": "broken",
  "platform": "ga4", "event": "purchase", "journey": "checkout", "viewport": "mobile",
  "firstSeen": "2026-10-01_0900", "lastSeen": "2026-10-02_0900", "seenIn": 2,
  "openNow": false, "openSince": null, "flapping": false, "fixedIn": "2026-10-04_0900" }
```

`openSince` is the start of the current unbroken streak (`firstSeen` unless it flapped), which is what
"open for N runs" should count. Note the purchase problem: it is absent in the third run, but that
run's checkout on mobile did not complete, so it is fixed in the fourth run, not the third.

### Trend, `trend(history)`

```json
{
  "runs": 5, "first": "2026-10-01_0900", "last": "2026-10-07_0900",
  "series": [
    { "id": "2026-10-01_0900", "date": "2026-10-01T09:00", "broken": 2, "risk": 1, "warning": 1, "score": 9, "complete": true },
    { "id": "2026-10-02_0900", "date": "2026-10-02T09:00", "broken": 2, "risk": 1, "warning": 0, "score": 8, "complete": true },
    { "id": "2026-10-03_0900", "date": "2026-10-03T09:00", "broken": 0, "risk": 1, "warning": 1, "score": 3, "complete": false },
    { "id": "2026-10-04_0900", "date": "2026-10-04T09:00", "broken": 0, "risk": 1, "warning": 1, "score": 3, "complete": true },
    { "id": "2026-10-07_0900", "date": "2026-10-07T09:00", "broken": 0, "risk": 1, "warning": 2, "score": 4, "complete": true }
  ],
  "direction": "improving",
  "openLongest": [
    { "check": "before_consent", "severity": "risk", "platform": "meta", "event": "PageView", "openSince": "2026-10-01_0900", "runsOpen": 5,
      "places": [{ "journey": "browse", "viewport": "desktop" }, { "journey": "browse", "viewport": "mobile" }, { "journey": "checkout", "viewport": "desktop" }, { "journey": "checkout", "viewport": "mobile" }], "…": "…" },
    { "check": "duplicate", "severity": "warning", "platform": "ga4", "event": "add_to_cart", "openSince": "2026-10-03_0900", "runsOpen": 3, "flapping": true, "…": "…" },
    { "check": "cookie_without_consent", "severity": "warning", "platform": "tiktok", "event": null, "openSince": "2026-10-07_0900", "runsOpen": 1, "…": "…" }
  ],
  "fixedRecently": [ { "check": "missing_params", "platform": "ga4", "event": "purchase", "fixedIn": "2026-10-04_0900", "…": "…" }, { "check": "missing_params", "platform": "meta", "event": "Purchase", "…": "…" } ],
  "newRecently": [ { "check": "cookie_without_consent", "platform": "tiktok", "firstSeen": "2026-10-07_0900", "…": "…" } ],
  "flapping": [ { "check": "duplicate", "platform": "ga4", "event": "add_to_cart", "seenIn": 4, "places": ["…4 places"], "…": "…" } ]
}
```

The four lists hold one entry per problem (grouped by severity, check, platform and event, as the
report groups findings) with its `places`, so "Meta PageView before consent" is one line with four
places, not four lines. The timeline stays per key for anyone who needs the exact places.

### Journey stability, `journeyStability(history)`

Least reliable first:

```json
[
  { "id": "checkout", "viewport": "mobile", "runs": 5, "completed": 4, "completionRate": 0.8, "lastFailure": "2026-10-03_0900", "avgHits": 17 },
  { "id": "browse", "viewport": "desktop", "runs": 5, "completed": 5, "completionRate": 1, "lastFailure": null, "avgHits": 9 },
  { "id": "browse", "viewport": "mobile", "runs": 5, "completed": 5, "completionRate": 1, "lastFailure": null, "avgHits": 9 },
  { "id": "checkout", "viewport": "desktop", "runs": 5, "completed": 5, "completionRate": 1, "lastFailure": null, "avgHits": 20 }
]
```

`avgHits` is over every run the journey ran in, including failed ones, so a drop in the average is
visible when the journey starts stopping early. This view answers "is the navigation reliable on this
site" before anyone reads the tracking findings into it.

### Summary lines, `historySummaryLines(trend, lang, stability?)`

English:

```
Trend over 5 runs (2026-10-01 → 2026-10-07): improving. Now 0 broken · 1 risk · 2 warning; 3 runs ago 2 broken · 1 risk · 0 warning.
Open longest: Meta PageView before_consent in 4 places since 2026-10-01 (5 runs); GA4 add_to_cart duplicate in 4 places since 2026-10-03 (3 runs); TikTok cookie_without_consent since 2026-10-07 (1 run).
Flapping (seen, gone, back again): GA4 add_to_cart duplicate in 4 places in 4 of 5 runs.
Journeys that do not finish every time: checkout (mobile) 80%.
```

Turkish:

```
5 çalıştırmada eğilim (2026-10-01 → 2026-10-07): iyileşiyor. Şimdi 0 bozuk · 1 risk · 2 uyarı; 3 çalıştırma önce 2 bozuk · 1 risk · 0 uyarı.
En uzun süredir açık: Meta PageView before_consent 4 yerde 2026-10-01 tarihinden beri (5 çalıştırma); …
```

The strings live in a small table in `src/history.js` for the lead to move into `src/i18n.js`
(`ui.history.*`); an unknown language falls back to English. With no runs or one run the function
returns a single line saying so.

## Rules

**Evidence.** A run says something about a finding only if the finding's journey and viewport
completed in that run. Present: *seen*. Absent and the journey completed: *gone*. Absent and the
journey did not complete, or was not run (the config changed): *unknown*, and the run is skipped for
that finding. A finding from an older capture without a journey has nothing to check, so absent means
gone. Without this rule a crashed checkout would "fix" every purchase problem and the next good run
would "reintroduce" them.

**Open now.** The last known state is *seen*. **Fixed in:** the first *gone* run after `lastSeen`;
`null` while open. **Open since:** the first run of the current unbroken run of *seen* states.

**Flapping.** Any *gone* run strictly between `firstSeen` and `lastSeen`. A finding that was fixed and
stayed fixed is not flapping; one that came back is, whether or not it is open now. Flapping usually
means the check depends on timing or on which product the AI picked, which is worth knowing before
someone spends a day on it.

**Open longest.** Open findings sorted by `openSince` ascending, then severity (broken, risk,
warning), then key. The trend's `openLongest` is the first five problems after grouping.

**Recently.** `fixedRecently` and `newRecently` look at the last 3 runs of the window (`RECENT`),
not just the last one, so a weekly reader who missed a run still sees the change.

**Score.** `3·broken + 2·risk + 1·warning` per run, from the grouped counts; lower is better. It is the
one number a sparkline and the direction can use, and nothing else in the product shows it yet.

**Direction.** Take the complete runs only (every journey finished). Compare the mean score of the
last `n` with the `n` before them, where `n = min(3, floor(count / 2))`: lower is *improving*, higher
is *worsening*, equal is *flat*. Fewer than two complete runs: *flat*. With 2-3 runs this is one against
one; with 4-5 two against two; from six on three against three, and runs older than those six do not
count, so a bad first week does not flatter the site forever. Incomplete runs are left out because a
journey that stopped early hides findings rather than fixing them; they still appear in the series,
marked `complete: false`.

## Sparkline spec (for the Art Director)

- **Series:** `trend.series`, oldest left, newest right, up to 30 points (the `limit`). Three stacked
  or three separate lines for `broken`, `risk`, `warning` in the severity colors the report already
  uses, or a single line of `score` when there is room for only one. Prefer the three counts in the
  report card and the single score line in the Slack text (as a sparkline string, see below).
- **Scale:** integers from 0; the y range is 0 to the max of the series (not the current value), with
  at least 3 so a site with one warning does not draw a wall. Same scale across the three lines so
  they compare. No smoothing: these are counts, and a step from 2 to 0 is the story.
- **Points:** one per run. Mark the last point. A run with `complete: false` is a hollow point (or a
  dashed segment into it), with a title "checkout (mobile) did not finish", because its lower counts
  are not a fix; the direction already ignores it.
- **Gaps:** runs are not evenly spaced in time (weekly, then three in a day). Space points evenly by
  run, not by date, and show the date in the hover title; the series carries `date` for that. A run
  folder without a readable capture is simply not a point.
- **Different journeys:** when the run's journeys differ from the latest run's (a journey was added or
  removed in the config), keep the point but mark it like an incomplete one and title it "different
  journeys". Compare `journeys` of that run with the last run's; `history.js` leaves this to the
  renderer because the runSummary has both lists. Counts of runs with fewer journeys are naturally
  lower and that is not an improvement.
- **Fewer than 2 points:** no sparkline, one line of text ("the trend starts with the next run").
- **Text sparkline** for the CLI and Slack: map `score` onto `▁▂▃▄▅▆▇█` (eight levels over 0..max,
  `·` for an incomplete run), e.g. `█▇·▃▄` for the fixture (the third run did not finish). Monospace only; in Slack it is fine inside
  a code span.

## How the report's "Changed since last run" becomes "Trend"

Today the overview tab starts with the `changes` card (`changesCard` in `report.js`): a headline
"1 problem fixed, 1 new problem", the fixed and new items, and the route change. It should become one
card, "Trend", in three rows:

1. **The sparkline row:** the three-count sparkline over the window with the direction word and the
   span ("improving over 5 runs since 2026-10-01"). This is `trend.series` and `trend.direction`.
2. **The diff row:** exactly today's fixed and new items, unchanged, because "since the last run" is
   still the most actionable part. Below it, when non-empty, the `flapping` problems with "seen in 4
   of 5 runs" so a reader does not celebrate a fix that is really a flap.
3. **The open-longest row:** `trend.openLongest`, each with its first-seen date, run count and places,
   linking to the finding in the findings list. This is the row that creates pressure to fix: "Meta
   PageView fires before consent, open since 2026-10-01, 5 runs, 4 places".

The journey stability table goes into the journeys tab, not the overview, as a small line under each
journey header ("completed 4 of 5 runs, last failure 2026-10-03, 17 hits on average"), and into the
overview only when a journey's rate is below 1, as a warning line under the sparkline.

Reports written with `--out` (not in the runs folder) have no history and keep today's card.

## What the CLI prints after a run

Two lines by default, a third when there is something to say, from `historySummaryLines`:

```
Trend over 5 runs (2026-10-01 → 2026-10-07): improving. Now 0 broken · 1 risk · 2 warning; 3 runs ago 2 broken · 1 risk · 0 warning.
Open longest: Meta PageView before_consent in 4 places since 2026-10-01 (5 runs); GA4 add_to_cart duplicate in 4 places since 2026-10-03 (3 runs).
Journeys that do not finish every time: checkout (mobile) 80%.
```

The first run says "One saved run; the trend starts with the next one." and nothing else. A new
`aitd history --site <url> [--limit 30] [--json]` command prints the same lines plus the text
sparkline, and with `--json` the `trend`, `timeline` and `stability` objects for scripts and MCP.

## What the Slack alert adds

`alertMessage` in `notify.js` sends the `changesLines`. Add, after them, the first line of
`historySummaryLines` (the direction with now versus three runs ago) and the flapping line when there
is one, with the text sparkline at the end of the direction line. Do not add the open-longest line to
every alert: it is the same every week and trains people to skip the message. Instead send it when a
problem crosses a round number of runs open (5, 10, 20), as its own line "Still open after 10 runs:
…". `hasChanges` keeps deciding whether an alert goes out at all; the trend never triggers one alone.

## Storage: write `aitd/<domain>/history.json`

Recommendation: yes, keep a small index, and `updateHistoryIndex` implements it.

Reasons. Re-reading every capture is fine for the sample (137 KB, 3 ms) but a real capture holds every
hit's parameters, the dataLayer log and network calls for every step, and runs to a few MB; thirty of
them is about a second and hundreds of MB of allocation on every report render, every CLI call and
every MCP `history` request, and it grows with the window. The summary is about 2 KB per run (3.8 KB
pretty-printed), so a year of daily runs is under 1 MB and reads in a millisecond. The index is also
what lets `version` and `ai` be recorded, since the capture does not hold them.

Shape: `{ version: 1, site, updated, runs: [runSummary, …] }`, sorted by id. `updateHistoryIndex(dataDir,
site, { id, capture, version, ai })` replaces or adds the run's entry and drops entries whose run folder
is gone, so `aitd clean` or a manual `rm` needs no extra step. It never throws on a missing or corrupt
index: the file is rebuilt from what it has.

Safety: the index is a cache, not the truth. `loadHistory` lists the run folders first, takes an entry
from the index when one exists and reads the capture when it does not, so a run saved by an older
version of the tool (no index yet), a folder copied in from another machine, or a corrupt index all
still work; the only cost is the capture reads for the runs that are missing from the index. Deleting
`history.json` is always safe. An index entry wins over its capture once written, so a hand-edited
capture is not re-read; that is acceptable because nobody edits captures, and `aitd history --rebuild`
(delete the file, load, write) covers the rest.

Where to call it: in `audit.js` right after `writeReports`, only for runs saved in the runs folder (not
`--out`), with `{ id: path.basename(outDir), capture: { runs, findings }, version: VERSION, ai }`; the
summary needs only `runs` and `findings`, so the audit need not re-read what it just wrote.
