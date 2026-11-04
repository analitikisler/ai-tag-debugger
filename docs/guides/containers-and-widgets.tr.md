# Google container'ları, gömülü widget'lar ve iframe'ler

*[English](containers-and-widgets.md)*

Bir sitenin izlemesi artık nadiren tek bir GTM snippet'inden ibaret. Container'lar başka container'ları yükler, Google etiketleri kendi hedeflerini yükler, onay platformları GTM'i ziyaretçi seçim yaptıktan sonra yükler; rezervasyon, sohbet ve ödeme widget'ları da iframe'lerin içinde kendi izlemelerini çalıştırır. Bu rehber ai-tag-debugger'ın bunların hepsi hakkında neyi raporladığını, her bulgunun genellikle ne anlama geldiğini ve nasıl düzeltileceğini anlatır.

Buradaki her şey `report.html` içindeki **Envanter** bölümünde, `report.md` içinde ve MCP üzerinden ([MCP üzerinden](#mcp-üzerinden)) yer alır.

## Google container'ları kartı

Sayfaların yüklediği her GTM container'ı (`gtm.js`) ve Google etiketi (`gtag/js`) için bir satır:

- **Sayfaya nasıl geldiği.** Tarayıcı her container betiğini eklendiği anda not eder ve onu bir betik eklediyse o anda hangi betiklerin çalıştığını kaydeder. Böylece kaynak ağ isteğinden tahmin edilmez, sayfanın kendisinden okunur.

  | Kaynak | Genellikle ne olduğu |
  |---|---|
  | Sayfanın HTML'indeki bir script etiketi | `gtag.js` snippet'i ya da elle eklenmiş `gtm.js` |
  | Sayfadaki satır içi kod (snippet) | GTM snippet'i |
  | Sayfadaki başka bir betik: *adres* | Ziyaretçi seçim yaptıktan sonra GTM'i yükleyen bir onay platformu, bir tema ya da uygulama paketi, başka bir etiket yöneticisi |
  | GTM-… içindeki bir Özel HTML etiketi | O container'da bir `<script>` yazan etiket |
  | GTM-… içindeki bir Google etiketi | O container'daki bir Google etiketi, GA4 ya da Ads şablonu |
  | GTM-… kendisi: bir Zone ya da etiket şablonu | Bir container'ın başka birini yüklemesi |
  | Bir `gtag('config')` komutu | Sayfa o hedefi yapılandırdı |
  | config olmadan bir olayın `send_to` değeri | Hedef yalnızca ona bir olay gönderildiği için yüklendi |
  | Google etiketinin bir hedefi | Google'ın kendi ayarlarında Google etiketine bağlanmış bir hedef |
  | Sayfada yalnızca bir ön yükleme ipucu | Bir `<link rel="preload">` container'ı indirdi ama hiçbir şey onu betik olarak eklemedi, bu yüzden hiç çalışmadı |
  | Eklendiği görülmedi | Araç bir betiğin eklendiğini görmeden çalıştı ya da istendi: genellikle bir onay platformunun otomatik engellemesi tarayıcının kendi işlevlerini değiştirmiştir |

- **Çalışıp çalışmadığı.** Araç her adımdan sonra Google'ın çalışan container'lar kaydını (`google_tag_manager`) okur. İndirilip hiç çalışmayan bir container *hiç çalışmadı* olarak işaretlenir.
- **Sürüm, boyut ve yükleme süresi.** Sürüm, container'ın yayımlandığı numaradır; GTM'deki Sürümler sekmesindekiyle aynıdır. Az önce yayımladığınız sürüm değilse site eski bir sürümü önbellekte tutuyordur ya da yayında başka bir container veya ortam vardır.
- Container'ın okuduğu **dataLayer**, `dataLayer` değilse.
- **Sunulduğu yer:** Google ya da sitenin kendi alan adı (Google etiket ağ geçidi ya da bir sunucu container'ı).
- Snippet bir ortam adlandırıyorsa **GTM ortamı**, bir iframe içinde çalıştıysa **iframe**.

### Container bulguları

| Bulgu | Ne anlama geldiği | Ne yapmalı |
|---|---|---|
| `container_not_run` (uyarı) | Bir GTM container'ı indirildi ya da istendi, ama çalıştırmanın hiçbir sayfasında çalışmadı; etiketlerinin hiçbiri çalışmadı. Sık bir neden: sayfa onu yalnızca ön yüklüyor ve onu eklemesi gereken kod başarısız oluyor, örneğin sayfanın kendi betikleri bozulduğunda. | Betiği gerçekten bir şeyin eklediğini kontrol edin: snippet ya da çatı bileşeni (yalnızca ön yükleme hiçbir şeyi çalıştırmaz). Betik hatalarına ve onu hiç serbest bırakmayan bir onay platformuna bakın. |
| `container_held` (bilgi) | Aynısı, ama bir onay platformu var ve çalıştırmada onay verilmedi: GTM'in onaya kadar bekletilmesi beklenen bir durum. | Etiketlerini kontrol etmek için yolculuğu onay kabul edilmiş olarak çalıştırın. |
| `container_failed` (uyarı) | Container betiği yüklenemedi ya da hatayla yanıtlandı; o sayfada etiketlerinin hiçbiri çalışmadı. | Snippet'teki container kimliğini ve adresi kontrol edin. Sunucu container'ı ya da Google etiket ağ geçidi için `gtm.js` ve `gtag/js` sunduğunu kontrol edin. |
| `container_duplicate` (uyarı) | Aynı container aynı sayfaya iki kez yüklendi; örneğin snippet ile, bir de bir onay platformu ya da Özel HTML etiketiyle. Etiketleri iki kez çalışabilir. | Tek bir kurulum bırakın: fazladan snippet'i ya da onu yeniden yükleyen etiketi kaldırın. |
| `container_environment` (uyarı) | Snippet Live yerine bir GTM ortamı (`gtm_preview`, `gtm_auth`) yüklüyor; ziyaretçiler bir test ya da geliştirme sürümü alıyor. | Canlı sitede Live snippet'ini kullanın ya da ortamdaki sürümü Live'a yayımlayın. |
| `datalayer_split` (bilgi) | Aynı sayfadaki container'lar farklı dataLayer'ları okuyor. Birine yapılan push diğerlerine hiç ulaşmaz. | Tüm container'ları aynı dataLayer'a yönlendirin ya da olayları ve onay komutlarını her birine gönderin. |
| `container_send_to_only` (bilgi) | Bir hedef `gtag('config')` olmadan yalnızca bir olayın `send_to` değeriyle yüklendi; varsayılan ayarlarla çalışıyor. | Ona gönderen olaylardan önce bir `gtag('config', ID)` ya da GTM'de onun için bir Google etiketi ekleyin. |

## Gömülü widget'lar

Üçüncü taraf bir iframe (rezervasyon, sohbet ya da ödeme widget'ı, bir video) kendi sağlayıcısının hesaplarına kendi izlemesini gönderebilir. ai-tag-debugger her isteğin, dataLayer push'unun ve container yüklemesinin hangi iframe'den geldiğini kaydeder ve izlemenin kime ait olduğuna karar verir:

- Sayfanın kendisinden ya da sitenin kendi alan adındaki bir iframe'den (bir alt alan adındaki ödeme ya da form): **sitenin**.
- Üçüncü taraf bir iframe'den, sitenin kendi etiketlerinin de kullandığı bir hesaba (sitenin GA4 kimliğiyle kurulmuş bir rezervasyon motoru): **sitenin**.
- Üçüncü taraf bir iframe'den, başka herhangi bir hesaba: **widget'ın**.

Bir widget'ın kendi izlemesi, sitenin izlemesini değerlendiren her şeyin dışında tutulur: plan eşleştirme, kapsam, tekrarlar, planda olmayan olaylar ve puanlar. Widget'ın sağlayıcısının GA4'üne giden bir `purchase` sitenin yerine geçemez. Yine de onay ve kişisel veri için sayılır, çünkü site gömdüğü widget'ların topladıklarından sorumludur. Bu bulgular "… kaynaklı gömülü bir widget içinde:" ile başlar.

**Gömülü widget'lar** kartı her widget için gömülü olduğu yeri, yüklediği container'ları, kendi hesaplarına ve sitenin hesaplarına gönderdiği izlemeyi, kendi dataLayer'ındaki olayları ve sitenin hesaplarına hiç ulaşmayan olayları gösterir.

| Bulgu | Ne anlama geldiği | Ne yapmalı |
|---|---|---|
| `widget_tracking` (bilgi) | Widget kendi hesaplarına izleme gönderdi; plan kontrollerinin dışında tutuldu. | Plan için bir şey gerekmez. Onaydan önce izliyorsa onay bulguları onu adlandırır. |
| `widget_events_unshared` (bilgi) | Widget kendi dataLayer'ına olaylar gönderdi (örneğin tamamlanan bir rezervasyon), ama bunlar sitenin hesaplarına hiç ulaşmadı. Sayfanın etiketleri bir widget'ın dataLayer'ını okuyamaz. | Çoğu rezervasyon ve form widget'ı ayarlarında bir GA4 ya da GTM kimliği kabul eder: sitenin kimliğini verin. Aksi hâlde olayı sayfaya iletin (aşağıya bakın). |

## Sitenin kendi alan adındaki iframe'ler

| Bulgu | Ne anlama geldiği | Ne yapmalı |
|---|---|---|
| `iframe_container` (bilgi) | Sayfanınkinin yanında aynı sitedeki bir iframe'de bir container çalışıyor. iframe'in kendi dataLayer'ı var: sayfanın olayları ve onayı ona hiç ulaşmaz. | Olayları ve onay durumunu iframe içinde de gönderin ya da iframe'deki adımları sayfadan izleyin. |
| `iframe_message_unhandled` (bilgi) | Bir iframe sayfaya `postMessage` ile bir olay gönderdi (örneğin "form gönderildi"), ancak sayfa hemen ardından dataLayer'a hiçbir şey göndermedi ve istek yollamadı. | Sayfaya, aşağıdaki gibi onu ileten bir dinleyici ekleyin. |

### iframe'lerden gelen mesajlar

Formlar, ödeme sayfaları ve rezervasyon widget'ları işleri bittiğinde bunu sayfaya çoğu zaman `postMessage` ile bildirir. **iframe'lerden gelen mesajlar** kartı bir iframe'in gönderdiği her olayı ve sayfanın ardından ne yaptığını listeler:

- **aynı olayı dataLayer'a gönderdi ya da iletti:** iletildi.
- **3 saniye içinde başka bir olay gönderdi ya da istek yolladı:** büyük olasılıkla aynı olay, başka bir adla.
- **hiçbir şey:** sayfa dinlemiyor ve `iframe_message_unhandled` bildirilir.

Mesajın yalnızca adı ve alanlarının adları kaydedilir, değerleri asla; çünkü bir formun mesajı ziyaretçinin yazdıklarını taşıyabilir. Düzenleme mesajları (boyutlandırma, hazır ve canlılık sinyalleri) dışarıda bırakılır.

Bir iframe'in olayını sayfanın dataLayer'ına ileten, böylece bir GTM tetikleyicisinin onunla çalışabildiği bir dinleyici:

```html
<script>
  window.dataLayer = window.dataLayer || [];
  window.addEventListener("message", function (e) {
    // Yalnızca beklediğiniz iframe'e güvenin.
    if (e.origin !== "https://booking.example.com") return;
    var data = typeof e.data === "string" ? safeParse(e.data) : e.data;
    if (data && data.event === "booking_complete") {
      window.dataLayer.push({ event: "booking_complete", booking_value: data.value });
    }
  });
  function safeParse(s) { try { return JSON.parse(s); } catch (err) { return null; } }
</script>
```

Ardından GTM'de `booking_complete` için bir Özel Olay tetikleyicisi ekleyin ve GA4 ile reklam dönüşüm etiketlerini onunla çalıştırın.

## MCP üzerinden

MCP sunucusuna bağlı bir sohbet uygulamasında:

- Her adım sonucu yüklediği container'ları, bir iframe'den gelen istekleri (ve plan kontrollerinin onları sayıp saymadığını) ve iframe'lerin gönderdiği mesajları listeler.
- `get_containers` ve `get_widgets` açık bir denetimin şimdiye kadar gördüklerini listeler.
- `finish_audit` ve `run_audit` sonuçları container'lar, widget'lar ve mesajlarla biter.
- `get_report` bunları `part: "containers"`, `"widgets"` ya da `"messages"` ile JSON olarak döndürür.

Örneğin: *"shop.example'ın rezervasyon sayfasını denetle ve rezervasyon widget'ının dönüşümlerinin GA4'ümüze ulaşıp ulaşmadığını söyle."*
