[English](README.md) | Türkçe

# AI Tag Debugger

**Web sitenizin analitik ve reklam takibini test eden, açık kaynaklı bir yapay zekâ ajanı.**

Bir yapay zekâ modeli gerçek bir tarayıcıyı, sitenizdeki temel yolculukları (ürün → sepet → ödeme, form gönderimleri) gerçek bir ziyaretçi gibi gezdirir. Gezerken `ai-tag-debugger` her takip isteğini (GA4, Google Ads, Meta Pixel, TikTok ve bir düzine kadar başka platform) ve her dataLayer gönderimini kaydeder. Ardından bunları ölçümleme planınız ve Consent Mode kurulumunuzla karşılaştırır ve neyin bozulduğunu ve nasıl düzeltileceğini sade bir dille, Türkçe ya da İngilizce olarak yazılmış bir raporla anlatır.

İki şekilde kullanabilirsiniz:

- **Terminalinizden ya da CI'nizden**, kendi API anahtarınızla: Anthropic (Claude), OpenAI, Google Gemini veya OpenAI uyumlu herhangi bir API (Kimi, GLM, DeepSeek, OpenRouter, yerel bir Ollama ve daha fazlası).
- **Yapay zekâ sohbet uygulamanızdan** (Claude, ChatGPT, Gemini ve MCP destekleyen diğer uygulamalar). Denetimi uygulamanın kendi modeli yürütür, bu yüzden ayrı bir API anahtarına ihtiyacınız yoktur.

[Analitik İşler](https://analitikisler.com) tarafından geliştirilmiştir. MIT lisanslıdır.

```
▶ ödeme (mobil)
  Çerezleri kabul et
  İlk ürünü aç
  Sepete ekle
  Sepeti aç
  Ödemeye geç
  …
  Siparişi ver
  ✓ Tüm adımlar tamamlandı. · 20 takip isteği yakalandı

2 hatalı · 1 risk · 1 uyarı · 4 uygun
Rapor: reports/demo/localhost/runs/2026-10-16_0800/report.html
```

## Neden

Takip kodları sessizce bozulur. Bir yeniden tasarımda bir düğmenin adı değişir, yeni bir şablon bir alanı unutur, bir çerez onayı güncellemesi piksellerin çok erken çalışmasına yol açar. Kimse uyarı almaz. Bunu haftalar sonra öğrenirsiniz, reklam platformları da o zamana kadar hatalı dönüşümlere göre optimizasyon yapmış olur.

Manuel etiket kontrolü bunu yakalar, ama zahmetlidir; bu yüzden her sürümden sonra nadiren yapılır. `ai-tag-debugger` bunu CI'nizde çalıştırabileceğiniz bir komuta dönüştürür.

## Neleri kontrol eder

| Kontrol | Örnek bulgu |
|---|---|
| Eksik event'ler | Ödeme yolculuğunda hiç `purchase` gönderilmemiş |
| Eksik parametreler | Mobilde `value` ve `currency` olmadan gönderilen `purchase` |
| Geçersiz satın alma değeri | `value` değeri `0`, negatif bir sayı ya da `"ücretsiz"` gibi bir metin olan `purchase` |
| Geçersiz satın alma para birimi | Para birimi `TRY` yerine `TL` ya da `USD` yerine `usd` olan `purchase` (3 harfli ISO kodu olmalı) |
| Boş satın alma ürünleri | `items` listesi boş gönderilen `purchase` |
| Satın alma uyuşmazlığı | Aynı sipariş numarası için GA4'ün 120, Meta'nın 115 gönderdiği durum |
| Tekrarlar | Tek bir tıklamayla iki kez gönderilen `add_to_cart` |
| Çerez onayı | Ziyaretçi çerezleri kabul etmeden fire olan Meta `PageView`, eksik ya da çok geç ayarlanmış Consent Mode varsayılanı, eksik Consent Mode v2 sinyalleri (`ad_user_data`, `ad_personalization`), onaydan önce ayarlanan takip çerezleri, `decline_cookies` yolculuğu reddettikten sonra hâlâ aktif olan etiket ya da çerezler, hiçbir şey yapmayan bir reddetme düğmesi |
| Kişisel veri | Bir reklam platformuna düz metin olarak gönderilen e-posta adresi |
| Planda olmayan event'ler | Ölçümleme planınızda bulunmayan, yine de fire olan event'ler |
| Plan kapsamı | Planlanan her event'in uygulandı, eksik, parametresi eksik, değeri hatalı ya da kontrol edilmedi olarak sınıflandırılması (bkz. [Plan ve site](#plan-ve-site)) |
| Kampanya parametreleri | Açılış adresindeki `utm_campaign` ya da `gclid`'in bir yönlendirmede düşmesi, ya da isteklerin bildirdiği sayfa adresinde eksik olması. Ziyaret doğrudan trafiğe yazılır |
| Sunucu tarafı takip | Aynı event kimliğinin iki farklı event'te kullanılması, ya da Meta event kimliğinin sunucu konteynerinin Conversions API olayına dönüştürdüğü GA4 isteğindeki `event_id` ile eşleşmemesi |

Platformlar: GA4 (sitenin kendi alan adındaki sunucu tarafı GTM uç noktaları ve Google etiket geçidi yolları dahil; bir sunucu konteynerine giden istekler sunucu tarafı olarak işaretlenir, Stape ve Elevar istekleri tanınır), Google Ads dönüşümleri, Meta Pixel, TikTok Pixel, temel X Pixel event'leri, LinkedIn Insight Tag, Microsoft Advertising UET, Criteo OneTag ile Pinterest, Snapchat ve Klaviyo event'leri. Adobe Analytics, Matomo ve Piwik PRO event'leri de okunur (sayfa görüntülemeleri, bağlantılar, hedefler, site içi arama ve e-ticaret siparişleri); Microsoft Clarity ve Hotjar etiket yüklemeleri ise proje ya da site kimliğini gösterir.

GA4 istekleri başka bir ana makinedeki bir sunucu konteynerine gidiyorsa ya da yükleyicisi oradan sunuluyorsa, rapor bir bilgi bulgusu ekler: konteynerin ad platformlarına ilettiği event'ler tarayıcıdan geçmez, bu yüzden burada görülemez.

`gtm_container` dışa aktarımı verildiğinde, her hatalı event onu gönderen GTM etiketini ve tetiklendiği tetikleyiciyi adlandırır (ya da hiçbir etiketin göndermediğini söyler). Her etiket ardından tetikleyicisinin o yolculukta tetiklenip tetiklenmediğini, tetiklenmediyse nedenini söyler: etiket duraklatılmış, hiçbir dataLayer gönderimi tetikleyicinin event'ini taşımamış, bir tetikleyici koşulu sağlanmamış (gönderimdeki değerle birlikte; değer, GTM'in Data Layer Variable'larının okuduğu gibi birikimli dataLayer'dan okunur), bir istisna tetikleyicisi engellemiş ya da event tetiklendiğinde etiketin gerektirdiği onay reddedilmiş. Her şey tetiklendiği hâlde istek yine de hatalıysa bunu söyler ve etiketin kendi kurulumunu işaret eder. Tıklama, form, görünürlük ve zamanlayıcı tetikleyicilerini GTM sayfada değerlendirdiği için, bunlar `gtm.click` türü event'leri dataLayer'a ulaşmadıkça değerlendirilemez olarak raporlanır. Bunların tümü yakalanan dataLayer'dan, yapay zekâ modeli olmadan değerlendirilir.

### Kontrol edilecek platformları seçin

Varsayılan olarak bir denetim GA4, Google Ads, Meta ve TikTok'u kontrol eder; ayrıca sitenin kullandığı başka her platformu, ilk isteğinden itibaren kontrol eder. Bunun için bir ayar gerekmez. Platform seçmek bu otomatik algılamayı kapatır. Sabit bir liste için `--platforms ga4,meta,x` kullanın, ayar dosyasında `"providers"` ya da MCP `start_audit` ve `run_audit` araçlarında `providers` verin. Seçenekler: `ga4`, `google_ads`, `meta`, `tiktok`, `x`, `linkedin`, `microsoft_ads`, `pinterest`, `snapchat`, `criteo`, `klaviyo`, `adobe`, `matomo`, `piwik_pro`, `clarity`, `hotjar`, `doubleclick` ve `adsense`. GA4, Google Ads, Meta, TikTok, X, LinkedIn, Microsoft Ads, Pinterest, Snapchat, Criteo, Klaviyo, Adobe Analytics, Matomo ve Piwik PRO için event'ler ayrıştırılır. Clarity ve Hotjar etiket yüklemelerini gösterir; diğerlerinin ağ istekleri gösterilir. `--providers` eski adı olarak bir minör sürüm daha çalışır ve bir not yazdırır.

Seçmediğiniz platformlara giden istekler de yerelde yanıtlanır, yani o hesaplara da ulaşmaz. Bu istekler zaman akışına, CSV'ye ve kontrollere alınmaz, sadece sayılır: rapor bunları istek sayılarıyla listeler (örneğin "Kapsam dışı 61 istek atlandı: Microsoft Clarity, DoubleClick") ve her adım kaç istek atladığını gösterir. `--platforms` vermezseniz, ölçümleme planınızda geçen ya da sitenin gönderdiği her platform varsayılan listeye eklenir. Dışarıda bıraktığınız platformlar için planlanmış event'ler eksik olarak raporlanmaz, tek bir bilgi bulgusunda listelenir. Etiket yöneticisi ve çerez onayı platformu istekleri her zaman gösterilir.

### Onay senaryoları

Her denetim ayrıca başlangıç sayfasını her çerez onay seçimi için bir kez açar; her seçim yeni bir tarayıcıda yapılır: tümünü kabul, tümünü reddet ve yalnızca analitik. Seçim, consent platformunun kendi API'siyle (OneTrust, Cookiebot, Usercentrics ya da Didomi) yapılır; API yoksa bannerın düğmelerine tıklanır. Rapor, her seçimden sonra her etiketin kaç istek gönderdiğini gösterir. Yalnızca analitik seçeneği OneTrust ve Cookiebot ile çalışır; diğer platformlarda o sütun "Burada desteklenmiyor" yazar. Tümünü reddet'ten sonra gönderilen bir etiket işaretlenir; Consent Mode'un çerezsiz ping'leri hariç. Yalnızca analitik'ten sonra gönderilen bir reklam etiketi, reklam depolaması reddedilmiş olarak gönderilmediği sürece işaretlenir. Tablo **Yolculuklar** sekmesinin en üstünde ve `report.md` içinde bulgulardan önce yer alır. Başlangıç sayfasında aracın yanıtlayabileceği bir banner yoksa ya da kayıtlı bir site tekrar oynatılıyorsa atlanır. Yapay zekâ modeli çağrılmaz, ama başlangıç sayfası üç kez daha ziyaret edilir. Kapatmak için ayar dosyasına `"consent_scenarios": false` yazın.

## Nasıl çalışır

