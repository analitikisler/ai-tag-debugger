// The side panel's platform filter (extension/panel/views/filter.js): All, toggling, solo, and the way back to the
// default, as the chips and the "Not selected" popover use it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { allShown, chipClick, shownKeys } from "../extension/panel/views/filter.js";

const sets = { selected: ["ga4", "meta"], unselected: ["hotjar"], hasOther: true };
const DEFAULT = { on: null, extra: new Set() };
const shown = (f) => [...shownKeys(f, sets)].sort();

test("the default shows the selected platforms, and All is off", () => {
  assert.deepEqual(shown(DEFAULT), ["ga4", "meta"]);
  assert.equal(allShown(DEFAULT, sets), false);
});

test("All shows everything captured, and a second click goes back to the default", () => {
  const all = chipClick(DEFAULT, "all", sets);
  assert.deepEqual(shown(all), ["ga4", "hotjar", "meta", "other"]);
  assert.equal(allShown(all, sets), true);
  assert.deepEqual(chipClick(all, "all", sets), DEFAULT);
});

test("a platform chip with All on turns only that platform off", () => {
  const all = chipClick(DEFAULT, "all", sets);
  const noMeta = chipClick(all, "meta", sets);
  assert.deepEqual(shown(noMeta), ["ga4", "hotjar", "other"]);
  assert.equal(allShown(noMeta, sets), false);
  // Clicking All again from there shows everything once more.
  assert.equal(allShown(chipClick(noMeta, "all", sets), sets), true);
});

test("toggling a chip off and on again lands back on the default", () => {
  const off = chipClick(DEFAULT, "ga4", sets);
  assert.deepEqual(shown(off), ["meta"]);
  assert.deepEqual(chipClick(off, "ga4", sets), DEFAULT);
});

test("an unselected platform shown from the popover is added, then hidden again", () => {
  const withHotjar = chipClick(DEFAULT, "hotjar", sets);
  assert.deepEqual(shown(withHotjar), ["ga4", "hotjar", "meta"]);
  assert.deepEqual(chipClick(withHotjar, "hotjar", sets), DEFAULT);
});

test("solo shows only that platform", () => {
  assert.deepEqual(shown(chipClick(DEFAULT, "meta", sets, { solo: true })), ["meta"]);
  assert.deepEqual(shown(chipClick(DEFAULT, "hotjar", sets, { solo: true })), ["hotjar"]);
});
