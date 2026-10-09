// What each tracking request parameter means, for the "?" tips in the report's Network tab.
// Keys are the raw request parameter names; [en, tr].

const G = {
  // GA4 (Measurement Protocol v2, as sent by gtag.js)
  v: ["Protocol version. Always 2 for GA4.", "Protokol sürümü. GA4 için her zaman 2."],
  tid: ["Measurement ID (G-…): which GA4 property the request goes to.", "Ölçüm kimliği (G-…). İsteğin hangi GA4 mülküne gittiğini gösterir."],
  gtm: ["Hash of the Google tag or GTM container that sent it.", "Etiketi gönderen Google etiketi ya da GTM kapsayıcısının özeti."],
  _p: ["Page load ID. Every request from the same page load has the same value.", "Sayfa yükleme kimliği. Aynı sayfadaki tüm istekler aynı değeri taşır."],
  gcs: ["Consent Mode state. G1xy: x is ad_storage, y is analytics_storage (1 granted, 0 denied).", "Consent Mode durumu. G1xy: x reklam, y analitik depolama (1 izin var, 0 yok)."],
  gcd: ["Consent Mode detail: the default and update value of each consent type.", "Consent Mode ayrıntısı: her izin türü için varsayılan ve güncelleme değerleri."],
  npa: ["Non-personalized ads. 1 means personalization is off.", "Kişiselleştirilmemiş reklam. 1 ise kişiselleştirme kapalı."],
  dma: ["EU Digital Markets Act flag.", "AB Dijital Pazarlar Yasası işareti."],
  dma_cps: ["Consent purposes sent under the Digital Markets Act.", "Dijital Pazarlar Yasası kapsamında gönderilen izin amaçları."],
  cid: ["Client ID: the anonymous ID of this browser (the _ga cookie).", "Client ID: tarayıcıyı tanımlayan anonim kimlik (_ga çerezi)."],
  uid: ["User ID set by the site for a logged-in user.", "Site tarafından giriş yapmış kullanıcıya verilen kullanıcı kimliği."],
  ul: ["Browser language.", "Tarayıcı dili."],
  sr: ["Screen resolution.", "Ekran çözünürlüğü."],
  _s: ["Sequence number of this request within the page load.", "Bu sayfa yüklemesindeki istek sıra numarası."],
  sid: ["Session ID.", "Oturum kimliği."],
  sct: ["Number of sessions for this user.", "Bu kullanıcının oturum sayısı."],
  seg: ["Engaged session (1 = yes).", "Etkileşimli oturum (1 = evet)."],
  dl: ["Page URL (page_location).", "Sayfa adresi (page_location)."],
  dr: ["Previous page (page_referrer).", "Önceki sayfa (page_referrer)."],
  dt: ["Page title (page_title).", "Sayfa başlığı (page_title)."],
  en: ["Event name.", "Olay adı (event_name)."],
  _et: ["Engagement time in milliseconds.", "Etkileşim süresi, milisaniye."],
  cu: ["Currency.", "Para birimi (currency)."],
  _ee: ["Enhanced conversions or user-provided data is enabled.", "Gelişmiş dönüşümler ya da kullanıcı verisi açık."],
  _fv: ["First visit: this is the user's first session.", "İlk ziyaret: kullanıcının ilk oturumu."],
  _ss: ["Session start: this request starts a new session.", "Oturum başlangıcı: bu istek yeni bir oturum başlatır."],
  _nsi: ["New session ID was created.", "Yeni oturum kimliği oluşturuldu."],
  _dbg: ["Debug mode is on (shows in GA4 DebugView).", "Hata ayıklama modu açık (GA4 DebugView'da görünür)."],
  tfd: ["Time from page load to this request, in milliseconds.", "Sayfa yüklemesinden bu isteğe kadar geçen süre, milisaniye."],
  are: ["Ads remarketing enabled.", "Reklam yeniden pazarlaması açık."],
  frm: ["Request sent from inside a frame.", "İstek bir çerçeve içinden gönderildi."],
  pscdl: ["Privacy sandbox cookie deprecation label.", "Privacy Sandbox çerez kullanımdan kaldırma etiketi."],
  tag_exp: ["Google tag experiments this request is part of.", "Bu isteğin dahil olduğu Google etiketi deneyleri."],
  // Meta Pixel
  id: ["Meta Pixel ID.", "Meta piksel kimliği."],
  ev: ["Meta event name.", "Meta olay adı."],
  rl: ["Previous page (referrer).", "Önceki sayfa (referrer)."],
  if: ["Whether the request came from inside an iframe.", "İstek bir iframe içinden mi geldi."],
  ts: ["Time sent (Unix milliseconds).", "Gönderim zamanı (Unix ms)."],
  sw: ["Screen width.", "Ekran genişliği."],
  sh: ["Screen height.", "Ekran yüksekliği."],
  ec: ["Number of events the pixel has sent on this page.", "Bu sayfada pikselin gönderdiği olay sayısı."],
  o: ["Pixel setting flags.", "Piksel ayar bayrakları."],
  fbp: ["Meta browser ID (the _fbp cookie).", "Meta tarayıcı kimliği (_fbp çerezi)."],
  fbc: ["Meta click ID (the _fbc cookie, from fbclid).", "Meta tıklama kimliği (_fbc çerezi, fbclid'den)."],
  eid: ["Event ID, used to deduplicate against the server-side (Conversions API) event.", "Olay kimliği. Sunucu tarafı (CAPI) olayla eşleştirmek için kullanılır."],
  it: ["When the pixel loaded.", "Pikselin yüklendiği zaman."],
  coo: ["Whether third-party cookies are off.", "Üçüncü taraf çerezler kapalı mı."],
  rqm: ["Request method.", "İstek yöntemi."],
  r: ["Pixel release channel.", "Piksel sürüm kanalı."],
  a: ["Integration the pixel was installed with (e.g. tmgoogletagmanager).", "Pikselin kurulduğu entegrasyon (ör. tmgoogletagmanager)."],
  udff: ["Hashed user data for advanced matching.", "Gelişmiş eşleştirme için karma (hash) kullanıcı verisi."],
  // TikTok Pixel
  event: ["TikTok event name.", "TikTok olay adı."],
  pixel_code: ["TikTok Pixel ID.", "TikTok piksel kimliği."],
  event_id: ["Event ID, used to deduplicate against the Events API.", "Olay kimliği. Events API ile eşleştirme için."],
  "context.page.url": ["Page URL.", "Sayfa adresi."],
  "context.page.referrer": ["Previous page.", "Önceki sayfa."],
  "context.user.ttp": ["TikTok browser ID (the _ttp cookie).", "TikTok tarayıcı kimliği (_ttp çerezi)."],
  "context.pixel.code": ["TikTok Pixel ID.", "TikTok piksel kimliği."],
  "context.ad.callback": ["TikTok click ID (ttclid).", "TikTok tıklama kimliği (ttclid)."],
  timestamp: ["Time sent.", "Gönderim zamanı."],
  // Google Ads
  label: ["Conversion label: which conversion action this is.", "Dönüşüm etiketi: hangi dönüşüm işlemi olduğunu gösterir."],
  value: ["Conversion value.", "Dönüşüm değeri."],
  currency_code: ["Currency.", "Para birimi."],
  oid: ["Order (transaction) ID, used to deduplicate conversions.", "Sipariş (işlem) kimliği. Dönüşümleri tekilleştirmek için."],
  gclaw: ["Google click ID (gclid) from the ad click.", "Reklam tıklamasından gelen Google tıklama kimliği (gclid)."],
  gcl_ctr: ["Number of conversions counted for this click.", "Bu tıklama için sayılan dönüşüm sayısı."],
  url: ["Page URL.", "Sayfa adresi."],
  ref: ["Previous page.", "Önceki sayfa."],
  guid: ["Whether Google user ID matching is on.", "Google kullanıcı kimliği eşleştirmesi açık mı."],
  rnd: ["Random number to stop caching.", "Önbelleğe almayı önlemek için rastgele sayı."],
  em: ["Hashed email for enhanced conversions.", "Gelişmiş dönüşümler için karma (hash) e-posta."],
  // X Pixel
  txn_id: ["X Pixel ID.", "X piksel kimliği."],
  events: ["Events in this request.", "Bu istekteki olaylar."],
  tw_sale_amount: ["Conversion value.", "Dönüşüm değeri."],
  tw_order_quantity: ["Quantity.", "Adet."],
  tw_document_href: ["Page URL.", "Sayfa adresi."],
  p_id: ["Pixel type.", "Piksel türü."],
};

