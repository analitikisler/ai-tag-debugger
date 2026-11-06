// What each tracking request parameter means, for the "?" tips in the report's Network tab and the side panel's
// parameter views: a label, a group and a tip per key and platform. Keys are the raw request parameter names; [en, tr].
// The text lives here rather than in i18n.js because it is a dictionary of the vendors' protocols, not interface copy.

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

/**
 * The tip for a request parameter in the report language, or null. With a platform, that platform's dictionary is read
 * first: several keys mean different things per vendor (v, dl, ts, r, id, event, url).
 */
export function paramTip(key, lang = "en", platform = null) {
  const i = lang === "tr" ? 1 : 0;
  const own = entryOf(key, platform);
  if (own?.tip) return own.tip[i];
  if (Object.hasOwn(G, key)) return G[key][i] + (key === "gcd" && (!platform || GOOGLE_TABLES.has(platform)) ? ` ${GCD_LETTERS[i]}` : "");
  for (const [re, fn] of PATTERNS) {
    const m = key.match(re);
    if (m) return fn(m)[i];
  }
  const pattern = patternOf(key, platform);
  return pattern?.tip ? pattern.tip[i] : null;
}

// ---------- the parameter dictionary: a label and a group per key, per platform ----------
// Each entry is [group, label EN, label TR] or [group, label EN, label TR, tip EN, tip TR] when the shared tips above
// say nothing (or the wrong thing) for that platform. Groups are ids; their names are in src/i18n.js.

