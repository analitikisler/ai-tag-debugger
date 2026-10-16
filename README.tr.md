[English](README.md) | Türkçe

# AI Tag Debugger

**Web sitenizin analitik ve reklam takibini test eden, açık kaynaklı bir yapay zekâ ajanı.**

Bir yapay zekâ modeli gerçek bir tarayıcıyı, sitenizdeki temel yolculukları (ürün → sepet → ödeme, form gönderimleri) gerçek bir ziyaretçi gibi gezdirir. Gezerken `ai-tag-debugger` her GA4, Google Ads, Meta Pixel ve TikTok isteğini ve her dataLayer gönderimini kaydeder. Ardından bunları ölçümleme planınız ve Consent Mode kurulumunuzla karşılaştırır ve neyin bozulduğunu ve nasıl düzeltileceğini sade bir dille, Türkçe ya da İngilizce olarak yazılmış bir raporla anlatır.

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

Platformlar: GA4 (sitenin kendi alan adındaki sunucu tarafı GTM uç noktaları ve Google etiket geçidi yolları dahil; bir sunucu konteynerine giden istekler sunucu tarafı olarak işaretlenir, Stape ve Elevar istekleri tanınır), Google Ads dönüşümleri, Meta Pixel, TikTok Pixel ve temel X Pixel event'leri.

### Kontrol edilecek platformları seçin

Varsayılan olarak bir denetim GA4, Google Ads, Meta ve TikTok'u kontrol eder. Başka platformları `--platforms ga4,meta,x` ile, ayar dosyasındaki `"providers"` ile ya da MCP `start_audit` ve `run_audit` araçlarındaki `providers` ile seçebilirsiniz. Seçenekler: `ga4`, `google_ads`, `meta`, `tiktok`, `x`, `linkedin`, `microsoft_ads`, `pinterest`, `snapchat`, `clarity`, `hotjar`, `doubleclick` ve `adsense`. GA4, Google Ads, Meta, TikTok ve X için event'ler ayrıştırılır; diğerlerinin ağ istekleri gösterilir. `--providers` eski adı olarak bir minör sürüm daha çalışır ve bir not yazdırır.

Seçmediğiniz platformlara giden istekler de yerelde yanıtlanır, yani o hesaplara da ulaşmaz. Bu istekler zaman akışına, CSV'ye ve kontrollere alınmaz, sadece sayılır: rapor bunları istek sayılarıyla listeler (örneğin "Kapsam dışı 61 istek atlandı: Microsoft Clarity, DoubleClick") ve her adım kaç istek atladığını gösterir. `--platforms` vermezseniz, ölçümleme planınızda geçen her platform varsayılan listeye eklenir. Dışarıda bıraktığınız platformlar için planlanmış event'ler eksik olarak raporlanmaz, tek bir bilgi bulgusunda listelenir. Etiket yöneticisi ve çerez onayı platformu istekleri her zaman gösterilir.

## Nasıl çalışır

1. **Gezinme:** Yapay zekâ modeli, sade bir dille yazılmış bir hedef ("sepete herhangi bir ürün ekle ve test ödeme yöntemiyle siparişi tamamla") ve sayfanın metin görünümünü alır. İki araçla çalışır: `browser_action` (goto, click, fill, select, scroll, wait) ve `finish`. Playwright ile her seferinde bir adım atar.
2. **Yakalama:** Bir takip uç noktasına giden her istek normalleştirilmiş isteklere ayrıştırılır ve isteği tetikleyen adımla etiketlenir. Her dataLayer gönderimi, bir başlatma betiği aracılığıyla kaydedilir; `gtag('consent', ...)` komutları da buna dahildir. Varsayılan olarak GA4, Google Ads, Meta, TikTok, Microsoft Ads, LinkedIn, Pinterest, Snapchat ve X'in toplama istekleri yerelde yanıtlanır, bu yüzden **test trafiği bu gerçek hesaplara ulaşmaz**. Diğer satıcıların etiketleri isteklerini göndermeye devam eder; zaman akışının ağ bölümü her çağrıyı ve yerelde yanıtlanıp yanıtlanmadığını gösterir.
3. **Kontrol:** Deterministik kurallar, yakalanan istekleri ölçümleme planınızla karşılaştırır. Bu bölüm yapay zekâ çağrısı gerektirmez, bu yüzden sonuçlar tekrarlanabilirdir.
4. **Açıklama:** Model bulguları, adım başına istekleri ve (isteğe bağlı olarak) GTM konteyner dışa aktarımınızı okur. Her sorun için olası nedeni ve düzeltmeyi yazar, ilgili etiket ve tetikleyicileri adlandırarak.