1. **Gezinme:** Yapay zekâ modeli, sade bir dille yazılmış bir hedef ("sepete herhangi bir ürün ekle ve test ödeme yöntemiyle siparişi tamamla") ve sayfanın metin görünümünü alır. İki araçla çalışır: `browser_action` (goto, click, fill, select, scroll, wait) ve `finish`. Playwright ile her seferinde bir adım atar.
2. **Yakalama:** Bir takip uç noktasına giden her istek normalleştirilmiş isteklere ayrıştırılır ve isteği tetikleyen adımla etiketlenir. Her dataLayer gönderimi, bir başlatma betiği aracılığıyla kaydedilir; `gtag('consent', ...)` komutları da buna dahildir. Varsayılan olarak aracın ayrıştırabildiği her platformun (GA4, Google Ads, Meta, TikTok, X, LinkedIn, Microsoft Ads, Pinterest, Snapchat, Criteo, Klaviyo, Adobe Analytics, Matomo ve Piwik PRO) toplama istekleri ile Google'ın dönüşüm, yeniden pazarlama ve onay ping'leri yerelde yanıtlanır, bu yüzden **test trafiği bu gerçek hesaplara ulaşmaz**. Aracın yalnızca ana makinesinden tanıdığı satıcıların (Clarity ve Hotjar gibi) etiket yüklemeleri ve istekleri dışarı gitmeye devam eder; zaman akışının ağ bölümü her çağrıyı ve yerelde yanıtlanıp yanıtlanmadığını gösterir.
3. **Kontrol:** Deterministik kurallar, yakalanan istekleri ölçümleme planınızla karşılaştırır. Bu bölüm yapay zekâ çağrısı gerektirmez, bu yüzden sonuçlar tekrarlanabilirdir.
4. **Açıklama:** Model bulguları, adım başına istekleri ve (isteğe bağlı olarak) GTM konteyner dışa aktarımınızı okur. Her sorun için olası nedeni ve düzeltmeyi yazar, ilgili etiket ve tetikleyicileri adlandırarak.

## Yapay zekâ sağlayıcıları

Kendi API anahtarınızı getirirsiniz. `ai-tag-debugger` her sağlayıcının resmî SDK'sını kullanır:

| Sağlayıcı | API anahtarı değişkeni | Varsayılan model |
|---|---|---|
| Anthropic (Claude) | `ANTHROPIC_API_KEY` | `claude-opus-5-5` |
| OpenAI | `OPENAI_API_KEY` | `gpt-5.5` |
| Google Gemini | `GEMINI_API_KEY` | `gemini-pro-latest` |
| Cloudflare Workers AI | `CLOUDFLARE_API_TOKEN` ve `CLOUDFLARE_ACCOUNT_ID` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` |

`--provider` verilmezse bulunan ilk ayar belirler, şu sırayla: `OPENAI_COMPATIBLE_BASE_URL`, Vercel AI Gateway (`AI_GATEWAY_API_KEY`), Cloudflare Workers AI, Anthropic, OpenAI, Gemini. `--provider anthropic|openai|gemini|vercel|cloudflare` ya da ayar dosyasındaki `"provider"` ile açıkça seçebilirsiniz; başka bir model için `--model` kullanın. `--model cheap`, rutin CI çalıştırmaları için her sağlayıcının küçük ve ucuz modelini seçer: `claude-haiku-5-5`, `gpt-5.5-mini`, `gemini-flash-latest` ya da Vercel'de `anthropic/claude-haiku-5.5`. Cloudflare'da bu listede tek bir model var, bu yüzden orada `cheap` ile varsayılan aynıdır. Gezinme, çalışmaları ucuz tutmak için düşük akıl yürütme çabası ister; açıklamalar yüksek çaba ve yapılandırılmış JSON çıktısı ister.

### OpenAI uyumlu herhangi bir API: Kimi, GLM, DeepSeek, OpenRouter, Ollama ve daha fazlası

Birçok sağlayıcı OpenAI'ınkine benzer çalışan bir API sunar. `ai-tag-debugger`'ı adresi ve bir model kimliğiyle ona yönlendirin:

```bash
export OPENAI_COMPATIBLE_API_KEY=...        # yerel bir Ollama için boş bırakın
ai-tag-debugger run --site https://yourshop.com --journey add_to_cart \
  --provider openai-compatible --base-url <API adresi> --model <model kimliği>
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

Model kimliğini sağlayıcınızın dokümantasyonundan alın. Bayrakların yerine `OPENAI_COMPATIBLE_BASE_URL` ve `OPENAI_COMPATIBLE_MODEL` değişkenlerini ya da ayar dosyasında `"provider"`, `"base_url"` ve `"model"` alanlarını da kullanabilirsiniz. API katı JSON şemalarını döndüremezse açıklamalar düz JSON moduna geçer.

### Vercel AI Gateway

Tek anahtarla birçok model. Vercel panelinizden `AI_GATEWAY_API_KEY` alın ve modeli `<sağlayıcı>/<model>` olarak seçin:

```bash
export AI_GATEWAY_API_KEY=...
aitd run --site https://yourshop.com --journey purchase --model google/gemini-3.6-flash
```

`--model` verilmezse `anthropic/claude-opus-5.5` kullanılır. Kullanım ve maliyet Vercel'in AI Gateway panelinde görünür ve Vercel tarafından faturalandırılır. Hangi yapay zekânın kullanılacağını görmek için `aitd` çalıştırın: son satır örneğin `AI: vercel (anthropic/claude-opus-5.5) · also set: anthropic (pick with --provider)` der.

### Cloudflare AI Gateway

Her AI çağrısının kayıtlarını, maliyetini ve limitlerini görmek için çağrıları [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/) üzerinden gönderin. Sağlayıcı anahtarınız aynı kalır:

```bash
export AI_GATEWAY_URL=https://gateway.ai.cloudflare.com/v1/<hesap kimliği>/default
export AI_GATEWAY_TOKEN=...   # yalnızca gateway'de kimlik doğrulama açıksa
```

