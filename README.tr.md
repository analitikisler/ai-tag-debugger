[English](README.md) | Türkçe

# AI Tag Debugger

**Sitenizdeki analitik ve reklam ölçümlemesini test eden açık kaynak bir yapay zekâ ajanı.**

Bir yapay zekâ modeli, gerçek bir tarayıcıda önemli senaryolarınızı (ürün → sepet → ödeme, form doldurma) gerçek bir ziyaretçi gibi gezer. Gezinirken `ai-tag-debugger`, GA4, Google Ads, Meta Pixel ve TikTok'a giden her isteği ve her dataLayer push'unu kaydeder. Sonra bunları ölçümleme planınıza ve Consent Mode ayarlarınıza göre kontrol eder ve neyin bozulduğunu, nasıl düzeltileceğini anlaşılır bir dille, Türkçe ya da İngilizce bir raporda yazar.

İki şekilde kullanabilirsiniz:

- **Terminalden ya da CI'dan**, Anthropic (Claude), OpenAI, Google Gemini ya da OpenAI uyumlu herhangi bir API (Kimi, GLM, DeepSeek, OpenRouter, bilgisayarınızdaki Ollama ve daha fazlası) için kendi API anahtarınızla.
- **Yapay zekâ asistanınızdan** (Claude, ChatGPT, Gemini ve MCP destekleyen diğer uygulamalar). Testi uygulamanın kendi modeli yürütür, yani ayrı bir API anahtarına gerek yoktur.

