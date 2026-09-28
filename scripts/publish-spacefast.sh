#!/usr/bin/env bash
# Publishes the CEO Owl SpaceFast migration to a preview space.
#
# Builds the standalone SPA (vite.spa.config.ts), renames spa.html to
# index.html, and publishes it with the Functions backend. SPA routes are
# rewritten to /index.html via _redirects. Static files (llms.txt,
# sitemap.xml, carbon.txt, robots.txt, og-image.png, logo.png, favicon.png)
# are copied from public/.
#
# Usage: ./scripts/publish-spacefast.sh [space-slug] [message]
set -euo pipefail

SPACE="${1:-ceo-owl-preview}"
MESSAGE="${2:-preview publish}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)/sf-publish"

cd "$ROOT"
bun x vite build --config vite.spa.config.ts

rm -rf "$OUT"
mkdir -p "$OUT"
cp -a dist-spa/. "$OUT/"
mv "$OUT/spa.html" "$OUT/index.html"
cp -a functions sf.jsonc "$OUT/"

# Static files served from the site root.
for f in llms.txt sitemap.xml carbon.txt robots.txt og-image.png logo.png favicon.png favicon.ico; do
  if [ -f "public/$f" ]; then
    cp "public/$f" "$OUT/$f"
  fi
done

# SPA fallback: serve index.html for client-side routes.
cat > "$OUT/_redirects" <<'EOF'
/ /index.html 200
/editor /index.html 200
/connect /index.html 200
/auth /index.html 200
/docs /index.html 200
/licenses /index.html 200
/privacy /index.html 200
/terms /index.html 200
/health /index.html 200
EOF

sf publish "$OUT" --space "$SPACE" -m "$MESSAGE" -y --wait