`anthropic`, `openai` ve `gemini` ile çalışır. Her çalıştırmanın canlı sitenizi görmesi için gateway'de önbelleği kapalı bırakın. Cloudflare'ın kendi modelleri için bkz. [Cloudflare Workers AI](#cloudflare-workers-ai).

**Model seçimi hakkında bir not.** Yapay zekâ, 5 ila 30 adım boyunca araç çağırarak, her seferinde bir adım gezinir. Modeller bunu ne kadar güvenilir yaptıklarında büyük farklılık gösterir: daha küçük ve yerel modeller yanlış yere tıklayabilir, döngüye girebilir ya da erken durabilir. Kontroller model ne yaparsa yapsın doğrudur, çünkü yakalanan isteklerden gelirler; ama bitmeyen bir yolculuk, sonraki event'lerini gösteremez. Bir model zorlanıyorsa daha büyük bir model, kısa hedefli hazır bir yolculuk ya da `--max-steps` deneyin. Anthropic, OpenAI ve Gemini varsayılanları test edilmiş olanlardır.

### Cloudflare Workers AI

Cloudflare'ın ağında açık modeller; kullanım başına Cloudflare tarafından faturalandırılır. Workers AI yetkisi olan bir API token oluşturun ve hesap kimliğinizi Cloudflare panelinde bulun:

```bash
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
aitd run --site https://yourshop.com --journey purchase
```

`--model` verilmezse `@cf/meta/llama-3.3-70b-instruct-fp8-fast` kullanılır. İki değişken de ayarlıysa Cloudflare, Anthropic, OpenAI ve Gemini'den önce seçilir; bunlardan birini kullanmak için `--provider` verin.

Yerel bir sağlayıcı eklemek için [`src/providers.js`](src/providers.js) içinde iki fonksiyon yazmanız gerekir: araç çağıran bir konuşma ve yapılandırılmış bir JSON çağrısı.

## Hızlı başlangıç

Node 20+ gerekir.

```bash
npm install -g @analitikisler/ai-tag-debugger
npx -y playwright@1.56.1 install chromium   # bu sürümün kullandığı tarayıcı sürümü
export ANTHROPIC_API_KEY=...                # ya da OPENAI_API_KEY, ya da GEMINI_API_KEY

ai-tag-debugger run --site https://staging.yourshop.com --journey add_to_cart --headed
```

Genel kurulum, kısa bir takma ad olan `aitd`'yi de ekler: `aitd run --site … --journey add_to_cart` aynı işi yapar.

Ya da kurmadan çalıştırın: `npx -y @analitikisler/ai-tag-debugger run --site … --journey add_to_cart`.

Komutları görmek için `aitd --help`, her komutun seçenekleri için `aitd run --help` (ya da `plan`, `replay`, `mcp`) çalıştırın. Bir şey çalışmıyorsa `aitd doctor`, Node'u, Chromium'u, yapay zekâ anahtarınızı ve veri klasörünü denetler ve neyin düzeltileceğini söyler.

### Demo mağazayı deneyin (kaynak koddan)

Depo, üç bilerek yapılmış takip hatası içeren bir demo mağaza içerir:

```bash
git clone https://github.com/analitikisler/ai-tag-debugger.git
cd ai-tag-debugger
npm install
npx playwright install chromium   # sürümü yükselttikten sonra yeniden çalıştırın, tarayıcı Playwright ile eşleşsin
npm run demo:serve                # bir terminalde: http://localhost:4321
node src/cli.js run --config examples/demo.config.json --data-dir reports/demo
open reports/demo/localhost/runs/*/report.html
```

Henüz bir API anahtarınız yok mu? Sabit adımları hiçbir yapay zekâ modeli olmadan yeniden oynatın:

```bash
node src/cli.js run --config examples/demo.config.json --scripted --no-ai --data-dir reports/demo
```

## Sadece sorun

Önce tüm seçenekleri öğrenmeniz gerekmez. Tırnak içinde düz bir cümle yazın; aitd bunu eşleşen komuta çevirir, komutu gösterir ve çalıştırmadan önce `Run this? (Y/n)` diye sorar:

```bash
aitd "check my google analytics tags"
# aitd run --platforms ga4
# Run this? (Y/n)
```

| Yazdığınız | aitd çalıştırır |
|---|---|
| `"Check my google analytics tags"` | `aitd run --platforms ga4` |
| `"What changed on my site since the last run"` | `aitd run` (her çalıştırma neyin değiştiğini zaten raporlar) |
| `"Compare my site against the plan"` | `aitd run --against latest` |
| `"What custom events does my site need"` | `aitd plan --topic custom-events` |
| `"Is my Meta pixel firing on checkout?"` | `aitd run --platforms meta --goal "reach checkout"` |
| `"Test signing up for the newsletter"` | `aitd run --goal "sign up for the newsletter"` |
| `"Does my purchase event send the right revenue?"` | `aitd run --journey purchase` |
| `"Make a tracking plan for example.com"` | `aitd plan --site https://example.com` |
| `"What ecommerce events should an online shop track?"` | `aitd plan --topic ecommerce` |
| `"Check TikTok and Google Ads on the contact form"` | `aitd run --platforms google_ads,tiktok --goal "submit the contact form"` |

Soruyu atlamak için `-y` ekleyin: `aitd -y "check my google analytics tags"`.

Bir cümlede bir şey eksikse aitd tahmin yürütmek yerine tek bir kısa soru sorar: plan mı çalıştırma mı, hangi site, ya da neyin test edileceği. Rapor filtreleme henüz cümleyle yapılamaz (`"Show me only the errors from the last report"` bunu söyler). Yapay zekâ anahtarı yoksa, yaygın ifadeleri küçük bir anahtar sözcük eşleştirici karşılar. Anahtar varsa yapay zekâ her ifadeyi anlar, ama yalnızca var olan seçenekleri seçebilir; bu yüzden var olmayan bir bayrak uydurmaz. Örnek cümleler İngilizcedir, çünkü anahtar sözcük eşleştirici İngilizce ifadeleri tanır.

## Planla, sonra denetle

Bir çalıştırma, sitenin gönderdiklerini bir **plan** ile karşılaştırır: beklediğiniz event'ler, parametreler ve kullanıcı özellikleri. Üç adım:

```bash
# 1. Bir plan taslağı çıkarın. Yapay zekâ siteyi gezer ve neyin takip edilmesi gerektiğini önerir.
aitd plan --site https://yoursite.com

# 2. İsteğe bağlı: bir elektronik tabloda düzenleyin, sonra düzenlenmiş kopyayı yeni bir plan olarak kaydedin.
aitd plan export latest --site https://yoursite.com     # planın yanına plan.xlsx yazar
aitd plan import plan.xlsx --site https://yoursite.com  # yeni bir plan kaydeder; eskisi değişmez

# 3. Siteyi plana göre denetleyin.
aitd run --site https://yoursite.com --against latest
```

**Plan taslağı çıkarmak** takip kodu gerektirmez. Yapay zekâ her sayfa türünden birer sayfayı inceler: ana sayfa, bir kategori, bir ürün, sepet, ilk ödeme adımı, arama ve varsa üyelik ya da iletişim formları. Asla ödeme yapmaz ve kişisel bilgilerle bir formu göndermez. `--provider`, `--model` ve `--max-steps` (varsayılan 25, yapay zekâ için en fazla adım) `run` için olduğu gibi çalışır. Çıktı "Bulunan sayfa türleri" ve "Bu sitede yok" satırlarını yazdırır, böylece yapay zekânın hangi sayfa türlerine ulaştığını görürsünüz. Yalnızca 2 sayfası olan küçük bir site de sorun değildir.

Yalnızca bir tür event için plan çıkarmak istiyorsanız `--topic` ekleyin: `custom-events`, `ecommerce`, `forms` ya da `consent`. Plan yalnızca bu event'leri kapsar, plan biçimi değişmez:

```bash
aitd plan --site https://yoursite.com --topic ecommerce
```

Plan, yeni bir klasöre, `aitd/<alan adı>/plans/<id>/` içine `measurement-plan.json` ve okunabilir bir `plan.html` olarak kaydedilir. Her event için şunları listeler:

- `name` ve `platform`. Sitenize özgü event'ler, örneğin bir beden rehberi ya da mağaza bulucu, `custom: true` ile işaretlenir.
- `description` ve `trigger`: event'i tetikleyen sayfa türü ve öğenin görünen etiketi.
- `parameters`: her biri bir açıklama ve örnek değerle. Özel parametreler işaretlenir. `required_params` mutlaka bulunması gerekenleri listeler.
- `user_properties`: `customer_type` gibi önerilen özellikler, her biri bir açıklama ve örnekle.

Siteniz zaten gönderdiği event'ler `"seen": true` ile işaretlenir.

Kullanmadan önce planı gözden geçirin. Örnekler ve öneriler yapay zekânın gördüğü sayfalardan gelir, bu yüzden her event'in işinize uyduğunu kontrol edin. Ek alanları kontroller yok sayar.

**Elektronik tablo ile içe ve dışa aktarma.** `aitd plan export <plan> --site <url>`, planın yanına `plan.xlsx` yazar: `events` sekmesinde her event parametresi için bir satır (`event, platform, parameter, required, example, trigger, description`) ve `user_properties` sekmesinde her kullanıcı özelliği için bir satır. Bunun yerine `events.csv` ve `user_properties.csv` almak için `--format csv` ekleyin; CSV ek bir paket gerektirmez. `.xlsx`, araçla birlikte isteğe bağlı bir bağımlılık olarak gelen küçük bir kütüphane, `fflate` kullanır. `aitd plan import <dosya> --site <url>` elektronik tabloyu okuyup yeni bir plan klasörü olarak kaydeder. Google E-Tablolar'dan indirirken Dosya > İndir > Microsoft Excel (.xlsx) seçin ya da her sekmeyi CSV olarak indirin: `Shop plan - events.csv` dosyası, yanındaki `Shop plan - user_properties.csv` ile birlikte okunur ve onay kutuları evet/hayır olarak tanınır. İçe aktarma mevcut bir planı asla düzenlemez. Tanınmayan sütunlar bir uyarıyla yok sayılır; bir hata, sekmeyi, satırı ve düzeltmeyi belirtir, örneğin `events, row 7: "required" must be yes or no (found "maybe").`

`measurement-plan.json` şöyle görünür:

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

`platform` değeri `ga4`, `google_ads`, `meta` veya `tiktok` olur. `journeys`, bir event'in nerede beklendiğini sınırlar (varsayılan: her yolculuk). Bir eylem başına birden fazla kez fire olabilen event'ler için `allow_multiple: true` ayarlayın.

Event adları gevşek eşleştirilir: `dl_add_to_cart` (Elevar), `addToCart` ve `Add To Cart`, `add_to_cart` sayılır; `transaction` ya da `order_completed` ise `purchase` sayılır. Kendi adlarınızı planlanmış bir event'e `"aliases": ["my_event"]` ile ekleyebilirsiniz. Gerekli parametreler de olağan diğer adlarıyla bulunur: `items` için `products`, `value` için `revenue`, `transaction_id` için `order_id`.

**Bir plana karşı denetim.** `run --against <plan>`, `latest` (ya da `last`), `first`, bir plan kimliği ya da bir plan dosyasının ya da klasörünün yolunu alır. `--site` verilmezse site plandan alınır. Çalıştırmaya bir yolculuk da verirseniz, yalnızca o akışı gezer ve orada beklenen plan event'lerini kontrol eder; planın geri kalanı eksik değil, kontrol edilmedi olarak raporlanır. Tek başına kullanıldığında `--against`, plandan en fazla altı yolculuk türetir: planlanmış event'leri tetiklendikleri sayfaya göre gruplar ve sayfa başına bir yolculuk oluşturur, en fazla altı tane (en küçük gruplar son yolculuğu paylaşır); ek bir yapay zekâ çağrısı yapılmaz. Seçilen yolculuklar, tarayıcı açılmadan önce yazdırılır. Her rapor başlığı ardından `Checked against plan <id>` (Plana karşı kontrol edildi: <id>) yazar.

`run` bir şey test etmek ister: `--against`, `--journey`, `--goal` ya da ayar dosyanızdaki yolculuklar. Biri yoksa tarayıcıyı açmadan `Nothing to test. Add --against latest, --journey <id> or --goal "<text>".` mesajıyla durur; böylece dolaşıp API kullanımını harcamaz. Sitenin henüz planı yoksa `run --against` şunu söyler: `No plan yet for example.com. Draft one with: aitd plan --site https://example.com`.

`aitd plan list --site <url>`, sitenin plan kimliklerini en eskiden en yeniye listeler.

**Planı ilk çalıştırmadan öğrenin.** Sitenin kayıtlı bir planı yokken, `--against` ya da `--out` olmadan yapılan bir çalıştırma, sitenin zaten gönderdiği event'leri listeler ve bunları sitenin planı olarak kaydedip kaydetmeyeceğinizi sorar:

```
No plan yet for this site. It already sends 3 events: ga4:page_view, ga4:purchase, meta:PageView
Save them as the site's plan? (Y/n)
```

Evet derseniz sonraki çalıştırmalar `--against latest` ile bu plana karşı kontrol yapabilir. Bir event'in her isteğinde bulunan bir parametre, o event'in zorunlu parametrelerinden biri olur. Hiçbir değer kopyalanmaz, bu yüzden bir ziyaretçinin yazdıkları plana girmez. Bir betikte ya da CI işinde `--yes` eklemedikçe hiçbir şey kaydedilmez; çalıştırma bunun yerine daha ayrıntılı bir plan taslağı için `aitd plan --site` komutunu yazdırır.

### Plan ve site

Bir çalıştırma `--against` kullandığında raporda bir **Plan ve site** bölümü bulunur: `report.md` dosyasının başında ve `report.html` içinde Kapsam bölümünde. Planlanan her event bir kovaya düşer:

| Kova | Anlamı |
|---|---|
| Uygulanmış | Planlandı, fire oldu, gerekli parametrelerin tümü var, değer sorunu yok |
| Eksik | Çalıştırmanın gezdiği bir yolculuk için planlandı, ama hiç fire olmadı |
| Parametre eksik | Fire oldu, ama gerekli bir parametre yok |
| Hatalı değer | Fire oldu, değer sorunu var; satın alma değeri, para birimi ve ürün kontrollerinin aynısından |
| Planda yok | Fire oldu, ama planda değil |
| Kontrol edilmedi | Planlandı, ama yolculuğu ya da platformu bu çalıştırmanın parçası değildi |

Kapsam puanı, uygulanmış olanların kontrol edilebilir planlanmış event'lere (kontrol edilmedi hariç hepsi) bölünmesiyle bulunur; genel ve platform başına gösterilir, örneğin `Kapsam 11 olaydan 7 (%64), 2 olay kontrol edilmedi`. Aynı kayıtlar `plan-check.json` dosyasında da bulunur: planlanan her event için kovasıyla birlikte bir kayıt. Çıkış kodları değişmez: `--fail-on` yine bulgu önemine bakar. `--against` olmadan rapor tam olarak eskisi gibidir.

Kontrol edilen plan sitenin ilk planı değilse, rapor başlığı onu bir önceki kayıtlı sürümle karşılaştırır: `Plan 2026-10-01_0900 sürümünden bu yana değişti: 1 eklendi, 0 çıkarıldı, 2 değişti` ya da `Plan 2026-10-01_0900 sürümünden bu yana değişmedi`. Başlık her değişikliği `report.html` ve `report.md` içinde listeler: eklenen event için `+`, çıkarılan için `−`, değişen için `~`, ardından neyin değiştiği (zorunlu parametreler, parametreler ya da yolculuklar). İlk sürümün karşılaştırılacak bir şeyi yoktur; `capture.json` aynı karşılaştırmayı `planChanges` altında da saklar.

### Etiket envanteri

Her raporda ayrıca bir **etiket envanteri** bulunur: sitenin istek gönderdiği her sağlayıcı; istekleri sitenin kendi alan adına gittiyse birinci taraf, sağlayıcıya gittiyse üçüncü taraf, ikisine de gittiyse ikisi olarak işaretlenir. Sağlayıcının görüldüğü sayfa sayısını ve ona bağlı çerezleri gösterir. Hiçbir sağlayıcıya ait olmayan çerezler ayrıca birinci ya da üçüncü taraf olarak listelenir. Yalnızca çerez adları kaydedilir, değerleri asla. Envanter `report.html` içindeki **Envanter** bölümünde, `report.md` içinde ise bir tablo olarak yer alır.

### Klasör yapısı ve plan kimlikleri

Planlar ve çalıştırmalar, aracı çalıştırdığınız klasördeki `aitd/` içinde tutulur:

```
aitd/
  example.com/                      sitenin ana makinesi, www. olmadan
    plans/2026-10-16_0900/          measurement-plan.json, plan.html, plan.xlsx (dışa aktarımdan sonra)
    runs/2026-10-16_0912/           report.html, report.md, timeline.csv, capture.json, steps.json,
                                    junit.xml, summary.json ve plan-check.json (--against ile)
    history.json                    kayıtlı her çalıştırmanın küçük bir özeti, eğilim için (aşağıya bakın)
```

Bir kimlik, yerel saat `YYYY-MM-DD_HHMM` biçimindedir. O dakika zaten alınmışsa saniye eklenir (`_HHMMSS`). Hiçbir şey değiştirilmez: her taslak, içe aktarma ve çalıştırma yeni bir klasör alır. `aitd/` klasörünü başka bir yerde tutmak için `--data-dir <dir>` kullanın. `replay` ve `--save-site` klasörleri etkilenmez.

Her raporda, çalıştırmayı sitenin `runs/` içindeki bir önceki çalıştırmasıyla karşılaştıran bir "Son çalıştırmadan bu yana değişenler" bölümü bulunur, örneğin `2 olay düzeldi, 1 yeni sorun`, ve her birini listeler: neyin düzeldiği (önceki durumuyla birlikte), neyin yeni olduğu ve neyin hâlâ açık olduğu. İki çalıştırma da `--against` kullandıysa plan kapsamı karşılaştırılır (Eksik iken Uygulanmış olan bir olay düzelmiş sayılır); aksi halde sağlık bulguları karşılaştırılır. Bir sitenin ilk çalıştırmasında karşılaştırılacak bir şey olmadığı yazar. Ayarlanacak bir bayrak yoktur. Karşılaştırma `capture.json` içinde `changes` altında da kaydedilir.

### Çalıştırmalar arasında eğilim

İkinci kayıtlı çalıştırmadan itibaren araç, sitenin son 30 çalıştırmasına da birlikte bakar. Sayıların ardından CLI, sonuç satırını ve en fazla üç eğilim satırı yazdırır:

```
2 bozuk · 1 risk · 1 uyarı · 0 bilgi · 4 sorunsuz
Sonuç: Kaldı · purchase izlemesi bozuk (mobile) · puan 25/100
5 çalıştırmada eğilim (2026-10-01 → 2026-10-07): iyileşiyor. Şimdi 0 bozuk · 1 risk · 2 uyarı; 3 çalıştırma önce 2 bozuk · 1 risk · 0 uyarı.
En uzun süredir açık: Meta PageView before_consent 4 yerde 2026-10-01 tarihinden beri (5 çalıştırma); GA4 add_to_cart duplicate 4 yerde 2026-10-03 tarihinden beri (3 çalıştırma).
Her seferinde tamamlanmayan yolculuklar: checkout (mobile) 80%.
```

Aynı satırlar, çalıştırmaların metin biçimindeki bir mini grafiğiyle (sparkline; çalıştırma başına bir karakter, yolculuklarının tümü tamamlanmayan çalıştırma için `·`) `report.md` ve `report.html` içindeki **Eğilim** bölümünü oluşturur. Bir sorun, yolculuğunu tamamlayan son çalıştırma onu hâlâ gösteriyorsa *açık* sayılır; yolculuğu erken duran bir çalıştırma hiçbir şey kanıtlamaz, bu yüzden ne bir şeyi düzeltir ne de geri getirir. *Gelip giden* sorunlar (görüldü, kayboldu, yine görüldü) ayrıca adlandırılır, çünkü bunlar genellikle bir düzeltmeye değil, zamanlamaya ya da yapay zekânın seçtiği ürüne bağlıdır. Yön, tamamlanan son birkaç çalıştırmayı öncekilerle karşılaştırır.

`aitd history --site <url>` eğilimi tek başına yazdırır: her çalıştırma için sayıları ve puanıyla (`3·broken + 2·risk + warning`, düşük olan iyidir) bir satır, mini grafik ve yukarıdaki satırlar. `--limit <n>` yalnızca en yeni `n` çalıştırmayı okur (varsayılan 30), `--lang tr` satırları Türkçeye çevirir ve `--json`, betikler için eğilim serisini, bulgu başına zaman çizelgesini (ilk görülme, son görülme, ne zamandan beri açık, hangi çalıştırmada düzeldi, gelip gidiyor mu) ve yolculuk tamamlanma oranlarını yazdırır.

Özetler `aitd/<alan adı>/history.json` dosyasında durur, çalıştırma başına yaklaşık 2 KB; kayıtlı her çalıştırma `capture.json` dosyasını yazdıktan sonra bu dosyayı günceller. Dosya bir önbellektir: içinde olmayan bir çalıştırma klasörü `capture.json` dosyasından okunur, silinen bir klasör sonraki güncellemede listeden düşer ve dosyayı silmek her zaman güvenlidir. `--out` ile gönderilen çalıştırmalar ve tekrar oynatmalar geçmişin parçası değildir.

## Ne test edileceğini seçin

Başlamak için bir ayar dosyasına ihtiyacınız yok. Hazır yolculukları seçin, kendi yolculuğunuzu sade bir dille tarif edin, bir plana karşı kontrol edin ve kontrolü yalnızca ilgilendiğiniz event'lerle sınırlayın:

```bash
# Siteyi en son kaydedilmiş planına karşı kontrol edin.
aitd run --site https://staging.yourshop.com --against latest

# Hazır yolculuklar, hedefleri ve beklenen GA4 ve Meta event'leriyle gelir.
ai-tag-debugger run --site https://staging.yourshop.com --journey purchase --journey sign_up

# Bir yolculuğu kendi sözlerinizle tarif edin. Adını verdiğiniz event'ler bu yolculukta beklenir.
ai-tag-debugger run --site https://yoursite.com --goal "Alt bilgideki bültene abone ol" --events newsletter_signup

# Yalnızca bazı event'leri kontrol edin.
ai-tag-debugger run --config ai-tag-debugger.config.json --events purchase,add_to_cart
```

| Hazır yolculuk | Yapay zekânın yaptığı | Beklediği event'ler |
|---|---|---|
| `purchase` (ya da `checkout`) | Ürün → sepet → ödeme → test ödeme yöntemiyle sipariş | GA4 `view_item`, `add_to_cart`, `begin_checkout`, `purchase`; Meta `AddToCart`, `InitiateCheckout`, `Purchase` |
| `add_to_cart` (ya da `cart`) | Bir ürün açar ve sepete ekler | GA4 `view_item`, `add_to_cart`; Meta `AddToCart` |
| `sign_up` (ya da `signup`, `register`) | Test verileriyle bir hesap oluşturur | GA4 `sign_up`; Meta `CompleteRegistration` |
| `lead` (ya da `contact`, `form`) | Bir iletişim, teklif ya da demo formunu doldurup gönderir | GA4 `generate_lead`; Meta `Lead` |
| `search` | Sitede arama yapar ve bir sonucu açar | GA4 `search` (`search_term` ile); Meta `Search` |

`--journey`, ayar dosyanızdaki yolculukları id'leriyle de seçer. Bir ayar dosyasıyla, hazır yolculuklar kendi event'lerini planınıza ekler.

Ne test edeceğinizden emin değil misiniz? `aitd plan --site https://yoursite.com` bir ölçümleme planı taslağı çıkarır, `--against latest` de siteyi buna göre kontrol eder.

### API kullanımını düşük tutmak

Gezinmenin her adımı bir model çağrısıdır; bu yüzden kullanım **yolculuk × görünüm × adım** ile artar, üstüne bulguları açıklamak için sonda bir çağrı eklenir. Kontroller modeli asla çağırmaz.

- **Yalnızca ihtiyacınız olan yolculukları çalıştırın.** En büyük tasarruf budur: tam `purchase` yolculuğu yerine `--journey add_to_cart`, on adım ya da daha fazla yerine birkaç adım alır.
- **Tek bir görünüm çalıştırın.** `--viewport mobile`, masaüstü ve mobil birlikte çalıştırmaya göre çağrı sayısını yarıya indirir.
- **Adım sayısını sınırlayın.** `--max-steps 15`, dolaşan bir yolculuğu durdurur.
- **Büyük sayfaların daha pahalı olmasını bekleyin.** Her adım, sayfa görünümünü (en fazla 250 öğe ve 3.000 karakter metin) modele gönderir; bu yüzden yoğun sayfalar basit sayfalardan adım başına daha fazla token kullanır.
- **Tekrar çalıştırmalar son yolu baştan kullanır.** Bir yolculuk sitede bir kez tamamlandıktan sonra, bir sonraki çalıştırma yapay zekâya o çalıştırmanın geçtiği sayfaları sırasıyla verir; böylece keşfetmek yerine doğrudan hedefe gider. Yalnızca aynı hedef için kullanılır, yalnızca 0.14.0 ve sonrasıyla kaydedilen çalıştırmalardan alınır ve yalnızca yapay zekâlı çalıştırmalarda kullanılır. `--out` ya da `replay` ile kullanılmaz. Site değiştiyse ve yol artık uymuyorsa yapay zekâ başka bir yol izler.
- **Raporu odaklı tutmak için `--events` kullanın.** Gezinmeyi kısaltmaz, bu yüzden kullanımı pek değiştirmez.
- **Yapay zekâsız tekrar oynatın.** Tamamlanan her çalıştırma attığı adımları çalıştırma klasörüne `steps.json` olarak kaydeder; `--scripted --no-ai`, kendi sabit adımları olmayan bir yolculuk için son tamamlanan çalıştırmanın adımlarını tekrarlar. Bir yolculuğu yapay zekâyla bir kez çalıştırın, sonra her dağıtımda tekrar oynatın. Bkz. [Adımları kaydedin ve yapay zekâ olmadan tekrar oynatın](#adımları-kaydedin-ve-yapay-zekâ-olmadan-tekrar-oynatın).
- **Bir sohbet uygulaması kullanın.** MCP üzerinden gezinmeyi sohbet uygulamasının kendi modeli yapar, bu yüzden hiç API anahtarı kullanılmaz.
- **Geçici hatalar bir çalıştırmaya mal olmaz.** Model API'sinden gelen bir hız sınırı, aşırı yük yanıtı ya da kopan bağlantı (429, 529, 5xx ve benzerleri) `retry-after` başlığına uyularak, artan bir bekleme süresiyle en fazla 3 kez yeniden denenir; ağın düşürdüğü ya da zaman aşımına uğrayan bir sayfa yüklemesi de 2 saniye sonra bir kez daha denenir. Hatalı bir anahtar ya da reddedilen bir sayfa gibi diğer hatalar hemen başarısız olur.

Çalışma süresi ayrı bir konudur: `--concurrency 3`, her biri kendi tarayıcısında olmak üzere aynı anda en fazla üç yolculuk çalıştırır; böylece birkaç yolculuk ve görünüm içeren bir çalıştırma çok daha erken biter. Aynı model çağrılarını yapar, yalnızca daha sık aralıklarla; bu yüzden sağlayıcı size hız sınırı uyguluyorsa `1` ya da `2` ile kalın.

### Yeni bir sürümü kayıtlı sitelere karşı kontrol edin

`--save-site <dir>`, sitenin gönderdiği her yanıtı ve atılan adımları da kaydeder. `replay` daha sonra aynı sayfaları çevrimdışı, ağ bağlantısı ve yapay zekâ modeli olmadan yeniden denetler; bu yüzden maliyeti sıfırdır. Kayıtlı çalıştırmaya göre yeni ya da kalkmış bulguları listeler:

```bash
npx @analitikisler/ai-tag-debugger run --site https://www.yourshop.com --journey purchase --save-site saved/yourshop
npx @analitikisler/ai-tag-debugger replay saved/*
✗ https://www.yourshop.com (saved/yourshop): 0 yeni, 1 kalktı
    - warning duplicate purchase desktop ga4 page_view
```

İlk çalıştırmanın bulguları beklenen bulgular olur. Bir değişiklik doğruysa, örneğin düzeltilmiş bir yanlış alarm ise, `replay --update` yeni bulguları beklenen bulgular yapar. Aracın yeni bir sürümünü bildiğiniz sitelere karşı ya da bir site değişikliğini son iyi çalıştırmasına karşı kontrol etmek için kullanın. Kaydedilmiş bir site genellikle birkaç MB'tır. Takip isteklerini, görselleri ve videoları, HttpOnly ve oturum çerezlerini, tarayıcının gönderdiği çerezleri, yetkilendirme başlıklarını, form verilerini ve adresinde e-posta ya da başka kullanıcı verisi bulunan istekleri dışarıda bırakır. Yine de sitenin sayfalarını ve betiklerini tutar; bu yüzden sahibi olmadığınız siteleri herkese açık depolarda tutmayın.

### Adımları kaydedin ve yapay zekâ olmadan tekrar oynatın

Tamamlanan her çalıştırma, her yolculuğun attığı adımları çalıştırma klasörüne, `aitd/<alan adı>/runs/<id>/steps.json` dosyasına kaydeder. Bir `--scripted --no-ai` çalıştırması, kendi `steps` alanı olmayan her yolculuk için bu adımları tekrarlar: sitenin o yolculuğu tamamlayan en yeni çalıştırmasını alır (varsa aynı görünümdekini, yoksa diğer görünümdekini) ve hangi çalıştırmayı tekrar oynattığını yolculuğun `▶` satırının altında söyler. Böylece yapay zekâ her yolculuk için bir kez gerekir; sonraki her çalıştırmanın maliyeti sıfırdır:

```bash
ai-tag-debugger run --site https://www.yourshop.com --journey purchase
ai-tag-debugger run --site https://www.yourshop.com --journey purchase --scripted --no-ai
```

Site değiştiğinde ve kayıtlı bir adım artık öğesini bulamadığında yolculuk, o çalıştırmanın adımlarının artık siteye uymadığını söyleyen bir notla tamamlanmamış olarak biter; yolculuğu yapay zekâyla bir kez daha çalıştırın, sonraki tekrar yeni adımları kullanır. Sitede hiç tamamlanmamış bir yolculuk, çalıştırmayı tarayıcı açılmadan durdurur. Yalnızca `aitd/` içine kaydedilen çalıştırmalar tekrar oynatılır: `--out` ile başka bir yere gönderilen ya da MCP üzerinden yapılan bir çalıştırma da `steps.json` yazar, ama sonraki çalıştırma oraya bakmaz. Adımlar atıldıkları gibi, yazılan değerler dahil saklanır (bir forma yazılan e-posta adresi `steps.json` içinde yazıldığı haliyle durur, çünkü tekrar oynatmanın onu yeniden yazması gerekir); bu yüzden yolculuklarda test verisi kullanın ve çalıştırma klasörünü sürüm denetiminin dışında tutun.

Adımları bunun yerine deponuzda tutmak için `--save-steps <dosya>`, bunları bir ayar dosyasının `journeys[].steps` alanına yazar. Dosya yoksa oluşturur; ayar dosyasında plan yoksa çalıştırmanın planını da kaydeder. Aynı ayar dosyası yolculuğu, yapay zekâ modeli ve API anahtarı olmadan tekrarlar:

```bash
ai-tag-debugger run --site https://www.yourshop.com --journey purchase --save-steps ai-tag-debugger.config.json
ai-tag-debugger run --config ai-tag-debugger.config.json --scripted --no-ai
```

Bir yolculuk her iki görünümde de çalıştıysa yalnızca ilk görünümün adımları tutulur. İkinci komutu her dağıtımda çalıştırarak aynı yolculuğu hiçbir model çağrısı yapmadan kontrol edin.

### Bilinen bulguları kabul edin

`--fail-on`, bir düzeydeki her bulguda CI işini başarısız yapar. Bir bulgu biliniyorsa ve yakında düzeltilmeyecekse, örneğin onaydan önce tetiklenen bir satıcı pikseli, bir temel dosya (baseline) sonraki çalıştırmaların yalnızca yeni bulgularda başarısız olmasını sağlar. Mevcut her bulguyu bir dosyaya yazmak için bir kez `--update-baseline` ile çalıştırın, dosyayı gözden geçirin ve depoya ekleyin:

```bash
ai-tag-debugger run --config ai-tag-debugger.config.json --scripted --no-ai --baseline baseline.json --update-baseline
ai-tag-debugger run --config ai-tag-debugger.config.json --scripted --no-ai --baseline baseline.json --fail-on warning
```

Dosyada her bulgu için bir kayıt bulunur: çalıştırmanın eşleştirme yaptığı bir `key` (kontrol, platform, event, yolculuk, görünüm ve eksik parametreler için hangileri olduğu) ve dosyayı okuyan kişi için geri kalanı. Bir bulguda yeniden başarısız olmaya başlamak için kaydını silin, ya da neden kabul edildiğini söyleyen bir `"note"` ekleyin; notlar bir sonraki `--update-baseline` çalıştırmasında korunur. Kabul edilen bir bulgu raporda "Kabul edildi" etiketiyle kalır, sayılara ve yapay zekâ açıklamasına alınmaz ve `--fail-on` için sayılmaz. Sayıların ardından çalıştırma, kaç bulgunun kabul edildiğini ve temel dosyadaki kaç kaydın bayatladığını, yani artık görülmediğini yazdırır; böylece dosya sadeleştirilebilir. Yalnızca bazı görünümlerde ya da yolculuklarda kabul edilen bir sorun kısmen kabul edilmiş olarak bildirilir ve sayılmaya devam eder; başka bir site için yazılmış bir temel dosya ise uyarı verir. Ayar dosyasındaki, ayar dosyasına göre bağıl `"baseline": "baseline.json"`, seçeneği her seferinde vermekten kurtarır; MCP `run_audit` aracı da `baseline` alır.

## Sitenizi yapılandırın

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
      "goal": "Çerezleri kabul et, sepete herhangi bir ürün ekle ve test ödeme yöntemiyle ödemeyi tamamla."
    }
  ]
}
```

| Alan | Anlamı |
|---|---|
| `site` | Temel URL. Mümkünse staging kullanın. |
| `plan` | Ölçümleme planı: bir dosya yolu ya da satır içi bir nesne (aşağıya bakın). Hazır yolculuklarla isteğe bağlıdır. `--against` ile çalışan bir çalıştırma bunun yerine o planı kullanır. |
| `gtm_container` | İsteğe bağlı GTM konteyner dışa aktarımı (Yönetici → Konteyneri dışa aktar). Her hatalı event, onu gönderen etiketi ve tetikleyicisini adlandırır (ya da hiçbir etiketin göndermediğini söyler) ve o tetikleyicinin yolculukta tetiklenip tetiklenmediğini, tetiklenmediyse nedenini söyler (duraklatılmış etiket, event'i taşıyan gönderim yok, görülen değerle birlikte sağlanmayan bir koşul, engelleyen bir tetikleyici, reddedilen onay); yakalanan dataLayer'dan, yapay zekâ modeli olmadan değerlendirilir. |
| `viewports` | `desktop` ve/veya `mobile`. |
| `concurrency` | Varsayılan `1`. Aynı anda kaç yolculuğun (ve onay senaryosunun) çalışacağı, her biri kendi tarayıcısında, en fazla `8`. `--concurrency` ile aynıdır. |
| `journeys` | `--journey` ile hazır yolculuk seçtiğinizde, `--goal` ile bir yolculuk tarif ettiğinizde ya da `--against` ile bir plana karşı kontrol ettiğinizde isteğe bağlıdır. |
| `journeys[].goal` | Yapay zekânın sade bir dille ne yapacağı. |
| `journeys[].start` | İsteğe bağlı başlangıç yolu (varsayılan `/`). |
| `journeys[].steps` | `--scripted` çalıştırmaları için isteğe bağlı sabit adımlar: `{ "action": "click", "selector": "#add-to-cart" }`. Bunlar yoksa `--scripted`, sitenin o yolculuğu son tamamlayan çalıştırmasının adımlarını tekrarlar. |
| `allowed_hosts` | Yolculukların ziyaret edebileceği başka ana makineler, örneğin barındırılan bir ödeme için `["checkout.payments-provider.com"]`. Tarayıcı aksi halde `site` ana makinesinde ve alt alan adlarında kalır. `--allow-host` ile aynıdır. |
| `providers` | Kontrol edilecek takip platformları, örneğin `["ga4", "meta"]`. Varsayılan `["ga4", "google_ads", "meta", "tiktok"]`; bu ayar boşken sitenin gönderdiği diğer platformlar da eklenir. `--platforms` ile aynıdır. |
| `campaign_checks` | Varsayılan `true`. Her çalıştırma ilk sayfayı bir reklam tıklaması gibi açar (UTM parametreleri, `gclid`, `fbclid` ya da başlangıç adresinde zaten olanlar) ve bunların yönlendirmelerden geçip isteklere ulaştığını denetler. Düz adresi açmak için `false` yapın. |
| `block_hits` | Varsayılan `true`. Takip isteklerinin gerçek uç noktalarınıza ulaşmasına izin vermek için `false` yapın. |
| `consent_scenarios` | Varsayılan `true`. [Onay senaryolarını](#onay-senaryoları) atlamak için `false` yapın; her onay seçimi için başlangıç sayfasını bir kez ziyaret ederler. |
| `baseline` | İsteğe bağlı: kabul edilen bulguların temel dosyasının, ayar dosyasına göre bağıl yolu. `--baseline` ile aynıdır. Bkz. [Bilinen bulguları kabul edin](#bilinen-bulguları-kabul-edin). |
| `language` | Rapor dili, `en` (varsayılan) ya da `tr`. `--lang` ile aynıdır. |
| `keep_bodies` | Varsayılan `false`. Takip isteklerini gönderildiği gibi, kullanıcı verisi gizlenmeden saklamak için `true` yapın. `--keep-bodies` ile aynıdır. |
| `branding` | Varsayılan `true`. Analitik İşler logosunu ve "Generated by AI Tag Debugger · analitikisler.com" satırını raporlardan çıkarmak için `false` yapın. `--no-branding` ile aynıdır, ya da MCP `finish_audit` ve `run_audit` araçlarında `branding: false`. |
| `report` | İsteğe bağlı beyaz etiket: `{ "name": "Acme", "logo": "logo.png", "color": "#0a7d5a", "pdf": true }`. `logo` (PNG, JPG, WebP, GIF veya SVG; en fazla 512 KB; ayar dosyasına göre bağıl) ve `name`, HTML raporundaki Analitik İşler markasının yerine geçer (küçük bir AI Tag Debugger logosu ve kredisi kalır). `color` vurgu rengini ayarlar; `pdf: true` ise `report.html` yanına `report.pdf` de yazar. |
| `provider` | İsteğe bağlı: `anthropic`, `openai`, `gemini`, `vercel`, `cloudflare` ya da `openai-compatible`. `--provider` ile aynıdır. |
| `base_url`, `model` | İsteğe bağlı: API adresi ve model kimliği, örneğin `openai-compatible` için. `--base-url` ve `--model` ile aynıdır. |
| `notify` | İsteğe bağlı uyarılar, kayıtlı her çalıştırmadan sonra: `slack` (bir webhook adresi ya da `SLACK_WEBHOOK_URL` değişkenini okumak için `true`) ve `email` (bir adres ya da liste). Bkz. [Uyarılar](#uyarılar). |

Ayar dosyası ve plan, okunur okunmaz, tarayıcı başlamadan önce denetlenir. Bir hata, alanı ve sabit bir seçim için izin verilen değerleri adlandırır, örneğin `viewports[1]: must be one of desktop, mobile (got "tablet")` ya da `journeys[0].steps[2].action: must be one of goto, click, fill, select, scroll, wait`. Aracın tanımadığı bir anahtar, en yakın olanı öneren bir uyarıyla yok sayılır (`Unknown key "viewport" ... Did you mean "viewports"?`); böylece dosyadaki fazladan bir not çalıştırmayı durdurmaz. `aitd plan` ile kaydedilen ve elektronik tablodan içe aktarılan planlar da aynı denetimden geçer.

### Uyarılar

Kayıtlı her çalıştırmadan sonra `notify`, "Son çalıştırmadan bu yana değişenler" farkını ekibinize gönderir; böylece sitedeki bir değişiklik raporu açmadan size ulaşır:

```json
"notify": {
  "slack": "https://hooks.slack.com/services/...",
  "email": ["team@example.com"]
}
```

- **Slack** webhook adresini alır. `"slack": true` ise adresi bunun yerine `SLACK_WEBHOOK_URL` ortam değişkeninden okur; böylece adres dosyada durmaz.
- **E-posta** tek bir adres ya da bir liste alır. Postalar `SMTP_URL` içindeki sunucudan gönderilir, örneğin `smtps://kullanici:parola@mail.example.com:465`. Gönderen adresi `SMTP_FROM` belirler (varsayılan: ilk alıcı). `smtps://` kullanın; bağlantıyı baştan şifreler. Düz `smtp://` adresi giriş bilgisini ve postayı şifresiz gönderir, STARTTLS desteklenmez.

