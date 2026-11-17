#!/usr/bin/env bash
# Yayınla: son senkronize edilen lig verisini repoya ekler ve gönderir.
# Barındırma servisi her gönderimde siteyi yeniden derler
# (derleme: cd web && npm ci && npm run build:site, çıktı klasörü: web/dist).
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f data/league.json ] || { echo "data/league.json yok. Önce eklentiyle senkronize et."; exit 1; }

# data/ .gitignore'da durur (yanlışlıkla eklenmesin diye); burada bilerek ekleniyor
git add -f data/league.json
[ -d data/logos ] && git add -f data/logos
if git diff --cached --quiet -- data; then
  echo "Veri değişmemiş; yayınlanacak yeni bir şey yok."
  exit 0
fi
git commit -q -m "Lig verisi: $(date '+%Y-%m-%d %H:%M')" -- data
git push -q
echo "Gönderildi. Site birkaç dakika içinde güncellenir."
