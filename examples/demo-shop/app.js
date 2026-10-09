// Demo store logic. Two of its tracking pushes are deliberately wrong (see README).
var PRODUCTS = [
  { item_id: "TEE-01", item_name: "Basic Tee", price: 19.9 },
  { item_id: "MUG-02", item_name: "Coffee Mug", price: 12.5 },
  { item_id: "SOX-03", item_name: "Wool Socks", price: 9.0 },
];
var CURRENCY = "EUR";
var isMobile = window.matchMedia("(max-width: 767px)").matches;

function cart() { try { return JSON.parse(localStorage.getItem("cart") || "[]"); } catch (e) { return []; } }
function saveCart(c) { localStorage.setItem("cart", JSON.stringify(c)); }
function total(items) { return Math.round(items.reduce(function (s, i) { return s + i.price * (i.quantity || 1); }, 0) * 100) / 100; }
function push(event, items, extra) {
  var ecommerce = Object.assign({ currency: CURRENCY, value: total(items), items: items }, extra || {});
  dataLayer.push({ ecommerce: null });
  dataLayer.push({ event: event, ecommerce: ecommerce });
}

document.getElementById("cart-count").textContent = cart().length;

// Consent banner
var banner = document.getElementById("consent");
function setConsent(granted) {
  var state = granted ? "granted" : "denied";
  gtag("consent", "update", { ad_storage: state, analytics_storage: state, ad_user_data: state, ad_personalization: state });
  localStorage.setItem("consent", state);
  banner.hidden = true;
}
var saved = localStorage.getItem("consent");
if (saved) gtag("consent", "update", { ad_storage: saved, analytics_storage: saved, ad_user_data: saved, ad_personalization: saved });
else banner.hidden = false;
document.getElementById("consent-accept").onclick = function () { setConsent(true); };
document.getElementById("consent-reject").onclick = function () { setConsent(false); };

var page = document.body.dataset.page;

if (page === "index") {
  document.getElementById("products").innerHTML = PRODUCTS.map(function (p) {
    return '<a class="card" href="product.html?id=' + p.item_id + '"><b>' + p.item_name + "</b><span>€" + p.price.toFixed(2) + "</span></a>";
  }).join("");
  push("view_item_list", PRODUCTS);
}

if (page === "product") {
  var id = new URLSearchParams(location.search).get("id") || PRODUCTS[0].item_id;
  var p = PRODUCTS.filter(function (x) { return x.item_id === id; })[0] || PRODUCTS[0];
  document.getElementById("product").innerHTML =
    "<h1>" + p.item_name + '</h1><p class="price">€' + p.price.toFixed(2) + '</p><button id="add-to-cart" class="btn">Add to cart</button>';
  push("view_item", [p]);
  var btn = document.getElementById("add-to-cart");
  btn.addEventListener("click", function () {
    var c = cart(); c.push(Object.assign({ quantity: 1 }, p)); saveCart(c);
    document.getElementById("cart-count").textContent = c.length;
    push("add_to_cart", [Object.assign({ quantity: 1 }, p)]);
    btn.textContent = "Added ✓";
  });
  // BUG: a legacy handler left over from the old theme sends add_to_cart again.
  btn.addEventListener("click", function () { push("add_to_cart", [Object.assign({ quantity: 1 }, p)]); });
}

if (page === "cart") {
  var items = cart();
  document.getElementById("cart").innerHTML = items.length
    ? "<ul>" + items.map(function (i) { return "<li>" + i.item_name + " · €" + i.price.toFixed(2) + "</li>"; }).join("") + "</ul><p>Total: €" + total(items).toFixed(2) + "</p>"
    : "<p>Your cart is empty.</p>";
  push("view_cart", items);
}

if (page === "checkout") {
  push("begin_checkout", cart());
  document.getElementById("checkout-form").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!e.target.payment.value) { alert("Please choose a payment method."); return; }
    localStorage.setItem("last_order", JSON.stringify({ id: "T" + Date.now(), items: cart() }));
    saveCart([]);
    location.href = "thanks.html";
  });
}

if (page === "thanks") {
  var order = JSON.parse(localStorage.getItem("last_order") || "null");
  if (order) {
    document.getElementById("order-id").textContent = order.id;
    if (isMobile) {
      // BUG: the new mobile thank-you template builds its own ecommerce
      // object and forgets value and currency.
      dataLayer.push({ ecommerce: null });
      dataLayer.push({ event: "purchase", ecommerce: { transaction_id: order.id, items: order.items } });
    } else {
      push("purchase", order.items, { transaction_id: order.id });
    }
  }
}