const PATTERNS = [
  [/^ep\.(.+)$/, (m) => [`Text event parameter: ${m[1]}.`, `Metin olay parametresi: ${m[1]}.`]],
  [/^epn\.(.+)$/, (m) => [`Number event parameter: ${m[1]}.`, `Sayısal olay parametresi: ${m[1]}.`]],
  [/^up\.(.+)$/, (m) => [`Text user property: ${m[1]}.`, `Metin kullanıcı özelliği: ${m[1]}.`]],
  [/^upn\.(.+)$/, (m) => [`Number user property: ${m[1]}.`, `Sayısal kullanıcı özelliği: ${m[1]}.`]],
  [/^pr(\d+)$/, (m) => [`Item ${m[1]}, fields separated by ~. Decoded below.`, `${m[1]}. ürün, ~ ile ayrılmış alanlar. Çözülmüş hali aşağıda.`]],
  [/^cd\[(.+)\]$/, (m) => [`Custom data: ${m[1]}.`, `Özel veri: ${m[1]}.`]],
  [/^ud\[(.+)\]$/, (m) => [`Advanced matching user data: ${m[1]} (should be hashed).`, `Gelişmiş eşleştirme kullanıcı verisi: ${m[1]} (karma olmalı).`]],
  [/^properties\.(.+)$/, (m) => [`Event property: ${m[1]}.`, `Olay özelliği: ${m[1]}.`]],
];

