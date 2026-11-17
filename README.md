# Takas Masası

Yahoo Fantasy NBA ligin için iki araç sunan bir web uygulaması. AI yorumu yok, yalnızca istatistik.

1. **Takas Analizi:** İki takımdan oyuncu seçersin, paketler kategori kategori karşılaştırılır:
   - maç başı ortalamalar (sezon / son 30 / 14 / 7 gün)
   - oyuncu başına z-skor (yüzdeler atış hacmiyle ağırlıklı, TO ters çevrilmiş)
   - her iki takımın kategori bazında lig sıralamasının takastan önceki ve sonraki hali
   - **görsel:** "Bu takasın görselini oluştur" düğmesi takası tek bir görselde toplar (iki tarafın verdiği, bıraktığı ve eklediği oyuncular, net değer, kategori değişimleri ve lig sırası); PNG ya da JPG olarak indirilebilir
   - **kadro dengesi:** oyuncu sayısı eşit olmayan takasta (ör. 3'e 1) fazla oyuncu alan takımın bırakması gereken oyuncular ve diğer takımda açılan yerlere eklenebilecek serbest oyuncular önerilir; seçimleri değiştirebilirsin ve hepsi net değere, kategori farklarına ve lig sıralarına dahil edilir
2. **Ya Olsaydı?:** Geçmiş bir haftayı yeniden oynatır.
   - **Başka rakip:** o haftaki istatistiklerinle ligdeki her takıma karşı skorun; rakibi seçip ayrıntıya bakabilirsin.
     "Tüm haftaların görselini oluştur" düğmesi, seçili takımın her hafta her rakibe karşı skorunu tek bir görselde (2160 piksel genişlik) toplar; PNG ya da JPG olarak indirip ya da kopyalayıp paylaşabilirsin.
   - **Günlük diziliş:** ızgarada bir hücreye tıklayarak bir oyuncuyu tek bir gün için oynat ya da oynatma ("son gün onu oynatmasaydım").
   - **Oyuncu değiştir:** çıkan oyuncunun aktif olduğu günlerde yerine gelenin o günkü istatistiği sayılır; rakibin oyuncusuysa ters değişim de uygulanabilir.
   - Senaryo aktif kadro sayısını aşarsa uyarır (pozisyon uygunluğu kontrol edilmez).
3. **Güç Sıralaması:** %45 "herkese karşı" kategori oranı (her hafta ligdeki herkesle oynasaydın), %25 son 2 haftanın formu, %30 bugünkü kadro gücü. Ayrıca fikstür şansı ve haftalık değişim.
4. **Puan Durumu:** Aynı sezonun dört formatta sıralaması: H2H Kategori (ligin gerçek formatı), H2H Tek Galibiyet, Rotisserie (sezon toplamlarıyla her kategoride tüm lig sıralanır, birinci N puan alır) ve Puan ligi (Yahoo'nun varsayılan puan değerleriyle).
5. **Draft:** Her seçimin bugüne kadarki değeri, takımların draft sıralaması, en iyi ve en kötü seçimler.
6. **Transferler:** Serbest oyuncu eklemelerinin ve takasların, oyuncunun yeni takımında aktif oynadığı maçlarda ürettiği değere göre sıralaması.

Draft ve Transferler tek bir ölçü kullanır: **değer** = oyuncunun maç başı z-skoru eksi "yedek seviyesi" (en iyi 20 serbest oyuncunun ortalaması), oynadığı maçlarla çarpılır.

## Çalıştırma

Bir kez kurulum (Python 3.11+ ve Node 20+ gerekir):

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd web && npm install && npm run build && cd ..
```

Sonra uygulamayı başlat:

```bash
.venv/bin/uvicorn backend.app:app --reload
```

http://127.0.0.1:8000 adresini aç. Henüz veri yoksa uygulama **demo verisiyle** açılır (hayali bir 10 takımlı 9-cat lig).

Arayüz `web/` klasöründe (Vite + Preact + TypeScript) ve `npm run build` ile `web/dist` içine derlenir; FastAPI bu derlemeyi sunar. Arayüzde değişiklik yaparken `cd web && npm run dev` komutu http://localhost:5173 adresinde anında yenilenen bir geliştirme sunucusu açar (API istekleri 8000'deki uygulamaya yönlenir). Arayüzü ilk kez derlediysen ya da derleme klasörü yeni oluştuysa `uvicorn`'u yeniden başlat.

## Kendi ligini bağlama: Chrome eklentisi (önerilen)

Başvuru, API anahtarı ya da şifre gerekmez. Eklenti, Yahoo'ya giriş yapmış olduğun tarayıcıda zaten görebildiğin sayfaları okur (yalnızca okur, hiçbir şeye tıklamaz) ve veriyi bilgisayarında çalışan uygulamaya gönderir.

1. Chrome'da `chrome://extensions` adresini aç, sağ üstten **Geliştirici modu**nu aç.
2. **Paketlenmemiş öğe yükle** → bu projedeki `extension/` klasörünü seç.
3. Uygulamayı çalıştır (yukarıdaki `uvicorn` komutu).
4. Chrome'da Yahoo'daki ligini aç (ör. `basketball.fantasysports.yahoo.com/nba/56909`), eklenti simgesine tıkla → **Senkronize et**.
5. Bitince uygulamayı yenile.

İlk senkron bütün haftaları okur (her gün × her takım için bir sayfa, sayfalar arasında 1–2 saniye bekleyerek) ve 6–8 dakika sürer. Eklenti penceresini kapatabilirsin, senkron arka planda sürer; yalnızca Yahoo sekmesini kapatma.

Sonraki senkronlar yalnızca eksik olanı okur:
- Bitmiş haftalar (bitişinin üzerinden 2 günden fazla geçmiş, tüm günleri kayıtlı) hiç okunmaz.
- Kayıtlı günler atlanır; yalnızca son 2 gün yeniden okunur (Yahoo istatistik düzeltmeleri için).
- Kadrolar ve ortalamalar en fazla 6 saatte bir yenilenir; hemen yenilemek için penceredeki kutuyu işaretle.

Yahoo çok sık istek görürse geçici hız sınırı koyar (HTTP 999). Eklenti bu durumda birkaç dakika bekleyip kaldığı yerden kendiliğinden devam eder. Veri `data/league.json` dosyasında durur; `.venv/bin/python -m backend.validate` komutu kayıtlı haftaları Yahoo'nun resmi skorlarıyla karşılaştırır.

Notlar:
- Okunanlar: lig ayarları, takımlar ve takım logolarının adresleri (logoları uygulama Yahoo'nun görsel sunucusundan bir kez indirip `data/logos/` içinde saklar), güncel dizilişler (takım başına 1 sayfa), draft sonuçları, transfer geçmişi, ligdeki ilk 300 oyuncunun sezon ortalamaları (günde bir), güncel kadrolar, sezon / son 30 / 14 / 7 gün ortalamaları, her günün aktif/yedek dizilişi ve kutu skorları, haftalık eşleşmeler ve Yahoo'nun resmi haftalık toplamları. Ya Olsaydı? sekmesi kendi hesapladığı skoru resmi skorla karşılaştırır.
- Bu yöntem Yahoo'nun sayfa yapısına bağlı. Yahoo tasarımı değiştirirse eklentinin güncellenmesi gerekir.
- Otomatik sayfa okumak Yahoo'nun kullanım koşullarında gri bir alanda. Eklenti yalnızca kendi ligini, yavaş ve elle başlatıldığında okur.
- Serbest oyuncuların yalnızca sezon ortalamaları var, günlük istatistikleri yok. Ya Olsaydı? sekmesinde yalnızca o gün herhangi bir takımın kadrosunda olan oyuncular kullanılabilir.
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
| `backend/rankings.py` | Güç sıralaması ve farklı formatlarda puan durumu |
| `backend/analysis.py` | Draft ve transfer değerlendirmesi |
| `backend/imported.py` | Eklentiden gelen veriyi saklar ve uygulamaya sunar |
| `backend/yahoo.py` | Yahoo Fantasy API istemcisi (OAuth2, XML ayrıştırma, cache) |
| `backend/demo.py` | Demo lig ve sahte günlük kutu skorları |
| `backend/app.py` | FastAPI uç noktaları + statik arayüz |
| `web/src/tabs/` | Arayüz: her sekme ayrı bir Preact bileşeni (TypeScript) |
| `web/src/share.ts` | Paylaşılabilir görseli çizen canvas kodu |
| `web/src/types.ts` | API yanıtlarının tipleri |
| `tests/` | Testler (`.venv/bin/python -m pytest`) |

## Bilinen sınırlar

- Yahoo API istemcisi (`backend/yahoo.py`) API dokümantasyonuna göre yazıldı, ancak gerçek bir lig üzerinde henüz test edilmedi.
- Takas sonrası takım gücü, kadrodaki oyuncuların maç başı ortalamalarının toplamıyla hesaplanıyor. Haftalık maç sayısı ve oynama süresinin yeniden dağılımı hesaba katılmıyor. Kadro sınırı IL yuvaları hariç sayılır; gelen oyuncunun IL'e konabileceği durumlar dikkate alınmaz.
- Ya Olsaydı? tekrarı haftalık kadroyu Yahoo'dan gün gün çeker. Puan skoru, Yahoo'nun sonradan yaptığı istatistik düzeltmeleri yüzünden resmi skordan biraz farklı çıkabilir.
- Son 7, 14 ve 30 günlük ortalamalar günlük istatistiklerden toplanır. İlk çalıştırmada çok sayıda istek atılır, sonraki çalıştırmalarda cache'ten gelir.