[Analitik İşler](https://analitikisler.com/tr/) tarafından geliştirildi. MIT lisanslı.

```
▶ checkout (mobile)
  Accept cookies
  Open the first product
  Add to cart
  Open the cart
  Go to checkout
  …
  Place the order
  ✓ All scripted steps completed. · 20 tracking hits captured

2 broken · 1 risk · 1 warning · 4 ok
Report: reports/demo/report.html
```

## Neden

Ölçümleme sessizce bozulur. Yeniden tasarımda bir butonun adı değişir, yeni bir şablon bir alanı unutur, çerez onayı banner'ındaki bir güncelleme pikselleri erken çalıştırır. Kimseye uyarı gelmez. Reklam platformları haftalarca hatalı dönüşümlerle optimizasyon yaptıktan sonra fark edersiniz.

Tag'leri elle test etmek bunu yakalar, ama zahmetli olduğu için her sürümden sonra pek yapılmaz. `ai-tag-debugger` bunu CI'da çalıştırabileceğiniz tek bir komuta dönüştürür.

## Neleri kontrol eder

| Kontrol | Örnek bulgu |
|---|---|
| Eksik event'ler | `purchase`, ödeme senaryosunda hiç gönderilmedi |
| Eksik parametreler | `purchase`, mobilde `value` ve `currency` olmadan gönderildi |
| Tekrar eden event'ler | `add_to_cart` tek tıklamada iki kez gönderildi |
| Çerez onayı | Meta `PageView`, ziyaretçi çerezleri kabul etmeden gönderildi; Consent Mode varsayılanı yok ya da çok geç ayarlanmış |
| Kişisel veri | Bir e-posta adresi reklam platformuna açık metin olarak gönderildi |
| Planda olmayan event'ler | Ölçümleme planınızda bulunmayan event'ler gönderiliyor |

Platformlar: GA4 (server-side GTM adresleri dahil), Google Ads dönüşümleri, Meta Pixel, TikTok Pixel ve temel X Pixel event'leri.

### Kontrol edilecek platformları seçin

Varsayılan olarak bir test GA4, Google Ads, Meta ve TikTok'u kontrol eder. Başka platformları `--providers ga4,meta,x` ile, ayar dosyasındaki `"providers"` ile ya da MCP `start_audit` ve `run_audit` araçlarındaki `providers` ile seçebilirsiniz. Seçenekler: `ga4`, `google_ads`, `meta`, `tiktok`, `x`, `linkedin`, `microsoft_ads`, `pinterest`, `snapchat`, `clarity`, `hotjar`, `doubleclick` ve `adsense`. GA4, Google Ads, Meta, TikTok ve X için event'ler ayrıştırılır; diğerlerinin ağ istekleri gösterilir.

Seçmediğiniz platformlara giden istekler de yerelde yanıtlanır, yani o hesaplara da ulaşmaz. Bu istekler zaman akışına, CSV'ye ve kontrollere alınmaz, sadece sayılır: rapor bunları istek sayılarıyla listeler (örneğin "Kapsam dışı 61 istek atlandı: Microsoft Clarity, DoubleClick") ve her adım kaç istek atladığını gösterir. `--providers` vermezseniz, ölçümleme planınızda geçen her platform varsayılan listeye eklenir. Dışarıda bıraktığınız platformlar için planlanmış event'ler eksik olarak raporlanmaz, tek bir bilgi bulgusunda listelenir. Tag yöneticisi ve çerez onayı platformu istekleri her zaman gösterilir.

## Nasıl çalışır

1. **Gezinme:** yapay zekâ modeline sade bir dille yazılmış bir hedef ("herhangi bir ürünü sepete ekle ve test ödeme yöntemiyle siparişi tamamla") ve sayfanın metin görünümü verilir. Model, Playwright üzerinden adım adım iki araç kullanır: `browser_action` (goto, click, fill, select, scroll, wait) ve `finish`.
2. **Kayıt:** ölçümleme adreslerine giden her istek ayrıştırılıp standart bir biçime getirilir ve onu oluşturan adımla etiketlenir. Her dataLayer push'u, `gtag('consent', ...)` komutları dahil, bir init script ile kaydedilir. Varsayılan olarak GA4, Google Ads, Meta, TikTok, Microsoft Ads, LinkedIn, Pinterest, Snapchat ve X'in veri toplama istekleri yerelde yanıtlanır, yani **test trafiği bu gerçek hesaplara ulaşmaz**. Diğer sağlayıcıların tag'leri isteklerini göndermeye devam eder; zaman akışının ağ bölümü her çağrıyı ve yerelde yanıtlanıp yanıtlanmadığını gösterir.
3. **Kontrol:** kurallar, yakalanan istekleri ölçümleme planınızla karşılaştırır. Bu kısım hiçbir API çağrısı yapmaz, bu yüzden sonuçlar tekrarlanabilirdir.
4. **Açıklama:** model bulguları, her adımdaki istekleri ve (isterseniz) GTM container dışa aktarımınızı okur. Her sorunun olası nedenini ve çözümünü, ilgili tag ve trigger'ları adıyla anarak yazar.

## Yapay zekâ sağlayıcıları

Kendi API anahtarınızı kullanırsınız. `ai-tag-debugger` her sağlayıcının resmi SDK'sını kullanır:

| Sağlayıcı | API anahtarı değişkeni | Varsayılan model |
|---|---|---|
| Anthropic (Claude) | `ANTHROPIC_API_KEY` | `claude-opus-5-5` |
| OpenAI | `OPENAI_API_KEY` | `gpt-5.5` |
| Google Gemini | `GEMINI_API_KEY` | `gemini-pro-latest` |

Sağlayıcı, hangi anahtar tanımlıysa ona göre seçilir (birden fazlası tanımlıysa önce Anthropic). Açıkça seçmek için `--provider anthropic|openai|gemini` ya da ayar dosyasında `"provider"` kullanın; başka bir model için `--model` verin. Gezinme, maliyeti düşük tutmak için düşük reasoning effort ister; açıklamalar ise yüksek effort ve yapılandırılmış JSON çıktısı ister.

### OpenAI uyumlu her API: Kimi, GLM, DeepSeek, OpenRouter, Ollama ve daha fazlası

Birçok sağlayıcı, OpenAI'ınkine benzer çalışan bir API sunar. `ai-tag-debugger`'ı adresini ve model kimliğini vererek bu API'lere yönlendirebilirsiniz:

```bash
export OPENAI_COMPATIBLE_API_KEY=...        # leave unset for a local Ollama
ai-tag-debugger run --site https://yourshop.com --journey add_to_cart \
  --provider openai-compatible --base-url <API address> --model <model id>
```

| Sağlayıcı | `--base-url` |
|---|---|
| Moonshot (Kimi) | `https://api.moonshot.ai/v1` |
| Z.ai (GLM) | `https://api.z.ai/api/paas/v4` |
| DeepSeek | `https://api.deepseek.com` |
| Mistral | `https://api.mistral.ai/v1` |
| Groq | `https://api.groq.com/openai/v1` |
| OpenRouter (yüzlerce model) | `https://openrouter.ai/api/v1` |
| Bilgisayarınızdaki Ollama | `http://localhost:11434/v1` |

Model kimliğini sağlayıcınızın dokümantasyonundan alın. Bayrakların yerine `OPENAI_COMPATIBLE_BASE_URL` ve `OPENAI_COMPATIBLE_MODEL` değişkenlerini ya da ayar dosyasında `"provider"`, `"base_url"` ve `"model"` alanlarını da kullanabilirsiniz. API katı JSON şeması döndüremiyorsa, açıklamalar düz JSON moduna geçer.

**Model seçimi hakkında.** Yapay zekâ, 5 ile 30 adım arasında, her adımda bir araç çağırarak gezinir. Modeller bunu ne kadar güvenilir yaptıkları konusunda çok farklıdır: küçük ve yerel modeller yanlış yere tıklayabilir, döngüye girebilir ya da erken durabilir. Kontroller modelin ne yaptığından bağımsız olarak doğru kalır, çünkü yakalanan isteklere dayanır. Ama tamamlanmayan bir senaryo, sonraki adımlardaki event'leri gösteremez. Bir model zorlanıyorsa daha büyük bir model, kısa hedefli hazır bir senaryo ya da `--max-steps` deneyin. Test edilmiş olanlar Anthropic, OpenAI ve Gemini varsayılanlarıdır.

Yeni bir yerleşik sağlayıcı eklemek için [`src/providers.js`](src/providers.js) içinde iki fonksiyon yazmanız yeterli: araç çağıran bir konuşma ve yapılandırılmış bir JSON çağrısı.

## Hızlı başlangıç

Node 20 ve üstü gerekir.

```bash
npm install -g @analitikisler/ai-tag-debugger
npx -y playwright@1.56.1 install chromium   # the browser version this release uses
export ANTHROPIC_API_KEY=...                # or OPENAI_API_KEY, or GEMINI_API_KEY

ai-tag-debugger run --site https://staging.yourshop.com --journey add_to_cart --headed
```

Ya da kurmadan çalıştırın: `npx -y @analitikisler/ai-tag-debugger run --site … --journey add_to_cart`.

### Demo mağazayı deneyin (kaynak koddan)

Depoda, bilerek bırakılmış üç ölçümleme hatası olan bir demo mağaza var:

```bash
git clone https://github.com/analitikisler/ai-tag-debugger.git
cd ai-tag-debugger
npm install
npx playwright install chromium   # run again after upgrading, so the browser matches Playwright
npm run demo:serve                # in one terminal: http://localhost:4321
node src/cli.js run --config examples/demo.config.json --out reports/demo
open reports/demo/report.html
```

Henüz API anahtarınız yok mu? Kayıtlı adımları hiçbir yapay zekâ modeli kullanmadan tekrar oynatın:

```bash
node src/cli.js run --config examples/demo.config.json --scripted --no-ai --out reports/demo
```

## Neyi test edeceğinizi seçin

Başlamak için ayar dosyasına gerek yok. Hazır senaryoları seçin, kendi senaryonuzu kendi cümlenizle yazın ve kontrolü önem verdiğiniz event'lerle sınırlayın:

```bash
# Ready-made journeys come with a goal and the GA4 and Meta events to expect.
ai-tag-debugger run --site https://staging.yourshop.com --journey purchase --journey sign_up

# Describe a journey in your own words. The events you name are expected on it.
ai-tag-debugger run --site https://yoursite.com --goal "Subscribe to the newsletter in the footer" --events newsletter_signup

# Only check some events.
ai-tag-debugger run --config ai-tag-debugger.config.json --events purchase,add_to_cart
```

Hedefi Türkçe de yazabilirsiniz, örneğin `--goal "Sayfanın altındaki bültene abone ol"`.

| Hazır senaryo | Yapay zekânın yaptığı | Beklenen event'ler |
|---|---|---|
| `purchase` (ya da `checkout`) | Ürün → sepet → ödeme → test ödeme seçeneğiyle sipariş | GA4 `view_item`, `add_to_cart`, `begin_checkout`, `purchase`; Meta `AddToCart`, `InitiateCheckout`, `Purchase` |
| `add_to_cart` (ya da `cart`) | Bir ürün açar ve sepete ekler | GA4 `view_item`, `add_to_cart`; Meta `AddToCart` |
| `sign_up` (ya da `signup`, `register`) | Test verileriyle hesap oluşturur | GA4 `sign_up`; Meta `CompleteRegistration` |
| `lead` (ya da `contact`, `form`) | İletişim, teklif ya da demo formunu doldurup gönderir | GA4 `generate_lead`; Meta `Lead` |
| `search` | Sitede arama yapar ve bir sonucu açar | `search_term` ile GA4 `search`; Meta `Search` |

`--journey`, ayar dosyanızdaki senaryoları da id'leriyle seçer. Ayar dosyasıyla birlikte kullanıldığında hazır senaryolar kendi event'lerini planınıza ekler.

### API kullanımını düşük tutmak

Her gezinme adımı bir model çağrısıdır. Yani kullanım **senaryo × ekran boyutu × adım** ile artar, buna sonda bulguları açıklayan bir çağrı eklenir. Kontroller hiçbir zaman modeli çağırmaz.

- **Sadece ihtiyacınız olan senaryoları çalıştırın.** En büyük tasarruf budur: tam `purchase` senaryosu yerine `--journey add_to_cart`, on ya da daha fazla adım yerine birkaç adım sürer.
- **Tek ekran boyutu kullanın.** `--viewport mobile`, masaüstü ve mobile göre çağrıları yarıya indirir.
- **Adım sayısını sınırlayın.** `--max-steps 15`, yolunu kaybeden bir senaryoyu durdurur.
- **Büyük sayfaların daha pahalı olduğunu unutmayın.** Her adım modele sayfanın görünümünü (en fazla 250 öğe ve 3.000 karakter metin) gönderir. Bu yüzden kalabalık sayfalar adım başına daha fazla token kullanır.
- **Raporu odaklı tutmak için `--events` kullanın.** Gezinmeyi kısaltmadığı için kullanımı pek değiştirmez.
- **Yapay zekâ olmadan tekrar oynatın.** Bir yapay zekâ çalıştırmasından sonra adımları `journeys[].steps` içine kopyalayın ve her deploy'da `--scripted` (hiç model çağrısı olmaması için `--no-ai` ile birlikte) kullanın.
- **Bir yapay zekâ asistanı kullanın.** MCP üzerinden gezinmeyi asistanın kendi modeli yapar, hiç API anahtarı kullanılmaz.

### Yeni bir sürümü kaydedilmiş sitelerle karşılaştırın

`--save-site <klasör>`, sitenin gönderdiği her yanıtı ve atılan adımları da kaydeder. `replay` aynı sayfaları ağ ve yapay zekâ modeli olmadan, çevrimdışı olarak yeniden denetler; bu yüzden hiçbir maliyeti yoktur. Kaydedilen çalıştırmaya göre yeni çıkan ya da kaybolan bulguları listeler:

```bash
npx @analitikisler/ai-tag-debugger run --site https://www.magazaniz.com --journey purchase --save-site saved/magazaniz
npx @analitikisler/ai-tag-debugger replay saved/*
✗ https://www.magazaniz.com (saved/magazaniz): 0 new, 1 gone
    - warning duplicate purchase desktop ga4 page_view
```

İlk çalıştırmanın bulguları beklenen bulgular olur. Bir değişiklik doğruysa (örneğin düzeltilmiş bir yanlış alarm), `replay --update` yeni bulguları beklenen bulgular yapar. Aracın yeni bir sürümünü bildiğiniz sitelerle ya da bir site değişikliğini son sağlıklı çalıştırmayla karşılaştırmak için kullanın. Kaydedilmiş bir site genellikle birkaç MB'tır. İzleme isteklerini, görselleri ve videoları, oturum çerezlerini ve tarayıcının gönderdiği çerezleri, yetkilendirme başlıklarını, form verilerini ve adresinde e-posta ya da başka kullanıcı verisi olan istekleri içermez. Yine de sitenin sayfalarını ve betiklerini içerdiği için size ait olmayan siteleri herkese açık depolara koymayın.

## Sitenizi ayarlayın

`ai-tag-debugger.config.json`:

```json
{
  "site": "https://staging.yourshop.com",
  "plan": "measurement-plan.json",
  "gtm_container": "GTM-XXXX_workspace.json",
  "viewports": ["desktop", "mobile"],
  "journeys": [
    {
      "id": "checkout",
      "goal": "Accept cookies, add any product to the cart and complete checkout using the test payment method."
    }
  ]
}
```

| Alan | Anlamı |
|---|---|
| `site` | Ana adres. Mümkünse staging kullanın. |
| `plan` | Ölçümleme planı: bir dosya yolu ya da satır içi bir nesne (aşağıda). Hazır senaryolarla isteğe bağlıdır. |
| `gtm_container` | İsteğe bağlı GTM container dışa aktarımı (Admin → Export container). Böylece açıklamalarda tag ve trigger'lar adıyla geçer. |
| `viewports` | `desktop` ve/veya `mobile`. |
| `journeys` | `--journey` ile hazır senaryo seçtiğinizde ya da `--goal` ile kendi senaryonuzu yazdığınızda isteğe bağlıdır. |
| `journeys[].goal` | Yapay zekânın yapması gereken, sade bir dille. |
| `journeys[].start` | İsteğe bağlı başlangıç yolu (varsayılan `/`). |
| `journeys[].steps` | `--scripted` çalıştırmaları için isteğe bağlı sabit adımlar: `{ "action": "click", "selector": "#add-to-cart" }`. |
| `allowed_hosts` | Senaryoların gidebileceği diğer adresler, örneğin harici bir ödeme sayfası için `["checkout.payments-provider.com"]`. Bunun dışında tarayıcı `site` adresinde ve alt alan adlarında kalır. `--allow-host` ile aynıdır. |
| `providers` | Kontrol edilecek ölçümleme platformları, örneğin `["ga4", "meta"]`. Varsayılan `["ga4", "google_ads", "meta", "tiktok"]`. `--providers` ile aynıdır. |
| `block_hits` | Varsayılan `true`. İsteklerin gerçek adreslerinize ulaşmasına izin vermek için `false` yapın. |
| `language` | Rapor dili, `en` (varsayılan) ya da `tr`. `--lang` ile aynıdır. |
| `keep_bodies` | Varsayılan `false`. Ölçümleme isteklerini kullanıcı verilerini gizlemeden, gönderildiği haliyle saklamak için `true` yapın. `--keep-bodies` ile aynıdır. |
| `branding` | Varsayılan `true`. Analitik İşler logosunu ve "AI Tag Debugger ile oluşturuldu · analitikisler.com" satırını raporlardan çıkarmak için `false` yapın. `--no-branding` ya da MCP `finish_audit` ve `run_audit` araçlarında `branding: false` ile aynıdır. |
| `provider` | İsteğe bağlı: `anthropic`, `openai`, `gemini` ya da `openai-compatible`. `--provider` ile aynıdır. |
| `base_url`, `model` | İsteğe bağlı: API adresi ve model kimliği, örneğin `openai-compatible` için. `--base-url` ve `--model` ile aynıdır. |

`measurement-plan.json`:

```json
{
  "consent_mode": true,
  "events": [
    { "platform": "ga4", "name": "add_to_cart", "required_params": ["currency", "value", "items"] },
    { "platform": "ga4", "name": "purchase", "journeys": ["checkout"], "required_params": ["transaction_id", "currency", "value", "items"] },
    { "platform": "meta", "name": "Purchase", "journeys": ["checkout"], "required_params": ["value", "currency"] }
  ]
}
```

`platform` değeri `ga4`, `google_ads`, `meta` ya da `tiktok` olabilir. `journeys`, bir event'in hangi senaryolarda beklendiğini sınırlar (varsayılan: her senaryo). Tek bir işlemde birden fazla kez gönderilmesi normal olan event'ler için `allow_multiple: true` kullanın.

## CLI

```
ai-tag-debugger run [--site <url>] [--config <file>] [--journey <id>] [--goal "<text>"] [--events <names>]
                [--max-steps <n>] [--out <dir>] [--viewport desktop|mobile] [--providers <list>]
                [--provider anthropic|openai|gemini|openai-compatible] [--model <id>] [--base-url <url>]
                [--lang en|tr] [--allow-host <host>] [--keep-bodies] [--scripted] [--no-ai] [--fail-on broken|risk|warning|never] [--headed]
                [--save-site <dir>]
ai-tag-debugger replay <dir>... [--update] [--out <dir>]
ai-tag-debugger mcp [--http] [--port <n>] [--host <addr>] [--token <secret>] [--public-url <https url>] [--reports <dir>]
                [--allow-private-network]
```

Bulgular `--fail-on` seviyesine (varsayılan `broken`) ulaştığında çıkış kodu `1` olur, böylece bir deploy'u durdurabilir. Her deploy sonrası çalıştırmak için [`examples/github-actions/ai-tag-debugger.yml`](examples/github-actions/ai-tag-debugger.yml) örneğine bakın.

Çıktılar:

- `report.html`: dört sekmeli tek bir dosya. Sekmeler arası bağlantılar çalışır (bir bulgudaki "Nerede" etiketi o adımı açar) ve her görünümün kaydedip paylaşabileceğiniz kendi adresi vardır.
  - **Genel bakış**: sorun sayıları, yapay zekâ özeti (en önemli sorun en üstte, ayrıca bulguların kapsamadığı ama kontrol etmeye değer noktalar), sorun sayılarıyla senaryolar ve kontrol edilen platformlar.
  - **Bulgular**: önem derecesine göre gruplanır ve filtrelenebilir. Her bulgunun etkisi, olası nedeni, kanıtı, numaralı çözüm adımları ve oluştuğu adımlar vardır.
  - **Yolculuklar**: her seferinde bir senaryo; solda adımları, sağda seçili adım. İlk sorunlu adımda açılır. Her adımın üç sekmesi vardır:
    - **Olaylar**: parametreleri, çerez onayı durumu, arkasındaki dataLayer push'u ve isteğiyle birlikte her ölçümleme isteği; bir bulgu ona işaret ediyorsa bir not.
    - **dataLayer**: adımdaki her push.
    - **Ağ istekleri**: seçilen platformlara giden her istek; her parametrede `?` ipucu olan bir parametre tablosuna çözülmüş halde. Toplu gönderilen bir GA4 isteği, içindeki her event'i gösterir.
  - **Kapsam ve plan**: planlanan her event'in her senaryoda gönderilip gönderilmediği ve istek sayılarıyla kontrol edilen ya da dışarıda bırakılan platformlar.

  Event'ler ve istekler kaynağa göre filtrelenebilir. GA4 ürün dizeleri (`pr1`…) ve dataLayer `ecommerce.items` ürün kartları olarak, özel ürün parametreleri ayrı bir grupta gösterilir. Raporda script yoktur: sekmeler ve filtreler düz HTML ve CSS'tir (Chrome 105, Safari 15.4 ya da Firefox 121 ve üstü gerekir) ve yazdırınca tüm sekmeler görünür. Logolar dosyanın içindedir, internetten hiçbir şey yüklenmez. `--no-branding` Analitik İşler logosunu ve imza satırını çıkarır.
- `timeline.csv`: aynı zaman akışı; her istek, dataLayer push'u ve ağ çağrısı bir satır, Excel ya da Google Sheets için hazır.
- `report.md`: raporun Markdown hali, örneğin bir pull request yorumu için.
- `capture.json`: yakalanan tüm veriler, kendi analiziniz için.

Raporlar bir imza satırıyla biter: "AI Tag Debugger ile oluşturuldu · analitikisler.com". Buradaki alan adı düz bir bağlantıdır (resim yok, takip yok, referrer gönderilmez, böylece rapor adresleri sızmaz). `--no-branding` bu satırı logoyla birlikte kaldırır.

Türkçe rapor için `--lang tr` kullanın. Bulgu metinleri, başlıklar, modelin açıklamaları ve çözümleri Türkçe yazılır; ajan da adımlarını Türkçe anlatır.

## Yapay zekâ asistanınızdan kullanın (MCP)

`ai-tag-debugger mcp`, bir [Model Context Protocol](https://modelcontextprotocol.io) sunucusu başlatır. Böylece testi asistanınızın modeli kendisi yürütür: "staging.magazam.com'da ödeme adımlarının ölçümlemesini kontrol et" dersiniz, tarayıcıyı açar, adımları tıklar ve bulguları sohbette açıklar. API anahtarı gerekmez, çünkü düşünme işini uygulamanın kendi modeli yapar.

Sunucunun sunduğu araçlar:

| Araç | Ne yapar |
|---|---|
| `start_audit` | Bir adreste yeni bir tarayıcı açar ve tüm ölçümleme isteklerini kaydetmeye başlar. Hedefini ve beklenen event'lerini almak için hazır bir senaryo (`purchase`, `sign_up`, …), neyin kontrol edileceğini seçmek için `providers` verin. Asistan önce size hangi platformların kontrol edileceğini sorar. |
| `browser_action` | Tek bir click, fill, select, goto, scroll ya da wait. Sayfayı ve o adımda gönderilen ölçümleme isteklerini döndürür. |
| `get_page` | Mevcut sayfayı gösterir. |
| `finish_audit` | Her şeyi ölçümleme planınıza (JSON) ya da hazır senaryonun event'lerine göre, isterseniz sadece adını verdiğiniz `events` için kontrol eder ve zaman akışıyla birlikte tam HTML raporu yazar. |
| `run_audit` | Bir ayar dosyasını baştan sona çalıştırır (sadece yerelde). |

Tarayıcı, sunucunun çalıştığı bilgisayarda çalışır. Bu yüzden staging ve `localhost` sitelerinize erişebilir. Ölçümleme istekleri her zamanki gibi yerelde yanıtlanır.

### Yerel sunucu başlatan uygulamalar: Claude Desktop, Gemini CLI, Cursor, VS Code, Claude Code

Sunucuyu uygulamanın MCP ayarlarına ekleyin. Claude Desktop'ta bu Settings → Developer → Edit Config'tir (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ai-tag-debugger": {
      "command": "npx",
      "args": ["-y", "@analitikisler/ai-tag-debugger", "mcp"]
    }
  }
}
```

Tarayıcıyı bir kez `npx -y playwright@1.56.1 install chromium` ile kurun. Gemini CLI, `~/.gemini/settings.json` içinde aynı `mcpServers` bloğunu kullanır. Claude Code için: `claude mcp add ai-tag-debugger -- npx -y @analitikisler/ai-tag-debugger mcp`. Uygulamayı yeniden başlatın, ai-tag-debugger araçları görünür. Uygulama `npx`'i bulamazsa tam yolunu kullanın (`which npx`; örneğin Homebrew kurulu bir Mac'te `/opt/homebrew/bin/npx`). Raporlar `~/ai-tag-debugger-reports` klasörüne yazılır.

Kaynak koddan mı çalıştırıyorsunuz? `"command": "node"` ve `"args": ["/path/to/ai-tag-debugger/src/cli.js", "mcp"]` kullanın.

### Bir adrese bağlanan uygulamalar: ChatGPT, Gemini

Bu uygulamalar MCP sunucularına HTTPS üzerinden bağlanır (ChatGPT'de, planınıza bağlı olarak developer mode connector'ları ile). Sunucuyu HTTP modunda başlatın ve bir tünelle internete açın:

```bash
cloudflared tunnel --url http://localhost:8787     # or: ngrok http 8787; note the https address it prints
npx -y @analitikisler/ai-tag-debugger mcp --http --port 8787 --public-url https://<your-tunnel-address>
```

Sunucu, rastgele gizli bir yol içeren bir adres yazdırır, örneğin `https://<your-tunnel-address>/mcp/<secret>`. Bu adresi uygulamaya connector olarak ekleyin. Adrese sahip olan herkes bilgisayarınızdaki tarayıcıyı kullanabilir; adresi kimseyle paylaşmayın ve işiniz bitince sunucuyu kapatın. Kendi belirlediğiniz bir gizli anahtar (`--token`) en az 16 karakter olmalıdır.