Uyarı yalnızca kayıtlı bir çalıştırma için gönderilir (`--out` ile gönderilen için değil), karşılaştırılacak bir önceki çalıştırma varsa ve o zamandan beri bir değişiklik olduysa. Konu satırı önce sonucu, sonra sayıları ve başlığı taşır: `shop.example: Kaldı · 2 yeni sorun · purchase izlemesi bozuk (mobile)`. Gövde sonuç satırını yineler, sonra neyin düzeldiğini (*önceki durumuyla* birlikte) ve neyin yeni olduğunu listeler (her yeni kayıt önem düzeyi ve sorumlusuyla), ardından mini grafikli eğilim satırı, gelip giden sorunlar ve bir sorun 5, 10, 20 çalıştırmadır açık kaldığında (sonra her 10 çalıştırmada bir) "N çalıştırmadır hâlâ açık" satırı gelir; böylece aynı açık liste her mesajda tekrarlanmaz:

```
shop.example
Sonuç: Kaldı · purchase izlemesi bozuk (mobile) · puan 25/100
1 sorun düzeldi, 1 yeni sorun. 2026-10-15_1000 çalıştırmasıyla sağlık bulgularına göre karşılaştırıldı (2026-10-16_1000).
- Düzeldi: GA4 page_view (önceki durum: Onaydan önce gönderildi)
- Yeni: Meta Purchase · Bozuk · "Purchase" olayı "value" parametresi olmadan gönderildi. · Yazılımcı
5 çalıştırmada eğilim (2026-10-12 → 2026-10-16): kötüleşiyor. Şimdi 2 bozuk · 1 risk · 0 uyarı; 3 çalıştırma önce 0 bozuk · 1 risk · 0 uyarı. `▃▃·▅█`
```

