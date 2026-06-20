# yt-dlp API Backend Runbook

This runbook covers how to run the Docker backend locally and send requests to it.

Use this service only for media you own, control, or have permission to access.

## Files That Matter

- `Dockerfile`: builds the backend image.
- `main.py`: FastAPI app with the API endpoints.
- `requirements.txt`: Python dependencies.
- `render.yaml`: optional Render deployment config.
- `ui/`: separate static browser frontend.
- `cookies.txt`: local secret file if you need YouTube cookies. Do not commit it.

The Docker image runs the backend API only. The `ui/` browser frontend is separate and can be hosted anywhere static files are supported.

## Build The Image

Run from the `yt_dlp_api/` directory:

```bash
docker build -t yt-dlp-media-url-api .
```

If you are in the parent repo directory, run:

```bash
docker build -t yt-dlp-media-url-api ./yt_dlp_api
```

## Run The Backend

Without cookies:

```bash
docker run --rm --name yt-dlp-backend -p 10001:10000 yt-dlp-media-url-api
```

With cookies:

```bash
docker run --rm --name yt-dlp-backend -p 10001:10000 \
  --mount type=bind,src="$PWD/cookies.txt",dst=/run/secrets/youtube-cookies.txt,readonly \
  -e YTDLP_COOKIES_FILE=/run/secrets/youtube-cookies.txt \
  yt-dlp-media-url-api
```

The container listens on port `10000`. The host maps it to `10001`, so your local backend URL is:

```text
http://localhost:10001
```

## Run With An API Key

```bash
docker run --rm --name yt-dlp-backend -p 10001:10000 \
  -e API_KEY=dev-secret \
  yt-dlp-media-url-api
```

When `API_KEY` is set, send it as either:

```bash
-H "x-api-key: dev-secret"
```

or:

```bash
-H "Authorization: Bearer dev-secret"
```

## Stop The Backend

```bash
docker stop yt-dlp-backend
```

If you forgot the container name:

```bash
docker ps
docker stop <container-name-or-id>
```

If Docker says port `10001` is already allocated:

```bash
lsof -nP -iTCP:10001 -sTCP:LISTEN
docker ps
```

Then stop the container or process that is holding the port.

## Health Check

```bash
curl http://localhost:10001/health
```

Expected shape:

```json
{
  "ok": true,
  "yt_dlp_version": "...",
  "cookies": "configured",
  "js_runtimes": ["node"]
}
```

If cookies are not mounted, `cookies` will show `disabled`.

## API Docs

Open:

```text
http://localhost:10001/docs
```

FastAPI will show interactive docs for every endpoint.

## Resolve A Media URL

Use `POST /resolve` to ask `yt-dlp` for a direct media URL.

```bash
curl -X POST "http://localhost:10001/resolve" \
  -H "content-type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","video_format":"18"}'
```

With an API key:

```bash
curl -X POST "http://localhost:10001/resolve" \
  -H "content-type: application/json" \
  -H "x-api-key: dev-secret" \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","video_format":"18"}'
```

Useful response fields:

- `title`: resolved media title.
- `format_id`: selected format.
- `direct_url`: temporary direct media URL.
- `headers`: request headers that may be needed by the player.
- `expires_at`: estimated expiration time if detectable.

Direct URLs are temporary. Re-resolve them when playback fails or after they expire.

## Resolve With GET

```bash
curl "http://localhost:10001/resolve?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&video_format=18"
```

Use URL encoding for query parameters.

## List Available Formats

```bash
curl "http://localhost:10001/formats?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ"
```

Then choose a `format_id` and pass it back to `/resolve` or `/stream`.

Common browser-friendly options:

- `18`: often MP4 with audio and video.
- `best[height<=720][vcodec!=none][acodec!=none]/best[height<=720]/best`: auto-pick a playable stream.

## Stream Through The Backend

Use `/stream` when the browser or another device should play through your backend instead of using the raw `direct_url`.

```bash
curl -I "http://localhost:10001/stream?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&video_format=18"
```

It supports range requests, so browsers can seek in the video when the upstream source supports it.

## Use The Browser Frontend

The `ui/` folder is static HTML/CSS/JS. It searches YouTube from the browser with the YouTube Data API, fetches suggestions from YouTube/Google's public suggestion endpoint, and only calls the backend when resolving a selected video link.

Run it separately with the frontend dev server. It reads the root `.env` file and exposes only frontend config to the browser:

```bash
node ui/dev-server.mjs
```

Open:

```text
http://localhost:8080/?api=http%3A%2F%2Flocalhost%3A10001
```

The search page is:

```text
http://localhost:8080/
```

The frontend looks for the YouTube key in `.env` using `YOUTUBE_API_KEY`, `YOUTUBE_DATA_API_KEY`, `YT_API_KEY`, `YT_PUBLIC_API_KEY`, or the first non-empty raw line. Hyphenated names are normalized too. If your backend uses `API_KEY`, enter that value in the resolver key field or set `RESOLVER_API_KEY` in `.env`.

For another device on the same network, replace `localhost` with your computer's LAN IP:

```text
http://YOUR_LAN_IP:8080/?api=http%3A%2F%2FYOUR_LAN_IP%3A10001
```

## Deploy Backend From GitHub

Commit these backend files:

- `Dockerfile`
- `.dockerignore`
- `requirements.txt`
- `main.py`
- `__init__.py`
- `render.yaml` if using Render
- `README.yt-dlp-api.md`
- `RUNBOOK.md`

The `ui/` folder is deployed separately as static frontend assets.

Do not commit:

- `.venv/`
- `__pycache__/`
- `cookies.txt`
- `.env`
- real API keys

If the GitHub repo contains many folders, set the deployment root/build context to:

```text
yt_dlp_api
```

## Useful Environment Variables

- `PORT`: port inside the container. Defaults to `10000`.
- `API_KEY`: optional shared secret.
- `CORS_ORIGINS`: allowed browser origins. Defaults to `*`.
- `YTDLP_COOKIES_FILE`: path to mounted cookies file.
- `YTDLP_COOKIES_BASE64`: cookies as base64 text for hosted deployments.
- `REQUEST_TIMEOUT_SECONDS`: yt-dlp timeout. Default is `90`.
- `MAX_CONCURRENT_REQUESTS`: concurrent extraction limit. Default is `2`.
- `DEFAULT_FORMAT`: default yt-dlp format selector.

## Quick Troubleshooting

Port already allocated:

```bash
docker ps
docker stop yt-dlp-backend
```

No cookies:

```bash
curl http://localhost:10001/health
```

Check that `cookies` says `configured`.

Unauthorized:

Send `x-api-key` or remove the `API_KEY` environment variable when running locally.

Video does not play:

Try `/formats`, then use a combined audio/video `format_id` such as `18`, or use `/stream` instead of `direct_url`.