/** The tip for a request parameter in the report language, or null. */
export function paramTip(key, lang = "en") {
  const i = lang === "tr" ? 1 : 0;
  if (Object.hasOwn(G, key)) return G[key][i];
  for (const [re, fn] of PATTERNS) {
    const m = key.match(re);
    if (m) return fn(m)[i];
  }
  return null;
}

// Parameters that describe the event itself; the rest (session, device, page, consent) are collapsed.
const EVENT_KEYS = /^(en|ev|event|label|value|currency_code|oid|cu|ep\..*|epn\..*|pr\d+|cd\[.*\]|properties\..*|eid|event_id|events|tw_sale_amount|tw_order_quantity)$/;
export const isEventParam = (key) => EVENT_KEYS.test(key);

// GA4 item string fields (pr1=…): two-letter keys, plus kN/vN custom item parameters.
const ITEM_FIELDS = {
  id: "item_id", nm: "item_name", br: "item_brand", ca: "item_category", c2: "item_category2", c3: "item_category3", c4: "item_category4", c5: "item_category5",
  va: "item_variant", pr: "price", qt: "quantity", cp: "coupon", ds: "discount", af: "affiliation", lp: "index", ln: "item_list_name", li: "item_list_id", lo: "location_id",
  pi: "promotion_id", pn: "promotion_name", cn: "creative_name", cs: "creative_slot",
};

/**
 * Decodes a GA4 item string ("nmShoe~id42~pr10~qt1~k0size~v0XL") into
 * { fields: [[item_name, "Shoe"], …], custom: [["size", "XL"]] }.
 */
export function decodeGa4Item(s) {
  const fields = [];
  const names = {};
  const values = {};
  for (const part of String(s).split("~")) {
    const m = part.match(/^([a-z][a-z0-9])(.*)$/);
    if (!m) continue;
    const [, k, v] = m;
    if (/^k\d$/.test(k)) names[k[1]] = v;
    else if (/^v\d$/.test(k)) values[k[1]] = v;
    else fields.push([ITEM_FIELDS[k] ?? k, v]);
  }
  return { fields, custom: Object.entries(values).map(([n, v]) => [names[n] ?? `custom_${n}`, v]) };
}