HTTP modunda sunucu, yereldekinden daha kısıtlıdır:

- Diskinizden ölçümleme planı ya da ayar dosyası okumaz (planı sohbette JSON metni olarak verin) ve `run_audit` sunulmaz. Sadece kendi yazdığı raporları sunar.
- Tarayıcı sadece `http` ve `https` sayfalarını açar; `localhost` ve özel ağ adreslerini (`192.168.x.x` ya da `169.254.169.254` gibi) reddeder, böylece adres ağınızın içini görmek için kullanılamaz. WebSocket'ler dahil tüm tarayıcı trafiği küçük bir yerleşik proxy'den geçer. Bu proxy her adresi bir kez çözümler ve sadece kontrol ettiği IP'ye bağlanır, böylece test sırasında değişen bir DNS yanıtı bu kontrolü aşamaz. Yerel bir staging sitesini yine de bu şekilde test etmek için sunucuyu `--allow-private-network` ile başlatın.
- 15 dakika açık kalan testler kapatılır ve istek gövdeleri 1 MB ile sınırlıdır.

Tünele gerek kalmayan, hazır bir adresle barındırılan sunucu, [Analitik İşler](https://analitikisler.com/tr/) Cloud sürümünün bir parçasıdır.

## Güvenlik

- Ajana bariz test verileri kullanması ve **asla gerçek ödeme bilgisi girmemesi** söylenir. Bir senaryo gerçek bir ödeme ya da hesap gerektiriyorsa, durur ve bunu raporlar.
- [Nasıl çalışır](#nasıl-çalışır) bölümünde listelenen platformlara giden ölçümleme istekleri varsayılan olarak yerelde yanıtlanır, böylece bu analitik ve reklam hesaplarına test dönüşümleri gitmez.
- Tarayıcı test edilen sitede ve alt alan adlarında, ayrıca `allowed_hosts` içindeki adreslerde kalır. Sadece `http` ve `https` sayfalarını açar.
- Modele, sayfa içeriğinin talimat değil veri olduğu söylenir. Bir prompt kuralı, modelin hiçbir zaman yanıltılmayacağını garanti edemez; bu yüzden yukarıdaki gezinme sınırları, yanıltılmış bir modelin yapabileceklerini kısıtlar.
- Tarayıcı, ortamında API anahtarlarınız ve diğer gizli bilgiler olmadan çalışır.
- **Reklam eşleştirmesi için gönderilen kullanıcı verileri**, `capture.json` dosyasına kaydedilmeden ya da raporda gösterilmeden önce **gizlenir**: GA4 ve Google Ads enhanced conversions (`em`, `ph`, `uid`, …), Meta advanced matching (`ud[*]`, `udff[*]`), TikTok `context.user` içindeki e-postalar, telefon numaraları, adlar, adresler ve kullanıcı kimlikleri ile sitenin enhanced conversions için dataLayer'a gönderdiği `user_data`. E-posta adresine benzeyen her değer, alanın adı ne olursa olsun gizlenir. Denetlenen sitenin kendi adresi bir `mailto:` bağlantısında ya da bir bağlantı alanında (`link_url`, `link_text`, `gtm.elementUrl`, …) geçiyorsa, örneğin bir GTM tıklama olayındaki iletişim bağlantısında, ziyaretçi verisi olmadığı için bu kuralın dışında kalır. Her değer `[redacted: 64 chars, looks hashed]` gibi bir işarete dönüşür; hash'lenmemiş bir değer kişisel veri riski olarak raporlanır. `--keep-bodies` (`"keep_bodies": true`) hata ayıklama için istekleri gönderildiği haliyle saklar.
- Saklanan istek gövdeleri istek başına 32 KB ve senaryo başına 2 MB ile sınırlıdır. Bu sınırın üstünde rapor, gövdenin saklanmadığını belirtir.
- Sadece size ait ya da test etme yetkiniz olan sitelerde çalıştırın.
- HTTP sunucusunu başkaları için mi barındırıyorsunuz? Ek bir güvenlik katmanı olarak özel ağ ve bulut metadata adres aralıklarını ağ seviyesinde de engelleyin (bir egress firewall ya da izole bir ağ ile).

## Yol haritası

- Consent Check: çerez onayı banner'larının ve Consent Mode v2'nin GDPR/KVKK'ya göre daha derin denetimi.
- Ölçümleme planı: bir adresten plan ve dataLayer şartnamesi taslağı hazırlama.
- [analitikisler.com](https://analitikisler.com/tr/) üzerinde zamanlanmış testler, deploy webhook'ları, barındırılan MCP sunucusu ve ajanslar için çoklu site panelleri sunan barındırılan sürüm.

## Geliştirme

```bash
npm test   # parsers, checks, each AI provider and the MCP server, end to end against the demo shop
```

Uçtan uca testler sahte model istemcileri kullanır, bu yüzden API anahtarı olmadan çalışır.

## Barındırılan sürüm

Barındırılan testler, zamanlama ve ajans panelleri için [analitikisler.com](https://analitikisler.com/tr/) adresine bakın.

## Lisans

MIT © Analitik İşler
