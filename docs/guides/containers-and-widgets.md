# Google containers, embedded widgets and iframes

*[Türkçe](containers-and-widgets.tr.md)*

A site's tracking is rarely one GTM snippet any more. Containers load other containers, Google tags load their own destinations, consent platforms load GTM after a choice, and booking, chat and payment widgets run their own tracking inside iframes. This guide explains what ai-tag-debugger reports about all of that, what each finding usually means, and how to fix it.

Everything here is in the **Inventory** section of `report.html`, in `report.md`, and over MCP (see [Over MCP](#over-mcp)).

## The Google containers card

One line per GTM container (`gtm.js`) and Google tag (`gtag/js`) the pages loaded, with:

- **How it got there.** The browser notes each container script as it is added and, when a script added it, which scripts were running at that moment. So the source is read from the page, not guessed from the network request.

  | Source | What it usually is |
  |---|---|
  | A script tag in the page's HTML | The `gtag.js` snippet, or `gtm.js` added by hand |
  | Inline code in the page (the snippet) | The GTM snippet |
  | Another script on the page: *address* | A consent platform loading GTM after the visitor chose, a theme or app bundle, another tag manager |
  | A Custom HTML tag in GTM-… | A tag in that container that writes a `<script>` |
  | A Google tag in GTM-… | A Google tag, GA4 or Ads template in that container |
  | GTM-… itself: a Zone or a tag template | One container loading another |
  | A `gtag('config')` command | The page configured that destination |
  | An event's `send_to` with no config | The destination was loaded only because an event was sent to it |
  | A destination of the Google tag | A destination linked to the Google tag in Google's own settings |

- **Version, size and load time.** The version is the number the container was published as, the same as in GTM's Versions tab. If it isn't the version you just published, the site is caching an old one, or a different container or environment is live.
- **dataLayer** the container reads, when it isn't `dataLayer`.
- **Served from** Google, or the site's own domain (the Google tag gateway or a server container).
- **GTM environment**, when the snippet names one, and **iframe**, when it ran inside one.

### Container findings

| Finding | What it means | What to do |
|---|---|---|
| `container_failed` (warning) | The container script failed to load or was answered with an error, so none of its tags ran on that page. | Check the container ID and the address in the snippet. For a server container or the Google tag gateway, check that it serves `gtm.js` and `gtag/js`. |
| `container_duplicate` (warning) | The same container was loaded twice into one page, for example by the snippet and again by a consent platform or a Custom HTML tag. Its tags can fire twice. | Keep one install: remove the extra snippet, or the tag that loads it again. |
| `container_environment` (warning) | The snippet loads a GTM environment (`gtm_preview`, `gtm_auth`) instead of Live, so visitors get a staging or development version. | Use the Live snippet in production, or publish what the environment holds to Live. |
| `datalayer_split` (info) | Containers on one page read different dataLayers. A push to one never reaches the others. | Point every container at the same dataLayer, or push events and consent commands to each one. |
| `container_send_to_only` (info) | A destination was loaded only by an event's `send_to`, with no `gtag('config')`, so it runs with default settings. | Add a `gtag('config', ID)` before the events that send to it, or a Google tag for it in GTM. |

## Embedded widgets

A third-party iframe (a booking, chat or payment widget, a video) can run its own tracking to its own vendor's accounts. ai-tag-debugger records which iframe every hit, dataLayer push and container load came from, and decides whose tracking it is:

- From the page itself or an iframe on the site's own domain (a checkout or form on a subdomain): **the site's**.
- From a third-party iframe, to an account the site's own tags also use (a booking engine set up with the site's GA4 ID): **the site's**.
- From a third-party iframe, to any other account: **the widget's**.

A widget's own tracking is left out of everything that judges the site's tracking: plan matching, coverage, duplicates, unplanned events and the scores. A widget's `purchase` to its vendor's GA4 can't pass for the site's. It still counts for consent and personal data, because the site answers for what the widgets it embeds collect. Those findings begin with "In an embedded widget from …".

The **Embedded widgets** card shows, per widget, where it was embedded, the containers it loaded, the tracking it sent to its own accounts and to the site's, the events in its own dataLayer, and the events it pushed that never reached the site's accounts.

| Finding | What it means | What to do |
|---|---|---|
| `widget_tracking` (info) | The widget sent tracking to its own accounts; it was kept out of the plan checks. | Nothing for the plan. If it tracks before consent, the consent findings name it. |
| `widget_events_unshared` (info) | The widget pushed events to its own dataLayer, such as a completed booking, that never reached the site's accounts. The page's tags can't read a widget's dataLayer. | Most booking and form widgets take a GA4 or GTM ID in their settings: give them the site's. Otherwise relay the event to the page (see below). |

## Iframes on the site's own domain

| Finding | What it means | What to do |
|---|---|---|
| `iframe_container` (info) | A container runs in a same-site iframe beside the page's own. The iframe has its own dataLayer: the page's events and consent never reach it. | Push the events and the consent state inside the iframe too, or track the iframe's steps from the page. |
| `iframe_message_unhandled` (info) | An iframe posted an event to the page with `postMessage`, such as "form submitted", but the page pushed nothing to its dataLayer and sent no hit right after. | Add a listener on the page that relays it, as below. |

### Messages from iframes

Forms, checkouts and booking widgets often tell the page when they are done, with `postMessage`. The **Messages from iframes** card lists each event an iframe posted and what the page did next:

- **pushed or sent the same event:** relayed.
- **pushed another event or sent a hit within 3 seconds:** most likely the same event under another name.
- **nothing:** the page isn't listening, and `iframe_message_unhandled` is reported.

Only the message's name and the names of its fields are recorded, never their values, since a form's message can carry what the visitor typed. Housekeeping messages (resizing, ready and heartbeat pings) are left out.

A listener that relays an iframe's event to the page's dataLayer, so a GTM trigger can fire on it:

```html
<script>
  window.dataLayer = window.dataLayer || [];
  window.addEventListener("message", function (e) {
    // Only trust the iframe you expect.
    if (e.origin !== "https://booking.example.com") return;
    var data = typeof e.data === "string" ? safeParse(e.data) : e.data;
    if (data && data.event === "booking_complete") {
      window.dataLayer.push({ event: "booking_complete", booking_value: data.value });
    }
  });
  function safeParse(s) { try { return JSON.parse(s); } catch (err) { return null; } }
</script>
```

Then add a Custom Event trigger for `booking_complete` in GTM and fire the GA4 and ad conversion tags on it.

## Over MCP

In a chat app connected to the MCP server:

- Each step result lists the containers it loaded, the hits that came from an iframe (and whether the plan checks count them), and the messages iframes posted.
- `get_containers` and `get_widgets` list what an open audit has seen so far.
- `finish_audit` and `run_audit` end with the containers, widgets and messages.
- `get_report` returns them as JSON with `part: "containers"`, `"widgets"` or `"messages"`.

For example: *"Audit shop.example's booking page and tell me whether the booking widget's conversions reach our GA4."*
