#!/usr/bin/env bash
# Yayınla: siteyi derler, son senkronize edilen lig verisini içine koyar ve
# Cloudflare Pages'e doğrudan yükler. Lig verisi repoya girmez.
#
# İlk çalıştırmada:
#   - Cloudflare'e giriş ister (tarayıcı açılır),
#   - proje adını sorar ve projeyi oluşturur. Site adresi <proje-adı>.pages.dev olur.
# Proje adı .publish-project dosyasında saklanır (repoya girmez).
set -euo pipefail
cd "$(dirname "$0")/.."
WRANGLER="npx --yes wrangler@4"

[ -f data/league.json ] || { echo "data/league.json yok. Önce eklentiyle senkronize et."; exit 1; }

if [ ! -f .publish-project ]; then
  echo "Site adresi <proje-adı>.pages.dev olacak. Yalnızca küçük harf, rakam ve tire kullan."
  echo "Bağlantıyı bilen herkes siteyi görebilir; tahmin edilmesi zor bir ad seç (ör. okkesi-lig-7f3k)."
  read -r -p "Proje adı: " name
  [[ "$name" =~ ^[a-z0-9][a-z0-9-]{1,56}[a-z0-9]$ ]] || { echo "Geçersiz ad."; exit 1; }
  # proje zaten varsa bu adım hata verir; o durumda var olan projeye yüklenir
  $WRANGLER pages project create "$name" --production-branch main || echo "(Proje oluşturulamadı ya da zaten var; yüklemeye devam ediliyor.)"
  echo "$name" > .publish-project
fi
PROJECT="$(cat .publish-project)"

echo "Site derleniyor…"
(cd web && npm run --silent build:site)

echo "Cloudflare Pages'e yükleniyor: $PROJECT"
$WRANGLER pages deploy web/dist --project-name "$PROJECT" --branch main --commit-dirty=true

echo
echo "Yayında: https://$PROJECT.pages.dev"