const GCD_LETTERS = [
  "Letters: l not used · p denied · q denied, updated denied · r denied, updated granted · t granted · u granted, updated denied · v granted, updated granted.",
  "Harfler: l kullanılmıyor · p reddedildi · q reddedildi, güncelleme reddedildi · r reddedildi, güncelleme izin verildi · t izin verildi · u izin verildi, güncelleme reddedildi · v izin verildi, güncelleme izin verildi.",
];
const GA4 = {
  en: ["event", "Event name", "Olay adı"],
  cu: ["event", "Currency", "Para birimi"],
  _ee: ["event", "Enhanced conversions", "Gelişmiş dönüşümler"],
  cid: ["user", "Client ID", "İstemci kimliği"],
  uid: ["user", "User ID", "Kullanıcı kimliği"],
  sid: ["session", "Session ID", "Oturum kimliği"],
  sct: ["session", "Session number", "Oturum sayısı"],
  seg: ["session", "Engaged session", "Etkileşimli oturum"],
  _et: ["session", "Engagement time", "Etkileşim süresi"],
  _fv: ["session", "First visit", "İlk ziyaret"],
  _ss: ["session", "Session start", "Oturum başlangıcı"],
  _nsi: ["session", "New session ID", "Yeni oturum kimliği"],
  gcs: ["consent", "Consent state", "İzin durumu"],
  gcd: ["consent", "Consent detail", "İzin ayrıntısı"],
  dma: ["consent", "EU DMA flag", "AB DMA işareti"],
  dma_cps: ["consent", "DMA purposes", "DMA amaçları"],
  npa: ["consent", "Non-personalised ads", "Kişiselleştirilmemiş reklam"],
  are: ["consent", "Ads remarketing", "Reklam yeniden pazarlama"],
  pscdl: ["consent", "Cookie deprecation label", "Çerez kaldırma etiketi"],
  dl: ["page", "Page URL", "Sayfa adresi"],
  dr: ["page", "Referrer", "Önceki sayfa"],
  dt: ["page", "Page title", "Sayfa başlığı"],
  ul: ["device", "Browser language", "Tarayıcı dili"],
  sr: ["device", "Screen resolution", "Ekran çözünürlüğü"],
  frm: ["device", "Sent from a frame", "Çerçeveden gönderildi"],
  uaa: ["device", "CPU architecture", "İşlemci mimarisi", "CPU architecture from the browser's client hints, e.g. arm or x86.", "Tarayıcının istemci ipuçlarından işlemci mimarisi, ör. arm ya da x86."],
  uab: ["device", "Architecture bitness", "Mimari bit sayısı", "32 or 64-bit, from client hints.", "İstemci ipuçlarından 32 ya da 64 bit."],
  uafvl: ["device", "Browser versions", "Tarayıcı sürümleri", "Full version list of the browser brands (client hints), e.g. Google Chrome 142.0.7444.60.", "Tarayıcı markalarının tam sürüm listesi (istemci ipuçları), ör. Google Chrome 142.0.7444.60."],
  uamb: ["device", "Mobile device", "Mobil cihaz", "1 if the browser reports a mobile device.", "Tarayıcı mobil cihaz bildiriyorsa 1."],
  uam: ["device", "Device model", "Cihaz modeli", "Device model from client hints; empty on desktop.", "İstemci ipuçlarından cihaz modeli; masaüstünde boştur."],
  uap: ["device", "Operating system", "İşletim sistemi", "Operating system from client hints, e.g. macOS, Windows, Android.", "İstemci ipuçlarından işletim sistemi, ör. macOS, Windows, Android."],
  uapv: ["device", "OS version", "İşletim sistemi sürümü", "Operating system version from client hints.", "İstemci ipuçlarından işletim sistemi sürümü."],
  uaw: ["device", "32-bit on 64-bit Windows", "64 bit Windows'ta 32 bit", "1 if a 32-bit browser runs on 64-bit Windows (WOW64).", "64 bit Windows'ta 32 bit tarayıcı çalışıyorsa (WOW64) 1."],
  v: ["technical", "Protocol version", "Protokol sürümü"],
  tid: ["technical", "Measurement ID", "Ölçüm kimliği"],
  gtm: ["technical", "Container hash", "Kapsayıcı özeti"],
  _p: ["technical", "Page load ID", "Sayfa yükleme kimliği"],
  _s: ["technical", "Hit sequence", "İstek sırası"],
  tfd: ["technical", "Time since page load", "Sayfa yüklemesinden beri süre"],
  _dbg: ["technical", "Debug mode", "Hata ayıklama modu"],
  tag_exp: ["technical", "Tag experiments", "Etiket deneyleri"],
  _gaz: ["technical", "Internal flag _gaz", "Dahili işaret _gaz", "An internal Google tag flag. Google does not document it; shown so the list is complete. It does not affect reports you can check.", "Dahili bir Google etiketi işareti. Google belgelemiyor; liste eksiksiz olsun diye gösterilir."],
  _eu: ["technical", "Tag feature bits", "Etiket özellik bitleri", "Encoded list of Google tag features used for this hit. Undocumented by Google.", "Bu istekte kullanılan Google etiketi özelliklerinin kodlanmış listesi. Google belgelemiyor."],
  _tu: ["technical", "Tag usage bits", "Etiket kullanım bitleri", "Encoded tag usage flags. Undocumented by Google.", "Kodlanmış etiket kullanım işaretleri. Google belgelemiyor."],
  gdid: ["technical", "Developer ID", "Geliştirici kimliği", "ID of a tool that integrates with the Google tag, such as a consent platform.", "Google etiketiyle entegre olan bir aracın kimliği, ör. bir izin platformu."],
  richsstsse: ["server", "Server response stream", "Sunucu yanıt akışı", "Asks a server-side container to stream back its responses. Seen on hits to server-side GTM.", "Sunucu tarafı kapsayıcıdan yanıtlarını akış olarak döndürmesini ister. Sunucu tarafı GTM isteklerinde görülür."],
};
const META = {
  id: ["event", "Pixel ID", "Piksel kimliği"],
  ev: ["event", "Event name", "Olay adı"],
  eid: ["event", "Event ID", "Olay kimliği"],
  fbp: ["user", "Browser ID", "Tarayıcı kimliği"],
  fbc: ["user", "Click ID", "Tıklama kimliği"],
  dl: ["page", "Page URL", "Sayfa adresi", "Page the event was sent from.", "Olayın gönderildiği sayfa."],
  rl: ["page", "Referrer", "Önceki sayfa"],
  if: ["page", "In an iframe", "iframe içinde"],
  sw: ["page", "Screen width", "Ekran genişliği"],
  sh: ["page", "Screen height", "Ekran yüksekliği"],
  v: ["technical", "Pixel version", "Piksel sürümü", "Version of the Meta Pixel library (fbevents.js).", "Meta Pixel kütüphanesinin (fbevents.js) sürümü."],
  r: ["technical", "Release channel", "Sürüm kanalı"],
  a: ["technical", "Installed via", "Kurulum yolu"],
  ts: ["technical", "Sent at", "Gönderim zamanı"],
  it: ["technical", "Pixel loaded at", "Pikselin yüklendiği an"],
  ec: ["technical", "Event count", "Olay sayısı"],
  o: ["technical", "Setting flags", "Ayar bayrakları"],
  coo: ["technical", "Third-party cookies off", "Üçüncü taraf çerezler kapalı"],
  rqm: ["technical", "Request method", "İstek yöntemi"],
  cs_est: ["technical", "Automatic event setup", "Otomatik olay kurulumu", "Whether automatic event setup (codeless events) is on for this pixel.", "Bu piksel için otomatik olay kurulumunun (kodsuz olaylar) açık olup olmadığı."],
  cdl: ["technical", "Page data available", "Sayfa verisi mevcut", "Whether the pixel could read page metadata. Undocumented by Meta.", "Pikselin sayfa meta verisini okuyup okuyamadığı. Meta belgelemiyor."],
  ler: ["technical", "Script status", "Betik durumu", "Internal loader status of the pixel script. Undocumented by Meta.", "Piksel betiğinin dahili yükleyici durumu. Meta belgelemiyor."],
  plt: ["technical", "Page load time", "Sayfa yükleme süresi", "Time the page took to load, in milliseconds.", "Sayfanın yüklenme süresi, milisaniye."],
};
const META_CD = { value: ["Value", "Değer"], currency: ["Currency", "Para birimi"], content_ids: ["Content IDs", "İçerik kimlikleri"], content_type: ["Content type", "İçerik türü"], contents: ["Contents", "İçerikler"], num_items: ["Number of items", "Ürün sayısı"], content_name: ["Content name", "İçerik adı"], content_category: ["Content category", "İçerik kategorisi"] };
const ADS = {
  label: ["conversion", "Conversion label", "Dönüşüm etiketi"],
  value: ["conversion", "Value", "Değer"],
  currency_code: ["conversion", "Currency", "Para birimi"],
  oid: ["conversion", "Transaction ID", "İşlem kimliği"],
  en: ["conversion", "Event name", "Olay adı", "gtag event that sent this conversion, e.g. conversion or purchase.", "Bu dönüşümü gönderen gtag olayı, ör. conversion ya da purchase."],
  data: ["conversion", "Event data", "Olay verisi", "Extra event parameters, packed as key=value pairs separated by semicolons.", "Noktalı virgülle ayrılmış anahtar=değer çiftleri olarak paketlenmiş ek olay parametreleri."],
  gclaw: ["click", "Google click ID", "Google tıklama kimliği"],
  gclgb: ["click", "gbraid (iOS click ID)", "gbraid (iOS tıklama kimliği)", "Click ID for app-to-web iOS traffic, used instead of gclid.", "iOS'ta uygulamadan web'e gelen trafik için gclid yerine kullanılan tıklama kimliği."],
  gcl_ctr: ["click", "Conversions for this click", "Bu tıklamanın dönüşümleri"],
  auid: ["click", "Conversion linker ID", "Dönüşüm bağlayıcı kimliği", "First-party ID from the _gcl_au cookie, set by the conversion linker.", "Dönüşüm bağlayıcının yazdığı _gcl_au çerezindeki birinci taraf kimlik."],
  em: ["click", "Hashed email", "Karma e-posta"],
  ec_mode: ["click", "Enhanced conversions mode", "Gelişmiş dönüşüm modu", "How user data was collected: automatic (a), code (c) or manual (m).", "Kullanıcı verisinin nasıl toplandığı: otomatik (a), kod (c) ya da elle (m)."],
  guid: ["click", "User ID matching", "Kullanıcı kimliği eşleştirme"],
  gcs: ["consent", "Consent state", "İzin durumu"],
  gcd: ["consent", "Consent detail", "İzin ayrıntısı"],
  dma: ["consent", "EU DMA flag", "AB DMA işareti"],
  dma_cps: ["consent", "DMA purposes", "DMA amaçları"],
  npa: ["consent", "Non-personalised ads", "Kişiselleştirilmemiş reklam"],
  url: ["page", "Page URL", "Sayfa adresi"],
  ref: ["page", "Referrer", "Önceki sayfa"],
  tiba: ["page", "Page title", "Sayfa başlığı", "Title of the page the conversion fired on.", "Dönüşümün tetiklendiği sayfanın başlığı."],
  hn: ["page", "Host name", "Alan adı", "Host the request was sent from.", "İsteğin gönderildiği alan adı."],
  cv: ["technical", "Tag version", "Etiket sürümü", "Version of the conversion tag code.", "Dönüşüm etiketi kodunun sürümü."],
  fst: ["technical", "Fired at", "Tetiklenme zamanı", "Time the tag fired (Unix milliseconds).", "Etiketin tetiklendiği zaman (Unix ms)."],
  num: ["technical", "Random number", "Rastgele sayı", "Random number to stop caching.", "Önbelleğe almayı önlemek için rastgele sayı."],
  fmt: ["technical", "Response format", "Yanıt biçimi", "Which response the tag asked for (image, script or fetch).", "Etiketin istediği yanıt türü (görsel, betik ya da fetch)."],
  u_tz: ["technical", "Time zone offset", "Saat dilimi farkı", "Browser time zone offset in minutes.", "Tarayıcı saat dilimi farkı, dakika."],
  u_his: ["technical", "History length", "Geçmiş uzunluğu", "Number of pages in this tab's history.", "Bu sekmenin geçmişindeki sayfa sayısı."],
  rnd: ["technical", "Random number", "Rastgele sayı"],
};
const TIKTOK_HASHED = ["Advanced matching data. It should be a SHA-256 hash, never plain text.", "Gelişmiş eşleştirme verisi. Düz metin değil, SHA-256 karma olmalı."];
const TIKTOK = {
  event: ["event", "Event name", "Olay adı"],
  event_id: ["event", "Event ID", "Olay kimliği"],
  pixel_code: ["event", "Pixel ID", "Piksel kimliği"],
  "context.pixel.code": ["event", "Pixel ID", "Piksel kimliği"],
  "context.user.ttp": ["user", "Browser ID", "Tarayıcı kimliği"],
  "context.ad.callback": ["user", "Click ID", "Tıklama kimliği"],
  "context.user.email": ["user", "Hashed email", "Karma e-posta", ...TIKTOK_HASHED],
  "context.user.phone_number": ["user", "Hashed phone", "Karma telefon", ...TIKTOK_HASHED],
  "context.user.external_id": ["user", "Hashed external ID", "Karma harici kimlik", ...TIKTOK_HASHED],
  "context.page.url": ["page", "Page URL", "Sayfa adresi"],
  "context.page.referrer": ["page", "Referrer", "Önceki sayfa"],
  message_id: ["technical", "Message ID", "Mesaj kimliği", "Unique ID of this request, used by TikTok to drop duplicates in transit.", "Bu isteğin benzersiz kimliği; TikTok aktarımdaki kopyaları atmak için kullanır."],
  "context.library.name": ["technical", "Library", "Kütüphane", "The TikTok Pixel script and its version.", "TikTok Pixel betiği ve sürümü."],
  "context.library.version": ["technical", "Library version", "Kütüphane sürümü", "The TikTok Pixel script and its version.", "TikTok Pixel betiği ve sürümü."],
  timestamp: ["technical", "Sent at", "Gönderim zamanı"],
};
const TIKTOK_PROPS = { value: ["Value", "Değer"], currency: ["Currency", "Para birimi"], contents: ["Contents", "İçerikler"], content_type: ["Content type", "İçerik türü"], content_id: ["Content ID", "İçerik kimliği"] };
const ADOBE = {
  pe: ["event", "Link type", "Bağlantı türü", "Set on link tracking calls (s.tl): lnk_o custom, lnk_d download, lnk_e exit. Absent on page views (s.t).", "Bağlantı izleme çağrılarında (s.tl) bulunur: lnk_o özel, lnk_d indirme, lnk_e çıkış. Sayfa görüntülemelerinde (s.t) yoktur."],
  pev2: ["event", "Link name", "Bağlantı adı", "Name of the tracked link.", "İzlenen bağlantının adı."],
  events: ["event", "Events", "Olaylar", "Success events in this hit, e.g. scAdd, purchase, event12.", "Bu istekteki başarı olayları, ör. scAdd, purchase, event12."],
  products: ["commerce", "Products", "Ürünler", "Product string: category;product;quantity;price;events;eVars, products separated by commas.", "Ürün dizesi: kategori;ürün;adet;fiyat;olaylar;eVar'lar; ürünler virgülle ayrılır."],
  purchaseID: ["commerce", "Purchase ID", "Satın alma kimliği", "Order ID; Adobe counts a purchase with the same ID once.", "Sipariş kimliği; aynı kimlikli satın almayı Adobe bir kez sayar."],
  cc: ["commerce", "Currency", "Para birimi", "Currency code of revenue in this hit.", "Bu istekteki gelirin para birimi kodu."],
  mid: ["visitor", "Experience Cloud ID", "Experience Cloud kimliği", "Visitor ID from the Adobe identity service (ECID).", "Adobe kimlik hizmetinden ziyaretçi kimliği (ECID)."],
  aid: ["visitor", "Legacy visitor ID", "Eski ziyaretçi kimliği", "Older s_vi cookie ID.", "Eski s_vi çerez kimliği."],
  vid: ["visitor", "Custom visitor ID", "Özel ziyaretçi kimliği", "Visitor ID set by the site.", "Site tarafından atanan ziyaretçi kimliği."],
  pageName: ["page", "Page name", "Sayfa adı", "Name of the page in reports.", "Raporlardaki sayfa adı."],
  g: ["page", "Page URL", "Sayfa adresi", "Address of the page.", "Sayfanın adresi."],
  r: ["page", "Referrer", "Önceki sayfa", "Previous page.", "Önceki sayfa."],
  ch: ["page", "Site section", "Site bölümü", "Channel (site section) variable.", "Kanal (site bölümü) değişkeni."],
  h1: ["page", "Hierarchy", "Hiyerarşi", "Hierarchy variable for site structure.", "Site yapısı için hiyerarşi değişkeni."],
  server: ["page", "Server", "Sunucu", "Server or site name set by the implementation.", "Uygulamanın atadığı sunucu ya da site adı."],
  t: ["technical", "Browser time", "Tarayıcı saati", "Local time of the browser when sent.", "Gönderim anındaki tarayıcı yerel saati."],
  ns: ["technical", "Namespace", "Ad alanı", "Tracking server namespace.", "İzleme sunucusu ad alanı."],
  ce: ["technical", "Character set", "Karakter seti", "Character encoding of the page.", "Sayfanın karakter kodlaması."],
  AQB: ["technical", "Start marker", "Başlangıç işareti", "Mark the start and end of the query string; a missing AQE means the URL was cut off.", "Sorgu dizesinin başını ve sonunu işaretler; AQE yoksa adres kesilmiştir."],
  AQE: ["technical", "End marker", "Bitiş işareti", "Mark the start and end of the query string; a missing AQE means the URL was cut off.", "Sorgu dizesinin başını ve sonunu işaretler; AQE yoksa adres kesilmiştir."],
};
const MATOMO_EVENT = ["Parts of a Matomo event.", "Bir Matomo olayının parçaları."];
const MATOMO_ORDER = ["Order amounts.", "Sipariş tutarları."];
const MATOMO_SEARCH = ["Site search tracking.", "Site içi arama izleme."];
const MATOMO_TIME = ["Browser's local hour, minute, second.", "Tarayıcının yerel saat, dakika, saniyesi."];
const MATOMO_CVAR = ["Legacy custom variables as JSON.", "JSON olarak eski özel değişkenler."];
const MATOMO = {
  idsite: ["event", "Site ID", "Site kimliği", "Which Matomo site receives the hit.", "İsteği hangi Matomo sitesinin aldığı."],
  action_name: ["event", "Page title", "Sayfa başlığı", "Name of the page view in reports.", "Raporlardaki sayfa görüntüleme adı."],
  e_c: ["event", "Event category", "Olay kategorisi", ...MATOMO_EVENT],
  e_a: ["event", "Event action", "Olay eylemi", ...MATOMO_EVENT],
  e_n: ["event", "Event name", "Olay adı", ...MATOMO_EVENT],
  e_v: ["event", "Event value", "Olay değeri", ...MATOMO_EVENT],
  search: ["event", "Site search keyword", "Site içi arama terimi", ...MATOMO_SEARCH],
  search_cat: ["event", "Site search category", "Site içi arama kategorisi", ...MATOMO_SEARCH],
  search_count: ["event", "Site search results", "Site içi arama sonuç sayısı", ...MATOMO_SEARCH],
  idgoal: ["commerce", "Goal ID", "Hedef kimliği", "Goal conversion and its revenue; idgoal=0 is an ecommerce order.", "Hedef dönüşümü ve geliri; idgoal=0 bir e-ticaret siparişidir."],
  revenue: ["commerce", "Revenue", "Gelir", "Goal conversion and its revenue; idgoal=0 is an ecommerce order.", "Hedef dönüşümü ve geliri; idgoal=0 bir e-ticaret siparişidir."],
  ec_id: ["commerce", "Order ID", "Sipariş kimliği", "Ecommerce order ID.", "E-ticaret sipariş kimliği."],
  ec_items: ["commerce", "Items", "Ürünler", "Cart or order items as JSON: [SKU, name, category, price, quantity].", "JSON olarak sepet ya da sipariş ürünleri: [SKU, ad, kategori, fiyat, adet]."],
  ec_st: ["commerce", "Subtotal", "Ara toplam", ...MATOMO_ORDER],
  ec_tx: ["commerce", "Tax", "Vergi", ...MATOMO_ORDER],
  ec_sh: ["commerce", "Shipping", "Kargo", ...MATOMO_ORDER],
  ec_dt: ["commerce", "Discount", "İndirim", ...MATOMO_ORDER],
  _id: ["visitor", "Visitor ID", "Ziyaretçi kimliği", "Anonymous visitor ID from the _pk_id cookie.", "_pk_id çerezindeki anonim ziyaretçi kimliği."],
  uid: ["visitor", "User ID", "Kullanıcı kimliği", "User ID set by the site for a logged-in user.", "Site tarafından giriş yapmış kullanıcıya verilen kimlik."],
  cid: ["visitor", "Forced visitor ID", "Zorunlu ziyaretçi kimliği", "Visitor ID forced by the implementation.", "Uygulamanın zorla atadığı ziyaretçi kimliği."],
  _idvc: ["visitor", "Visit count", "Ziyaret sayısı", "Number of visits by this visitor.", "Bu ziyaretçinin ziyaret sayısı."],
  _cvar: ["visitor", "Custom variables (legacy)", "Özel değişkenler (eski)", ...MATOMO_CVAR],
  cvar: ["page", "Custom variables (legacy)", "Özel değişkenler (eski)", ...MATOMO_CVAR],
  url: ["page", "Page URL", "Sayfa adresi", "Address of the page.", "Sayfanın adresi."],
  urlref: ["page", "Referrer", "Önceki sayfa", "Address of the previous page.", "Önceki sayfanın adresi."],
  pv_id: ["page", "Page view ID", "Sayfa görüntüleme kimliği", "Links events to the page view they happened on.", "Olayları gerçekleştikleri sayfa görüntülemesine bağlar."],
  res: ["technical", "Screen resolution", "Ekran çözünürlüğü", "Screen size.", "Ekran boyutu."],
  h: ["technical", "Local hour", "Yerel saat", ...MATOMO_TIME],
  m: ["technical", "Local minute", "Yerel dakika", ...MATOMO_TIME],
  s: ["technical", "Local second", "Yerel saniye", ...MATOMO_TIME],
  rec: ["technical", "Record flag", "Kayıt işareti", "Must be 1 for the hit to be recorded.", "İsteğin kaydedilmesi için 1 olmalı."],
  ping: ["technical", "Heartbeat", "Canlılık sinyali", "1 for a heartbeat that extends visit time, not a page view.", "Sayfa görüntüleme değil, ziyaret süresini uzatan canlılık sinyali için 1."],
  gt_ms: ["technical", "Page generation time", "Sayfa üretim süresi", "Time the server took to generate the page, ms.", "Sunucunun sayfayı üretme süresi, ms."],
  ca: ["technical", "Custom action", "Özel eylem", "1 when the hit is not a page view (event, content impression).", "İstek sayfa görüntüleme değilse (olay, içerik gösterimi) 1."],
};
const TABLES = { ga4: GA4, meta: META, google_ads: ADS, tiktok: TIKTOK, adobe: ADOBE, matomo: MATOMO, piwik_pro: MATOMO };
const GOOGLE_TABLES = new Set(["ga4", "google_ads"]);
/** Each platform's groups in display order; a vendor without a table uses GA4's, whose shared keys most pixels reuse. */
export const PARAM_GROUPS = {
  // Server-side tagging keys (richsstsse, sst.*) get their own group: they only appear on hits to a server container.
  ga4: ["event", "user", "session", "consent", "page", "device", "server", "technical", "other"],
  meta: ["event", "custom", "user", "page", "technical", "other"],
  google_ads: ["conversion", "click", "consent", "page", "technical", "other"],
  tiktok: ["event", "properties", "user", "page", "technical", "other"],
  adobe: ["event", "commerce", "variables", "visitor", "page", "technical", "other"],
  matomo: ["event", "commerce", "visitor", "page", "technical", "other"],
  piwik_pro: ["event", "commerce", "visitor", "page", "technical", "other"],
};
export const groupsOf = (platform) => PARAM_GROUPS[platform] ?? PARAM_GROUPS.ga4;

