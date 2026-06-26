#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$root/docs"
cp "$root/ui/index.html" "$root/ui/reel.html" "$root/ui/config.example.js" "$root/ui/.nojekyll" "$root/docs/"

# docs/config.js is owned by the Pages deploy workflow (bakes from repo secrets).
# Only seed it if it's missing so local checkouts still load.
if [[ ! -f "$root/docs/config.js" ]]; then
  cp "$root/ui/config.example.js" "$root/docs/config.js"
fi

echo "Synced ui/ -> docs/ (config.js preserved)"
