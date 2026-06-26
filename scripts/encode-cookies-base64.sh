#!/usr/bin/env bash
set -euo pipefail

cookie_file="${1:-cookies.txt}"

if [[ ! -f "$cookie_file" ]]; then
  echo "Cookie file not found: $cookie_file" >&2
  echo "Usage: $0 path/to/cookies.txt" >&2
  exit 1
fi

if ! grep -Eq '(^# Netscape HTTP Cookie File|^[^#[:space:]][^[:space:]]+[[:space:]]+TRUE|^[^#[:space:]][^[:space:]]+[[:space:]]+FALSE)' "$cookie_file"; then
  echo "Warning: $cookie_file does not look like a Netscape cookies.txt export." >&2
fi

if base64 --help 2>/dev/null | grep -q -- '-w'; then
  base64 -w0 "$cookie_file"
else
  base64 < "$cookie_file" | tr -d '\n'
fi
printf '\n'
