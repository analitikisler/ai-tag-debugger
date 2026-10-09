// A tiny stand-in for gtag.js and the Meta Pixel, configured the way a
// GTM container might be. It contains a deliberate bug (see README).
(function () {
  var GA4_ID = "G-DEMO12345";
  var META_ID = "000000000000001";
  var consent = { ad_storage: "denied", analytics_storage: "denied" };
  var clientId = "555.666";

  function gcs() {
    return "G1" + (consent.ad_storage === "granted" ? "1" : "0") + (consent.analytics_storage === "granted" ? "1" : "0");
  }

  function sendGa4(name, params) {
    var q = new URLSearchParams({ v: "2", tid: GA4_ID, cid: clientId, en: name, gcs: gcs(), dl: location.href, dt: document.title });
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v === undefined || v === null) return;
      if (k === "currency") q.set("cu", v);
      else if (k === "items") v.forEach(function (it, i) { q.set("pr" + (i + 1), "id" + it.item_id + "~nm" + it.item_name + "~pr" + it.price + "~qt" + (it.quantity || 1)); });
      else if (typeof v === "number") q.set("epn." + k, String(v));
      else q.set("ep." + k, String(v));
    });
    navigator.sendBeacon("https://region1.google-analytics.com/g/collect?" + q.toString());
  }

  function sendMeta(name, data) {
    var q = new URLSearchParams({ id: META_ID, ev: name, dl: location.href });
    Object.keys(data || {}).forEach(function (k) { q.set("cd[" + k + "]", String(data[k])); });
    new Image().src = "https://www.facebook.com/tr/?" + q.toString();
  }

  var META_EVENTS = { add_to_cart: "AddToCart", begin_checkout: "InitiateCheckout", purchase: "Purchase" };

  function handle(entry) {
    if (entry && typeof entry === "object" && entry[0] === "consent") {
      consent.ad_storage = entry[2].ad_storage || consent.ad_storage;
      consent.analytics_storage = entry[2].analytics_storage || consent.analytics_storage;
      return;
    }
    if (!entry || !entry.event || entry.event.indexOf("gtm.") === 0) return;
    var ec = entry.ecommerce || {};
    sendGa4(entry.event, { currency: ec.currency, value: ec.value, transaction_id: ec.transaction_id, items: ec.items });
    var metaName = META_EVENTS[entry.event];
    if (metaName && consent.ad_storage === "granted") {
      sendMeta(metaName, ec.value !== undefined ? { value: ec.value, currency: ec.currency } : {});
    }
  }

  var dl = window.dataLayer;
  dl.forEach(handle);
  var push = dl.push;
  dl.push = function () {
    var r = push.apply(dl, arguments);
    Array.prototype.forEach.call(arguments, handle);
    return r;
  };

  window.addEventListener("load", function () {
    sendGa4("page_view", {});
    // BUG: the Meta base code uses an "All Pages" trigger with no consent check.
    sendMeta("PageView");
  });
})();