/** GA4's recommended event parameters, labelled in the Readable view without a CUSTOM tag. */
const RECOMMENDED = {
  value: ["Value", "Değer"], currency: ["Currency", "Para birimi"], transaction_id: ["Transaction ID", "İşlem kimliği"], coupon: ["Coupon", "Kupon"],
  shipping: ["Shipping", "Kargo"], tax: ["Tax", "Vergi"], item_list_id: ["Item list ID", "Ürün listesi kimliği"], item_list_name: ["Item list name", "Ürün listesi adı"],
  promotion_id: ["Promotion ID", "Promosyon kimliği"], promotion_name: ["Promotion name", "Promosyon adı"], creative_name: ["Creative name", "Kreatif adı"],
  creative_slot: ["Creative slot", "Kreatif alanı"], payment_type: ["Payment type", "Ödeme türü"], shipping_tier: ["Shipping tier", "Kargo seçeneği"],
  search_term: ["Search term", "Arama terimi"], method: ["Method", "Yöntem"], content_group: ["Content group", "İçerik grubu"],
  engagement_time_msec: ["Engagement time (ms)", "Etkileşim süresi (ms)"], debug_mode: ["Debug mode", "Hata ayıklama modu"],
  page_location: ["Page URL", "Sayfa adresi"], page_referrer: ["Referrer", "Önceki sayfa"], page_title: ["Page title", "Sayfa başlığı"],
  first_open_time: ["First open time", "İlk açılış zamanı"], user_id: ["User ID (as property)", "Kullanıcı kimliği (özellik olarak)"],
};
/** The order recommended parameters are listed in, before custom ones. */
export const RECOMMENDED_ORDER = Object.keys(RECOMMENDED);

