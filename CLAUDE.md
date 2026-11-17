# Takas Masası: proje kuralları

Yahoo Fantasy NBA ligi için istatistik sitesi. Arayüz Türkçe. Ayrıntılar `README.md` dosyasında.

## Yeni sayfa kuralı (zorunlu)

Her yeni sayfa ve her yeni kart ya da tablo bölümü, **görsel çıkarma seçeneği** içermek zorunda.

1. Sayfa başlığını `PageHead` ile yaz ve düğmeyi çocuğu olarak ekle:
   ```tsx
   <PageHead title="..." sub="...">
     {r?.available && <PosterButton name="sayfa-adi" make={() => xPoster(r)} />}
   </PageHead>
   ```
2. `web/src/posters.ts` içine `xPoster(...)` fonksiyonunu ekle. Görsel, `drawPoster` ile çizilir; içinde sayfanın asıl sayıları olmalı, sadece başlık değil. Bkz. `injuriesPoster`, `powerPoster`.
3. Görsel, sayfa verisi yüklenmeden önce ya da veri yokken çalışmamalı; düğme yalnızca veri varken görünür.
4. Bir kart ya da bölüm sayfada çok küçük bir ayrıntıysa, o bölümü kapsayan sayfanın görseline ekle. Yeni bir sayfa oluştururken görsel yoksa bunu kullanıcıya açıkça söyle.

Mevcut görseller: takas (Takas Analizi), herkese karşı (Ya Olsaydı?), senaryo (Ya Olsaydı?), güç sıralaması, puan durumu, draft, transfer, sakatlıklar.

## Veri ve gizlilik

- `data/` klasörü repoda değil (`.gitignore`). Lig verisi yalnızca `scripts/publish.sh` ile yayınlanır.
- Yayınlanan sitede menajer adları ve logolar vardır; test verisi eklerken gerçek veri kullanma, küçük uydurma lig kullan (`web/tests/fixtures/`).

## Ürün ilkeleri

- Uygulama yalnızca istatistik gösterir. Yapay zekâ yorumu, tahmin, kazanma olasılığı ya da "şunu al" tipi öneri eklenmez. Sebebi: tahmin rakibe karşı hamle planlamayı kolaylaştırır.
- Hesaplama tarayıcıda yapılır (`web/src/engine/`). Sunucu yoktur.

## Kontroller (commit öncesi)

```bash
cd web && npx tsc --noEmit && npx vitest run && npm run build
cd .. && .venv/bin/python -m pytest -q tests
```

## Kod

- Türkçe arayüz metinleri; kod adları ve yorumlar Türkçe ya da İngilizce olabilir, tutarlı olsun.
- Her commit mesajında Co-Authored-By satırı olsun (Claude Code'un önerdiği biçimde).
