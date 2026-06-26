#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

cookie_env_name=""
for candidate in YTDLP_COOKIES_BASE64 YOUTUBE_COOKIES_BASE64 YTDLP_COOKIES_TEXT YOUTUBE_COOKIES_TEXT; do
  if [[ -n "${!candidate:-}" ]]; then
    cookie_env_name="$candidate"
    break
  fi
done

if [[ -z "$cookie_env_name" ]]; then
  cat >&2 <<'EOF'
No cookie secret is visible in this shell.

Set one of these env vars before running the stack:
  YTDLP_COOKIES_BASE64
  YOUTUBE_COOKIES_BASE64
  YTDLP_COOKIES_TEXT
  YOUTUBE_COOKIES_TEXT

For Codespaces secrets added after the codespace started, restart/rebuild the codespace,
or export the value manually in this terminal.
EOF
  exit 1
fi

echo "Using cookie env: $cookie_env_name"

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "docker compose (v2) or docker-compose (v1) is required" >&2
  exit 1
fi

"${COMPOSE[@]}" build backend
exec "${COMPOSE[@]}" up --remove-orphans