/**
 * Keys that follow a pattern: [regex, platforms (null = any), group, label(m, lang index), custom?, tip?]. The label
 * of a GA4 event or user parameter is the parameter's own name: that name is what the site's developer wrote.
 */
const LABEL_PATTERNS = [
  [/^epn?\.(.+)$/, ["ga4"], "event", (m, i) => RECOMMENDED[m[1]]?.[i] ?? m[1], (m) => !RECOMMENDED[m[1]]],
  [/^upn?\.(.+)$/, ["ga4"], "user", (m, i) => RECOMMENDED[m[1]]?.[i] ?? m[1], (m) => !RECOMMENDED[m[1]]],
  [/^pr(\d+)$/, ["ga4"], "event", (m, i) => (i ? `${m[1]}. ürün` : `Item ${m[1]}`)],
  [/^sst\.(.+)$/, ["ga4"], "server", (m, i) => (i ? `Sunucu ipucu: ${m[1]}` : `Server hint: ${m[1]}`), null,
    (m) => [`A hint the Google tag sends for the server-side container (sst = server-side tagging): ${m[1]}.`, `Google etiketinin sunucu tarafı kapsayıcı için gönderdiği ipucu (sst = sunucu tarafı etiketleme): ${m[1]}.`]],
  [/^cd\[(.+)\]$/, ["meta"], "custom", (m, i) => META_CD[m[1]]?.[i] ?? m[1], (m) => !META_CD[m[1]]],
  [/^ud\[(.+)\]$/, ["meta"], "user", (m, i) => (i ? `Gelişmiş eşleştirme: ${m[1]}` : `Advanced matching: ${m[1]}`)],
  [/^udff\[(.+)\]$/, ["meta"], "user", (m, i) => (i ? `Karma eşleştirme: ${m[1]}` : `Hashed matching: ${m[1]}`), null, () => [G.udff[0], G.udff[1]]],
  [/^pmd\[(.+)\]$/, ["meta"], "page", (m, i) => (i ? `Sayfa meta verisi: ${m[1]}` : `Page metadata: ${m[1]}`), null,
    () => ["Page metadata the pixel read automatically, e.g. title or description.", "Pikselin otomatik okuduğu sayfa meta verisi, ör. başlık ya da açıklama."]],
  [/^expv2\[(.+)\]$/, ["meta"], "technical", (m, i) => (i ? `Deney ${m[1]}` : `Experiment ${m[1]}`), null,
    () => ["A Meta Pixel experiment this request is part of.", "Bu isteğin dahil olduğu bir Meta Pixel deneyi."]],
  [/^properties\.(.+)$/, ["tiktok"], "properties", (m, i) => TIKTOK_PROPS[m[1]]?.[i] ?? m[1], (m) => !TIKTOK_PROPS[m[1]]],
  [/^v(\d{1,3})$/, ["adobe"], "variables", (m) => `eVar ${m[1]}`, null,
    () => ["Conversion variable: keeps its value across hits until it expires.", "Dönüşüm değişkeni: süresi dolana kadar değerini korur."]],
  [/^c(\d{1,2})$/, ["adobe"], "variables", (m) => `prop ${m[1]}`, null, () => ["Traffic variable: counts only for this hit.", "Trafik değişkeni: yalnızca bu istek için geçerlidir."]],
  [/^l([1-3])$/, ["adobe"], "variables", (m, i) => (i ? `Liste değişkeni ${m[1]}` : `List var ${m[1]}`), null, () => ["A list variable: several values in one hit.", "Liste değişkeni: tek istekte birden çok değer."]],
  [/^c\.(.+?)(\.c)?$/, ["adobe"], "variables", (m, i) => (i ? `Bağlam verisi: ${m[1]}` : `Context data: ${m[1]}`)],
  [/^dimension(\d+)$/, ["matomo", "piwik_pro"], "visitor", (m, i) => (i ? `Özel boyut ${m[1]}` : `Custom dimension ${m[1]}`), null, () => ["Custom dimension value.", "Özel boyut değeri."]],
];

