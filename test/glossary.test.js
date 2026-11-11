// The parameter dictionary (src/glossary.js): labels, groups, tips and value hints per platform, in both languages,
// as the side panel's Readable and All parameters views and the HTML report read them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupsOf, isCustomParam, itemField, ITEM_GROUPS, paramGroup, paramHint, paramLabel, paramTip } from "../src/glossary.js";

test("GA4 keys get a label and a group, and the parameter's own name labels an ep./up. key", () => {
  assert.equal(paramLabel("cu"), "Currency");
  assert.equal(paramLabel("cu", "tr"), "Para birimi");
  assert.equal(paramGroup("gcs"), "consent");
  assert.equal(paramGroup("uafvl", "ga4"), "device");
  assert.equal(paramGroup("_et"), "session");
  assert.equal(paramLabel("ep.page_type"), "page_type");
  assert.equal(isCustomParam("ep.page_type"), true);
  // A recommended parameter has a real label and is no custom one.
  assert.equal(paramLabel("ep.item_list_name"), "Item list name");
  assert.equal(isCustomParam("epn.value"), false);
  assert.equal(paramLabel("upn.lifetime_orders"), "lifetime_orders");
  assert.equal(paramGroup("up.user_type"), "user");
  assert.equal(paramLabel("pr3", "tr"), "3. ürün");
  assert.equal(paramLabel("sst.etld"), "Server hint: etld");
  // Server-side tagging keys are grouped apart, so a server container's additions are easy to find.
  assert.equal(paramGroup("sst.etld"), "server");
  assert.equal(paramGroup("richsstsse"), "server");
});

test("an unknown key keeps its name, goes to Other and has no tip", () => {
  assert.equal(paramLabel("zz_new"), "zz_new");
  assert.equal(paramGroup("zz_new"), "other");
  assert.equal(paramTip("zz_new"), null);
  assert.deepEqual(groupsOf("ga4").slice(0, 4), ["event", "user", "session", "consent"]);
  assert.equal(groupsOf("clarity"), groupsOf("ga4"));
});

test("the same key means different things per platform, and old callers without one still get the shared tip", () => {
  assert.equal(paramLabel("v", "en", "ga4"), "Protocol version");
  assert.equal(paramLabel("v", "en", "meta"), "Pixel version");
  assert.match(paramTip("v", "en", "meta"), /fbevents\.js/);
  assert.match(paramTip("v"), /Protocol version/);
  assert.equal(paramLabel("r", "en", "adobe"), "Referrer");
  assert.equal(paramLabel("cd[content_ids]", "tr", "meta"), "İçerik kimlikleri");
  assert.equal(isCustomParam("cd[fabric]", "meta"), true);
  assert.equal(paramLabel("v12", "en", "adobe"), "eVar 12");
  assert.equal(paramGroup("ec_items", "matomo"), "commerce");
  assert.equal(paramLabel("tiba", "tr", "google_ads"), "Sayfa başlığı");
  // The gcd tip explains its letters for Google platforms, in both languages.
  assert.match(paramTip("gcd", "en", "ga4"), /r denied, updated granted/);
  assert.match(paramTip("gcd", "tr"), /güncelleme izin verildi/);
  assert.match(paramTip("_gaz", "en", "ga4"), /does not document/);
});

test("values get a short reading where the dictionary has one", () => {
  assert.equal(paramHint("seg", "1"), "yes");
  assert.equal(paramHint("seg", "1", "tr"), "evet");
  assert.equal(paramHint("_et", "2140"), "2.1 s");
  assert.equal(paramHint("gcs", "G100"), "ad ✕ analytics ✕");
  assert.equal(paramHint("npa", "0"), "personalised");
  assert.equal(paramHint("dl", "https%3A%2F%2Fshop.example%2F"), "https://shop.example/");
  assert.equal(paramHint("dl", "https://shop.example/"), null);
  assert.equal(paramHint("uafvl", "Chromium;142.0|Google%20Chrome;142.0"), "Chromium 142.0\nGoogle%20Chrome 142.0");
  assert.equal(paramHint("tid", "G-1"), null);
});

test("item fields carry their wire key, group and label", () => {
  assert.deepEqual(itemField("item_brand"), { wire: "br", group: "product", label: "Brand" });
  assert.deepEqual(itemField("discount", "tr"), { wire: "ds", group: "price", label: "İndirim" });
  assert.equal(itemField("zz").group, "other");
  assert.ok(ITEM_GROUPS.includes("custom"));
});
