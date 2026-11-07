// The Chrome extension's manifest. Chrome refuses webRequest listeners when site access is only optional (granted
// later), so the worker would never hear a tracking request; an earlier build shipped that way and the test copy
// of the extension, which granted access at install, hid it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));

test("site access is declared in host_permissions, as webRequest requires", () => {
  assert.ok(manifest.permissions.includes("webRequest"));
  for (const origin of ["http://*/*", "https://*/*"]) assert.ok(manifest.host_permissions?.includes(origin), origin);
  assert.equal(manifest.optional_host_permissions, undefined, "optional access leaves the request listeners unregistered");
});

test("the store names fit Chrome's limits", async () => {
  assert.ok(manifest.short_name.length <= 12, manifest.short_name);
  for (const lang of ["en", "tr"]) {
    const m = JSON.parse(await readFile(new URL(`../extension/_locales/${lang}/messages.json`, import.meta.url), "utf8"));
    assert.ok(m.name.message.length <= 75, `${lang} name`);
    assert.ok(m.description.message.length <= 132, `${lang} description`);
  }
});