function entryOf(key, platform) {
  const row = TABLES[platform ?? "ga4"]?.[key];
  if (!row) return null;
  const [group, en, tr, tipEn, tipTr] = row;
  return { group, label: [en, tr], tip: tipEn ? [tipEn, tipTr] : null };
}

function patternOf(key, platform) {
  for (const [re, platforms, group, label, custom, tip] of LABEL_PATTERNS) {
    if (platforms && !platforms.includes(platform ?? "ga4")) continue;
    const m = key.match(re);
    if (m) return { group, label: (i) => label(m, i), custom: custom ? custom(m) : false, tip: tip ? tip(m) : null };
  }
  return null;
}

/** The human label of a request parameter; the key itself when no dictionary knows it. */
export function paramLabel(key, lang = "en", platform = null) {
  const i = lang === "tr" ? 1 : 0;
  return entryOf(key, platform)?.label[i] ?? patternOf(key, platform)?.label(i) ?? key;
}

/** The group a parameter is listed under in the All parameters view; "other" when no dictionary knows it. */
export function paramGroup(key, platform = null) {
  return entryOf(key, platform)?.group ?? patternOf(key, platform)?.group ?? "other";
}

/** Whether a parameter is the site's own (a GA4 ep./up. key, Meta cd[…] or TikTok property no dictionary names). */
export function isCustomParam(key, platform = null) {
  return Boolean(patternOf(key, platform)?.custom);
}

