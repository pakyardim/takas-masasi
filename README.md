# Takas Masası

Yahoo Fantasy NBA ligin için istatistik araçları. AI yorumu yok, yalnızca hesap.

Uygulama **statik bir site**: lig verisini tek bir dosyadan (`data/league.json`) okur ve bütün hesaplamaları tarayıcıda yapar. Sunucu gerekmez.

## Sekmeler

1. **Takas Analizi:** İki takımdan oyuncu seçersin, paketler kategori kategori karşılaştırılır.
   - maç başı ortalamalar (sezon / son 30 / 14 / 7 gün), oyuncu başına z-skor
   - her iki takımın kategori bazında lig sırasının takastan önceki ve sonraki hali
   - **kadro dengesi:** oyuncu sayısı eşit olmayan takasta bırakılması gereken oyuncular ve açılan yerlere eklenebilecek serbest oyuncular önerilir; seçimleri değiştirebilirsin
2. **Ya Olsaydı?:** Geçmiş bir haftayı yeniden oynatır.
   - **Başka rakip:** o haftaki istatistiklerinle ligdeki her takıma karşı skorun
   - **Günlük diziliş:** bir oyuncuyu tek bir gün için oynat ya da oynatma
   - **Oyuncu değiştir:** çıkan oyuncunun aktif olduğu günlerde yerine gelenin o günkü istatistiği sayılır
3. **Güç Sıralaması:** %45 "herkese karşı" kategori oranı, %25 son 2 haftanın formu, %30 bugünkü kadro gücü; fikstür şansı ve haftalık değişim.
4. **Puan Durumu:** Aynı sezonun dört formatta sıralaması: H2H Kategori (gerçek), H2H Tek Galibiyet, Rotisserie ve Puan ligi.
5. **Draft:** Her seçimin bugüne kadarki değeri, takımların draft sıralaması.
6. **Transferler:** Serbest oyuncu eklemelerinin ve takasların, oyuncunun yeni takımında ürettiği değere göre sıralaması.

Her sekmede bir **görsel oluştur** düğmesi var: o sayfadaki sonucu paylaşılabilir tek bir görsele çevirir (PNG / JPG / panoya kopyala).

Sağ üstteki **Takımım** seçimi, uygulamanın kimi "sen" sayacağını belirler; her ziyaretçi kendi takımını seçer ve seçim o tarayıcıda hatırlanır.

Draft ve Transferler tek bir ölçü kullanır: **değer** = oyuncunun maç başı z-skoru eksi "yedek seviyesi" (en iyi 20 serbest oyuncunun ortalaması), oynadığı maçlarla çarpılır.

## Nasıl çalışıyor

```
Chrome eklentisi ──► yerel senkron uygulaması ──► data/league.json ──► statik site
(Yahoo sayfalarını      (Python, yalnızca senin        (+ data/logos)      (hesap tarayıcıda)
 senin oturumunla okur)  bilgisayarında)
```

- **Eklenti** (`extension/`): Yahoo'ya giriş yapmış olduğun Chrome'da lig sayfalarını okur (yalnızca okur) ve veriyi bilgisayarındaki senkron uygulamasına gönderir.
- **Senkron uygulaması** (`backend/`): Gelen veriyi `data/league.json` içinde birleştirir, takım logolarını indirir. Başka bir şey yapmaz.
- **Site** (`web/`): Vite + Preact + TypeScript. Hesaplama motoru `web/src/engine/` altında.

## Kurulum (bir kez)

Python 3.11+ ve Node 20+ gerekir.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd web && npm install && npm run build && cd ..
```

Eklenti: Chrome'da `chrome://extensions` → **Geliştirici modu** → **Paketlenmemiş öğe yükle** → `extension/` klasörü.

## Veriyi güncelleme

1. Senkron uygulamasını başlat:
   ```bash
   .venv/bin/uvicorn backend.app:app
   ```
2. Chrome'da Yahoo'daki ligini aç, eklenti simgesine tıkla → **Senkronize et**.
3. http://127.0.0.1:8000 adresinde güncel veriyle siteye bakabilirsin.

