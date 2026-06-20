#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$root/docs"
cp "$root/ui/index.html" "$root/ui/config.js" "$root/ui/config.example.js" "$root/ui/.nojekyll" "$root/docs/"

echo "Synced ui/ -> docs/"