const YES_NO = { "1": ["yes", "evet"], "0": ["no", "hayır"] };
const URL_KEYS = new Set(["dl", "dr", "url", "ref", "g", "r", "urlref", "rl", "context.page.url", "context.page.referrer"]);

/**
 * A short reading of a value, shown after it with a middle dot: "1 · yes", "2140 · 2.1 s", "G111 · ad ✓ analytics ✓".
 * Null when there is nothing to add. Multi-line values (uafvl) come back with one line per brand.
 */
export function paramHint(key, value, lang = "en", platform = null) {
  const i = lang === "tr" ? 1 : 0;
  const v = String(value ?? "");
  if (["seg", "_fv", "_ss", "_nsi", "uamb", "uaw", "_dbg"].includes(key) && YES_NO[v]) return YES_NO[v][i];
  if (key === "_et" && /^\d+$/.test(v)) return `${(Number(v) / 1000).toFixed(1).replace(".", i ? "," : ".")} ${i ? "sn" : "s"}`;
  if (key === "gcs" && /^G1[01-]{2}$/.test(v)) {
    const mark = (c) => (c === "1" ? "✓" : c === "0" ? "✕" : "–");
    return `${i ? "reklam" : "ad"} ${mark(v[2])} ${i ? "analitik" : "analytics"} ${mark(v[3])}`;
  }
  if (key === "npa" && (v === "0" || v === "1")) return v === "0" ? (i ? "kişiselleştirilmiş" : "personalised") : (i ? "kişiselleştirilmemiş" : "not personalised");
  if (key === "uafvl" && v.includes("|")) return v.split("|").map((b) => b.split(";").join(" ")).join("\n");
  if (URL_KEYS.has(key) && (platform !== "meta" || key !== "r")) {
    try {
      const decoded = decodeURIComponent(v);
      return decoded !== v ? decoded : null;
    } catch { return null; }
  }
  return null;
}