Eğilim tek başına hiçbir zaman uyarı tetiklemez. Bir kanal başarısız olursa çalıştırma nedenini yazar ve devam eder. Çıkış kodu yine `--fail-on` ile belirlenir.

## CLI

```
aitd "<cümle>" [-y]
aitd plan --site <url> [--topic <ad>] [--headed] [--provider <ad>] [--model <id>] [--max-steps <n>] [--data-dir <dir>]
aitd plan list --site <url> [--data-dir <dir>]
aitd plan import <dosya> --site <url> [--data-dir <dir>]
aitd plan export <plan> --site <url> [--format xlsx|csv] [--data-dir <dir>]
aitd run --site <url> (--against <plan> | --journey <id> | --goal "<metin>") [--config <dosya>] [--events <adlar>]
         [--max-steps <n>] [--viewport desktop|mobile] [--concurrency <n>] [--platforms <liste>] [--data-dir <dir>]
         [--provider anthropic|openai|gemini|openai-compatible] [--model <id>] [--lang en|tr] [--headed]
         [--fail-on broken|risk|warning|never] [--baseline <dosya>] [--update-baseline]
         [--scripted] [--no-ai] [--save-site <dir>] [--save-steps <dosya>]
aitd replay <dir>... [--update] [--out <dir>]
aitd mcp [--http] [--port <n>] [--host <adres>] [--token <gizli>] [--public-url <https url>] [--reports <dir>]
         [--allow-private-network]
aitd doctor [--site <url>] [--data-dir <dir>]
aitd history --site <url> [--limit <n>] [--json] [--lang en|tr] [--data-dir <dir>]
```

