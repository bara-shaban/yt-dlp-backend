#!/usr/bin/env bash
set -euo pipefail

container_name="${CONTAINER_NAME:-yt-dlp-backend}"
image_name="${IMAGE_NAME:-yt-dlp-media-url-api}"
host_port="${HOST_PORT:-10001}"
container_port="${PORT:-10000}"
api_key="${API_KEY:-dev-secret}"

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

Set one of these env vars before running Docker:
  YTDLP_COOKIES_BASE64
  YOUTUBE_COOKIES_BASE64
  YTDLP_COOKIES_TEXT
  YOUTUBE_COOKIES_TEXT

For Codespaces secrets added after the codespace started, restart/rebuild the codespace,
or export the value manually in this terminal.
EOF
  exit 1
fi

docker rm -f "$container_name" >/dev/null 2>&1 || true
docker build -t "$image_name" .
docker run --rm \
  --name "$container_name" \
  -p "$host_port:$container_port" \
  -e API_KEY="$api_key" \
  -e "$cookie_env_name" \
  "$image_name"