// GA4 item fields: the wire key, the group and the label, in the order they are listed.
const ITEM_LABELS = {
  item_id: ["id", "row", "Item ID", "Ürün kimliği"], item_name: ["nm", "row", "Item name", "Ürün adı"],
  price: ["pr", "row", "Price", "Fiyat"], quantity: ["qt", "row", "Quantity", "Adet"],
  item_brand: ["br", "product", "Brand", "Marka"], item_variant: ["va", "product", "Variant", "Varyant"],
  item_category: ["ca", "category", "Category 1", "Kategori 1"], item_category2: ["c2", "category", "Category 2", "Kategori 2"],
  item_category3: ["c3", "category", "Category 3", "Kategori 3"], item_category4: ["c4", "category", "Category 4", "Kategori 4"],
  item_category5: ["c5", "category", "Category 5", "Kategori 5"],
  discount: ["ds", "price", "Discount", "İndirim"], coupon: ["cp", "price", "Coupon", "Kupon"],
  item_list_name: ["ln", "list", "List name", "Liste adı"], item_list_id: ["li", "list", "List ID", "Liste kimliği"], index: ["lp", "list", "Index", "Sıra"],
  promotion_id: ["pi", "promotion", "Promotion ID", "Promosyon kimliği"], promotion_name: ["pn", "promotion", "Promotion name", "Promosyon adı"],
  creative_name: ["cn", "promotion", "Creative name", "Kreatif adı"], creative_slot: ["cs", "promotion", "Creative slot", "Kreatif alanı"],
  affiliation: ["af", "store", "Affiliation", "Satış kanalı"], location_id: ["lo", "store", "Location ID", "Konum kimliği"],
};
/** The groups an expanded item lists its fields in, in order; "custom" holds kN/vN pairs, "other" unknown keys. */
export const ITEM_GROUPS = ["product", "category", "price", "list", "promotion", "store", "custom", "other"];
/** An item field's wire key, group and label: { wire, group, label }; unknown keys go to "other" under their own name. */
export function itemField(field, lang = "en") {
  const row = ITEM_LABELS[field];
  if (!row) return { wire: field, group: "other", label: lang === "tr" ? "Bilinmeyen ürün alanı" : "Unknown item field" };
  return { wire: row[0], group: row[1], label: row[lang === "tr" ? 3 : 2] };
}
/** Every known item field in display order. */
export const ITEM_FIELDS_ORDER = Object.keys(ITEM_LABELS);

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