İlk senkron bütün sezonu okur (6–8 dakika). Sonrakiler yalnızca eksik olanı okur: bitmiş haftalar ve kayıtlı günler atlanır, son 2 gün yeniden okunur, kadrolar ve ortalamalar en fazla 6 saatte bir yenilenir. Yahoo geçici hız sınırı koyarsa (HTTP 999) eklenti birkaç dakika bekleyip kaldığı yerden devam eder.

## Yayına alma (Cloudflare Pages)

Site statik olduğu için sunucu gerekmez. Yayınlamak tek komut:

```bash
scripts/publish.sh
```

Komut siteyi derler, `data/` klasöründeki lig verisini ve logoları içine koyar ve Cloudflare Pages'e doğrudan yükler. **Lig verisi repoya girmez.**

İlk çalıştırmada:
1. Ücretsiz bir Cloudflare hesabın olmalı (https://dash.cloudflare.com/sign-up).
2. Komut tarayıcıda Cloudflare girişi ister ve izin onayı alır.
3. Bir proje adı sorar. Site adresi `<proje-adı>.pages.dev` olur; ad `.publish-project` dosyasında saklanır (repoya girmez).

Sonraki güncellemeler: eklentiyle senkronize et, sonra `scripts/publish.sh`.

Kimler görebilir:
- Site, bağlantıyı bilen herkese açıktır. Tahmin edilmesi zor bir proje adı seçip bağlantıyı yalnızca gruba atmak en basit yoldur.
- Gerçek bir giriş kapısı istersen Cloudflare Zero Trust → Access altında, alan adı `<proje-adı>.pages.dev` olan bir "self-hosted" uygulama tanımlayıp izin verilen e-postaları listeleyebilirsin.

Not: Bu yöntemle oluşturulan proje "Direct Upload" türündedir ve sonradan Git bağlantısına çevrilemez. Git ile otomatik derleme istersen ayrı bir proje açıp derleme komutu olarak `cd web && npm ci && npm run build:site`, çıktı klasörü olarak `web/dist` verirsin; o durumda `data/` klasörünün repoda olması gerekir.

## Sık yapılacaklar (özet)

**Yeni veri çekmek (sync) ve yayınlamak:**
1. Chrome'da eklentinin sürümü 0.8.0 olsun (`chrome://extensions`, ↻ ile yeniden yükle).
2. Proje klasöründe senkron uygulamasını başlat: `.venv/bin/uvicorn backend.app:app` (açık kalmalı).
3. Yahoo lig sayfasını aç, eklentiye tıkla → **Senkronize et**. İlk seferde 6–8 dk, sonra kısa sürer. "Tamam" mesajını bekle.
4. İstersen http://127.0.0.1:8000 adresinden kontrol et.
5. `scripts/publish.sh` ile yayınla. Canlı adres: https://okkesi-koruma-ve-yasatma-ligi.pages.dev

**Sakatlık takibi için (sürüm 0.9.0):**
- Eklentiyi güncelledikten sonra bir kez **"Her şeyi baştan oku (sakatlık durumları ve geçen sezon için)"** kutusunu işaretleyip senkronla. Bu, geçmiş günlerdeki sakatlık durumlarını da okur (yaklaşık 8–10 dk). Bu seferden sonrası normal senkronla yetişir.
- Geçen sezonun oyuncu ortalamaları da bu sırada bir kez çekilir. Sakatlık sayfasında bir oyuncunun bu sezonki maçı 10'dan azsa, kaybettiği değer geçen sezonun ortalamasıyla hesaplanır.

**Kod değiştirdikten sonra:** GitHub'a push etmek siteyi güncellemez. Değişikliğin yayında görünmesi için `scripts/publish.sh` çalıştırılır (veri senkronlanmamış olsa bile aynı komut yeterli).

**Açık kararlar:**
- Yahoo Product Sans fontu kullanılmıyor (Yahoo'nun tescilli fontu; herkese açık sitede dağıtılması izin gerektirir). Yerine Inter ya da Figtree gibi açık lisanslı bir font konulabilir. Henüz yapılmadı.
- Yahoo'nun sakatlık bayrakları ("O", "Q") artık günlük olarak kaydediliyor; yalnızca "O" ve IL slotundakiler sakat sayılıyor.
- Otomatik yayın (GitHub'a push'ta siteyi kendiliğinden güncelleme) için lig verisinin GitHub dışında bir yerde (ör. Cloudflare R2) tutulması gerekir. Henüz kurulmadı; şimdilik elle yayınlanıyor.

**Mobil:** 375 px genişlikte kontrol edildi; yatay kayma yok. Geniş tablolar kendi kutusu içinde kayar.

## Neden AI yorumu, tavsiye veya tahmin yok?

- **Amaç istatistik karşılaştırmasıydı.** Uygulama "şunu yap" demez; sayıları ve farkları gösterir. Karar kullanıcıya aittir.
- **Tahmin ve öneri, hile riskini artırır.** Bir eşleşmenin kazanma olasılığını ya da hangi oyuncunun ekleneceğini hesaplamak, yalnızca bir rakibin kadrosuna ve diğer takımların zayıf noktalarına göre hamle yapmayı kolaylaştırır. Bu yüzden Tahmin sekmesi kaldırıldı.
- **AI yorumu sayıları değiştirebilir.** Dil modeli istatistik hesaplamakta ve karşılaştırmakta hata yapabilir; bu uygulamada sayılar koddan çıkar ve gerçek veriyle Yahoo'nun resmi skorlarına karşı kontrol edilir.
- **Yorum, veri kadar kısıtlı olmalı.** Ya Olsaydı?, takas ve sıralamalar kendi başına bir yorum içermez; kullanıcı kendi değerlendirmesini yapar.

## Geliştirme

```bash
cd web
npm run dev        # http://localhost:5173, veriyi 8000'deki senkron uygulamasından alır
npm test           # motor testleri (vitest)
npm run build      # tip kontrolü + derleme
```

```bash
.venv/bin/python -m pytest      # senkron uygulamasının testleri
```

| Yol | Görevi |
|---|---|
| `web/src/engine/core.ts` | Saf hesaplama: kategori karşılaştırma, z-skor, takas etkisi, hafta tekrarı |
| `web/src/engine/data.ts` | Lig dosyasına erişim |
| `web/src/engine/analysis.ts`, `rankings.ts` | Draft/transfer değerleri, güç sıralaması, puan durumu |
| `web/src/engine/api.ts` | Sekmelerin kullandığı sorgular |
| `web/src/tabs/` | Her sekme ayrı bir bileşen |
| `web/src/share.ts`, `poster.ts`, `posters.ts` | Paylaşılabilir görseller |
| `web/tests/` | Motor testleri; `fixtures/small-league.json` uydurma küçük bir lig ve beklenen sonuçları |
| `backend/imported.py`, `backend/app.py` | Senkron alıcısı ve veri dosyası |
| `extension/` | Chrome eklentisi |

Motor ilk olarak Python'da yazılmıştı; TypeScript'e taşınırken gerçek lig verisindeki 72 sorgunun sonucu eski Python sonuçlarıyla birebir karşılaştırıldı. `web/tests/golden.test.ts` bu karşılaştırmayı yapar (kayıt özel veri içerdiği için repoda değildir).

## Bilinen sınırlar

- Yalnızca kategori ligleri (H2H Categories) desteklenir; yalnızca 9 kategorili bir ligde denendi.
- Eklenti Yahoo'nun sayfa yapısına ve İngilizce arayüzüne bağlıdır; Yahoo tasarımı değiştirirse güncellenmesi gerekir. Otomatik sayfa okumak Yahoo'nun kullanım koşullarında gri bir alandadır; eklenti yalnızca kendi ligini, yavaş ve elle başlatıldığında okur.
- Serbest oyuncuların yalnızca sezon ortalamaları vardır. Ya Olsaydı? sekmesinde yalnızca o gün bir takımın kadrosunda olan oyuncular kullanılabilir.
- Takas sonrası takım gücü, kadrodaki oyuncuların maç başı ortalamalarının toplamıdır; haftalık maç sayısı ve oynama süresinin yeniden dağılımı hesaba katılmaz.
- Eski haftalarda Yahoo'nun resmi toplamlarıyla 1–2'lik istatistik farkları olabilir (skoru değiştirmez).