## Yapay zekâ sağlayıcıları

Kendi API anahtarınızı getirirsiniz. `ai-tag-debugger` her sağlayıcının resmî SDK'sını kullanır:

| Sağlayıcı | API anahtarı değişkeni | Varsayılan model |
|---|---|---|
| Anthropic (Claude) | `ANTHROPIC_API_KEY` | `claude-opus-5-5` |
| OpenAI | `OPENAI_API_KEY` | `gpt-5.5` |
| Google Gemini | `GEMINI_API_KEY` | `gemini-pro-latest` |

Sağlayıcı, ayarlı olan anahtardan seçilir (birden fazla varsa önce Anthropic). `--provider anthropic|openai|gemini` ya da ayar dosyasındaki `"provider"` ile açıkça seçebilirsiniz; başka bir model için `--model` kullanın. Gezinme, çalışmaları ucuz tutmak için düşük akıl yürütme çabası ister; açıklamalar yüksek çaba ve yapılandırılmış JSON çıktısı ister.

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

**Model seçimi hakkında bir not.** Yapay zekâ, 5 ila 30 adım boyunca araç çağırarak, her seferinde bir adım gezinir. Modeller bunu ne kadar güvenilir yaptıklarında büyük farklılık gösterir: daha küçük ve yerel modeller yanlış yere tıklayabilir, döngüye girebilir ya da erken durabilir. Kontroller model ne yaparsa yapsın doğrudur, çünkü yakalanan isteklerden gelirler; ama bitmeyen bir yolculuk, sonraki event'lerini gösteremez. Bir model zorlanıyorsa daha büyük bir model, kısa hedefli hazır bir yolculuk ya da `--max-steps` deneyin. Anthropic, OpenAI ve Gemini varsayılanları test edilmiş olanlardır.

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

Komutları görmek için `aitd --help`, her komutun seçenekleri için `aitd run --help` (ya da `plan`, `replay`, `mcp`) çalıştırın.

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

**Elektronik tablo ile içe ve dışa aktarma.** `aitd plan export <plan> --site <url>`, planın yanına `plan.xlsx` yazar: `events` sekmesinde her event parametresi için bir satır (`event, platform, parameter, required, example, trigger, description`) ve `user_properties` sekmesinde her kullanıcı özelliği için bir satır. Bunun yerine `events.csv` ve `user_properties.csv` almak için `--format csv` ekleyin; CSV ek bir paket gerektirmez. `.xlsx`, araçla birlikte isteğe bağlı bir bağımlılık olarak gelen küçük bir kütüphane, `fflate` kullanır. `aitd plan import <dosya> --site <url>` elektronik tabloyu okuyup yeni bir plan klasörü olarak kaydeder. İçe aktarma mevcut bir planı asla düzenlemez. Tanınmayan sütunlar bir uyarıyla yok sayılır; bir hata, sekmeyi, satırı ve düzeltmeyi belirtir, örneğin `events, row 7: "required" must be yes or no (found "maybe").`

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

### Plan ve site

Bir çalıştırma `--against` kullandığında rapor, `report.html` ve `report.md` dosyalarında **Plan ve site** bölümüyle başlar. Planlanan her event bir kovaya düşer:

| Kova | Anlamı |
|---|---|
| Uygulanmış | Planlandı, fire oldu, gerekli parametrelerin tümü var, değer sorunu yok |
| Eksik | Çalıştırmanın gezdiği bir yolculuk için planlandı, ama hiç fire olmadı |
| Parametre eksik | Fire oldu, ama gerekli bir parametre yok |
| Hatalı değer | Fire oldu, değer sorunu var; satın alma değeri, para birimi ve ürün kontrollerinin aynısından |
| Planda yok | Fire oldu, ama planda değil |
| Kontrol edilmedi | Planlandı, ama yolculuğu ya da platformu bu çalıştırmanın parçası değildi |

Kapsam puanı, uygulanmış olanların kontrol edilebilir planlanmış event'lere (kontrol edilmedi hariç hepsi) bölünmesiyle bulunur; genel ve platform başına gösterilir, örneğin `Kapsam 11 olaydan 7 (%64), 2 olay kontrol edilmedi`. Aynı kayıtlar `plan-check.json` dosyasında da bulunur: planlanan her event için kovasıyla birlikte bir kayıt. Çıkış kodları değişmez: `--fail-on` yine bulgu önemine bakar. `--against` olmadan rapor tam olarak eskisi gibidir.

### Klasör yapısı ve plan kimlikleri

Planlar ve çalıştırmalar, aracı çalıştırdığınız klasördeki `aitd/` içinde tutulur:

```
aitd/
  example.com/                      sitenin ana makinesi, www. olmadan
    plans/2026-10-16_0900/          measurement-plan.json, plan.html, plan.xlsx (dışa aktarımdan sonra)
    runs/2026-10-16_0912/           report.html, report.md, timeline.csv, capture.json
                                    ve plan-check.json (--against ile)
```

Bir kimlik, yerel saat `YYYY-MM-DD_HHMM` biçimindedir. O dakika zaten alınmışsa saniye eklenir (`_HHMMSS`). Hiçbir şey değiştirilmez: her taslak, içe aktarma ve çalıştırma yeni bir klasör alır. `aitd/` klasörünü başka bir yerde tutmak için `--data-dir <dir>` kullanın. `replay` ve `--save-site` klasörleri etkilenmez.