`aitd`, `ai-tag-debugger`'ın kısa bir takma adıdır ve aynı komutları ve seçenekleri kabul eder. Her komutun temel seçenekleri için `aitd <komut> --help` çalıştırın.

### Tüm seçenekler

| Seçenek | Komutlar | Anlamı |
|---|---|---|
| `--site <url>` | plan, run, doctor, history | Site. `plan` ve `history` için zorunludur; `run` için `--against` ya da ayar dosyası siteyi vermiyorsa gereklidir. `doctor` yalnızca adresin http(s) olduğunu ve ana makinesinin çözüldüğünü denetler. |
| `--against <plan>` | run | Bir plana karşı kontrol: `latest` (ya da `last`), `first`, bir plan kimliği ya da bir plan dosyasının ya da klasörünün yolu. |
| `--journey <id>` | run | Hazır bir yolculuk (tekrarlanabilir). |
| `--goal "<metin>"` | run | Sade bir dille bir yolculuk (tekrarlanabilir). |
| `--config <dosya>` | run | Siteyi, yolculukları ve planı bir ayar dosyasından al. |
| `--events <adlar>` | run | Yalnızca bu event'leri kontrol et, örneğin `purchase,add_to_cart`. |
| `--viewport <ad>` | run | `desktop` ya da `mobile` (tekrarlanabilir). |
| `--concurrency <n>` | run | Aynı anda kaç yolculuğun çalışacağı, her biri kendi tarayıcısında: `1` (varsayılan) ile `8` arası. Yan yana çalışırken her yolculuğun günlük satırları `[yolculuk/görünüm]` ile başlar ve `--headed` o kadar tarayıcı penceresi açar. Ayar dosyasındaki `concurrency` ile aynıdır. |
| `--platforms <liste>` | run | Kontrol edilecek platformlar, örneğin `ga4,meta`. Eski adı `--providers`'ın yerine geçer; o da bir minör sürüm daha çalışır. |
| `--max-steps <n>` | plan, run | Yolculuk başına en fazla yapay zekâ adımı (`plan` için varsayılan 25). |
| `--lang <kod>` | run, history | Rapor dili: `en` ya da `tr`. `history` için eğilim satırlarının dili. |
| `--fail-on <düzey>` | run | Bu düzeyde çıkış kodu 1 olur: `broken` (varsayılan), `risk`, `warning` ya da `never`. |
| `--baseline <dosya>` | run | Kabul edilen bulguların dosyası. Yine raporlanırlar, ama `--fail-on` için sayılmazlar. Bkz. [Bilinen bulguları kabul edin](#bilinen-bulguları-kabul-edin). |
| `--update-baseline` | run | Bu çalıştırmanın her bulgusunu çalıştırmadan sonra temel dosyaya yaz; dosya yoksa oluştur. |
| `--headed` | plan, run | Tarayıcı penceresini göster. |
| `--provider <ad>`, `--model <id>` | plan, run | Yapay zekâ sağlayıcısı ve modeli. Varsayılan: ayarlı olan API anahtarı. |
| `--scripted` | run | Her yolculuğun sabit adımlarını, yapay zekâ gezintisi olmadan tekrar oynat. Adımı olmayan bir yolculuk, sitenin son tamamlanan çalıştırmasının adımlarını tekrarlar. |
| `--no-ai` | run | Hiç yapay zekâ modeli yok. `--scripted` anlamına gelir. |
| `--save-site <dir>` | run | Sitenin yanıtlarını `replay` için kaydet. |
| `--save-steps <dosya>` | run | Her yolculuğun attığı adımları bir ayar dosyasına yaz. |
| `--data-dir <dir>` | plan, run, doctor, history | `aitd/` klasörünün (planlar ve çalıştırmalar) tutulduğu yer. Varsayılan: `./aitd`. `run --out` yerine geçer. |
| `--limit <n>` | history | Eğilimin sitenin en yeni kaç çalıştırmasını okuyacağı. Varsayılan: 30. |
| `--json` | history | Eğilim serisini, bulgu zaman çizelgesini ve yolculuk kararlılığını metin yerine JSON olarak yazdır. |
| `--format xlsx\|csv` | plan export | Elektronik tablo biçimi. Varsayılan: `xlsx`. |
| `--update` | replay | Bu tekrarın bulgularını beklenen bulgular yap. |
| `--out <dir>` | replay | Tekrar raporlarının yazılacağı yer. `run` için `--out` gizli bir takma ad olarak bir minör sürüm daha çalışır ve bir not yazdırır; `--data-dir` kullanın. |
| `--base-url <url>` | run | OpenAI uyumlu bir sağlayıcının API adresi. |
| `--allow-host <ana makine>` | run | Yolculukların ziyaret edebileceği başka bir ana makine (tekrarlanabilir). `allowed_hosts` ile aynıdır. |
| `--keep-bodies` | run | Takip isteklerini gönderildiği gibi, kullanıcı verisi gizlenmeden sakla. |
| `--no-branding` | plan, run | Logo ve kredi satırını raporlardan ve `plan.html` dosyasından çıkar. |
| `--http`, `--port`, `--host`, `--token`, `--public-url`, `--reports`, `--allow-private-network` | mcp | Aşağıdaki MCP bölümüne bakın. |

0.10.0 sürümünde kaldırıldı: `plan --from`, `plan --out` ve `plan --force`. Plan taslağı her zaman yeni bir klasör kaydeder; kaldırılmış bir bayrak ne çalıştırılacağını yazdırır.

Çıkış kodu, bulgular `--fail-on` düzeyine (varsayılan `broken`) ulaştığında `1` olur; böylece bir dağıtımı durdurabilir. Bir [temel dosyada](#bilinen-bulguları-kabul-edin) kabul edilen bulgular sayılmaz. Her dağıtımdan sonra çalıştırmak için [`examples/github-actions/ai-tag-debugger.yml`](examples/github-actions/ai-tag-debugger.yml) dosyasına bakın.

**CI'da test sonuçları.** Her çalıştırma ayrıca `junit.xml` yazar: her yolculuk bir test paketi, her bulgu bir test vakasıdır ve `--fail-on` düzeyine ulaşan bulgu başarısız sayılır; böylece GitHub Actions, GitLab ve Jenkins bulguları test hataları olarak gösterir. GitHub Actions'ta dosyayı yükleyin ve bir JUnit raporlayıcı action'a verin:

```yaml
      - run: aitd run --config ai-tag-debugger.config.json --data-dir tracking-report
      - uses: actions/upload-artifact@v6
        if: always()
        with:
          name: junit
          path: tracking-report/**/junit.xml
      # İsteğe bağlı: herhangi bir JUnit raporlayıcı action dosyayı çalıştırma üzerinde açıklamalara dönüştürür.
      - uses: dorny/test-reporter@v2
        if: always()
        with:
          name: tracking
          path: tracking-report/**/junit.xml
          reporter: java-junit
```

GitLab'da `artifacts: reports: junit:` ayarını aynı yola yönlendirin. Yanındaki `summary.json`, sayıları, sonucu (`status`: `fail`, `attention` ya da `pass`, ve `fail_broken` gibi bir `headline` anahtarı), veri kalitesi puanını (`score`, 0 ile 100 arası), kayıtlı çalıştırmalardaki eğilim yönünü (`direction`), yolculukları, her bulguyu (kontrol, önem düzeyi, platform, event, yolculuk, görünüm, başlık, mesaj), çalıştırma klasörünün adını `run` olarak ve diğer dosyaların adlarını o klasöre göre bağıl olarak `files` altında tutar; böylece bir betik, `capture.json` dosyasını ayrıştırmadan sonucu okuyabilir ve dosyadaki hiçbir şey çalıştırmanın yapıldığı makineye bağlı değildir:

```sh
jq '.counts.broken' aitd/example.com/runs/*/summary.json
jq -r '.verdict.status + " " + (.score | tostring)' aitd/example.com/runs/*/summary.json
```

**Zamanlanmış çalıştırmalar.** Her dağıtımdan sonra değil de bir zamanlayıcıyla denetlemek için [`examples/github-actions/scheduled-run.yml`](examples/github-actions/scheduled-run.yml) dosyasını kullanın (varsayılan olarak haftalık; cron satırını değiştirebilirsiniz). Geçmişi çalıştırmalar arasında bir önbellekte saklar, böylece "Son çalıştırmadan beri değişenler" yeni bir runner'da da çalışır. Kendi sunucunuzda aynısı için [`examples/cron/`](examples/cron) içinde bir betik ve bir crontab satırı vardır.

Çıktı:

- `report.html`: tek bir dosya, her seferinde tek bir ekran. Soldaki katlanabilir şerit yedi bölümü listeler; her bölümün, filtrenin ve kartın paylaşılabilir ya da yer imine eklenebilir kendi URL'si vardır ve bir bölümdeki bağlantı diğerinde doğru kartı açar (bir bulgunun "Nerede" çipi o isteği kendi adımında açar).
  - **Özet**: veri kalitesi puanı bir halka olarak; 50'nin altı kırmızı, 89'a kadar sarı, 90 ve üstü yeşil. Yanında karar ve başlığı, puanı neyin düşürdüğünü söyleyen en fazla üç satır (tam puanda hiç satır yok), bulguları önem düzeyine göre filtrelenmiş açan durum çipleri ve çalıştırmayı anlatan altı kart: kontrol edilen sağlayıcılar, her birinde görülen platformlarla yolculuklar, kontrol edilen event'ler, çerez onayı, yapay zekâ sağlayıcısı ve çalıştırmanın kendisi.
  - **Bulgular**: üç grubun (başarısız, doğrulanmamış, geçen) üstünde bir filtre çubuğu (önem düzeyi, sorumlu, platform, yolculuk, ekran, arama). Her satır kapalı başlar ve **Kanıt**, **Düzeltme**, **Nerede** ve **Doğrula** sekmelerine açılır: etkisi, olası nedeni, eksik parametreleri işaretli kanıtı, numaralı düzeltme adımları, yaşandığı adımlar ve düzeltmeyi kontrol edebileceğiniz araçlar (Tag Assistant, GA4 DebugView, Meta Test Events, TikTok Pixel Helper). Sitenin önceki bir çalıştırması varsa **Son çalıştırmadan bu yana değişenler** grupların üstünde yer alır.
  - **Yolculuklar**: her seferinde bir yolculuk ve ekran. Solda sayfalara göre adlandırılmış ("Ana sayfayı aç", "Sepete ekle") ve sayfaya göre gruplanmış adımlar, her adımın ürettiği isteklerle; sağda seçili adım, **İstekler**, **Data Layer** ve **Ağ** sekmeleriyle. Her istek event'ini, temel parametrelerini ve çerez onayı durumunu gösterir; çözülmüş parametrelere, ürün kartlarına ve ham isteğe açılır. Toplu bir GA4 isteği içindeki her event'i gösterir. Sorunlu ilk adımda açılır.
  - **Onay**: her platform için bir satır: seçimden önce, kabulden sonra ve retten sonra ne aldığı; Consent Mode varsayılanı ve güncellemeleri zamanlamalarıyla; ve [onay senaryoları](#onay-senaryoları) tablosu.
  - **Kapsam**: planlanan her event'in her yolculukta gönderilip gönderilmediği, hâlâ ihtiyaç duyduğu parametrelerle; dönüşüm bütünlüğü; ve `--against` ile [Plan ve site](#plan-ve-site) kovaları.
  - **Envanter**: [etiket envanteri](#etiket-envanteri), platform başına bir satır; sunucularına, sayfalarına ve çerezlerine açılır.
  - **Çalıştırma**: çalıştırmanın künyesi (site, sürüm, yapay zekâ sağlayıcısı ve modeli, plan, yolculuklar, ekranlar, platformlar, süreler, dosyalar) ve sitenin önceki çalıştırmaları varsa **Eğilim**.

  Özet dışında her kart kapalı başlar; her bölümde Tümünü aç ve Tümünü kapat düğmeleri vardır. Sayfada şerit, filtreler, sekmeler ve derin bağlantılar için, sayfanın Content Security Policy'sinde özetiyle izin verilmiş küçük bir betik bulunur; JavaScript olmadan bölümler tek bir belge olarak alt alta dizilir, yazdırma düzeni de budur. Klavye: `[` şeridi katlar, `1`–`7` bir bölüme atlar. Logolar gömülüdür, bu yüzden internetten hiçbir şey yüklenmez. `--no-branding`, Analitik İşler logosunu ve kredi satırını çıkarır.
- `timeline.csv`: aynı zaman akışı, her isteğe, dataLayer gönderimine ve ağ çağrısına bir satır olarak; Excel ya da Google Sheets için hazır.
- `report.md`: raporun Markdown hali; bir çekme isteği yorumu, bir Slack mesajı ya da bir e-posta için, dört yolculuklu bir çalıştırmada yaklaşık 100 satır ve 8 KB'ın altında. Başlığı sonuçtur (`# shop.example: purchase izlemesi bozuk (mobile)`), ardından tek bir meta satırı, veri kalitesi puanıyla birlikte durum ve sayılar gelir. Sonra sırasıyla: **Son çalıştırmadan bu yana değişenler** ve **Eğilim** (sitenin önceki çalıştırmaları varsa), **Plan ve site** (`--against` ile), **Öncelikler** (sorumlu başına yapılacaklar listesi: Yazılımcı, Tag Manager, Pazarlama), **Bulgular** (Nerede, Etkisi, Neden, Kanıt, Şurada sorunsuz, Sorumlu, Çözüm, Nasıl doğrulanır ve `report.html` içine bir bağlantıyla en fazla beş tam blok; geri kalanı *Ayrıca* altında birer satır), **Onay** (Consent Mode zamanlama cümlesi ve her hücresinde bir neden bulunan senaryo tablosu), **Sorunsuz olanlar**, **Yolculuklar** (çalıştırma başına bir satır, sonra yalnızca sorun taşıyan adımlar), **Kontrol edilmeyenler** (çalıştırmanın yargılayamadıkları, bunu açan ayar anahtarıyla birlikte) ve **Etiket envanteri**. İstek başına zaman akışı dosyada yoktur; `timeline.csv` içindedir.
- `capture.json`: yakalanan her şey, kendi analiziniz için; aracın `version` bilgisi, `ai` sağlayıcısı ve hesaplanan `metrics` (sonuç, puan, plan kapsamı, huni, platform tutarlılığı, onay uyumu, dönüşüm bütünlüğü, zamanlama, öncelikler) dahil.
- `plan-check.json`: `--against` ile, planlanan her event için kovasıyla birlikte bir kayıt.
- `junit.xml`: bulgular JUnit test sonuçları olarak, yolculuk ve görünüm başına bir paket; CI sistemlerinin test hatası olarak göstermesi için (yukarıya bakın).
- `summary.json`: çalıştırmanın sayıları, sonucu, puanı, eğilim yönü, yolculukları, bulguları ve dosya adları, betikler için tek bir küçük dosyada.
- `plan.html` (planın klasöründe): planın event'lerini, parametrelerini ve kullanıcı özelliklerini gösteren okunabilir bir sayfa.

Raporlar bir kredi satırıyla biter: "Generated by AI Tag Debugger · analitikisler.com"; alan adı düz bir bağlantıdır (görsel yok, takip yok ve yönlendiren bilgisi yok; böylece rapor adresleri sızdırılmaz). `--no-branding`, bunu logosuyla birlikte kaldırır.

Türkçe rapor için `--lang tr` kullanın. Bulgu metinleri, başlıklar, modelin açıklamaları ve düzeltmeleri Türkçe yazılır; ajan adımlarını da Türkçe anlatır.

## Yapay zekâ sohbet uygulamanızdan kullanın (MCP)

`aitd mcp`, bir [Model Context Protocol](https://modelcontextprotocol.io) sunucusu başlatır. Sohbet uygulamanızın modeli denetimi kendisi yürütür: "staging.myshop.com sitesinin ödeme takibini kontrol et" dersiniz, o da tarayıcıyı açar, tıklar ve bulguları sohbette açıklar. Yapay zekâ düşünmeyi uygulamanın kendi modeli yaptığı için API anahtarı gerekmez.

Sunucunun sunduğu araçlar:

| Araç | Ne yapar |
|---|---|
| `make_plan` | Bir site için takip planı çıkarır (neyin takip edilmesi gerektiği), `aitd plan --site` ile aynıdır. Yalnızca bir tür event için sınırlamak üzere `topic` verin (`custom-events`, `ecommerce`, `forms`, `consent`). Plan kaydedilir ve kimliği `finish_audit` için `against` olarak verilebilir. Sunucuyu çalıştıran bilgisayarda ayarlı yapay zekâ sağlayıcısını kullanır ve birkaç dakika sürer. |
| `what_changed` | Bir site için yalnızca "son çalıştırmadan bu yana" farkını döndürür: kayıtlı son çalıştırmanın (`aitd run`) bir öncekine göre düzelen ve yeni sorunları. Tarayıcı ve yapay zekâ kullanmaz. Türkçe yanıt için `language` verin. |
| `start_audit` | Bir URL'de yeni bir tarayıcı açar ve tüm takibi kaydetmeye başlar. Hedefini ve beklenen event'lerini almak için hazır bir yolculuk (`purchase`, `sign_up`, …) verin; kontrol edilecek platformları seçmek için `providers` verin. Asistan önce hangi platformların kontrol edileceğini size sorar. |
| `browser_action` | Tek bir tıklama, doldurma, seçme, gitme, kaydırma ya da bekleme. Sayfayı ve o adımın gönderdiği takip isteklerini döndürür. |
| `get_page` | Geçerli sayfayı gösterir. |
| `finish_audit` | Her şeyi ölçümleme planınıza (JSON) ya da `against` olarak verilen kayıtlı bir plana (`latest`, `first`, bir plan kimliği ya da yerel bir sunucuda bir yol) ya da hazır yolculuğun event'lerine karşı kontrol eder; isterseniz yalnızca adını verdiğiniz `events` için, ve zaman akışıyla birlikte tam HTML raporunu yazar. Site denetimden alınır. |
| `run_audit` | Bir ayar dosyasını baştan sona çalıştırır. `against` ile çalıştırmayı kayıtlı bir plana karşı kontrol eder; ayar dosyasında yolculuk yoksa, plandan türetilen yolculukları gezer. `concurrency` o kadar yolculuğu aynı anda, her birini kendi tarayıcısında çalıştırır (varsayılan 1); `baseline`, `--update-baseline` ile yazılmış kabul edilen bulgular dosyasını adlandırır (varsayılan: ayar dosyasındaki `baseline`; bkz. [Bilinen bulguları kabul edin](#bilinen-bulguları-kabul-edin)). Dosya yolları yalnızca yerelde çalışır. |

`against`, CLI'deki `--against` ile aynı değerleri alır. HTTP üzerinden yalnızca `latest`, `first` ya da bir plan kimliği kabul edilir, asla bir yol değil. Planlar, `aitd plan --site <url>` ya da `make_plan` ile kaydedilmiş olanlardır. Neyin takip edileceğini öğrenmek için plan, sitenin ne gönderdiğini öğrenmek için denetim isteyin.

Tarayıcı, sunucunun çalıştığı bilgisayarda çalışır; bu yüzden staging ve `localhost` sitelerinize erişebilir. Takip istekleri her zamanki gibi yerelde yanıtlanır.

### Yerel sunucu başlatan uygulamalar: Claude Desktop, Gemini CLI, Cursor, VS Code, Claude Code

Sunucuyu uygulamanın MCP yapılandırmasına ekleyin. Claude Desktop için bu, Settings → Developer → Edit Config (`claude_desktop_config.json`) yoludur:

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

Tarayıcı (Chromium), bir denetimi ilk kez çalıştırdığınızda kendini indirir; bu yaklaşık bir dakika sürer ve yalnızca bir kez olur. Önceden indirmek için: `npx -y playwright@1.56.1 install chromium`.

Tek tıkla ya da tek satırla kurulum:

- **Claude Code:** `claude mcp add ai-tag-debugger -- npx -y @analitikisler/ai-tag-debugger mcp`
- **Cursor:** [Cursor'a ekle](https://cursor.com/en/install-mcp?name=ai-tag-debugger&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBhbmFsaXRpa2lzbGVyL2FpLXRhZy1kZWJ1Z2dlciIsIm1jcCJdfQ==)
- **VS Code:** [VS Code'a yükle](https://insiders.vscode.dev/redirect/mcp/install?name=ai-tag-debugger&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40analitikisler%2Fai-tag-debugger%22%2C%22mcp%22%5D%7D), ya da `code --add-mcp '{"name":"ai-tag-debugger","command":"npx","args":["-y","@analitikisler/ai-tag-debugger","mcp"]}'`
- **Claude Desktop, Gemini CLI ve diğerleri:** yukarıdaki JSON bloğu. Gemini CLI aynı `mcpServers` bloğunu `~/.gemini/settings.json` dosyasında kullanır.

Uygulamayı yeniden başlatın; ai-tag-debugger araçları görünür. Uygulama `npx`'i bulamıyorsa tam yolunu kullanın (`which npx`; örneğin Homebrew'lu bir Mac'te `/opt/homebrew/bin/npx`). Raporlar `~/ai-tag-debugger-reports` klasörüne yazılır.

Bunun yerine bir klondan mı çalıştırıyorsunuz? `"command": "node"` ve `"args": ["/path/to/ai-tag-debugger/src/cli.js", "mcp"]` kullanın.

### Bir adrese bağlanan uygulamalar: ChatGPT, Gemini

Bu uygulamalar MCP sunucularına HTTPS üzerinden bağlanır (ChatGPT'de geliştirici modu bağlayıcıları üzerinden, planınıza bağlı olarak). Sunucuyu HTTP modunda başlatın ve bir tünelle dışarı açın:

```bash
cloudflared tunnel --url http://localhost:8787     # ya da: ngrok http 8787; yazdığı https adresini not edin
npx -y @analitikisler/ai-tag-debugger mcp --http --port 8787 --public-url https://<tünel-adresiniz>
```

Sunucu, `https://<tünel-adresiniz>/mcp/<gizli>` gibi rastgele gizli bir yol içeren bir URL yazdırır. Bu URL'yi uygulamada bir bağlayıcı olarak ekleyin. URL'yi bilen herkes bilgisayarınızdaki tarayıcıyı kullanabilir; bu yüzden gizli tutun ve işiniz bitince sunucuyu durdurun. Kendi gizli değeriniz (`--token`) en az 16 karakter olmalıdır.

HTTP modunda sunucu yerelde olduğundan daha kısıtlıdır:

- Ölçümleme planlarını ya da ayar dosyalarını diskinizden okumaz (planı sohbette JSON metni olarak verin ya da `against: latest`, `first` ya da kimliğiyle kayıtlı bir planı adlandırın) ve `run_audit` sunulmaz. Yalnızca kendi yazdığı raporları sunar.
- Tarayıcı yalnızca `http` ve `https` sayfalarını açar ve `localhost` ile özel ağ adreslerini (`192.168.x.x` ya da `169.254.169.254` gibi) reddeder; böylece URL, ağınızı incelemek için kullanılamaz. WebSocket'ler dahil tüm tarayıcı trafiği, her ana makineyi bir kez çözüp yalnızca kontrol ettiği adrese bağlanan küçük bir yerleşik proxy üzerinden geçer; denetim sırasında değişen bir DNS yanıtı kontrolü atlatamaz. Yerel bir staging sitesini bu şekilde yine de denetlemek için sunucuyu `--allow-private-network` ile başlatın.
- 15 dakika açık kalan denetimler kapatılır ve istek gövdeleri 1 MB ile sınırlıdır.

Tünel gerektirmeyen barındırılmış bir sunucu, [Analitik İşler](https://analitikisler.com) Cloud sürümünün bir parçasıdır.

## Güvenlik

- Ajana kolay test verisi kullanması ve **asla gerçek ödeme bilgisi girmemesi** söylenir. Bir yolculuk gerçek bir ödeme ya da hesap gerektiriyorsa durur ve bunu bildirir.
- [Nasıl çalışır](#nasıl-çalışır) bölümünde listelenen platformlara giden takip istekleri varsayılan olarak yerelde yanıtlanır; bu yüzden o analitik ve reklam hesaplarına test dönüşümleri ulaşmaz.
- Tarayıcı, denetlenen sitede ve alt alan adlarında kalır; ayrıca varsa `allowed_hosts` içinde. Yalnızca `http` ve `https` sayfalarını açar.
- Modele, sayfa içeriğinin veri olduğu ve talimat olmadığı söylenir. Bir istem kuralı, bir modelin asla yanıltılmayacağını garanti edemez; bu yüzden yukarıdaki gezinme sınırları, yanıltılmış bir modelin yapabileceklerini sınırlar.
- Tarayıcı, ortamında API anahtarlarınız ve diğer gizli bilgileriniz olmadan çalışır.
- **Reklam eşleştirmesi için gönderilen kullanıcı verisi, `capture.json` dosyasına kaydedilmeden ya da raporda gösterilmeden önce gizlenir**: GA4 ve Google Ads geliştirilmiş dönüşümlerindeki e-postalar, telefonlar, adlar, adresler ve kullanıcı kimlikleri (`em`, `ph`, `uid`, …), Meta gelişmiş eşleştirme (`ud[*]`, `udff[*]`), TikTok `context.user` ve geliştirilmiş dönüşümler için sitenin dataLayer'a gönderdiği `user_data`. E-posta adresine benzeyen her değer, alanı ne olursa olsun gizlenir; yalnızca denetlenen sitenin `mailto:` bağlantısındaki ya da bir bağlantı alanındaki (`link_url`, `link_text`, `gtm.elementUrl`, …) kendi adresi istisnadır; örneğin bir GTM tıklama event'indeki iletişim bağlantısı, ziyaretçi verisi değildir. Her değer `[redacted: 64 chars, looks hashed]` gibi bir işaretçiye dönüşür; karma hâle getirilmemiş bir değer ise kişisel veri riski olarak raporlanır. `--keep-bodies` (`"keep_bodies": true`), istekleri gönderildiği gibi, hata ayıklama için saklar.
- Saklanan istek gövdeleri istek başına 32 KB, yolculuk başına 2 MB ile sınırlıdır. Bu sınırın üzerinde rapor, gövdenin saklanmadığını söyler.
- Yalnızca sahibi olduğunuz ya da test etme yetkiniz olan sitelere karşı çalıştırın.
- HTTP sunucusunu başkaları için barındırıyor musunuz? Ek bir savunma katmanı olarak özel ve bulut meta veri adres aralıklarını ağ düzeyinde de engelleyin (bir çıkış güvenlik duvarı ya da yalıtılmış bir ağ).

## Yol haritası

- Consent Check: çerez onay pencerelerinin ve Consent Mode v2'nin KVKK/GDPR'a karşı daha derin denetimleri.
- Measurement Plan: bir URL'den ölçümleme planı ve dataLayer şartnamesi taslağı çıkarma.
- [analitikisler.com](https://analitikisler.com) üzerinde; zamanlanmış çalıştırmalar, dağıtım webhook'ları, barındırılan bir MCP sunucusu ve ajanslar için çok siteli panolar içeren barındırılan sürüm.

## Geliştirme

```bash
npm run setup   # Node'u denetler, bağımlılıkları ve Chromium'u kurar, bir AI sağlayıcı anahtarının ayarlı olup olmadığını söyler
npm test        # ayrıştırıcılar, kontroller, her AI sağlayıcısı ve MCP sunucusu; demo mağazaya karşı uçtan uca
npm run test:unit   # yalnızca tarayıcı gerektirmeyen testler, yaklaşık on saniyede
npm run lint    # ESLint, yalnızca önerilen kurallar: tanımsız adlar, kullanılmayan import'lar ve benzerleri
```

Depoda ayrıca bir geliştirme konteyneri (`.devcontainer/devcontainer.json`) vardır. VS Code'da Dev Containers eklentisiyle ya da GitHub Codespaces'te açın; Chromium'un sistem kütüphaneleri dahil `npm run setup`'ı sizin yerinize çalıştırır. Oradaki bir AI modelini kullanmak için anahtarınızı bir Codespaces sırrı olarak ekleyin ya da konteynerin terminalinde dışa aktarın.

Uçtan uca testler sahte model istemcileri kullanır, bu yüzden bir API anahtarı olmadan çalışır.

## Barındırılan sürüm

Barındırılan çalıştırmalar, zamanlama ve ajans panoları için [analitikisler.com](https://analitikisler.com) adresine bakın.

## Lisans

MIT © Analitik İşler
