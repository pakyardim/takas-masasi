# Takas Masası

Yahoo Fantasy NBA ligin için iki araç sunan bir web uygulaması. AI yorumu yok, yalnızca istatistik.

1. **Takas Analizi:** İki takımdan oyuncu seçersin, paketler kategori kategori karşılaştırılır:
   - maç başı ortalamalar (sezon / son 30 / 14 / 7 gün)
   - oyuncu başına z-skor (yüzdeler atış hacmiyle ağırlıklı, TO ters çevrilmiş)
   - her iki takımın kategori bazında lig sıralamasının takastan önceki ve sonraki hali
   - 2'ye 1 gibi takaslarda kadro yeri uyarısı
2. **Ya Olsaydı?:** Geçmiş bir haftayı yeniden oynatır. "X yerine Y oynasaydı kazanır mıydım?"
   - Çıkan oyuncunun **aktif kadroda olduğu günlerde**, yerine gelen oyuncunun **o günkü** istatistiği sayılır.
   - Yerine gelen aynı takımın yedeğiyse ikisinin yeri değişir (bench kararlarını test etmek için).
   - Rakibin oyuncusunu seçersen, istersen ters değişim rakibe de uygulanır (o hafta takas yapılmış gibi).
   - Serbest oyuncu ya da başka bir takımın oyuncusu da seçilebilir.

## Çalıştırma

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn backend.app:app --reload
```

Sonra http://127.0.0.1:8000 adresini aç. Henüz veri yoksa uygulama **demo verisiyle** açılır (hayali bir 10 takımlı 9-cat lig).

## Kendi ligini bağlama: Chrome eklentisi (önerilen)

Başvuru, API anahtarı ya da şifre gerekmez. Eklenti, Yahoo'ya giriş yapmış olduğun tarayıcıda zaten görebildiğin sayfaları okur (yalnızca okur, hiçbir şeye tıklamaz) ve veriyi bilgisayarında çalışan uygulamaya gönderir.

1. Chrome'da `chrome://extensions` adresini aç, sağ üstten **Geliştirici modu**nu aç.
2. **Paketlenmemiş öğe yükle** → bu projedeki `extension/` klasörünü seç.
3. Uygulamayı çalıştır (yukarıdaki `uvicorn` komutu).
4. Chrome'da Yahoo'daki ligini aç (ör. `basketball.fantasysports.yahoo.com/nba/56909`), eklenti simgesine tıkla → **Senkronize et**.
5. Bitince uygulamayı yenile.

İlk senkron bütün haftaları okur: her gün × her takım için bir sayfa, sayfalar arasında kısa bekleme ile. Birkaç dakika sürer, bu sırada açılan pencere açık kalmalı. Sonraki senkronlar yalnızca yeni günleri (ve düzeltmeler için son 2 günü) okur. Veri `data/league.json` dosyasında durur.

Notlar:
- Okunanlar: lig ayarları, takımlar, güncel kadrolar, sezon / son 30 / 14 / 7 gün ortalamaları, her günün aktif/yedek dizilişi ve kutu skorları, haftalık eşleşmeler ve Yahoo'nun resmi haftalık toplamları. Ya Olsaydı? sekmesi kendi hesapladığı skoru resmi skorla karşılaştırır.
- Bu yöntem Yahoo'nun sayfa yapısına bağlı. Yahoo tasarımı değiştirirse eklentinin güncellenmesi gerekir.
- Otomatik sayfa okumak Yahoo'nun kullanım koşullarında gri bir alanda. Eklenti yalnızca kendi ligini, yavaş ve elle başlatıldığında okur.
- Ya Olsaydı? için serbest oyuncuların günlük istatistikleri yok; yalnızca o gün herhangi bir takımın kadrosunda olan oyuncular kullanılabilir.
- Şimdilik yalnızca kategori ligleri (H2H Categories) destekleniyor.

## Alternatif: Yahoo API (geliştirici uygulaması gerekir)

1. https://developer.yahoo.com/apps/create/ adresinde bir uygulama oluştur
   - API Permissions: **Fantasy Sports → Read**
   - Redirect URI: `oob` kabul edilmezse `https://localhost:8000` gibi bir adres gir ve aynısını `.env` içindeki `YAHOO_REDIRECT_URI` alanına yaz
2. `.env.example` dosyasını `.env` olarak kopyala, Client ID, Client Secret ve lig numarasını doldur.
3. Bir kez giriş yap:
   ```bash
   .venv/bin/python -m backend.auth_cli
   ```
   Tarayıcıda izin ver ve Yahoo'nun verdiği kodu terminale yapıştır. (Redirect URI bir https adresiyse sayfa açılmaz; bu normal. Adres çubuğundaki `code=` değerini kopyala.)
4. Sunucuyu yeniden başlat.

Token `.yahoo_tokens.json` dosyasında saklanır ve otomatik yenilenir. Yahoo yanıtları `.cache/` klasöründe tutulur; geçmiş günlerin istatistikleri değişmediği için bunlar kalıcı olarak cache'lenir.

## Yapı

| Dosya | Görevi |
|---|---|
| `backend/engine.py` | Saf hesaplama: kategori karşılaştırma, z-skor, takas etkisi, hafta tekrarı |
| `extension/` | Chrome eklentisi: Yahoo sayfalarını okur, uygulamaya gönderir |
| `backend/imported.py` | Eklentiden gelen veriyi saklar ve uygulamaya sunar |
| `backend/yahoo.py` | Yahoo Fantasy API istemcisi (OAuth2, XML ayrıştırma, cache) |
| `backend/demo.py` | Demo lig ve sahte günlük kutu skorları |
| `backend/app.py` | FastAPI uç noktaları + statik arayüz |
| `frontend/` | Derleme gerektirmeyen HTML/CSS/JS arayüz |
| `tests/` | Testler (`.venv/bin/python -m pytest`) |

## Bilinen sınırlar

- Yahoo API istemcisi (`backend/yahoo.py`) API dokümantasyonuna göre yazıldı, ancak gerçek bir lig üzerinde henüz test edilmedi.
- Takas sonrası takım gücü, kadrodaki oyuncuların maç başı ortalamalarının toplamıyla hesaplanıyor. Haftalık maç sayısı, oynama süresinin yeniden dağılımı ve boşalan kadro yerine eklenecek oyuncu hesaba katılmıyor.
- Ya Olsaydı? tekrarı haftalık kadroyu Yahoo'dan gün gün çeker. Puan skoru, Yahoo'nun sonradan yaptığı istatistik düzeltmeleri yüzünden resmi skordan biraz farklı çıkabilir.
- Son 7, 14 ve 30 günlük ortalamalar günlük istatistiklerden toplanır. İlk çalıştırmada çok sayıda istek atılır, sonraki çalıştırmalarda cache'ten gelir.