Her rapor, çalıştırmayı sitenin `runs/` içindeki bir önceki çalıştırmasıyla karşılaştıran "Son çalıştırmadan bu yana değişenler" bölümüyle açılır, örneğin `2 olay düzeldi, 1 yeni sorun`, ve her birini listeler. İki çalıştırma da `--against` kullandıysa plan kapsamı karşılaştırılır (Eksik iken Uygulanmış olan bir olay düzelmiş sayılır); aksi halde sağlık bulguları karşılaştırılır. Bir sitenin ilk çalıştırmasında karşılaştırılacak bir şey olmadığı yazar. Ayarlanacak bir bayrak yoktur. Karşılaştırma `capture.json` içinde `changes` altında da kaydedilir.

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
- **Raporu odaklı tutmak için `--events` kullanın.** Gezinmeyi kısaltmaz, bu yüzden kullanımı pek değiştirmez.
- **Yapay zekâsız tekrar oynatın.** Bir yapay zekâlı çalıştırmadan sonra adımları kaydetmek için `--save-steps <dosya>` ekleyin; sonra o ayar dosyasını her dağıtımda `--scripted --no-ai` ile çalıştırın. Bkz. [Adımları kaydedin ve yapay zekâ olmadan tekrar oynatın](#adımları-kaydedin-ve-yapay-zekâ-olmadan-tekrar-oynatın).
- **Bir sohbet uygulaması kullanın.** MCP üzerinden gezinmeyi sohbet uygulamasının kendi modeli yapar, bu yüzden hiç API anahtarı kullanılmaz.

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

`--save-steps <dosya>`, her yolculuğun attığı adımları bir ayar dosyasının `journeys[].steps` alanına yazar. Dosya yoksa oluşturur; ayar dosyasında plan yoksa çalıştırmanın planını da kaydeder. Aynı ayar dosyası yolculuğu, yapay zekâ modeli ve API anahtarı olmadan tekrarlar:

```bash
ai-tag-debugger run --site https://www.yourshop.com --journey purchase --save-steps ai-tag-debugger.config.json
ai-tag-debugger run --config ai-tag-debugger.config.json --scripted --no-ai
```

Bir yolculuk her iki görünümde de çalıştıysa yalnızca ilk görünümün adımları tutulur. Ayar dosyasını depoda tutun ve ikinci komutu her dağıtımda çalıştırarak aynı yolculuğu hiçbir model çağrısı yapmadan kontrol edin.

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
| `gtm_container` | İsteğe bağlı GTM konteyner dışa aktarımı (Yönetici → Konteyneri dışa aktar); açıklamalar etiket ve tetikleyicileri adlandırabilsin diye. |
| `viewports` | `desktop` ve/veya `mobile`. |
| `journeys` | `--journey` ile hazır yolculuk seçtiğinizde, `--goal` ile bir yolculuk tarif ettiğinizde ya da `--against` ile bir plana karşı kontrol ettiğinizde isteğe bağlıdır. |
| `journeys[].goal` | Yapay zekânın sade bir dille ne yapacağı. |
| `journeys[].start` | İsteğe bağlı başlangıç yolu (varsayılan `/`). |
| `journeys[].steps` | `--scripted` çalıştırmaları için isteğe bağlı sabit adımlar: `{ "action": "click", "selector": "#add-to-cart" }`. |
| `allowed_hosts` | Yolculukların ziyaret edebileceği başka ana makineler, örneğin barındırılan bir ödeme için `["checkout.payments-provider.com"]`. Tarayıcı aksi halde `site` ana makinesinde ve alt alan adlarında kalır. `--allow-host` ile aynıdır. |
| `providers` | Kontrol edilecek takip platformları, örneğin `["ga4", "meta"]`. Varsayılan `["ga4", "google_ads", "meta", "tiktok"]`. `--platforms` ile aynıdır. |
| `block_hits` | Varsayılan `true`. Takip isteklerinin gerçek uç noktalarınıza ulaşmasına izin vermek için `false` yapın. |
| `language` | Rapor dili, `en` (varsayılan) ya da `tr`. `--lang` ile aynıdır. |
| `keep_bodies` | Varsayılan `false`. Takip isteklerini gönderildiği gibi, kullanıcı verisi gizlenmeden saklamak için `true` yapın. `--keep-bodies` ile aynıdır. |
| `branding` | Varsayılan `true`. Analitik İşler logosunu ve "Generated by AI Tag Debugger · analitikisler.com" satırını raporlardan çıkarmak için `false` yapın. `--no-branding` ile aynıdır, ya da MCP `finish_audit` ve `run_audit` araçlarında `branding: false`. |
| `provider` | İsteğe bağlı: `anthropic`, `openai`, `gemini` ya da `openai-compatible`. `--provider` ile aynıdır. |
| `base_url`, `model` | İsteğe bağlı: API adresi ve model kimliği, örneğin `openai-compatible` için. `--base-url` ve `--model` ile aynıdır. |

## CLI

```
aitd "<cümle>" [-y]
aitd plan --site <url> [--topic <ad>] [--headed] [--provider <ad>] [--model <id>] [--max-steps <n>] [--data-dir <dir>]
aitd plan list --site <url> [--data-dir <dir>]
aitd plan import <dosya> --site <url> [--data-dir <dir>]
aitd plan export <plan> --site <url> [--format xlsx|csv] [--data-dir <dir>]
aitd run --site <url> (--against <plan> | --journey <id> | --goal "<metin>") [--config <dosya>] [--events <adlar>]
         [--max-steps <n>] [--viewport desktop|mobile] [--platforms <liste>] [--data-dir <dir>]
         [--provider anthropic|openai|gemini|openai-compatible] [--model <id>] [--lang en|tr] [--headed]
         [--fail-on broken|risk|warning|never] [--scripted] [--no-ai] [--save-site <dir>] [--save-steps <dosya>]
aitd replay <dir>... [--update] [--out <dir>]
aitd mcp [--http] [--port <n>] [--host <adres>] [--token <gizli>] [--public-url <https url>] [--reports <dir>]
         [--allow-private-network]
```

`aitd`, `ai-tag-debugger`'ın kısa bir takma adıdır ve aynı komutları ve seçenekleri kabul eder. Her komutun temel seçenekleri için `aitd <komut> --help` çalıştırın.

### Tüm seçenekler

| Seçenek | Komutlar | Anlamı |
|---|---|---|
| `--site <url>` | plan, run | Site. `plan` için zorunludur; `run` için `--against` ya da ayar dosyası siteyi vermiyorsa gereklidir. |
| `--against <plan>` | run | Bir plana karşı kontrol: `latest` (ya da `last`), `first`, bir plan kimliği ya da bir plan dosyasının ya da klasörünün yolu. |
| `--journey <id>` | run | Hazır bir yolculuk (tekrarlanabilir). |
| `--goal "<metin>"` | run | Sade bir dille bir yolculuk (tekrarlanabilir). |
| `--config <dosya>` | run | Siteyi, yolculukları ve planı bir ayar dosyasından al. |
| `--events <adlar>` | run | Yalnızca bu event'leri kontrol et, örneğin `purchase,add_to_cart`. |
| `--viewport <ad>` | run | `desktop` ya da `mobile` (tekrarlanabilir). |
| `--platforms <liste>` | run | Kontrol edilecek platformlar, örneğin `ga4,meta`. Eski adı `--providers`'ın yerine geçer; o da bir minör sürüm daha çalışır. |
| `--max-steps <n>` | plan, run | Yolculuk başına en fazla yapay zekâ adımı (`plan` için varsayılan 25). |
| `--lang <kod>` | run | Rapor dili: `en` ya da `tr`. |
| `--fail-on <düzey>` | run | Bu düzeyde çıkış kodu 1 olur: `broken` (varsayılan), `risk`, `warning` ya da `never`. |
| `--headed` | plan, run | Tarayıcı penceresini göster. |
| `--provider <ad>`, `--model <id>` | plan, run | Yapay zekâ sağlayıcısı ve modeli. Varsayılan: ayarlı olan API anahtarı. |
| `--scripted` | run | Her yolculuğun sabit adımlarını, yapay zekâ gezintisi olmadan tekrar oynat. |
| `--no-ai` | run | Hiç yapay zekâ modeli yok. `--scripted` anlamına gelir. |
| `--save-site <dir>` | run | Sitenin yanıtlarını `replay` için kaydet. |
| `--save-steps <dosya>` | run | Her yolculuğun attığı adımları bir ayar dosyasına yaz. |
| `--data-dir <dir>` | plan, run | `aitd/` klasörünün (planlar ve çalıştırmalar) tutulduğu yer. Varsayılan: `./aitd`. `run --out` yerine geçer. |
| `--format xlsx\|csv` | plan export | Elektronik tablo biçimi. Varsayılan: `xlsx`. |
| `--update` | replay | Bu tekrarın bulgularını beklenen bulgular yap. |
| `--out <dir>` | replay | Tekrar raporlarının yazılacağı yer. `run` için `--out` gizli bir takma ad olarak bir minör sürüm daha çalışır ve bir not yazdırır; `--data-dir` kullanın. |
| `--base-url <url>` | run | OpenAI uyumlu bir sağlayıcının API adresi. |
| `--allow-host <ana makine>` | run | Yolculukların ziyaret edebileceği başka bir ana makine (tekrarlanabilir). `allowed_hosts` ile aynıdır. |
| `--keep-bodies` | run | Takip isteklerini gönderildiği gibi, kullanıcı verisi gizlenmeden sakla. |
| `--no-branding` | plan, run | Logo ve kredi satırını raporlardan ve `plan.html` dosyasından çıkar. |
| `--http`, `--port`, `--host`, `--token`, `--public-url`, `--reports`, `--allow-private-network` | mcp | Aşağıdaki MCP bölümüne bakın. |

0.10.0 sürümünde kaldırıldı: `plan --from`, `plan --out` ve `plan --force`. Plan taslağı her zaman yeni bir klasör kaydeder; kaldırılmış bir bayrak ne çalıştırılacağını yazdırır.

Çıkış kodu, bulgular `--fail-on` düzeyine (varsayılan `broken`) ulaştığında `1` olur; böylece bir dağıtımı durdurabilir. Her dağıtımdan sonra çalıştırmak için [`examples/github-actions/ai-tag-debugger.yml`](examples/github-actions/ai-tag-debugger.yml) dosyasına bakın.

Çıktı:

- `report.html`: dört sekmeli tek bir dosya. Bağlantılar sekmeler arasında çalışır (bir bulgunun "Nerede" çipi o adımı açar) ve her görünümün paylaşılabilir ya da yer imine eklenebilir kendi URL'si vardır.
  - **Genel bakış**: sorun sayıları, yapay zekâ özeti (en önemli sorun önce, ve bulguların kapsamadığı kontrol edilmeye değer şeyler), yolculuklar ve sorun sayıları, kontrol edilen platformlar ve `--against` ile [Plan ve site](#plan-ve-site) kapsamı.
  - **Bulgular**: önem düzeyine göre gruplu ve filtrelenebilir. Her birinde etkisi, olası nedeni, kanıtı, numaralı düzeltme adımları ve olayın yaşandığı adımlar bulunur.
  - **Yolculuklar**: her seferinde bir yolculuk; solda adımları, sağda seçili adım. Sorunlu ilk adımda açılır. Her adımın üç sekmesi vardır:
    - **Event'ler**: her takip isteği, parametreleri, çerez onayı durumu, arkasındaki dataLayer gönderimi ve isteği ve bir bulgu buraya işaret ediyorsa bir not.
    - **dataLayer**: adımdaki her gönderim.
    - **Ağ istekleri**: seçilen platformlara giden her istek; her parametrede bir `?` ipucuyla bir parametre tablosuna çözülmüş. Toplu bir GA4 isteği, içindeki her event'i gösterir.
  - **Kapsam ve plan**: planlanan her event'in her yolculukta gönderilip gönderilmediği ve kontrol edilen ya da dışarıda bırakılan platformlar, istek sayılarıyla.

  Event'ler ve istekler kaynağa göre filtrelenebilir. GA4 ürün dizgileri (`pr1`…) ve dataLayer `ecommerce.items` ürün kartları olarak gösterilir; özel ürün parametreleri kendi grubunda yer alır. Raporda betik yoktur: sekmeler ve filtreler düz HTML ve CSS'tir (Chrome 105, Safari 15.4 ya da Firefox 121 ve sonrası gerekir) ve yazdırırken her sekme görünür. Logolar gömülüdür, bu yüzden internetten hiçbir şey yüklenmez. `--no-branding`, Analitik İşler logosunu ve kredi satırını çıkarır.
- `timeline.csv`: aynı zaman akışı, her isteğe, dataLayer gönderimine ve ağ çağrısına bir satır olarak; Excel ya da Google Sheets için hazır.
- `report.md`: raporun Markdown hali, örneğin bir çekme isteği yorumu için.
- `capture.json`: yakalanan her şey, kendi analiziniz için.
- `plan-check.json`: `--against` ile, planlanan her event için kovasıyla birlikte bir kayıt.
- `plan.html` (planın klasöründe): planın event'lerini, parametrelerini ve kullanıcı özelliklerini gösteren okunabilir bir sayfa.

Raporlar bir kredi satırıyla biter: "Generated by AI Tag Debugger · analitikisler.com"; alan adı düz bir bağlantıdır (görsel yok, takip yok ve yönlendiren bilgisi yok; böylece rapor adresleri sızdırılmaz). `--no-branding`, bunu logosuyla birlikte kaldırır.

Türkçe rapor için `--lang tr` kullanın. Bulgu metinleri, başlıklar, modelin açıklamaları ve düzeltmeleri Türkçe yazılır; ajan adımlarını da Türkçe anlatır.

## Yapay zekâ sohbet uygulamanızdan kullanın (MCP)

`aitd mcp`, bir [Model Context Protocol](https://modelcontextprotocol.io) sunucusu başlatır. Sohbet uygulamanızın modeli denetimi kendisi yürütür: "staging.myshop.com sitesinin ödeme takibini kontrol et" dersiniz, o da tarayıcıyı açar, tıklar ve bulguları sohbette açıklar. Yapay zekâ düşünmeyi uygulamanın kendi modeli yaptığı için API anahtarı gerekmez.

Sunucunun sunduğu araçlar:

| Araç | Ne yapar |
|---|---|
| `make_plan` | Bir site için takip planı çıkarır (neyin takip edilmesi gerektiği), `aitd plan --site` ile aynıdır. Yalnızca bir tür event için sınırlamak üzere `topic` verin (`custom-events`, `ecommerce`, `forms`, `consent`). Plan kaydedilir ve kimliği `finish_audit` için `against` olarak verilebilir. Sunucuyu çalıştıran bilgisayarda ayarlı yapay zekâ sağlayıcısını kullanır ve birkaç dakika sürer. |
| `start_audit` | Bir URL'de yeni bir tarayıcı açar ve tüm takibi kaydetmeye başlar. Hedefini ve beklenen event'lerini almak için hazır bir yolculuk (`purchase`, `sign_up`, …) verin; kontrol edilecek platformları seçmek için `providers` verin. Asistan önce hangi platformların kontrol edileceğini size sorar. |
| `browser_action` | Tek bir tıklama, doldurma, seçme, gitme, kaydırma ya da bekleme. Sayfayı ve o adımın gönderdiği takip isteklerini döndürür. |
| `get_page` | Geçerli sayfayı gösterir. |
| `finish_audit` | Her şeyi ölçümleme planınıza (JSON) ya da `against` olarak verilen kayıtlı bir plana (`latest`, `first`, bir plan kimliği ya da yerel bir sunucuda bir yol) ya da hazır yolculuğun event'lerine karşı kontrol eder; isterseniz yalnızca adını verdiğiniz `events` için, ve zaman akışıyla birlikte tam HTML raporunu yazar. Site denetimden alınır. |
| `run_audit` | Bir ayar dosyasını baştan sona çalıştırır. `against` ile çalıştırmayı kayıtlı bir plana karşı kontrol eder; ayar dosyasında yolculuk yoksa, plandan türetilen yolculukları gezer. Dosya yolları yalnızca yerelde çalışır. |

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
```

Depoda ayrıca bir geliştirme konteyneri (`.devcontainer/devcontainer.json`) vardır. VS Code'da Dev Containers eklentisiyle ya da GitHub Codespaces'te açın; Chromium'un sistem kütüphaneleri dahil `npm run setup`'ı sizin yerinize çalıştırır. Oradaki bir AI modelini kullanmak için anahtarınızı bir Codespaces sırrı olarak ekleyin ya da konteynerin terminalinde dışa aktarın.

Uçtan uca testler sahte model istemcileri kullanır, bu yüzden bir API anahtarı olmadan çalışır.

## Barındırılan sürüm

Barındırılan çalıştırmalar, zamanlama ve ajans panoları için [analitikisler.com](https://analitikisler.com) adresine bakın.

## Lisans

MIT © Analitik İşler
