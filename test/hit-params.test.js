import { test } from "node:test";
import assert from "node:assert/strict";
import { hitParams } from "../src/hit-params.js";

test("two events of one name in a GA4 batch each show their own parameters", () => {
  const url = "https://www.google-analytics.com/g/collect?v=2&tid=G-1";
  const hits = [25, 50].map((percent) => ({ platform: "ga4", name: "scroll", step: 1, url, params: { percent_scrolled: String(percent) } }));
  // gtag.js joins a batch with \r\n.
  const run = { hits, network: [{ step: 1, url, postData: "en=scroll&epn.percent_scrolled=25\r\nen=scroll&epn.percent_scrolled=50" }] };
  const shown = hits.map((h) => hitParams(run, h));
  assert.deepEqual(shown.map((s) => s.batch), [[1, 2], [2, 2]]);
  assert.deepEqual(shown.map((s) => s.event.find(([k]) => k === "epn.percent_scrolled")[1]), ["25", "50"]);
});
